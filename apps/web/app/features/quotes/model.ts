// The shape of a price snapshot as the site receives it, and the rules for turning a change into
// something a reader can trust.
//
// The upstream price api returns a price and a timestamp and nothing else: no previous close, no
// percentage, no open/high/low. So the comparison here is between two snapshots this site took
// itself, which is NOT the same thing as a financial daily change (that one is measured against
// yesterday's settlement). Labelling it "日涨幅" would be wrong in a way a knowledgeable reader
// would catch, and a wrong number is worse than no number — so the label states which baseline it
// is actually against, and when there is no baseline it says so rather than showing a zero.

/**
 * The bar's own data types, re-exported from the contract rather than restated here.
 *
 * A second local copy of the interface is a second thing to forget to update, and it had already
 * gone stale once: the local copy predated `unit`, so the tile was reading a hard-coded unit table
 * for a field the api was already sending. Whatever the contract says exists, exists — if a field
 * here ever looks unnecessary, that is a question for the contract's owner, not a reason to prune
 * the type locally.
 */
export type { Quote, QuoteBasis, QuoteSymbol, QuotesResponse } from "@aihot/contracts/site";
import type { Quote, QuoteBasis, QuoteSymbol, QuotesResponse } from "@aihot/contracts/site";

/**
 * Order is fixed here and never taken from the response.
 *
 * The price api has no inherent order, and a UI that renders whatever order the API happened to
 * return would reshuffle itself for no reason. Sorting by liquidity instead would put copper
 * between silver and platinum and split the four precious metals in half. Grouping like with like
 * is worth more than any single-instrument optimum: the first four cells are precious metals and
 * the fifth is an industrial metal, and the order itself carries that.
 */
export const QUOTE_ORDER: readonly QuoteSymbol[] = ["XAU", "XAG", "XPT", "XPD", "HG"] as const;

/**
 * Decimal places per instrument, fixed.
 *
 * Silver quotes to three decimals because its price is small and moves in small steps; two would
 * round away the move. Everything else quotes to two. A column whose cells disagree on decimals
 * cannot be scanned, so these are per-instrument constants and not a global format.
 */
export const QUOTE_DECIMALS: Record<QuoteSymbol, number> = { XAU: 2, XAG: 3, XPT: 2, XPD: 2, HG: 2 };

/**
 * The unit each instrument is quoted in. Not decoration: copper is dollars per pound and the
 * precious metals are dollars per troy ounce, so without this a reader compares a 4-dollar number
 * with a 4100-dollar one as if they were the same kind of thing.
 */
export const QUOTE_UNIT: Record<QuoteSymbol, string> = {
  XAU: "美元/盎司",
  XAG: "美元/盎司",
  XPT: "美元/盎司",
  XPD: "美元/盎司",
  HG: "美元/磅",
};

/** The trading code readers know an instrument by, and its Chinese name. */
export const QUOTE_LABEL: Record<QuoteSymbol, { code: string; name: string }> = {
  XAU: { code: "AU9999", name: "黄金" },
  XAG: { code: "XAG", name: "白银" },
  XPT: { code: "XPT", name: "铂金" },
  XPD: { code: "XPD", name: "钯金" },
  HG: { code: "HG", name: "铜" },
};

/**
 * What a change is measured against.
 * - `yesterday`: a baseline one calendar day back. The only case where "较昨日" is true.
 * - `lastSnapshot`: the previous snapshot, whenever yesterday's run was missed. The label says
 *   "较上次" so a reader never reads a five-day-old baseline as a daily move.
 * - `none`: nothing to compare against. The tile shows a dash and no arrow.
 */

/** A gap longer than this and the baseline is too old to be read as a daily change. */
export const BASIS_GAP_DAYS = 3;

/** How old a snapshot may be before the bar says so. */
export const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

/** A change worth drawing, or the honest absence of one. */
export type Move =
  | { kind: "up"; pct: number }
  | { kind: "down"; pct: number }
  | { kind: "flat"; pct: number }
  | { kind: "none" };

/**
 * The direction a change is shown in.
 *
 * Three cues travel together and all three are needed: the colour for the eye, the written sign
 * for a reader who cannot separate the hues, and the arrow for direction without reading. Colour
 * alone would fail WCAG 1.4.1 and would fail a reader with deuteranopia outright.
 */
export function moveOf(pct: number | null): Move {
  // No baseline is not a zero move. Rounding a small real move to zero would also be a lie, so the
  // test is on the value itself and the rounding only decides how many digits to print.
  if (pct === null || !Number.isFinite(pct)) return { kind: "none" };
  if (pct > 0) return { kind: "up", pct };
  if (pct < 0) return { kind: "down", pct };
  return { kind: "flat", pct };
}

/** The word that names the baseline, so the number is never read as more than it is. */
export function basisLabel(basis: QuoteBasis | null): string {
  if (basis === "yesterday") return "较昨日";
  if (basis === "lastSnapshot") return "较上次";
  return "—";
}

/** A price at its instrument's fixed precision, or a dash when there is no price. */
export function formatPrice(price: number | null, symbol: QuoteSymbol): string {
  if (price === null || !Number.isFinite(price)) return "—";
  return price.toLocaleString("en-US", { minimumFractionDigits: QUOTE_DECIMALS[symbol], maximumFractionDigits: QUOTE_DECIMALS[symbol] });
}

/**
 * A percentage to two decimals, always signed, or a dash when there is no baseline.
 *
 * The `%` is part of the number, not decoration on the tile: a bare "+1.24" beside a price is a
 * quantity with no unit, and the number without its unit is the failure Spec §9.6's "数字三件套"
 * (value, unit, basis) is about. Two decimals for every instrument — one hides a small move and
 * three is noise.
 */
export function formatChange(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return "—";
  const v = pct.toFixed(2);
  // A value that rounds to zero is shown as a signed zero, not as an arrow: "±0.00%" is noise, and
  // so is an arrow on a number that did not move.
  return `${pct > 0 ? "+" : ""}${v}%`;
}

/** Whole days between two ISO timestamps, by calendar day. Null if either is unusable. */
export function daysBetween(fromIso: string | null, toIso: string | null): number | null {
  if (!fromIso || !toIso) return null;
  const a = Date.parse(fromIso);
  const b = Date.parse(toIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.floor(Math.abs(b - a) / 86_400_000);
}

/**
 * True when the baseline is too old to be read as a daily change.
 *
 * This is the edge most easily missed and the most expensive to get wrong: a percentage measured
 * against a five-day-old snapshot looks exactly like a daily move, and a reader acting on it is
 * acting on a number that means something else. Past the gap the tile keeps the number, marks it,
 * and the label already reads "较上次".
 *
 * The gap is measured against **now**, not against the quote's own `updatedAt`, and the two are not
 * interchangeable. They differ exactly when the pipeline has stopped: if the newest snapshot is
 * five days old and its baseline six, then quote-to-baseline is one day — the tile would call that
 * fresh and show an unmarked percentage — while the number on screen is a week old. Measuring
 * against `now` is what the reader is actually reasoning about, and it is what the api measured
 * when it chose `lastSnapshot` over `yesterday`, so this agrees with the label it is explaining.
 */
export function baselineIsStale(quote: Quote, now = Date.now()): boolean {
  if (quote.basis === "none" || !quote.basisAt) return false;
  const days = daysBetween(quote.basisAt, new Date(now).toISOString());
  return days !== null && days > BASIS_GAP_DAYS;
}

/**
 * The newest snapshot in the set, as an ISO instant. Null when there is none.
 *
 * The bar's "数据截至 HH:mm" has to name when the *data* was taken, so it reads this rather than the
 * response's `computedAt`. The api sets `computedAt` to the moment it answered, which is always
 * now — printing it would put the current clock next to a week-old price and call the price
 * current, which is the one thing that line exists to prevent.
 */
export function newestSnapshotAt(quotes: readonly Quote[]): string | null {
  let newest: number | null = null;
  for (const q of quotes) {
    if (!q.updatedAt) continue;
    const t = Date.parse(q.updatedAt);
    if (!Number.isFinite(t)) continue;
    if (newest === null || t > newest) newest = t;
  }
  return newest === null ? null : new Date(newest).toISOString();
}

/** Whether the newest snapshot is old enough that the bar must say so. */
export function isStale(updatedAt: string | null, now = Date.now()): boolean {
  if (!updatedAt) return true;
  const t = Date.parse(updatedAt);
  if (!Number.isFinite(t)) return true;
  return now - t > STALE_AFTER_MS;
}

/** Puts the response into the fixed order, dropping anything unrecognised. A cell for an unknown
 *  symbol would be a blank with a border around it, which reads as a loading failure. */
export function orderQuotes(quotes: readonly Quote[]): Quote[] {
  const bySymbol = new Map(quotes.map((q) => [q.symbol, q]));
  return QUOTE_ORDER.map((s) => bySymbol.get(s)).filter((q): q is Quote => q !== undefined);
}

/** The symbol behind a trading code, or null when the site does not cover that instrument.
 *  There is deliberately no fallback: an unrecognised code has no honest label, and defaulting to
 *  the first instrument would file someone else's metal under 黄金. */
export function symbolOfCode(code: string): QuoteSymbol | null {
  return QUOTE_ORDER.find((s) => QUOTE_LABEL[s].code === code) ?? null;
}
