// The 9 instruments, and what it takes to print one honestly.
//
// The band shows two markets at once: five international futures (COMEX / NY Mercantile, in dollars
// per troy ounce or per pound) and four Shanghai Gold Exchange contracts (in yuan per gram). Those
// two groups are not comparable by eye — 4196 USD/oz and 909 CNY/g look like the same kind of
// quantity and are not, and the ratio between them is roughly 100 — so the band prints the unit on
// every cell, groups the rows, and never lets a reader infer either from position alone.
//
// The api's own unit strings are used verbatim (`USD/oz`, `CNY/g`) rather than a Chinese rendering
// of them, because those are the strings the trend endpoint returns for the same instrument. Two
// spellings of one unit on two surfaces is a discrepancy a reader can see and I cannot defend.

import type { Quote, QuoteBasis, QuoteSymbol, QuotesResponse } from "@aihot/contracts/site";
export type { Quote, QuoteBasis, QuoteSymbol, QuotesResponse } from "@aihot/contracts/site";
import { QUOTE_SYMBOLS } from "@aihot/contracts/site";

/**
 * The band shows two rows. The split is the point: an international price and a domestic one for the
 * same metal are two prices, not one, and a reader comparing them is looking at a basis — so they
 * are in separate rows with their own units rather than interleaved into one list.
 *
 * The order within each row is the api's own and is not reshuffled here: the contract already states
 * an order ("in display order"), and a second opinion about display order in the renderer is one
 * more place for the two to disagree.
 */
export const QUOTE_ROWS: ReadonlyArray<{ market: string; symbols: readonly QuoteSymbol[] }> = [
  { market: "国际期货", symbols: ["GC=F", "SI=F", "HG=F", "PL=F", "PA=F"] },
  { market: "上海黄金交易所", symbols: ["Au99.99", "Ag(T+D)", "Pt99.95", "mAu(T+D)"] },
];

/** Every symbol the band shows, in display order. The contract is the single source of this list. */
export const QUOTE_ORDER: readonly QuoteSymbol[] = QUOTE_SYMBOLS;

/** The units the api itself reports, per instrument. A fallback for an instrument it adds later. */
const UNITS: Record<QuoteSymbol, string> = {
  "GC=F": "USD/oz", "SI=F": "USD/oz", "PL=F": "USD/oz", "PA=F": "USD/oz", "HG=F": "USD/lb",
  "Au99.99": "CNY/g", "Ag(T+D)": "CNY/g", "Pt99.95": "CNY/g", "mAu(T+D)": "CNY/g",
};

/**
 * Decimal places per instrument, fixed.
 *
 * Silver and the SGE contracts quote to three because their prices are small and move in small
 * steps; two would round the move away. A row whose cells disagree on decimals cannot be scanned, so
 * these are per-instrument constants and not one global format. Tabs and spaces are grouped so the
 * last digit lines up down the row.
 */
export const QUOTE_DECIMALS: Record<QuoteSymbol, number> = {
  "GC=F": 2, "SI=F": 3, "HG=F": 3, "PL=F": 2, "PA=F": 2,
  "Au99.99": 2, "Ag(T+D)": 0, "Pt99.95": 2, "mAu(T+D)": 2,
};

/**
 * The unit each instrument is quoted in, in the api's own spelling. Not decoration: copper is
 * dollars per pound, the other futures are dollars per troy ounce, and the SGE contracts are yuan per
 * gram, so without this a reader compares 4196 with 909 as if they were the same kind of quantity.
 *
 * `quote.unit` from the response wins when it has one — it is what the collector recorded, and a
 * local table would quietly disagree with the data the moment a contract's unit changes.
 */
export function unitOf(quote: Quote): string {
  return quote.unit ?? UNITS[quote.symbol];
}

/**
 * Where the contract trades, or an honest blank when the collector has not said.
 *
 * The api's value wins. This has no local fallback table on purpose: the exchange *is* the symbol's
 * prefix (`GC=F` is a COMEX contract, `Ag(T+D)` an SGE one), so filling it in here from the symbol
 * would be a guess dressed as data — and a guess here is invisible, because the wrong exchange
 * printed on a tile looks exactly like a right one. "未知来源" is the truthful answer for a
 * contract nobody has classified yet, and it is the only string on the tile that admits a gap.
 */
export function exchangeOf(quote: Quote): string {
  // Trimmed as well as null-checked: the collector stores whatever the upstream row carried, and an
  // empty string is the shape a "we did not record this" takes most often. A blank cell in the
  // corner of a tile reads as a rendering fault, so it is replaced with a word that admits the gap.
  return quote.exchange?.trim() || "未知来源";
}

/**
 * The exchange in the short form a 92px cell can print.
 *
 * "NY Mercantile" and "上海黄金交易所" do not fit beside a price at any legible size, and the tile
 * truncated them to "NY Merca…" and "上海黄金…", which is worse than useless: it looks like the data
 * is cut off rather than abbreviated, and a reader cannot tell which exchange was meant. The short
 * forms are the ones the exchanges themselves trade under on a screen, and the full name is on the
 * cell's tooltip, so nothing is lost.
 *
 * The unit is never shortened. It is the one thing on the tile that makes the number interpretable,
 * and it is short enough to fit — which is why the exchange is what gives way.
 */
const EXCHANGE_SHORT: Array<[RegExp, string]> = [
  [/NY\s*Mercantile/i, "NYMEX"],
  [/上海黄金交易所/, "SGE"],
  [/COMEX/i, "COMEX"],
];

export function shortExchange(quote: Quote): string {
  const full = exchangeOf(quote);
  for (const [pattern, short] of EXCHANGE_SHORT) if (pattern.test(full)) return short;
  return full;
}

/**
 * The band in two rows, grouped by the market the api recorded for each quote.
 *
 * Grouping by data rather than by a symbol list here is the point: the split between international
 * futures and domestic spot is the difference between dollars per ounce and yuan per gram, and it is
 * the one thing about a price a reader cannot infer from the number in front of them. A contract
 * added later arrives in the right row because the collector said which market it belongs to.
 *
 * Rows with nothing in them are dropped rather than printed empty, so a day when the SGE feed is
 * down leaves one row instead of a row of dashes.
 */
export function rowsOf(quotes: readonly Quote[]): Array<{ market: string; quotes: Quote[] }> {
  const rows: Array<{ market: string; quotes: Quote[] }> = [];
  for (const q of quotes) {
    // A quote with no market recorded goes to its own row at the end rather than being folded into
    // the first one, which would file an unknown contract under whichever market happened to lead.
    // The whitespace trim matters: an empty or blank `market` is the other common shape of "not
    // recorded", and it would otherwise form a row whose label is invisible.
    const market = q.market?.trim() || "未分类";
    const row = rows.find((r) => r.market === market);
    if (row) row.quotes.push(q);
    else rows.push({ market, quotes: [q] });
  }
  return rows;
}

/** The trading code a reader knows an instrument by, and its Chinese name. */
export const QUOTE_LABEL: Record<QuoteSymbol, { code: string; name: string }> = {
  "GC=F": { code: "GC", name: "纽约黄金" },
  "SI=F": { code: "SI", name: "纽约白银" },
  "HG=F": { code: "HG", name: "纽约铜" },
  "PL=F": { code: "PL", name: "纽约铂金" },
  "PA=F": { code: "PA", name: "纽约钯金" },
  "Au99.99": { code: "Au99.99", name: "黄金" },
  "Ag(T+D)": { code: "Ag(T+D)", name: "白银延期" },
  "Pt99.95": { code: "Pt99.95", name: "铂金" },
  "mAu(T+D)": { code: "mAu(T+D)", name: "黄金延期" },
};
