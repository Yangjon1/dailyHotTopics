import { IconClock } from "../../components/icons";
import { beijingTime } from "@aihot/contracts/time";
import { QUOTE_ORDER, isStale, newestSnapshotAt, orderQuotes, type QuotesResponse } from "./model";
import { QuoteTile } from "./QuoteTile";

/**
 * The price bar at the top of the home page: five instruments, their latest snapshot, and how far
 * that snapshot moved.
 *
 * A full-width band with no frame, no radius and no shadow. Rounded corners would leave a notch
 * where two neighbouring cells meet, and a grid of numbers that has a shadow stops reading as a
 * grid and starts reading as five separate cards.
 */
export function QuoteBar({ data, now = Date.now() }: { data: QuotesResponse; now?: number }) {
  const quotes = orderQuotes(data.quotes);
  // The freshness line dates the newest snapshot, not the response. The api stamps `computedAt` with
  // the moment it answered, so using it would print the current clock beside a week-old price and
  // call that price current — the one thing this line exists to prevent.
  const freshest = newestSnapshotAt(quotes);
  const stale = isStale(freshest, now);

  // Nothing collected yet. The five cells stay as five cells: filling the row with dashes to match
  // the shape of a loaded bar would make an empty state look like a data outage.
  if (quotes.length === 0) {
    return (
      <section aria-label="行情数据" className="bleed border-y border-line bg-surface py-4 lg:mx-0 lg:px-0">
        <p className="text-[13px] text-ink-4">行情数据尚未生成。</p>
      </section>
    );
  }

  return (
    <section aria-label="行情数据" className="bleed border-y border-line bg-surface lg:mx-0 lg:px-0">
      <div className="scrollbar-none flex gap-0 overflow-x-auto">
        {quotes.map((q, i) => (
          <div key={q.symbol} className={i === 0 ? "" : "border-l border-line-soft"}>
            <QuoteTile quote={q} now={now} />
          </div>
        ))}
      </div>
      {/*
        The freshness line. It is not a nicety: a price that is six hours old and a price that is
        six minutes old look identical on the tile, and a reader who cannot tell them apart will
        make a decision on a stale number. Saying so is the difference between a data display and
        a claim. Past the threshold the wording changes rather than only the colour, because colour
        alone is the encoding this product does not use for anything a reader must act on.
      */}
      <p className={`flex items-center justify-end gap-1 px-3 pb-2 text-[11px] leading-none ${stale ? "text-warn" : "text-ink-4"}`}>
        {stale && <IconClock size={14} />}
        {stale ? "行情数据可能已过期" : "数据截至"}
        {!stale && freshest && <span className="num">{beijingTime(freshest)}</span>}
      </p>
    </section>
  );
}

/** The instruments the bar covers, for callers that need the list without the response. */
export const QUOTE_SYMBOLS = QUOTE_ORDER;
