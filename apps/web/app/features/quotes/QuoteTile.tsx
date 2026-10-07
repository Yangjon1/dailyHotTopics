import { IconClock } from "../../components/icons";
import { basisLabel, baselineIsStale, formatChange, formatPrice, moveOf, type Quote } from "./model";
import { QUOTE_LABEL, exchangeOf, shortExchange, unitOf } from "./instruments.ts";

/**
 * One instrument in the band: its code, its price, the move, the unit, and where it trades.
 *
 * No sparkline here, and none later either. The cell is 92px of content already — a line through two
 * daily points is a drawing of noise, and the trend that is worth drawing lives behind the click,
 * where one instrument gets the width to be a chart rather than a squiggle.
 *
 * The whole cell is a button because the chart is the answer to "how has this moved", and a reader
 * who has to aim at a small target to ask that will not ask it. 92×92 is far past the 44×44 minimum
 * in any case.
 */
export function QuoteTile({ quote, now, onOpen, expanded }: { quote: Quote; now?: number; onOpen?: (symbol: Quote["symbol"]) => void; expanded?: boolean }) {
  const label = QUOTE_LABEL[quote.symbol];
  const move = moveOf(quote.changePct);
  const stale = baselineIsStale(quote, now);
  const dir = move.kind === "none" ? "flat" : move.kind;
  // The exchange is the api's. It is null for an instrument the collector has not classified, and
  // the honest thing then is to say so — the alternative, guessing from the symbol, is how this
  // band would end up filing an SGE contract under COMEX.
  const exchange = exchangeOf(quote);
  const body = (
    <>
      <div className="flex items-baseline gap-1.5">
        {/* The code, not the name: it is the shorter string, it is what a terminal shows, and the
            Chinese name is one hover away for the reader who does not know the code. */}
        <span className="mono truncate text-[13px] leading-none tracking-[0.08em] text-ink-3">{label.code}</span>
        {/*
          The gap marker, beside the instrument code rather than beside the percentage. It belongs
          to the comparison, not to the number, and this row has room for it where the change row
          does not. A reader who takes the percentage without it has taken a week-old move for a
          daily one, so it is never allowed to be the thing that gets dropped for space.
        */}
        {stale && (
          <span className="inline-flex shrink-0 items-center text-warn" title="基准快照间隔超过 3 天，这个涨跌幅不是日涨跌">
            <IconClock size={14} />
            <span className="sr-only">基准间隔超过三天，不是日涨跌</span>
          </span>
        )}
      </div>
      <div className={`num text-[17px] leading-none ${quote.price === null ? "text-flat" : "text-ink"}`}>{formatPrice(quote.price, quote.symbol)}</div>
      {/*
        The basis and the change, on one line that is never allowed to wrap or truncate.

        Spec §9.4 puts the basis word in the cell — "较昨日 +1.24%" — and a basis that has been
        abbreviated or clipped to fit is worse than no basis, because the reader loses the one
        clause that says what the number is measured against. At 92px a three-glyph basis, a signed
        percentage and a 14px marker do not fit, so the marker moves out of this row rather than
        either of the two being cut. It goes to the top row, next to the instrument code, where it
        qualifies the whole cell rather than the number in it.
      */}
      <div className="flex flex-nowrap items-baseline gap-1 whitespace-nowrap text-[13px] leading-none">
        {move.kind === "none" ? (
          <span className="text-flat" title="没有可比较的基准">
            {basisLabel(quote.basis)}
          </span>
        ) : (
          <>
            {/* The basis comes before the number, so "较昨日 +1.24%" reads as one claim. Putting the
                number first would let a reader take the percentage before meeting the caveat. */}
            <span className="shrink-0 text-[11px] text-ink-4">{basisLabel(quote.basis)}</span>
            <span className={`val shrink-0 ${dir === "up" ? "val-up" : dir === "down" ? "val-down" : "val-flat"}`}>
              {move.kind === "up" && <span aria-hidden="true">▲</span>}
              {move.kind === "down" && <span aria-hidden="true">▼</span>}
              {formatChange(move.pct)}
            </span>
          </>
        )}
      </div>
      {/*
        The unit, then the exchange. Both are on every cell rather than once per row, because the two
        rows quote in different currencies and different weights per unit: 4196 USD/oz beside 909 CNY/g
        is about a hundredfold, and a reader who takes the row's meaning from its position will read
        that as a comparison of the metals rather than of two markets. The api's own strings are used
        for the unit, so the tile and the trend endpoint can never spell the same unit differently.
        The exchange is shortened because it does not fit beside a price — see shortExchange.
      */}
      <div className="flex flex-nowrap items-baseline justify-between gap-1 whitespace-nowrap text-[11px] leading-none text-ink-4">
        <span className="truncate">{unitOf(quote)}</span>
        <span className="shrink-0">{shortExchange(quote)}</span>
      </div>
    </>
  );
  if (!onOpen) {
    return (
      <div className="flex h-[92px] w-[104px] shrink-0 flex-col justify-between px-3 py-2.5 sm:w-[116px]" title={`${label.name}（${label.code}）`}>
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onOpen(quote.symbol)}
      aria-expanded={expanded}
      title={`${label.name}（${label.code}）· ${exchange}`}
      className={`flex h-[92px] w-[104px] shrink-0 flex-col justify-between px-3 py-2.5 text-left transition-colors duration-150 ease-standard sm:w-[116px] ${
        expanded ? "bg-bg-sunk" : "hover:bg-bg-sunk active:bg-bg-muted"
      }`}
    >
      {body}
    </button>
  );
}
