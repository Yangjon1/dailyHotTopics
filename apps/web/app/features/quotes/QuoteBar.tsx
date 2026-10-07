import { useState } from "react";
import type { QuoteSymbol } from "@aihot/contracts/site";
import { orderQuotes, type QuotesResponse } from "./model";
import { rowsOf } from "./instruments.ts";
import { QuoteTile } from "./QuoteTile";
import { QuoteFreshness } from "./QuoteFreshness";
import { QuoteTrend } from "./QuoteTrend";

/**
 * The price band at the top of the home page: every instrument the site covers, its latest snapshot,
 * and how far that snapshot moved.
 *
 * Two rows, one per market, and the row is not decoration. The international futures quote in
 * dollars per troy ounce (per pound for copper) and the domestic spot in yuan per gram, so 4196 and
 * 909 are not two numbers a reader can compare — they are about a hundredfold apart and describing
 * one market's metal against the other's. The rows keep them apart, every cell prints its own unit
 * and exchange, and the change line under the band dates the data per market rather than once for
 * the whole band, because the two markets close at different times and the Shanghai exchange is
 * shut on days the others trade.
 *
 * A full-width band with no frame, no radius and no shadow. Rounded corners would leave a notch
 * where two neighbouring cells meet, and a grid of numbers that has a shadow stops reading as a grid
 * and starts reading as nine separate cards.
 */
export function QuoteBar({ data, now = Date.now() }: { data: QuotesResponse; now?: number }) {
  const [open, setOpen] = useState<QuoteSymbol | null>(null);
  const quotes = orderQuotes(data.quotes);
  const rows = rowsOf(quotes);

  // Nothing collected yet. The cells stay as cells: filling the row with dashes to match the shape
  // of a loaded band would make an empty state look like a data outage.
  if (quotes.length === 0) {
    return (
      <section aria-label="行情数据" className="bleed border-y border-line bg-surface py-4 lg:mx-0 lg:px-0">
        <p className="text-[13px] text-ink-4">行情数据尚未生成。</p>
      </section>
    );
  }

  return (
    <section aria-label="行情数据" className="bleed border-y border-line bg-surface lg:mx-0 lg:px-0">
      {rows.map((row) => (
        <div key={row.market} className="border-b border-line-soft last:border-b-0">
          {/*
            The market's name, so the two rows are not nine anonymous cells. It is a heading rather
            than a label in the corner because it is the one fact that makes the row's numbers
            interpretable, and a reader who does not know row two is Shanghai rather than London
            cannot use anything else on it.
          */}
          <h2 className="px-3 pb-1 pt-2.5 text-[11px] font-semibold tracking-[0.04em] text-ink-4">{row.market}</h2>
          {/*
            Each row scrolls on its own. One shared scroller would tie the second row's position to
            the first's, and since the rows are read as two markets, scrolling one sideways while the
            other stays put is what a reader expects.
          */}
          <div className="scrollbar-none flex gap-0 overflow-x-auto">
            {row.quotes.map((q, i) => (
              <div key={q.symbol} className={i === 0 ? "" : "border-l border-line-soft"}>
                <QuoteTile
                  quote={q}
                  now={now}
                  onOpen={(s) => setOpen((cur) => (cur === s ? null : s))}
                  expanded={open === q.symbol}
                />
              </div>
            ))}
          </div>
          {/*
            Each market's own freshness line, not one for the band. The Shanghai exchange was shut for
            a national holiday when the futures were trading, so a single "data as of" would be
            claiming today's number for a price last collected a week ago — which is the one thing
            this line exists to prevent.
          */}
          <div className="px-3 py-2">
            <QuoteFreshness quotes={row.quotes} now={now} />
          </div>
        </div>
      ))}
      {open && <QuoteTrend symbol={open} onClose={() => setOpen(null)} />}
    </section>
  );
}
