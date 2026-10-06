import { QUOTE_LABEL, QUOTE_ORDER, symbolOfCode, type Quote, type QuoteSymbol } from "./model";

/** An instrument this event mentions, with how many related events name it. */
export interface InstrumentRef {
  symbol: QuoteSymbol;
  /** How many events on the site reference this instrument. */
  eventCount: number;
}

/**
 * The degraded form of a price panel: which instruments an event touches, and no prices.
 *
 * This is what shows when there is no snapshot to show. The line at the bottom says so in words,
 * because a table of instruments with the price column quietly missing looks like a bug, and a
 * reader who has been told "gold 4100" somewhere else will assume the number is coming.
 *
 * It appears on the event and item pages only. Putting it on the home page in place of the bar
 * would be a semantic substitution: the bar is a fixed set of five instruments, and this is a set
 * derived from one event. Swapping them would leave the module promising a thing it no longer is.
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
            <span className="num shrink-0 text-[12px] text-ink-4">{i.eventCount} 条相关事件</span>
          </div>
        );
      })}
      <p className="pt-2.5 text-[12px] leading-relaxed text-ink-4">近 24 小时无该品种的价格快照。</p>
    </div>
  );
}

/** Picks the instruments out of a set of quotes, for the event page to show alongside prices. */
export function instrumentsOf(quotes: readonly Quote[]): InstrumentRef[] {
  return quotes.filter((q) => q.price !== null).map((q) => ({ symbol: q.symbol, eventCount: 0 }));
}

/** The instruments behind a set of trading codes, dropping any the site does not cover. */
export function instrumentsOfCodes(codes: readonly string[]): InstrumentRef[] {
  const out: InstrumentRef[] = [];
  for (const c of codes) {
    const symbol = symbolOfCode(c);
    if (symbol && !out.some((i) => i.symbol === symbol)) out.push({ symbol, eventCount: 0 });
  }
  return out;
}
