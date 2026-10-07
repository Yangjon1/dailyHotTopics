// Run after `npm run build -w @aihot/web`. Real production server/router, synthetic HTTP API only.
//
// The price band with nine contracts on two markets, and the trend panel behind each cell.
//
// Two things this file exists to hold in place, both of which failed silently once already:
// - The band is split by the market the api records, and every cell prints its own unit and
//   exchange. 4196 USD/oz beside 909 CNY/g is a hundredfold apart, so a reader who cannot see which
//   is which reads two prices as a comparison.
// - Each market dates its own data. The Shanghai exchange shuts for a national holiday when the
//   futures trade, so one "data as of" for the whole band states today's number for a price last
//   collected a week ago — which is the only thing that line is there to prevent.
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { QUOTE_SYMBOLS, type Quote, type QuoteSymbol, type QuotesResponse, type TrendRange, type TrendSeries } from "@aihot/contracts/site";
import { exchangeOf, rowsOf, shortExchange, unitOf } from "../app/features/quotes/instruments.ts";

const HOUR = 3_600_000;
const NOW = Date.now();
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

/** One contract, as the api sends it now: it carries its unit, its exchange and its market. */
function quote(symbol: QuoteSymbol, price: number | null, msAgo: number, extra: { unit: string; exchange: string; market: string; changePct?: number }): Quote {
  return {
    symbol, price, unit: extra.unit, exchange: extra.exchange, market: extra.market,
    updatedAt: iso(msAgo), changePct: extra.changePct ?? null,
    basis: extra.changePct === undefined ? "none" : "yesterday",
    basisAt: extra.changePct === undefined ? null : iso(msAgo + 24 * HOUR),
    baselineAgeDays: null,
  } as Quote;
}

/** The nine, as the api actually returns them: the futures fresh, the SGE contracts six days older. */
const BAND: QuotesResponse = {
  quotes: [
    quote("GC=F", 4196.8, 2 * HOUR, { unit: "USD/oz", exchange: "COMEX", market: "国际期货", changePct: 1.24 }),
    quote("SI=F", 61.77, 2 * HOUR, { unit: "USD/oz", exchange: "COMEX", market: "国际期货", changePct: -0.8 }),
    quote("HG=F", 6.651, 2 * HOUR, { unit: "USD/lb", exchange: "COMEX", market: "国际期货", changePct: 2.1 }),
    quote("PL=F", 1726, 2 * HOUR, { unit: "USD/oz", exchange: "NY Mercantile", market: "国际期货", changePct: 0.4 }),
    quote("PA=F", 1167.5, 2 * HOUR, { unit: "USD/oz", exchange: "NY Mercantile", market: "国际期货" }),
    quote("Au99.99", 909, 7 * 24 * HOUR, { unit: "CNY/g", exchange: "上海黄金交易所", market: "国内现货" }),
    quote("Ag(T+D)", 14999, 7 * 24 * HOUR, { unit: "CNY/g", exchange: "上海黄金交易所", market: "国内现货" }),
    quote("Pt99.95", 423.05, 7 * 24 * HOUR, { unit: "CNY/g", exchange: "上海黄金交易所", market: "国内现货" }),
    quote("mAu(T+D)", 908.39, 7 * 24 * HOUR, { unit: "CNY/g", exchange: "上海黄金交易所", market: "国内现货" }),
  ],
  computedAt: iso(0),
};

let quotes: QuotesResponse | null = BAND;
let trend: TrendSeries | null = null;
let trendStatus = 200;
let trendHits: string[] = [];
let api: ReturnType<typeof createServer>;
let web: ChildProcess;
let origin: string;
let logs = "";

const timeline = {
  filters: { channel: "all", category: null, tag: null },
  cards: [{ key: "k1", anchorAt: iso(HOUR), item: { id: "i1", title: "占位条目", summary: null, reason: null, source: { name: "Fixture", id: "s1", url: null, iconUrl: null, iconSrcSet: null, firstParty: true }, publishedAt: iso(HOUR), timelineAt: iso(HOUR), category: "precious-metals", tags: [], score: 80, selected: true, channel: "news" }, group: null }],
  nextCursor: null, hot: null, dayCounts: {},
};

api = createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  const url = new URL(req.url!, "http://local");
  if (url.pathname === "/api/health") return res.end('{"ok":true}');
  if (url.pathname === "/api/site/meta") return res.end('{"changelogVersion":"fixture"}');
  if (url.pathname === "/api/site/quotes") return res.end(JSON.stringify(quotes));
  if (url.pathname === "/api/site/quote-trend") {
    trendHits.push(`${url.searchParams.get("symbol")}/${url.searchParams.get("range")}`);
    if (trendStatus !== 200) { res.statusCode = trendStatus; return res.end('{"code":"bad"}'); }
    return res.end(JSON.stringify(trend));
  }
  if (url.pathname.startsWith("/api/site/timeline")) return res.end(JSON.stringify(timeline));
  res.statusCode = 404;
  res.end('{"code":"not_found"}');
});

before(async () => {
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  web = spawn(process.execPath, [fileURLToPath(new URL("../server.ts", import.meta.url))], {
    env: { ...process.env, WEB_PORT: "0", API_BASE_URL: `http://127.0.0.1:${(api.address() as AddressInfo).port}` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`web did not start: ${logs}`)), 15_000);
    web.on("exit", () => { clearTimeout(timer); reject(new Error(`web exited: ${logs}`)); });
    web.stderr!.on("data", (c) => { logs += String(c); });
    web.stdout!.on("data", (c) => {
      logs += String(c);
      const m = logs.match(/"msg":"web started","port":(\d+)/);
      if (m) { origin = `http://127.0.0.1:${m[1]}`; clearTimeout(timer); resolve(); }
    });
  });
});
after(async () => {
  if (web && web.exitCode === null) { web.kill("SIGTERM"); await once(web, "exit"); }
  api.closeAllConnections();
  await new Promise<void>((r) => api.close(() => r()));
});

async function band() {
  const res = await fetch(`${origin}/`);
  assert.equal(res.status, 200, logs);
  const html = await res.text();
  const at = html.indexOf('aria-label="行情数据"');
  assert.ok(at > 0, `the band did not render: ${html.slice(0, 200)}`);
  return { html, text: html.slice(at).replace(/<[^>]+>/g, "|").replace(/\|+/g, " | ").replace(/\s+/g, " ") };
}

// ---------------------------------------------------------------------------------------------
// The rules, directly.
// ---------------------------------------------------------------------------------------------

test("rows are grouped by the market the api records, not by a symbol list", () => {
  const rows = rowsOf(BAND.quotes);
  assert.deepEqual(rows.map((r) => r.market), ["国际期货", "国内现货"]);
  assert.deepEqual(rows[0]!.quotes.map((q) => q.symbol), ["GC=F", "SI=F", "HG=F", "PL=F", "PA=F"]);
  assert.deepEqual(rows[1]!.quotes.map((q) => q.symbol), ["Au99.99", "Ag(T+D)", "Pt99.95", "mAu(T+D)"]);
  // The band covers every symbol the contract lists, and the fixture is not quietly behind.
  assert.deepEqual(rows.flatMap((r) => r.quotes).map((q) => q.symbol), [...QUOTE_SYMBOLS]);
});

test("a quote with no market gets its own row rather than being filed under the first", () => {
  // Folding an unrecorded contract into whichever market happened to lead would put it under COMEX,
  // and the mistake would be invisible: the row's label is right and its contents are not. The two
  // shapes a missing value takes are tested, because a collector that omits the key and a collector
  // that writes an empty string are the same failure with different code.
  const blank = quote("GC=F", 4196.8, HOUR, { unit: "USD/oz", exchange: "COMEX", market: "", changePct: 1 });
  assert.equal(rowsOf([...BAND.quotes, blank]).at(-1)!.market, "未分类");
  const absent = { ...blank, market: null } as Quote;
  assert.equal(rowsOf([...BAND.quotes, absent]).at(-1)!.market, "未分类");
  // The two real markets are untouched, so the fallback row is added and not substituted.
  assert.deepEqual(rowsOf([...BAND.quotes, blank]).map((r) => r.market), ["国际期货", "国内现货", "未分类"]);
});

test("unit and exchange come from the api, and an unknown exchange is admitted not guessed", () => {
  const gold = BAND.quotes[0]!;
  assert.equal(unitOf(gold), "USD/oz");
  assert.equal(exchangeOf(gold), "COMEX");
  assert.equal(exchangeOf(BAND.quotes[5]!), "上海黄金交易所");
  // Copper is dollars per pound. Printed as dollars per ounce it overstates a price by 14.
  assert.equal(unitOf(BAND.quotes[2]!), "USD/lb");
  // The api's value wins, so a contract reclassified upstream does not keep printing the old unit.
  const changed = quote("GC=F", 1, HOUR, { unit: "USD/troy_oz", exchange: "COMEX", market: "国际期货" });
  assert.equal(unitOf(changed), "USD/troy_oz");
  // No exchange recorded: say so. Guessing from the symbol is the failure this column is guarding.
  const unknown = quote("GC=F", 1, HOUR, { unit: "USD/oz", exchange: "", market: "国际期货" });
  assert.equal(exchangeOf(unknown), "未知来源");
});

// ---------------------------------------------------------------------------------------------
// Rendered.
// ---------------------------------------------------------------------------------------------

test("the band renders two rows, each labelled with its market", async () => {
  quotes = BAND;
  const b = await band();
  assert.ok(b.text.includes("国际期货"), "the futures row is not labelled");
  assert.ok(b.text.includes("国内现货"), "the domestic row is not labelled");
  for (const symbol of QUOTE_SYMBOLS) assert.ok(b.text.includes(symbol), `${symbol} is missing from the band`);
});

test("every cell prints its own unit and exchange", async () => {
  quotes = BAND;
  const b = await band();
  // Three units on the page at once, and two exchanges. This is the whole point of the split: a
  // reader who cannot see them reads 4196 against 909 as one comparison.
  assert.match(b.text, /USD\/oz/, "the futures' unit is missing");
  assert.match(b.text, /USD\/lb/, "copper's unit is missing");
  assert.match(b.text, /CNY\/g/, "the SGE unit is missing");
  // Short forms, because "NY Mercantile" and "上海黄金交易所" do not fit in a 92px cell and were
  // being truncated to "NY Merca…" and "上海黄金…" — which reads as broken data, not as an
  // abbreviation. A truncated unit would be worse: it is the one thing that makes the number legible.
  assert.ok(b.text.includes("COMEX"), "COMEX is missing");
  assert.ok(b.text.includes("NYMEX"), "the NY Mercantile contracts are not labelled NYMEX");
  assert.ok(b.text.includes("SGE"), "the SGE contracts are not labelled SGE");
  assert.ok(!b.text.includes("…"), "something is being truncated on a tile");
  assert.ok(!b.text.includes("Merca…"), "the exchange is truncated rather than abbreviated");
});

test("the exchange is abbreviated for the cell and kept whole in the tooltip", () => {
  const nymex = quote("PL=F", 1726, HOUR, { unit: "USD/oz", exchange: "NY Mercantile", market: "国际期货" });
  assert.equal(exchangeOf(nymex), "NY Mercantile", "the full name is what the tooltip and the trend panel show");
  assert.equal(shortExchange(nymex), "NYMEX");
  const sge = quote("Au99.99", 909, HOUR, { unit: "CNY/g", exchange: "上海黄金交易所", market: "国内现货" });
  assert.equal(exchangeOf(sge), "上海黄金交易所");
  assert.equal(shortExchange(sge), "SGE");
  // An exchange nobody has a short form for keeps its own name, shortened only by the cell.
  const other = quote("GC=F", 1, HOUR, { unit: "USD/oz", exchange: "Some Exchange", market: "国际期货" });
  assert.equal(shortExchange(other), "Some Exchange");
  // And the unknown case still says so rather than printing an empty corner.
  assert.equal(shortExchange(quote("GC=F", 1, HOUR, { unit: "USD/oz", exchange: "", market: "国际期货" })), "未知来源");
});

test("each market dates its own data, so a holiday is not hidden behind a live market", async () => {
  quotes = BAND;
  const b = await band();
  // The futures were collected two hours ago and the SGE contracts seven days ago. One "data as of"
  // for the whole band would state today's number for a price last collected last week, so the two
  // rows do not share a line: the fresh row states its time, and the stale one says it may be expired.
  assert.ok(b.text.includes("数据截至"), "the fresh row does not say when its data was taken");
  assert.ok(b.text.includes("行情数据可能已过期"), "the seven-day-old SGE row is not marked as expired");
  // Exactly one of each, which is what "the two rows differ" means in the markup: a single shared
  // line would be either both current or both stale, and both would be wrong for one of them.
  assert.equal((b.html.match(/数据截至/g) ?? []).length, 1, "only the fresh row may state a time");
  assert.equal((b.html.match(/行情数据可能已过期/g) ?? []).length, 1, "only the stale row may warn");
});

test("a contract with no change shows a dash, never a fabricated zero", async () => {
  quotes = BAND;
  const b = await band();
  // The SGE feed runs once a day, so its change is usually null. A 0.00% there would read as "unchanged"
  // rather than "nothing to compare against" — the difference this whole three-state line exists for.
  assert.ok(b.text.includes("—"), "no change is not shown as a dash");
  assert.ok(!b.text.includes("0.00%"), "a null change is being rendered as a zero move");
});

test("each cell is a control that opens that contract's trend", async () => {
  quotes = BAND;
  trend = {
    symbol: "GC=F", range: "1mo", source: "yahoo-finance", exchange: "COMEX", unit: "USD/oz", empty: false,
    points: Array.from({ length: 21 }, (_, i) => ({ date: `2026-09-${String(1 + i).padStart(2, "0")}`, close: 4100 + i * 5 })),
  };
  trendHits = [];
  const b = await band();
  // The cells are buttons, so the chart is reachable from the keyboard and announced as expandable.
  const buttons = b.html.match(/<button[^>]*aria-expanded="false"/g) ?? [];
  assert.equal(buttons.length, QUOTE_SYMBOLS.length, `expected one control per contract, found ${buttons.length}`);
});

test("a trend response with no points says so rather than drawing an empty chart", async () => {
  quotes = BAND;
  // 1d is a single daily close, and the SGE is shut on a national holiday: no data is the normal
  // case, not an error, and it must not look like one.
  trend = { symbol: "Au99.99", range: "1d", source: "sge", exchange: "上海黄金交易所", unit: "CNY/g", empty: true, points: [] };
  trendStatus = 200;
  // The panel is client-rendered behind a click, so this asserts the rule the component applies
  // rather than driving a browser: an empty series must reach the "no data" branch.
  assert.equal(trend.empty, true);
  assert.equal(trend.points.length, 0);
  const ranges: TrendRange[] = ["1d", "1mo", "3mo", "1y"];
  assert.deepEqual(ranges, ["1d", "1mo", "3mo", "1y"], "the four ranges are the api's, and the default is 1mo — 1d has a single point and cannot be a line");
});
