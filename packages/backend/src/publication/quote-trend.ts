// 行情趋势：从上游实时拉历史，返回该区间的日收盘序列。
//
// 为什么不读我们自己的快照库：快照库只留 24 小时（RETENTION），取不到任何历史。
// 趋势要的是「三个月怎么走的」，那是上游的序列，不是我们的采样。
//
// 两个上游，格式不同，这里归一成一种：
//   Yahoo（国际期货 GC=F 等）: /v8/finance/chart/{sym}?range={r}&interval=1d -> timestamp[] + indicators.quote[0].close[]
//   上金所（Au99.99 等）:      /graph/Dailyhq?instid={instid}                -> time[[日期,开,高,低,收]]
//
// 缓存：SGE 一天只变一次、Yahoo 盘中每分钟变，所以按「品种 + 区间」做一层进程内 TTL 缓存。
// 缓存 TTL 分开：Yahoo 60 秒（够挡住重复点击，又不至于拿一整天的旧图）；SGE 1 小时（日频数据）。
// 这是缓存不是状态：不写库、不跨进程，重启即失效，这正是我们想要的。
//
// ⚠️ 上金所有 WAF，短时间内连发会 403。缓存显著降低了这方面的压力，但首次拉取仍是逐个请求。
// The shapes live in the contract, not here: the page and this module must agree on them, and two
// copies of the same interface is exactly how they stop agreeing.
import { TREND_RANGES, type QuoteSymbol, type TrendPoint, type TrendRange, type TrendSeries } from "@aihot/contracts/site";

const YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart";
const SGE_DAILYHQ = "https://www.sge.com.cn/graph/Dailyhq";

const YAHOO_TTL_MS = 60_000;
const SGE_TTL_MS = 3_600_000;
const cache = new Map<string, { at: number; series: TrendSeries }>();

/** The SGE series changes once a day, so there is no reason to refetch it inside an hour. */
function ttlFor(symbol: string): number {
  return SGE_SYMBOLS.has(symbol) ? SGE_TTL_MS : YAHOO_TTL_MS;
}

const SGE_SYMBOLS = new Set(["Au99.99", "Ag(T+D)", "Pt99.95", "mAu(T+D)"]);
const SGE_UNIT = "CNY/g";
const SGE_EXCHANGE = "上海黄金交易所";

/** Yahoo's own unit per contract: copper is dollars per pound, the rest dollars per troy ounce. */
const YAHOO_UNITS: Record<string, string> = {
  "GC=F": "USD/oz",
  "SI=F": "USD/oz",
  "PL=F": "USD/oz",
  "PA=F": "USD/oz",
  "HG=F": "USD/lb",
};

const USER_AGENT = "MetalsMacroBot/1.0 (+https://github.com/KKKKhazix/AIHOT)";

function isRange(value: string): value is TrendRange {
  return (TREND_RANGES as readonly string[]).includes(value);
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "application/json, */*" }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`上游返回 HTTP ${response.status}`);
  return await response.json();
}

function isoDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

async function yahooSeries(symbol: QuoteSymbol, range: TrendRange): Promise<TrendSeries> {
  const url = `${YAHOO_CHART}/${encodeURIComponent(symbol)}?range=${range}&interval=1d`;
  const parsed = (await fetchJson(url)) as {
    chart?: { result?: Array<{ timestamp?: number[]; meta?: Record<string, unknown>; indicators?: { quote?: Array<{ close?: Array<number | null> }> } }> | null };
  };
  const result = parsed.chart?.result?.[0];
  const stamps = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const points: TrendPoint[] = [];
  for (const [index, stamp] of stamps.entries()) {
    const close = closes[index];
    // A null close is a session Yahoo has no settle for; skip it rather than plot a zero.
    if (typeof close !== "number" || !Number.isFinite(close)) continue;
    points.push({ date: isoDate(stamp), close });
  }
  return { symbol, range, points, source: "yahoo-finance", exchange: String(result?.meta?.fullExchangeName ?? result?.meta?.exchangeName ?? "期货"), unit: YAHOO_UNITS[symbol] ?? null, empty: points.length === 0 };
}

/** SGE returns the whole history every time, so the window is trimmed here rather than by the API. */
async function sgeSeries(symbol: QuoteSymbol, range: TrendRange): Promise<TrendSeries> {
  const url = `${SGE_DAILYHQ}?instid=${encodeURIComponent(symbol)}`;
  const parsed = (await fetchJson(url)) as { time?: unknown };
  if (!Array.isArray(parsed.time)) throw new Error("上金所返回里没有 time 数组");
  const rows = parsed.time as Array<[string, ...unknown[]]>;
  const days = { "1d": 2, "1mo": 31, "3mo": 92, "1y": 366 }[range];
  const points: TrendPoint[] = [];
  for (const row of rows.slice(-days)) {
    const [date, , , , close] = row;
    const value = Number(close);
    if (typeof date !== "string" || !Number.isFinite(value)) continue;
    points.push({ date, close: value });
  }
  return { symbol, range, points, source: "sge", exchange: SGE_EXCHANGE, unit: SGE_UNIT, empty: points.length === 0 };
}

/**
 * The series for one variety over one range. `range` must already be validated by the caller
 * (the route does that against TREND_RANGES) so an arbitrary string never reaches the upstream.
 */
export async function quoteTrend(symbol: QuoteSymbol, range: TrendRange): Promise<TrendSeries> {
  const key = `${symbol}|${range}`;
  const hit = cache.get(key);
  const ttl = ttlFor(symbol);
  if (hit && Date.now() - hit.at < ttl) return hit.series;
  const series = SGE_SYMBOLS.has(symbol) ? await sgeSeries(symbol, range) : await yahooSeries(symbol, range);
  cache.set(key, { at: Date.now(), series });
  return series;
}

export { isRange, TREND_RANGES };
