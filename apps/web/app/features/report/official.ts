import { REPORTS } from "@aihot/site";

/**
 * The masthead's line about official releases, and the three states it can be in.
 *
 * The wording is not written here. It is composed upstream, next to the counts it describes, and
 * arrives as one string — `REPORTS.officialTally` in site/site.ts owns it, and a second copy of
 * the sentence in the renderer is a second thing to keep in step and a second thing to get wrong.
 *
 * What this module owns is the *reading* of that state, which is a separate job and the one the
 * eye actually has to do:
 *
 * - a quiet day is not a warning. Zero official releases with every source reporting is a fact
 *   about the world, and painting it amber would cry wolf on most days, which is most days.
 * - an incomplete collection is a different thing from a quiet day, and it is the one state that
 *   must never be drawn as "nothing happened". A reader who sees a quiet market and concludes the
 *   desk is calm when in fact three sources did not report has been told something false by an
 *   omission. So the incomplete state always pairs its warning with the count that did arrive.
 */
export type OfficialState =
  /** Some official releases, and every official source reported. */
  | { kind: "withItems"; events: number; headline: string }
  /** No official releases, and every official source reported. A genuinely quiet day. */
  | { kind: "empty"; events: 0; headline: string }
  /** At least one official source did not report. Whatever arrived still counts. */
  | { kind: "incomplete"; events: number; missed: number; headline: string };

/** The shape upstream writes into the issue, and the contract exposes. */
export interface OfficialTally {
  events: number;
  sourcesTotal: number;
  sourcesMissed: number;
  headline: string;
}

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Reads the tally, or returns null when the issue predates it.
 *
 * Every field is checked rather than trusted. An issue written before this data existed has none
 * of it, and an issue whose headline arrived empty must not fall through to the "quiet day"
 * wording — that is exactly the substitution this is meant to prevent, and it would be silent.
 * A tally with no headline is treated as unknown, not as empty.
 */
export function readOfficial(raw: unknown): OfficialState | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  if (!isCount(t.events) || !isCount(t.sourcesMissed)) return null;
  const headline = typeof t.headline === "string" ? t.headline.trim() : "";
  if (!headline) return null;
  if (t.sourcesMissed > 0) {
    return { kind: "incomplete", events: Math.max(0, t.events), missed: t.sourcesMissed, headline };
  }
  if (t.events > 0) return { kind: "withItems", events: t.events, headline };
  return { kind: "empty", events: 0, headline };
}

/** The wording, for a caller that needs it as text (a share caption, a test). */
export const OFFICIAL_EMPTY = REPORTS.officialTally.empty;
export const OFFICIAL_INCOMPLETE = REPORTS.officialTally.incomplete;
