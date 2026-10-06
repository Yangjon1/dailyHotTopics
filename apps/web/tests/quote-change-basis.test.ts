// Run after `npm run build -w @aihot/web`. Real production server/router, synthetic HTTP API only.
//
// The price band's change line, in the three states Spec §9.4 defines. On the first day of
// collection every changePct is null (one snapshot, no baseline), so this branch of the component
// never renders against live data — a line of code that has only ever been exercised by a test
// fixture is a line nobody has watched work. These cases build the api response the way
// publication/quotes.ts builds it and read the rendered masthead back.
//
// The one that matters most is the gap marker. A percentage against a six-day-old baseline looks
// exactly like a daily move, and the marker's whole job is to say so. It is easy to write the check
// against the wrong timestamp and have it stay silent precisely when the pipeline has stopped.
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Quote, QuoteBasis, QuoteSymbol, QuotesResponse, TimelineResponse } from "@aihot/contracts/site";
import { beijingDate } from "@aihot/contracts/time";
import { QUOTE_UNIT, baselineIsStale, formatChange, moveOf, newestSnapshotAt } from "../app/features/quotes/model.ts";

/**
 * The clock these cases are built around.
 *
 * Relative to the moment the suite runs, not a fixed date. The component dates the baseline against
 * the real current time during SSR, so fixtures pinned to a calendar date drift: a date in the
 * future makes every gap measure as zero (the arithmetic is absolute), and the gap marker silently
 * stops appearing. Anchoring to now keeps "six days ago" meaning six days ago whenever this runs.
 */
const NOW = new Date();
const iso = (d: Date) => d.toISOString();
const daysAgo = (n: number, from = NOW) => new Date(from.getTime() - n * 86_400_000);

/**
 * One variety's quote, built the way quotes.ts builds it: the newest two snapshots, the percentage
 * between them, and the basis chosen from how old the baseline is measured against *now*.
 *
 * Nothing here reads `baselineAgeDays` and nothing needs it: the page derives the gap from `basisAt`,
 * so the fixtures are assembled from the fields the page actually consumes. That is deliberate — a
 * fixture that must carry a field the assertions never touch is a fixture that breaks when the field
 * is retired, and the breakage lands on whoever removes it rather than on the reason it was removed.
 * The casts are because the field is still in the contract but not in these objects.
 */
function quote(symbol: QuoteSymbol, latestDaysAgo: number, baselineDaysAgo: number | null, price: number, baselinePrice: number | null): Quote {
  if (baselineDaysAgo === null || baselinePrice === null) {
    return { symbol, price, unit: null, updatedAt: iso(daysAgo(latestDaysAgo)), changePct: null, basis: "none", basisAt: null } as Quote;
  }
  const changePct = Math.round(((price - baselinePrice) / baselinePrice) * 100 * 100) / 100;
  // quotes.ts: `ageInDays(baseline.at, now)` — the baseline's age as of now, not the distance
  // between the two snapshots. The two differ exactly when the pipeline has stopped. The age is
  // only used to pick the basis; the page derives the gap itself from `basisAt`, so it is not a
  // field the fixtures need to carry.
  const basis: QuoteBasis = baselineDaysAgo <= 1 ? "yesterday" : "lastSnapshot";
  return {
    symbol, price, unit: null, updatedAt: iso(daysAgo(latestDaysAgo)), changePct, basis,
    basisAt: iso(daysAgo(baselineDaysAgo)),
  } as Quote;
}

/** A variety with a price and nothing to compare it against: the tile shows a dash. */
function noBasis(symbol: QuoteSymbol, price: number, daysOld: number): Quote {
  return { symbol, price, unit: null, updatedAt: iso(daysAgo(daysOld)), changePct: null, basis: "none", basisAt: null } as Quote;
}

/** The five varieties, in one of three shapes, with XAU carrying the case under test. */
function response(xau: Quote): QuotesResponse {
  const rest: Array<[QuoteSymbol, number]> = [["XAG", 36.42], ["XPT", 1043.8], ["XPD", 944.25], ["HG", 4.512]];
  return {
    quotes: [
      xau,
      ...rest.map(([s, p]) => noBasis(s, p, 0)),
    ],
    // What the api actually sends: the moment it answered, not the moment the data was taken.
    computedAt: iso(NOW),
  };
}

/** yesterday: the baseline is a day back, so the tile may say 较昨日 and carries no marker. */
const YESTERDAY = quote("XAU", 0, 1, 4118.4, 4068.1);
/** lastSnapshot, fresh: yesterday's run was missed but the baseline is recent. No marker either. */
const LAST_SNAPSHOT_FRESH = quote("XAU", 0, 2, 4118.4, 4068.1);
/** lastSnapshot, stale: a six-day-old baseline. The percentage stays; the marker must appear. */
const LAST_SNAPSHOT_STALE = quote("XAU", 0, 6, 4118.4, 4068.1);
/** none: no baseline at all. A dash, and no arrow. */
const NO_BASIS = quote("XAU", 0, null, 4118.4, null);

let web: ChildProcess;
let origin: string;
let logs = "";
let current: QuotesResponse = response(YESTERDAY);

const timeline: TimelineResponse = {
  filters: { channel: "all", category: null, tag: null },
  cards: [{ key: "k1", anchorAt: iso(NOW), item: { id: "i1", title: "占位条目", summary: null, reason: null, source: { name: "Fixture", id: "s1", url: null, iconUrl: null, iconSrcSet: null, firstParty: true }, publishedAt: iso(NOW), timelineAt: iso(NOW), category: "precious-metals", tags: [], score: 80, selected: true, channel: "news" } as never, group: null }],
  nextCursor: null, hot: null, dayCounts: {},
} as unknown as TimelineResponse;

const api = createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/api/health") return res.end('{"ok":true}');
  if (req.url === "/api/site/meta") return res.end('{"changelogVersion":"fixture"}');
  if (req.url?.startsWith("/api/site/quotes")) return res.end(JSON.stringify(current));
  if (req.url?.startsWith("/api/site/timeline")) return res.end(JSON.stringify(timeline));
  res.statusCode = 404;
  res.end('{"code":"not_found"}');
});

before(async () => {
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  web = spawn(process.execPath, [fileURLToPath(new URL("../server.ts", import.meta.url))], {
    env: { ...process.env, WEB_PORT: "0", TZ: "UTC", API_BASE_URL: `http://127.0.0.1:${(api.address() as AddressInfo).port}` },
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

/** The rendered price band, as text plus the bits only the markup can tell us. */
async function band() {
  const res = await fetch(origin + "/");
  assert.equal(res.status, 200, logs);
  const html = await res.text();
  const at = html.indexOf("行情数据");
  assert.ok(at > 0, `the price band is not rendered: ${html.slice(0, 300)}`);
  const slice = html.slice(at, at + 4000);
  return {
    text: slice.replace(/<[^>]+>/g, "|").replace(/\|+/g, " | ").replace(/\s+/g, " "),
    hasWarn: slice.includes("text-warn"),
    hasArrow: slice.includes("▲") || slice.includes("▼"),
    /** The marker is an icon with a screen-reader label; the label is what proves it rendered. */
    hasGapMarker: slice.includes("基准间隔超过三天") || /基准快照间隔超过 3 天/.test(slice),
  };
}

// ---------------------------------------------------------------------------------------------
// The rule, tested directly. Rendering below proves the component applies it.
// ---------------------------------------------------------------------------------------------

test("the gap is measured against now, not against the quote's own timestamp", () => {
  // The case that separates the two measures: the pipeline stopped five days ago, so the newest
  // snapshot and its baseline are one day apart while both are ancient. Measuring quote-to-baseline
  // calls that fresh; measuring to now correctly marks it. A reader looking at this number is
  // reasoning about today, so "how old is the baseline" has to mean how old it is now.
  const stopped = quote("XAU", 5, 6, 4118.4, 4068.1);
  assert.equal(stopped.basis, "lastSnapshot", "a six-day-old baseline is not yesterday's");
  const quoteToBaseline = Math.abs(Date.parse(stopped.basisAt!) - Date.parse(stopped.updatedAt!)) / 86_400_000;
  assert.equal(quoteToBaseline, 1, "fixture is wrong: the two snapshots are meant to be a day apart");
  assert.equal(baselineIsStale(stopped, NOW.getTime()), true, "a six-day-old baseline must be marked");
});

test("a recent baseline is not marked, and yesterday's never is", () => {
  assert.equal(baselineIsStale(YESTERDAY, NOW.getTime()), false);
  assert.equal(baselineIsStale(LAST_SNAPSHOT_FRESH, NOW.getTime()), false);
  assert.equal(baselineIsStale(NO_BASIS, NOW.getTime()), false, "no baseline, nothing to mark");
  // Three days is the boundary and stays unmarked; four is marked.
  assert.equal(baselineIsStale(quote("XAU", 0, 3, 100, 99), NOW.getTime()), false);
  assert.equal(baselineIsStale(quote("XAU", 0, 4, 100, 99), NOW.getTime()), true);
});

test("the change is signed, and a zero change gets no arrow", () => {
  assert.equal(formatChange(1.24), "+1.24%");
  assert.equal(formatChange(-1.24), "-1.24%");
  assert.equal(formatChange(0), "0.00%");
  assert.equal(formatChange(null), "—", "no baseline is a dash, never a fabricated 0.00%");
  assert.equal(moveOf(0).kind, "flat");
  assert.equal(moveOf(null).kind, "none");
});

test("the freshness line dates the newest snapshot, not the response", () => {
  // The api stamps computedAt with the moment it answered, so it is always "now". Dating the
  // freshness line by it would print the current clock beside a week-old price and call it current.
  const old = { quotes: [quote("XAU", 7, 8, 4118.4, 4068.1)], computedAt: iso(NOW) } as QuotesResponse;
  assert.equal(newestSnapshotAt(old.quotes), iso(daysAgo(7)));
});

// ---------------------------------------------------------------------------------------------
// The component, rendered.
// ---------------------------------------------------------------------------------------------

test("较昨日: yesterday's baseline, red, signed, with an arrow and no marker", async () => {
  current = response(YESTERDAY);
  const b = await band();
  assert.match(b.text, /较昨日/, "the basis label is missing");
  assert.match(b.text, /\+1\.24%/, "the change is not signed as a rise");
  assert.ok(b.hasArrow, "a rising change needs its arrow");
  assert.ok(!b.hasGapMarker, "yesterday's baseline must not be marked as a gap");
});

test("较上次: a missed run, same encoding, and the label admits it is not a daily change", async () => {
  current = response(LAST_SNAPSHOT_FRESH);
  const b = await band();
  assert.match(b.text, /较上次/, "the basis must say it is measured against the previous snapshot");
  assert.ok(!/较昨日/.test(b.text), "a two-day-old baseline must not claim to be yesterday's");
  assert.match(b.text, /\+1\.24%/);
  assert.ok(!b.hasGapMarker, "a two-day-old baseline is recent enough not to be marked");
});

test("a gap over three days marks the tile, and the mark is the warning colour", async () => {
  current = response(LAST_SNAPSHOT_STALE);
  const b = await band();
  assert.match(b.text, /较上次/, "the label must already admit the baseline is not yesterday's");
  assert.match(b.text, /\+1\.24%/, "the number stays: a stale baseline is a caveat, not a deletion");
  assert.ok(b.hasGapMarker, "the gap marker is missing — a six-day-old percentage is being read as a daily move");
  assert.ok(b.hasWarn, "the marker must be in the warning colour, not the ordinary text colour");
});

test("no baseline: a grey dash, and no arrow", async () => {
  current = response(NO_BASIS);
  const b = await band();
  assert.match(b.text, /—/, "no baseline must show a dash");
  assert.ok(!b.hasArrow, "there is no direction to point when there is nothing to compare against");
  assert.ok(!b.hasGapMarker, "a missing baseline is not a gap, it is the absence of one");
});

test("a stopped pipeline marks both the tile and the freshness line", async () => {
  // The worst case and the one the two bugs met in: every price is a week old while the response
  // claims to be from now. The tile must be marked and the line must say the band may be expired.
  current = { quotes: [quote("XAU", 7, 8, 4118.4, 4068.1), noBasis("XAG", 36.42, 7)], computedAt: iso(NOW) } as QuotesResponse;
  const b = await band();
  assert.match(b.text, /行情数据可能已过期/, "the freshness line must not present week-old prices as current");
  assert.ok(b.hasGapMarker, "the stale baseline must still be marked on the tile");
});

test("each variety keeps its own unit, from the api when it has one", async () => {
  current = response(YESTERDAY);
  const b = await band();
  // Copper is dollars per pound; the precious metals are dollars per troy ounce. Without this a
  // reader compares a 4-dollar number with a 4100-dollar one as the same kind of quantity.
  assert.equal(QUOTE_UNIT.HG, "美元/磅");
  assert.equal(QUOTE_UNIT.XAU, "美元/盎司");
  assert.match(b.text, /美元\/磅/, "copper's unit is missing");
  const res = await fetch(origin + "/");
  const html = await res.text();
  assert.equal((html.match(/美元\/盎司/g) ?? []).length >= 4, true, "the four precious metals share one unit");
});
