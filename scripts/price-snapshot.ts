// 价格快照：抓 5 个伦敦现货（api.gold-api.com）与 5 个 COMEX/NYMEX 期货（Yahoo Finance），
// 统一字段后走 POST /api/ingest/items 推入，供首页行情带读取。
// 两组信源都是 participation_mode = isolated：框架保证它们到不了任何公开页面，也不进精选与日报。
//
// 用法：
//   node --env-file=.env scripts/price-snapshot.ts
//   node --env-file=.env scripts/price-snapshot.ts --dry-run     只打印将推送的内容
//   node --env-file=.env scripts/price-snapshot.ts --base http://api:3001
//   node --env-file=.env scripts/price-snapshot.ts --no-prune    跳过 24 小时清理
//
// 为什么 title 与 url 都带分钟（Spec §9.7 的旧约束已按本轮口径更新）：
// 原文说「url 里绝不能放时间戳」，那是**每日**快照下的结论——一天一条、identity 稳定。
// 现在口径是「涨跌幅 = 本次 vs 上一次快照」，一分钟一条，所以 identity 必须逐分钟不同：
// 否则同一篇会被 content_hash 判为「内容未变」而不生成新条目，涨跌幅永远算不出来。
//
// 代价与安全（已核实）：title 进 content_hash，所以每分钟内容哈希都会变，会触发 reviseMaterial()。
// 但这两个源都是 participation_mode = isolated，jobs/content.ts:89 的 settleNonEditorial() 会把
// 它们的 processing_state 直接置为 'skipped'，**不入队分析、零模型调用**。
// 已实测：推送后文章的 processing_state = 'skipped'、pgboss 里没有 analyze 作业。
// 换成 editorial 源之前不要改这个设计——那会变成每分钟 10 条 × 5-6 次模型调用。
//
// 价格绝不能进 title：价格每分钟变，那会让同一分钟的条目反复 revise，而它本来就不需要重跑。
//
// 单位陷阱：铜是美元/磅，金银铂钯是美元/盎司，原油是美元/桶。不标单位读者会拿 4 美元的铜和
// 4100 美元的金比量级。这不是显示层问题而是数据模型层问题，所以 unit 放在 raw 里由下游必读。
import postgres from "postgres";
import { fail, fetchText, log, pushItems, type IngestItem } from "./ingest-push.ts";

const SPOT_SOURCE_ID = "ext-price-snapshot";
const FUTURES_SOURCE_ID = "ext-futures-macro";
const SPOT_SOURCE_NAME = "伦敦现货价格快照";
const FUTURES_SOURCE_NAME = "COMEX/NYMEX 期货快照";
const SPOT_API = "https://api.gold-api.com/price";
const YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart";

/** 快照只留最近 24 小时：一年 525 万条会撑爆库，而行情数据读者只看当前价，不是新闻。 */
const RETENTION_HOURS = 24;

/**
 * 品种顺序是本站的展示顺序：黄金 → 白银 → 铂金 → 钯金 → 铜。
 * 同类连续 > 单项最优，顺序本身就是分类信息。绝不按 API 返回顺序排（外部接口的顺序没有语义）。
 *
 * 期货这组用 Yahoo 的连续合约（GC=F 等），exchange 取接口自报的 fullExchangeName，
 * 不自己写死——写死就会在 Yahoo 改代码时悄悄过期。
 */
const SPOT = [
  { symbol: "XAU", name: "黄金", unit: "USD/oz", decimals: 2 },
  { symbol: "XAG", name: "白银", unit: "USD/oz", decimals: 3 },
  { symbol: "XPT", name: "铂金", unit: "USD/oz", decimals: 2 },
  { symbol: "XPD", name: "钯金", unit: "USD/oz", decimals: 2 },
  { symbol: "HG", name: "铜", unit: "USD/lb", decimals: 2 }, // 铜是美元/磅，不是美元/盎司
] as const;

const FUTURES = [
  { symbol: "GC=F", name: "黄金", unit: "USD/oz", decimals: 2 },
  { symbol: "SI=F", name: "白银", unit: "USD/oz", decimals: 3 },
  { symbol: "HG=F", name: "铜", unit: "USD/lb", decimals: 3 },
  { symbol: "PL=F", name: "铂金", unit: "USD/oz", decimals: 1 },
  { symbol: "PA=F", name: "钯金", unit: "USD/oz", decimals: 1 },
] as const;

/** 两种来源的字段名不同，这里归一成下游唯一要认的一种。 */
interface Quote {
  price: number;
  quotedAt: string;
  exchange: string;
}

function beijingMinute(iso: string): string {
  const shifted = new Date(new Date(iso).getTime() + 8 * 3_600_000);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(shifted.getUTCFullYear(), 4)}-${p(shifted.getUTCMonth() + 1)}-${p(shifted.getUTCDate())}-${p(shifted.getUTCHours())}${p(shifted.getUTCMinutes())}`;
}

/** 报价时刻距今超过 24h 说明接口没在更新；推进去会让读者看到一个昨天的价格。 */
function assertFresh(stamp: string, expected: string): string {
  const time = new Date(stamp).getTime();
  if (!Number.isFinite(time)) fail(`${expected}: 报价时刻不是合法时间`);
  const ageHours = (Date.now() - time) / 3_600_000;
  if (ageHours > RETENTION_HOURS) fail(`${expected}: 报价时刻距今 ${ageHours.toFixed(1)} 小时，超过 ${RETENTION_HOURS}h`);
  return stamp;
}

function parseSpot(text: string, expected: string): Quote {
  const parsed = JSON.parse(text) as { price?: unknown; symbol?: unknown; updatedAt?: unknown };
  if (typeof parsed.price !== "number" || !Number.isFinite(parsed.price)) throw new Error(`返回里没有可用的 price`);
  if (parsed.symbol !== expected) throw new Error(`返回的 symbol 是 ${String(parsed.symbol)}，与请求不一致`);
  if (typeof parsed.updatedAt !== "string" || !parsed.updatedAt) throw new Error(`返回里没有 updatedAt`);
  return { price: parsed.price, quotedAt: assertFresh(parsed.updatedAt, expected), exchange: "伦敦现货" };
}

function parseFutures(text: string, expected: string): Quote {
  const parsed = JSON.parse(text) as {
    chart?: { result?: Array<{ meta?: Record<string, unknown> }> | null; error?: unknown };
  };
  const failure = parsed.chart?.error;
  if (failure) throw new Error(`Yahoo 返回错误：${JSON.stringify(failure).slice(0, 120)}`);
  const meta = parsed.chart?.result?.[0]?.meta;
  if (!meta) throw new Error("返回里没有 chart.result[0].meta");
  const price = meta.regularMarketPrice;
  if (typeof price !== "number" || !Number.isFinite(price)) throw new Error("返回里没有可用的 regularMarketPrice");
  const epoch = meta.regularMarketTime;
  if (typeof epoch !== "number" || !Number.isFinite(epoch)) throw new Error("返回里没有 regularMarketTime");
  // exchange 用接口自报的，不写死：写死就会在 Yahoo 换代码时悄悄过期。
  const exchange = typeof meta.fullExchangeName === "string" && meta.fullExchangeName ? meta.fullExchangeName : String(meta.exchangeName ?? expected);
  return { price, quotedAt: assertFresh(new Date(epoch * 1000).toISOString(), expected), exchange };
}

function item(variety: { symbol: string; name: string; unit: string; decimals: number }, quote: Quote, group: "spot" | "futures", endpoint: string): IngestItem {
  const minute = beijingMinute(quote.quotedAt);
  return {
    // title 含分钟（逐分钟一条）与品种码、中文名；价格只进 raw。
    title: `[${variety.symbol}] ${variety.name}价格快照 · ${minute}`,
    url: `https://snapshot.metalsmacro.local/${group}/${encodeURIComponent(variety.symbol)}/${minute}`,
    publishedAt: quote.quotedAt,
    raw: {
      symbol: variety.symbol,
      name: variety.name,
      price: quote.price,
      unit: variety.unit, // 数据模型层字段，下游必须用它
      decimals: variety.decimals,
      quotedAt: quote.quotedAt,
      exchange: quote.exchange,
      market: group === "spot" ? "伦敦现货" : "期货",
      source: group === "spot" ? "gold-api" : "yahoo-finance",
      endpoint,
    },
  };
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const spotItems: IngestItem[] = [];
const futuresItems: IngestItem[] = [];
const failed: string[] = [];

// 单个品种失败只记下来，不中断整批：一个品种挂了就少一格，读者还能看另外 9 格。
// 中断则是 10 格全空——这正是用户抱怨「更新频率不准」时最不该有的表现。
for (const variety of SPOT) {
  const endpoint = `${SPOT_API}/${variety.symbol}`;
  try {
    const quote = parseSpot(await fetchText(endpoint), variety.symbol);
    spotItems.push(item(variety, quote, "spot", endpoint));
    log(`现货 ${variety.symbol} ${variety.name}  ${quote.price} ${variety.unit}  ${quote.quotedAt}`);
  } catch (error) {
    failed.push(`现货 ${variety.symbol}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

for (const variety of FUTURES) {
  // symbol 里的 = 必须编码，否则 Yahoo 返回 400。
  const endpoint = `${YAHOO_CHART}/${encodeURIComponent(variety.symbol)}?range=5d&interval=1d`;
  try {
    const quote = parseFutures(await fetchText(endpoint), variety.symbol);
    futuresItems.push(item(variety, quote, "futures", endpoint));
    log(`期货 ${variety.symbol} ${variety.name}  ${quote.price} ${variety.unit}  ${quote.exchange}  ${quote.quotedAt}`);
  } catch (error) {
    failed.push(`期货 ${variety.symbol}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failed.length) {
  log(`以下品种抓取失败（其余照常推送）：`);
  for (const reason of failed) log(`  ${reason}`);
}
if (!spotItems.length && !futuresItems.length) fail("两个来源一个品种都没抓到，不推送");

/** 只删 articles：publications/analyses 有外键引用它们，删父行会报错或留下悬空引用。 */
async function pruneOld(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    log("提示：DATABASE_URL 未设置，跳过 24 小时清理");
    return;
  }
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const rows = await sql<{ source_id: string }[]>`
      DELETE FROM articles a USING sources s
      WHERE a.source_id = s.id
        AND s.id IN (${SPOT_SOURCE_ID}, ${FUTURES_SOURCE_ID})
        AND a.published_at < now() - make_interval(hours => ${RETENTION_HOURS})
      RETURNING s.id AS source_id`;
    const total = rows.length;
    if (total) log(`已清理 ${RETENTION_HOURS} 小时前的快照 ${total} 条（${[...new Set(rows.map((r) => r.source_id))].join("、")}）`);
    else log(`没有超过 ${RETENTION_HOURS} 小时的快照需要清理`);
  } finally {
    await sql.end();
  }
}

const baseUrl = arg("base") ?? process.env.SITE_URL ?? "http://localhost:3000";
const dryRun = process.argv.includes("--dry-run");
log(`目标站点 ${baseUrl}（${dryRun ? "试运行" : "正式推送"}）`);
if (!dryRun && !process.argv.includes("--no-prune")) await pruneOld();
const created = (await pushItems(spotItems, { sourceId: SPOT_SOURCE_ID, sourceName: SPOT_SOURCE_NAME, baseUrl, dryRun }))
  + (await pushItems(futuresItems, { sourceId: FUTURES_SOURCE_ID, sourceName: FUTURES_SOURCE_NAME, baseUrl, dryRun }));
if (!dryRun) {
  const total = spotItems.length + futuresItems.length;
  log(`推送完成：${total} 条（现货 ${spotItems.length}、期货 ${futuresItems.length}），服务端新建 ${created} 条`);
  // created 小于条目数是正常的：同一 symbol 同一分钟的快照是同一篇，重复推送会命中 identity_key。
  if (created === 0) log("提示：本次全部命中已有条目（这一分钟已推送过），未新建");
}
