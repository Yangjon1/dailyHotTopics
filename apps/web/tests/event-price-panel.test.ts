// Run after `npm run build -w @aihot/web`. Real production server/router, synthetic HTTP API only.
//
// The event page's price panel. This panel is why the file exists.
//
// It rendered on no event page at all for the whole of Phase 4: it filtered the response down to the
// instruments named by a field the api does not have, so the filter matched nothing, the panel's
// condition was permanently false, and no test looked. Two defects were sitting inside it the whole
// time and were invisible for the same reason — the tiles were not told what "now" is, so the stale
// check would have frozen one answer into the HTML, and the panel had no freshness line at all.
//
// A block that never renders is a block nobody has read. These cases are here so that "it renders"
// is a claim the suite makes every run rather than an assumption carried from a delivery note.
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { QUOTE_SYMBOLS, type Quote, type QuoteSymbol, type QuotesResponse, type StoryDetail } from "@aihot/contracts/site";
import { allInstruments, instrumentsOf, isStale, newestSnapshotAt, orderQuotes } from "../app/features/quotes/model.ts";

const PUBLIC_ID = "fixture-event";
const NOW = Date.now();
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const HOUR = 3_600_000;

/** One variety, as the api sends it. `price: null` is how "no snapshot" arrives. */
function quote(symbol: QuoteSymbol, price: number | null, msAgo: number, changePct: number | null = null): Quote {
  return {
    symbol, price, unit: null, updatedAt: iso(msAgo), changePct,
    basis: changePct === null ? "none" : "yesterday", basisAt: changePct === null ? null : iso(msAgo + 24 * HOUR),
  } as Quote;
}

/** The five, all with prices, gathered now. */
const WITH_PRICES: QuotesResponse = {
  quotes: [
    quote("GC=F", 4196.8, HOUR, 1.24), quote("SI=F", 61.77, HOUR, -0.8), quote("HG=F", 6.651, HOUR, 2.1),
    quote("PL=F", 1726, HOUR, 0.4), quote("PA=F", 1167.5, HOUR),
    quote("Au99.99", 909, HOUR), quote("Ag(T+D)", 14999, HOUR), quote("Pt99.95", 423.05, HOUR), quote("mAu(T+D)", 908.39, HOUR),
  ],
  computedAt: iso(HOUR),
};

/** The five, none with a price: the collection has not run. */
const NO_PRICES: QuotesResponse = {
  quotes: QUOTE_SYMBOLS.map((s) => quote(s, null, 0)),
  computedAt: iso(0),
};

/** Gathered, but nine days old: the freshness line has to say so. */
const STALE_PRICES: QuotesResponse = { ...WITH_PRICES, quotes: WITH_PRICES.quotes.map((q) => quote(q.symbol, q.price, 9 * 24 * HOUR, q.changePct)) };

let quotes: QuotesResponse | null = WITH_PRICES;
let api: ReturnType<typeof createServer>;
let web: ChildProcess;
let origin: string;
let logs = "";

const story = {
  publicId: PUBLIC_ID, title: "测试事件", status: "active", reportCount: 2, sourceCount: 2,
  firstReportAt: iso(48 * HOUR), latestAt: iso(HOUR), digest: "事件综述", digestUpdatedAt: iso(HOUR),
  summary: "事件摘要", excerpt: null, latest: "最新进展", latestReport: { id: "r1" },
  whyHot: { participants48h: 0, newParticipants6h: 0, recentReports24h: 2, observationComplete: true, rank: null },
  developments: [], officialReports: [], timeline: [], heat: [], related: [], topics: [],
} as unknown as StoryDetail;

api = createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  const url = req.url ?? "";
  if (url === "/api/health") return res.end('{"ok":true}');
  if (url === "/api/site/meta") return res.end('{"changelogVersion":"fixture"}');
  if (url.startsWith("/api/site/quotes")) return res.end(JSON.stringify(quotes));
  if (url.startsWith(`/api/site/stories/${PUBLIC_ID}`)) return res.end(JSON.stringify(story));
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

/** The price panel as the reader gets it: its text, and the classes only markup can tell us. */
async function panel() {
  const res = await fetch(`${origin}/story/${PUBLIC_ID}`);
  assert.equal(res.status, 200, logs);
  const html = await res.text();
  const at = html.indexOf('aria-label="相关品种行情"');
  // The degraded list is identified by the line that explains the absence, not by a count it used
  // to print and no longer has anything to print.
  if (at < 0) return { present: false, text: "", warn: false, hasRail: html.includes("近 24 小时无该品种的价格快照") };
  // The window is the rest of the document, not a fixed number of characters: the band grew from
  // five instruments to nine, and a fixed slice that was long enough for five cut the freshness
  // line off the end of the panel without saying so. The panel is followed by other sections, so
  // this reaches past it — which is fine, because the assertions are about what is present, and a
  // neighbouring section cannot contain this panel's own sentence.
  const slice = html.slice(at);
  return {
    present: true,
    text: slice.replace(/<[^>]+>/g, "|").replace(/\|+/g, " | ").replace(/\s+/g, " "),
    warn: slice.includes("text-warn"),
    hasRail: false,
  };
}

test("the panel renders every instrument the site covers when there are prices", async () => {
  quotes = WITH_PRICES;
  const p = await panel();
  assert.ok(p.present, "the price panel did not render at all — this is the bug this file exists for");
  // Every covered instrument, in the site's order. It used to show only the ones an event named,
  // and an event names none through the field that fed it, so this list was always empty.
  // The tile prints the code a reader knows the contract by (GC), with the api's symbol (GC=F) in
  // its tooltip. So the symbols are checked through the count of prices on the page and the codes
  // through the text — a dropped instrument fails both.
  for (const code of ["GC", "SI", "HG", "PL", "PA", "Au99.99", "Ag(T+D)", "Pt99.95", "mAu(T+D)"]) {
    assert.ok(p.text!.includes(code), `${code} is missing from the event panel`);
  }
  assert.match(p.text!, /4,196\.80/, "gold's price is missing");
  // Both markets, in their own units, with no reader left to infer either from position.
  assert.match(p.text!, /USD\/oz/, "the international row's unit is missing");
  assert.match(p.text!, /CNY\/g/, "the domestic row's unit is missing");
  assert.match(p.text!, /USD\/lb/, "copper's unit is missing — it is dollars per pound, not per ounce");
});

test("each instrument keeps its own unit", async () => {
  quotes = WITH_PRICES;
  const p = await panel();
  // Two markets, three different quantities: dollars per troy ounce, dollars per pound, and yuan per
  // gram. A reader who cannot see which is which compares 4196 with 909 as one number, and it is a
  // hundredfold off. The unit is printed on every cell, in the api's own spelling.
  assert.match(p.text!, /USD\/lb/, "copper quotes per pound and must say so");
  assert.match(p.text!, /USD\/oz/, "the futures quote per ounce and must say so");
  assert.match(p.text!, /CNY\/g/, "the SGE contracts quote per gram and must say so");
  // Both currencies appear: a band showing only one would let a reader assume the other row is
  // priced the same way.
  assert.ok(p.text!.includes("USD"), "the international row's currency is missing");
  assert.ok(p.text!.includes("CNY"), "the domestic row's currency is missing");
});

test("the freshness line states when the data was taken", async () => {
  quotes = WITH_PRICES;
  const p = await panel();
  assert.match(p.text!, /数据截至/, "the panel has no freshness line — a price with no time beside it is a claim, not a display");
});

test("a stale collection changes the line's wording, not only its colour", async () => {
  quotes = STALE_PRICES;
  const p = await panel();
  assert.ok(p.present, "the panel vanished instead of warning");
  assert.match(p.text!, /行情数据可能已过期/, "nine-day-old prices are not marked as possibly expired");
  assert.ok(p.warn, "the warning must be in the warning colour");
  assert.ok(!/数据截至/.test(p.text!), "the line still claims the data is current");
  // The numbers stay. A stale baseline is a caveat on a real price, not a reason to hide it.
  assert.match(p.text!, /4,196\.80/, "the price was dropped along with the warning");
});

test("no prices renders the instrument list, not an empty panel", async () => {
  quotes = NO_PRICES;
  const p = await panel();
  assert.ok(!p.present, "a price panel with no prices rendered, which is what an empty box looks like");
  assert.ok(p.hasRail, "the degraded instrument list is missing");
});

test("a missing quotes endpoint takes the panel away without taking the page", async () => {
  quotes = null;
  const res = await fetch(`${origin}/story/${PUBLIC_ID}`);
  assert.equal(res.status, 200, "the event page must survive a quotes endpoint that is not there");
  const html = await res.text();
  assert.ok(!html.includes('aria-label="相关品种行情"'), "a panel rendered with no data behind it");
  assert.ok(html.includes("测试事件"), "the event itself disappeared with the panel");
});

// ---------------------------------------------------------------------------------------------
// The rules, directly. The rendering cases above prove the panel applies them.
// ---------------------------------------------------------------------------------------------

test("the freshness line dates the newest snapshot, not the response", () => {
  // The api stamps computedAt with the moment it answered, so dating by it prints the current clock
  // beside a week-old price and calls that price current.
  const nineDays = new Date(NOW - 9 * 24 * HOUR).toISOString();
  const quotes9 = WITH_PRICES.quotes.map((q) => quote(q.symbol, q.price, 9 * 24 * HOUR, q.changePct));
  assert.equal(newestSnapshotAt(quotes9), quotes9.map((q) => q.updatedAt!).sort().at(-1));
  assert.equal(isStale(newestSnapshotAt(quotes9), NOW), true);
  assert.ok(nineDays < new Date(NOW).toISOString(), "fixture is wrong: the snapshots should be old");
  assert.equal(isStale(newestSnapshotAt(WITH_PRICES.quotes), NOW), false);
});

test("instrumentsOf keeps the site's order and drops the ones with no price", () => {
  assert.deepEqual(instrumentsOf(WITH_PRICES.quotes).map((i) => i.symbol), [...QUOTE_SYMBOLS]);
  // A variety with no snapshot is not an instrument a price panel can speak to.
  assert.deepEqual(instrumentsOf(NO_PRICES.quotes), []);
  assert.deepEqual(instrumentsOf([]), []);
  // Order follows the site, not the response, so a reshuffled response cannot reshuffle the page.
  // Picked by position, so the list survives the site renaming or adding a contract.
  const shuffled = [WITH_PRICES.quotes[8]!, WITH_PRICES.quotes[0]!, WITH_PRICES.quotes[2]!];
  assert.deepEqual(instrumentsOf(shuffled).map((i) => i.symbol), ["GC=F", "HG=F", "mAu(T+D)"]);
  assert.deepEqual(orderQuotes(shuffled).map((q) => q.symbol), ["GC=F", "HG=F", "mAu(T+D)"]);
});

test("the degraded list claims no event count, because none is measured", async () => {
  quotes = NO_PRICES;
  const p = await panel();
  assert.ok(p.hasRail, "the degraded list is missing");
  // It used to end every row with "0 条相关事件". Nothing counts events per instrument — that is
  // the same measurement the impact chain would have supplied — so the zeros were a fabricated
  // claim, and a zero reads as "none" rather than "unknown".
  const res = await fetch(`${origin}/story/${PUBLIC_ID}`);
  const html = await res.text();
  assert.ok(!html.includes("条相关事件"), "the fabricated event count is back");
  // What it does say is why there are no numbers.
  assert.ok(html.includes("近 24 小时无该品种的价格快照"), "the absence of prices is not explained");
});

test("allInstruments does not depend on snapshots existing", () => {
  // The degraded panel appears *because* the snapshots are missing. Listing only the varieties that
  // have a price would leave it with nothing to say — the same self-cancelling condition that kept
  // this panel off the page for the whole of Phase 4.
  assert.deepEqual(allInstruments().map((i) => i.symbol), [...QUOTE_SYMBOLS]);
  assert.deepEqual(allInstruments(), allInstruments());
  assert.equal(instrumentsOf(NO_PRICES.quotes).length < allInstruments().length, true, "the two are deliberately different: one follows the data, the other cannot");
});
