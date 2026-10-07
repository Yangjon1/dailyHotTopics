import { QUOTE_LABEL, QUOTE_ORDER, type InstrumentRef } from "./model.ts";
export type { InstrumentRef } from "./model.ts";
export { allInstruments, instrumentsOf } from "./model.ts";

/**
 * The degraded form of a price panel: which instruments the site covers, and no prices for them.
 *
 * This is what shows when there is no snapshot to show. The line at the bottom says so in words,
 * because a table of instruments with the price column quietly missing looks like a bug, and a
 * reader who has been told "gold 4100" somewhere else will assume the number is coming.
 *
 * It appears on the event page only. Putting it on the home page in place of the bar would be a
 * semantic substitution: the bar is a fixed set of five instruments shown as a band, and this is a
 * list explaining their absence. Swapping them would leave the module promising a thing it no
 * longer is.
 */
export function ReferenceTable({ instruments }: { instruments: readonly InstrumentRef[] }) {
  const known = instruments.filter((i) => QUOTE_ORDER.includes(i.symbol));
  if (known.length === 0) return null;
  return (
    <div className="divide-y divide-line-soft">
      {known.map((i) => {
        const label = QUOTE_LABEL[i.symbol];
        return (
          <div key={i.symbol} className="flex items-baseline gap-2 py-2.5">
            <span className="mono w-[52px] shrink-0 text-[13px] tracking-[0.08em] text-ink-3">{label.code}</span>
            <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink-2">{label.name}</span>
          </div>
        );
      })}
      {/*
        No count column. There was one — "N 条相关事件" — and it read 0 for every row, because
        nothing computes how many events name an instrument: that is the same missing measurement
        the impact chain needed. A column of zeros is worse than no column, because zero is a claim,
        and this one was false. It comes back when there is a real count to print.
      */}
      <p className="pt-2.5 text-[12px] leading-relaxed text-ink-4">近 24 小时无该品种的价格快照。</p>
    </div>
  );
}
