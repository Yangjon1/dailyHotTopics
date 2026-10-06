import { IconClock } from "../../components/icons";
import { basisLabel, baselineIsStale, formatChange, formatPrice, moveOf, QUOTE_LABEL, QUOTE_UNIT, type Quote } from "./model";

/**
 * One instrument in the bar: its code, its latest price, the move, and the unit it is quoted in.
 *
 * No sparkline. There is one snapshot a day, so a line through one or two points is not a trend,
 * it is a drawing of noise — and five of them side by side in 116px are unreadable anyway. The
 * 32px that would have gone to a sparkline went into the price instead: the price is the point of
 * the tile, and at 17px against the change's 13px it finally reads as the subject of the cell
 * rather than a twin of its own change. Once there are 14 days of history, a 7-day sparkline goes
 * on the event page's panel, where a single instrument has context; the home bar stays without.
 */
export function QuoteTile({ quote, now }: { quote: Quote; now?: number }) {
  const label = QUOTE_LABEL[quote.symbol];
  const move = moveOf(quote.changePct);
  const stale = baselineIsStale(quote, now);
  const dir = move.kind === "none" ? "flat" : move.kind;
  return (
    <div
      className="flex h-[92px] w-[104px] shrink-0 flex-col justify-between px-3 py-2.5 sm:w-[116px]"
      title={`${label.name}（${label.code}）`}
    >
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
        The unit line. Without it a reader compares dollars per pound with dollars per ounce, and
        4 dollars of copper against 4100 of gold looks like a hundredfold gap in the wrong
        direction. The api's `unit` wins when it has one — it is what the collector recorded, and a
        local table would quietly disagree with the data the moment the feed changes its units.
      */}
      <div className="text-[11px] leading-none text-ink-4">{quote.unit ?? QUOTE_UNIT[quote.symbol]}</div>
    </div>
  );
}
