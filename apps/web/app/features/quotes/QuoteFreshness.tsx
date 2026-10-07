import { IconClock } from "../../components/icons";
import { beijingTime } from "@aihot/contracts/time";
import { isStale, newestSnapshotAt, type Quote } from "./model";

/**
 * When these prices were taken, or a warning that they are too old to act on.
 *
 * The line exists because a price that is six hours old and one that is six minutes old look
 * identical on the tile, and a reader who cannot tell them apart will make a decision on a stale
 * number. Saying so is the difference between a data display and a claim.
 *
 * It dates the newest snapshot, never the response: the api stamps `computedAt` with the moment it
 * answered, so printing it would put the current clock beside a week-old price and call that price
 * current — the one thing this line is here to prevent.
 *
 * Past the threshold the wording changes as well as the colour, because colour alone is the only
 * encoding on this page and the reader is expected to act on this.
 *
 * `now` is passed in rather than read from the clock here: the same value has to reach the tiles and
 * this line in one render, and a value computed during SSR is frozen into the HTML. A caller that
 * takes it from the loader's response shares one instant across the server render and the
 * hydration that follows it.
 */
export function QuoteFreshness({ quotes, now }: { quotes: readonly Quote[]; now: number }) {
  const freshest = newestSnapshotAt(quotes);
  const stale = isStale(freshest, now);
  return (
    <p className={`flex items-center justify-end gap-1 text-[11px] leading-none ${stale ? "text-warn" : "text-ink-4"}`}>
      {stale && <IconClock size={14} />}
      {stale ? "行情数据可能已过期" : "数据截至"}
      {!stale && freshest && <span className="num">{beijingTime(freshest)}</span>}
    </p>
  );
}
