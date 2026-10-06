// 本机定时脚本共用的推送通道：把组装好的条目 POST 到 /api/ingest/items。
// 走这条通道的源在 industry/sources.json 里配成 kind=external，由服务端 upsert；
// 脚本只负责取数、组装、按 MAX_ITEMS 分批、失败重试与落日志。
//
// 硬约束（违反会白烧模型调用或让内容永远不出现）：
// 1. title 绝对不能含会变的数值（价格、持仓、涨跌幅）。title 参与 content_hash，
//    数值每天变就会 reviseMaterial() 重跑整条管道（5-6 次模型调用/条）。
//    正确格式：`[XAU] 黄金价格快照 · 2026-10-05`（只有日期变）。
// 2. url 必须是每期/每日不同的稳定地址，不能带时间戳或 token。
//    identityKeyForUrl 规范化后若每次都不同，会无限增长 + 每次全管道重跑。
// 3. publishedAt 必须是真实发布时间，且距发现不超过 48h，否则走
//    backfillReason="stale-on-discovery" 静默归档（不报错、不告警、内容永不出来）。
// 4. 单次最多 50 条，超出返回 413，所以要分批。

/** 服务端 ingestItems() 的硬上限（packages/backend/src/ingest/items.ts:9）。 */
export const MAX_ITEMS_PER_REQUEST = 50;

export interface IngestItem {
  title: string;
  url: string;
  publishedAt: string;
  author?: string;
  /**
   * 条目正文。推送型信源（官方统计、行情快照）没有可抓取的页面，模型分析时只看得到
   * articles.body_text，看不到 raw，所以正文必须由脚本把结构化数据渲染成人类可读的文本。
   */
  body?: string;
  raw?: Record<string, unknown>;
}

export interface PushOptions {
  /** 站内 sourceId，必须与 industry/sources.json 里的 id 一致，否则服务端会建成另一个源。 */
  sourceId: string;
  sourceName: string;
  /** 目标站点，如 http://localhost:3000 */
  baseUrl: string;
  /** 缺省读环境变量 INGEST_TOKEN（至少 16 位，服务端会拒收占位符）。 */
  token?: string;
  /** 每批条数，默认 MAX_ITEMS_PER_REQUEST。 */
  batchSize?: number;
  /** 失败重试次数（不含首次），默认 3；只在网络错误与 5xx 上重试。 */
  retries?: number;
  /** 试运行：只打印将推送的内容，不发请求。 */
  dryRun?: boolean;
}

/** 统一日志：显式 UTF-8，避免 Windows 控制台把中文与符号输出成乱码。 */
export function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

export function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 推一批条目，返回服务端报告的 created 条数。4xx（含 413 与 401）不重试：
 * 重试一个格式错误的请求只是把同一个错误重复若干次。
 */
async function pushBatch(body: unknown, options: PushOptions, token: string, batchIndex: number, totalBatches: number): Promise<number> {
  const endpoint = `${options.baseUrl.replace(/\/+$/, "")}/api/ingest/items`;
  const retries = options.retries ?? 3;
  let lastError = "";

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      // 指数退避：1s、2s、4s。官方站点在整点前后最慢，退避比紧着重试更有用。
      const backoff = 1000 * 2 ** (attempt - 1);
      log(`  第 ${batchIndex + 1}/${totalBatches} 批第 ${attempt} 次重试，等待 ${backoff}ms`);
      await sleep(backoff);
    }
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8", authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
    } catch (error) {
      // 网络层失败（站点没起、DNS、超时）值得重试。
      lastError = error instanceof Error ? error.message : String(error);
      continue;
    }
    const text = await response.text();
    if (response.ok) {
      const parsed = JSON.parse(text) as { created?: number };
      return typeof parsed.created === "number" ? parsed.created : 0;
    }
    lastError = `HTTP ${response.status} ${text.slice(0, 200)}`;
    if (response.status < 500) {
      // 4xx 是请求本身的问题（token 不对、条目为空、超过 50 条），重试没有意义。
      throw new Error(`推送被拒绝：${lastError}`);
    }
  }
  throw new Error(`推送失败（已重试 ${retries} 次）：${lastError}`);
}

/** 分批推送。返回服务端报告的 created 合计。 */
export async function pushItems(items: IngestItem[], options: PushOptions): Promise<number> {
  if (!items.length) {
    log("没有可推送的条目");
    return 0;
  }
  if (items.length > MAX_ITEMS_PER_REQUEST) {
    // 不是错误，但值得提醒：一次超 50 条会被 413 拒收。
    log(`提示：本次 ${items.length} 条，将分批推送（单次上限 ${MAX_ITEMS_PER_REQUEST}）`);
  }
  if (options.dryRun) {
    log(`试运行：${items.length} 条，未发送`);
    for (const item of items) log(`  ${item.publishedAt}  ${item.title}  ${item.url}`);
    return 0;
  }
  const token = options.token ?? process.env.INGEST_TOKEN ?? "";
  if (token.length < 16) {
    fail("INGEST_TOKEN 未设置或少于 16 位，服务端会拒绝所有推送");
  }
  const size = Math.min(options.batchSize ?? MAX_ITEMS_PER_REQUEST, MAX_ITEMS_PER_REQUEST);
  const batches: IngestItem[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));

  let created = 0;
  for (const [index, batch] of batches.entries()) {
    created += await pushBatch({ sourceId: options.sourceId, sourceName: options.sourceName, items: batch }, options, token, index, batches.length);
  }
  return created;
}

/** 带重试的 GET，返回文本。用于官方数据接口（CFTC 457KB、gold-api 单对象）。 */
export async function fetchText(url: string, retries = 3, timeoutMs = 60_000): Promise<string> {
  let lastError = "";
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1));
    try {
      const response = await fetch(url, {
        headers: { "user-agent": "MetalsMacroBot/1.0 (+https://github.com/KKKKhazix/AIHOT)", accept: "*/*" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) return await response.text();
      lastError = `HTTP ${response.status}`;
      // 4xx（除 429）重试无意义。
      if (response.status < 500 && response.status !== 429) throw new Error(`请求失败：${lastError}`);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (lastError.startsWith("请求失败")) throw error;
    }
  }
  throw new Error(`抓取失败（已重试 ${retries} 次）：${lastError}`);
}
