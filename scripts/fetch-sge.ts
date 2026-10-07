// 上金所（SGE）国内金属快照：抓 Dailyhq 接口的 4 个品种，取最后一个交易日的收盘价推入。
// 与 scripts/price-snapshot.ts（国际美元价）并列，构成行情带的第二行「国内金属」。
//
// 用法：
//   node scripts/fetch-sge.ts
//   node scripts/fetch-sge.ts --dry-run
//   node scripts/fetch-sge.ts --base http://api:3001
//
// ⚠️ **上金所有 WAF，短时间内连发请求会被 403 挡掉。** 实测：4 个品种连发（无间隔）→ 全部 403
// 「您的访问请求可能对网站造成安全威胁，请求已被阻断」；间隔 3-5 秒逐个请求 → 全部 200。
// 所以下面每个品种之间 sleep(REQUEST_GAP_MS)，并且 403 走退避重试。
// **不要为了快把它改成并发**——那会把这个脚本变成每天都拿不到数据的脚本。
//
// 为什么用 Dailyhq 而不是 sjzx/quotation_daily_new：后者是 JS 渲染的页面，HTTP 200 / 73KB 但
// HTML 里没有表格（解析出「表格行数 1」）。Dailyhq 直接给 JSON，且自带 2016 年至今的全部历史。
//
// 为什么只推一天、历史不入库：这个接口一次给 2375 个点，逐日入库就是百万级行。行情数据读者只看
// 当前价。历史由 GET /api/site/quote-trend 按需实时拉，不落库。
//
// 单位是**人民币/克**，和国际美元/盎司不是一回事，unit 必须写 CNY/g。
// 混了单位读者会拿 909 元/克 和 4171 美元/盎司 比量级。
import { fail, fetchText, log, pushItems, type IngestItem } from "./ingest-push.ts";

const SOURCE_ID = "ext-sge";
const SOURCE_NAME = "上海黄金交易所快照";
const SGE_DAILYHQ = "https://www.sge.com.cn/graph/Dailyhq";
/** 上金所收盘时间（北京时区）。publishedAt 用「最后交易日 + 收盘时刻」，不是脚本运行时刻。 */
const CLOSE_HOUR_BEIJING = 15;
/** 品种之间的间隔。低于 3 秒会被 WAF 挡（见文件头）。 */
const REQUEST_GAP_MS = 3_500;

/**
 * 展示顺序：金 → 银 → 铂，与第一行的国际品种一致，读者的扫视路径才连续。
 * instid 里的括号与加号必须 URL 编码，否则请求打到错误的品种上。
 */
const VARIETIES = [
  { instid: "Au99.99", name: "黄金99.99", decimals: 2 },
  { instid: "Ag(T+D)", name: "白银延期", decimals: 0 },
  { instid: "Pt99.95", name: "铂金99.95", decimals: 2 },
  { instid: "mAu(T+D)", name: "黄金延期", decimals: 2 },
] as const;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** `time` 每行是 [日期, 开, 高, 低, 收]。只取收盘价——日内最高最低对「现在多少钱」没有意义。 */
interface SgeRow {
  date: string;
  close: number;
}

function parseDaily(text: string, instid: string): SgeRow {
  const parsed = JSON.parse(text) as { time?: unknown };
  if (!Array.isArray(parsed.time) || !parsed.time.length) throw new Error("返回里没有 time 数组");
  const last = parsed.time[parsed.time.length - 1] as unknown;
  if (!Array.isArray(last) || last.length < 5) throw new Error(`最后一行不是 [日期,开,高,低,收]：${JSON.stringify(last).slice(0, 80)}`);
  const [date, , , , close] = last as [string, unknown, unknown, unknown, unknown];
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`日期格式不是 YYYY-MM-DD：${String(date)}`);
  const value = Number(close);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`收盘价不是正数：${String(close)}`);
  return { date, close: value };
}

/** 北京时区把「最后交易日 + 收盘时刻」拼成 ISO 时刻。数据里的日期就是交易日，不能换成「今天」。 */
function closeAt(date: string): string {
  // 北京 15:00 = UTC 07:00。用 Date.UTC 显式构造，避免宿主机时区影响结果。
  return new Date(`${date}T${String(CLOSE_HOUR_BEIJING).padStart(2, "0")}:00:00+08:00`).toISOString();
}

function stamp(date: string): string {
  return date.replaceAll("-", "");
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const items: IngestItem[] = [];
const failed: string[] = [];

for (const [index, variety] of VARIETIES.entries()) {
  if (index > 0) await sleep(REQUEST_GAP_MS); // WAF：见文件头，不能去掉
  const endpoint = `${SGE_DAILYHQ}?instid=${encodeURIComponent(variety.instid)}`;
  try {
    const row = parseDaily(await fetchText(endpoint, 2), variety.instid);
    const quotedAt = closeAt(row.date);
    // 过期检查：上金所国庆休市时最新数据会停在节前，跨很多天都属正常，所以窗口放到 10 天。
    // 超过 10 天说明接口坏了或者我们解析错了，宁可报错也不要推进一个陈旧价格。
    const ageDays = (Date.now() - new Date(quotedAt).getTime()) / 86_400_000;
    if (ageDays > 10) throw new Error(`最后交易日 ${row.date} 距今 ${ageDays.toFixed(1)} 天，超过 10 天`);
    items.push({
      title: `[${variety.instid}] ${variety.name}收盘 · ${row.date}`,
      url: `https://snapshot.metalsmacro.local/sge/${encodeURIComponent(variety.instid)}/${stamp(row.date)}`,
      publishedAt: quotedAt,
      raw: {
        symbol: variety.instid,
        name: variety.name,
        price: row.close,
        unit: "CNY/g", // 数据模型层字段：人民币/克，与国际美元/盎司不可混
        decimals: variety.decimals,
        quotedAt,
        exchange: "上海黄金交易所",
        market: "国内现货",
        source: "sge",
        endpoint,
      },
    });
    log(`${variety.instid} ${variety.name}  ${row.close} CNY/g  交易日 ${row.date}`);
  } catch (error) {
    failed.push(`${variety.instid}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failed.length) {
  log("以下品种抓取失败（其余照常推送）：");
  for (const reason of failed) log(`  ${reason}`);
}
if (!items.length) fail("四个品种一个都没抓到，不推送");

const baseUrl = arg("base") ?? process.env.SITE_URL ?? "http://localhost:3000";
const dryRun = process.argv.includes("--dry-run");
log(`目标站点 ${baseUrl}（${dryRun ? "试运行" : "正式推送"}）`);
const created = await pushItems(items, { sourceId: SOURCE_ID, sourceName: SOURCE_NAME, baseUrl, dryRun });
if (!dryRun) {
  log(`推送完成：${items.length} 条，服务端新建 ${created} 条`);
  // 同一交易日的快照是同一篇，重复推送会命中 identity_key。日频调度下 created=0 是正常的。
  if (created === 0) log("提示：本次全部命中已有条目（该交易日已推送过），未新建");
}
