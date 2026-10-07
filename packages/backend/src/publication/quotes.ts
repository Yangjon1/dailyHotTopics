// The daily price band (GET /api/site/quotes). Reads the isolated snapshot rows an external script
// pushes (scripts/price-snapshot.ts) and works out each variety's change against its baseline.
//
// Two things this deliberately does NOT do, because they would be wrong:
// - It does not read through `publications`. A snapshot's source is `isolated`, so the framework
//   gives it visibility 'withdrawn' (publication/publish.ts) and it reaches no public read at all —
//   which is exactly right for the article but means the price band has to read the material itself.
//   Nothing here is a judgement about the article: only the numbers in `raw`, and no title or body.
// - It does not call the price upstream. This is a read of what was already collected, so the front
//   page never waits on a third party and a slow upstream cannot take the home page down with it.
//
// changePct is NOT a financial daily change: that is measured against the previous close, which this
// feed does not carry. It is "today's snapshot against the baseline snapshot", so `basis`, `basisAt`
// and `basisAt` travel with the number and the page can say how old the comparison is. A gap
// of more than a few days is marked rather than shown as if it were today's move.
//
// The rows are few (5 varieties a day) and `raw` carries no index, so a scan is the honest cost here;
// adding a GIN index for it would be paying to maintain something this query does not need.
import { QUOTE_SYMBOLS, type Quote, type QuoteBasis, type QuoteSymbol, type QuotesResponse } from "@aihot/contracts/site";
import { beijingDate } from "@aihot/contracts/time";
import { sql } from "../db.ts";

/**
 * The band lists the varieties in this order: gold, silver, platinum, palladium, copper. Same-kind
 * runs together on purpose — the order itself is classification, and a reader learns it in a week.
 * Never order by `updatedAt`: a missing or stale quote must still appear, in its own place.
 */
const SYMBOLS: readonly QuoteSymbol[] = QUOTE_SYMBOLS;

/** Only these sources' snapshots are prices; anything else with a `raw.symbol` is not a quote. */
// ext-price-snapshot（gold-api 伦敦现货）已停用：它的品种被 ext-futures-macro（Yahoo 国际期货）
// 与 ext-sge（上金所国内）取代。留着它会让 2016 年以来的现货快照继续被读成行情。
const SNAPSHOT_SOURCES = ["ext-futures-macro", "ext-sge"];

interface SnapshotRow {
  symbol: string;
  price: number | null;
  unit: string | null;
  /** From the snapshot's own `raw`; null for rows collected before these fields existed. */
  exchange: string | null;
  market: string | null;
  at: Date;
}

/** The two most recent snapshots of each variety: today's, and the one it is compared against. */
async function recentSnapshots(): Promise<Map<string, SnapshotRow[]>> {
  // The newest two of each in one pass; the caller pairs them into current and baseline.
  const rows = await sql<{ symbol: string; price: number | null; unit: string | null; exchange: string | null; market: string | null; at: Date }[]>`
    SELECT symbol, price, unit, exchange, market, at FROM (
      SELECT a.raw->>'symbol' AS symbol,
        nullif(a.raw->>'price', '')::float8 AS price,
        a.raw->>'unit' AS unit,
        a.raw->>'exchange' AS exchange,
        a.raw->>'market' AS market,
        coalesce(a.published_at, a.discovered_at) AS at,
        row_number() OVER (PARTITION BY a.raw->>'symbol' ORDER BY coalesce(a.published_at, a.discovered_at) DESC) AS rank
      FROM articles a
      WHERE a.source_id = ANY(${SNAPSHOT_SOURCES}::text[])
        AND a.raw->>'symbol' IS NOT NULL
        AND nullif(a.raw->>'price', '')::float8 IS NOT NULL
    ) ranked WHERE rank <= 2`;
  const grouped = new Map<string, SnapshotRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.symbol) ?? [];
    list.push({ symbol: row.symbol, price: row.price, unit: row.unit, exchange: row.exchange, market: row.market, at: row.at });
    grouped.set(row.symbol, list);
  }
  return grouped;
}

/** Whole days between two instants, by Beijing calendar day (the day the page is read in). */
function ageInDays(from: Date, to: Date): number {
  const a = Date.parse(`${beijingDate(from)}T00:00:00Z`);
  const b = Date.parse(`${beijingDate(to)}T00:00:00Z`);
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

function quote(symbol: QuoteSymbol, snapshots: SnapshotRow[], now: Date): Quote {
  const empty: Quote = { symbol, price: null, updatedAt: null, changePct: null, basis: "none", basisAt: null, unit: null, exchange: null, market: null };
  const [latest, baseline] = snapshots;
  if (!latest || latest.price === null) return empty;
  const quote: Quote = {
    ...empty,
    price: latest.price,
    updatedAt: latest.at.toISOString(),
    unit: latest.unit,
    exchange: latest.exchange,
    market: latest.market,
  };
  // No baseline, or a baseline that is not a real number: the page shows a dash. It never shows 0,
  // which would read as "unchanged" rather than "nothing to compare against".
  if (!baseline || baseline.price === null || baseline.price === 0) return quote;
  const changePct = ((latest.price - baseline.price) / baseline.price) * 100;
  if (!Number.isFinite(changePct)) return quote;
  const age = ageInDays(baseline.at, now);
  const basis: QuoteBasis = age <= 1 ? "yesterday" : "lastSnapshot";
  return { ...quote, changePct: Math.round(changePct * 100) / 100, basis, basisAt: baseline.at.toISOString() };
}

export async function loadQuotes(now = new Date()): Promise<QuotesResponse> {
  const grouped = await recentSnapshots();
  return {
    quotes: SYMBOLS.map((symbol) => quote(symbol, grouped.get(symbol) ?? [], now)),
    computedAt: now.toISOString(),
  };
}
