// 每日价格快照：抓 api.gold-api.com 的 5 个品种，组装成条目后走 POST /api/ingest/items 推入。
// 供首页行情带读取，不进精选与日报（信源 participation_mode = isolated，框架保证它到不了任何公开页面）。
//
// 用法：
//   node --env-file=.env scripts/price-snapshot.ts
//   node --env-file=.env scripts/price-snapshot.ts --dry-run     只打印将推送的内容
//   node --env-file=.env scripts/price-snapshot.ts --base http://localhost:3001
//
// 两条硬约束（Spec §9.7）：
// 1. title 绝不能含价格。title 参与 content_hash，价格每日变就会 reviseMaterial() 重跑整条管道
//    （5-6 次模型调用/条）。正确格式：`[XAU] 黄金价格快照 · 2026-10-05`，只有日期变。
// 2. url 必须是 https://snapshot.metalsmacro.local/{symbol}/{yyyy-mm-dd}。
//    外部 URL 不可达，identityKey 只做规范化不校验可达性；每日不同所以天然是不同条目，满足旧文不刷屏。
//    urlTemplate 里绝不能放时间戳或 token（每次 identityKey 都不同 → 无限增长 + 每次全管道重跑）。
//
// 单位陷阱：HG（铜）是美元/磅，金银铂钯是美元/盎司。不标单位读者会拿 4 美元的铜和 4100 美元的金比量级。
// 这不是显示层问题而是数据模型层问题，所以 unit 放在 raw 里，下游行情带、摘要与将来的 quotes 模块都要用。
import { beijingDate } from "@aihot/contracts/time";
import { fail, fetchText, log, pushItems, type IngestItem } from "./ingest-push.ts";

const SOURCE_ID = "ext-price-snapshot";
const SOURCE_NAME = "每日价格快照";
const API_BASE = "https://api.gold-api.com/price";

/**
 * 品种顺序是本站的展示顺序：黄金 → 白银 → 铂金 → 钯金 → 铜。
 * 同类连续 > 单项最优，顺序本身就是分类信息。绝不按 API 返回顺序排（外部接口的顺序没有语义）。
 */
const VARIETIES = [
  { symbol: "XAU", name: "黄金", unit: "USD/oz", decimals: 2 },
  { symbol: "XAG", name: "白银", unit: "USD/oz", decimals: 3 },
  { symbol: "XPT", name: "铂金", unit: "USD/oz", decimals: 2 },
  { symbol: "XPD", name: "钯金", unit: "USD/oz", decimals: 2 },
  { symbol: "HG", name: "铜", unit: "USD/lb", decimals: 2 }, // 铜是美元/磅，不是美元/盎司
] as const;

interface Quote {
  price: number;
  symbol: string;
  updatedAt: string;
}

function parseQuote(text: string, expected: string): Quote {
  const parsed = JSON.parse(text) as Partial<Quote>;
  if (typeof parsed.price !== "number" || !Number.isFinite(parsed.price)) throw new Error(`${expected}: 返回里没有可用的 price`);
  if (parsed.symbol !== expected) throw new Error(`${expected}: 返回的 symbol 是 ${String(parsed.symbol)}，与请求不一致`);
  if (typeof parsed.updatedAt !== "string" || !parsed.updatedAt) throw new Error(`${expected}: 返回里没有 updatedAt`);
  const stamp = new Date(parsed.updatedAt);
  if (!Number.isFinite(stamp.getTime())) throw new Error(`${expected}: updatedAt 不是合法时间`);
  // updatedAt 是 publishedAt 的来源。距今超过 48h 会被判 stale-on-discovery 静默归档，
  // 所以过期数据宁可报出来也不要推进去。
  const ageHours = (Date.now() - stamp.getTime()) / 3_600_000;
  if (ageHours > 48) throw new Error(`${expected}: updatedAt 距今 ${ageHours.toFixed(1)} 小时，超过 48h，推进去会被静默归档`);
  return { price: parsed.price, symbol: parsed.symbol, updatedAt: parsed.updatedAt };
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const items: IngestItem[] = [];
for (const variety of VARIETIES) {
  const text = await fetchText(`${API_BASE}/${variety.symbol}`);
  const quote = parseQuote(text, variety.symbol);
  // 日期取该报价自身的 updatedAt 所在北京日，而不是"今天"：
  // 周末与假期接口不更新，用今天会造出一条与真实报价对不上的日期。
  const date = beijingDate(quote.updatedAt);
  items.push({
    // title 只含品种码、中文名与日期。价格、涨跌幅、updatedAt 全部只进 raw。
    title: `[${variety.symbol}] ${variety.name}价格快照 · ${date}`,
    url: `https://snapshot.metalsmacro.local/${variety.symbol}/${date}`,
    publishedAt: quote.updatedAt,
    raw: {
      symbol: variety.symbol,
      name: variety.name,
      price: quote.price,
      unit: variety.unit, // 数据模型层字段，下游必须用它
      decimals: variety.decimals,
      updatedAt: quote.updatedAt,
      source: "gold-api",
      endpoint: `${API_BASE}/${variety.symbol}`,
    },
  });
  log(`${variety.symbol} ${variety.name}  ${quote.price} ${variety.unit}  ${quote.updatedAt}`);
}

const baseUrl = arg("base") ?? process.env.SITE_URL ?? "http://localhost:3000";
const dryRun = process.argv.includes("--dry-run");
log(`目标站点 ${baseUrl}（${dryRun ? "试运行" : "正式推送"}）`);
const created = await pushItems(items, { sourceId: SOURCE_ID, sourceName: SOURCE_NAME, baseUrl, dryRun });
if (!dryRun) {
  log(`推送完成：${items.length} 条，服务端新建 ${created} 条`);
  // created 小于条目数是正常的：同一 symbol 同一天的快照是同一篇，重复推送会命中 identity_key。
  if (created === 0) log("提示：本次全部命中已有条目（今日已推送过），未新建");
}
