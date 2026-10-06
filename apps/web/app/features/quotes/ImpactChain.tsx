import { IconMinus, IconTrendDown, IconTrendUp } from "../../components/icons";

/**
 * The impact chain of an event: which instrument, in which direction, over what horizon.
 *
 * This is the thing the site exists to say and no other site says. A time stream tells you gold
 * moved; only the chain tells you the Fed drove it, that the effect is upward, and that it plays
 * out over months rather than minutes. Without all three parts it is a sentence of decoration —
 * an instrument with no direction says nothing happened, and a direction with no horizon is
 * advice by another name.
 */
export interface ImpactLink {
  /** The instrument code, e.g. AU9999 / XAG / HG. */
  code: string;
  /** Its Chinese name. */
  name: string;
  /** Which way the event pushes it. */
  direction: "up" | "down" | "mixed";
  /** How long the effect is expected to take. */
  horizon: "intraday" | "weeks" | "months" | "structural";
  /** One clause on the mechanism, from the reporting. */
  note: string | null;
}

const DIRECTION = {
  up: { label: "偏上", Icon: IconTrendUp, className: "val-up" },
  down: { label: "偏下", Icon: IconTrendDown, className: "val-down" },
  mixed: { label: "方向不一", Icon: IconMinus, className: "val-flat" },
} as const;

/** The horizons, shortest first. The order is the point: it ranks the claims from immediate to
 *  structural, so the reader sees how far the reasoning reaches. */
const HORIZON = {
  intraday: "日内",
  weeks: "数周",
  months: "数月",
  structural: "长期",
} as const;

type Direction = keyof typeof DIRECTION;
type Horizon = keyof typeof HORIZON;

const isDirection = (v: string): v is Direction => v in DIRECTION;
const isHorizon = (v: string): v is Horizon => v in HORIZON;

/** Keeps the rows the model got right and drops the ones it did not, so a malformed value shows as
 *  a missing row rather than as an empty instrument name. */
export function readImpact(raw: unknown): ImpactLink[] {
  if (!Array.isArray(raw)) return [];
  const out: ImpactLink[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const code = typeof r.code === "string" ? r.code.trim() : "";
    const name = typeof r.name === "string" ? r.name.trim() : "";
    const direction = typeof r.direction === "string" ? r.direction : "";
    const horizon = typeof r.horizon === "string" ? r.horizon : "";
    if (!code || !name || !isDirection(direction) || !isHorizon(horizon)) continue;
    out.push({ code, name, direction, horizon, note: typeof r.note === "string" && r.note.trim() ? r.note.trim() : null });
  }
  return out;
}

export function ImpactChain({ links }: { links: readonly ImpactLink[] }) {
  if (links.length === 0) return null;
  return (
    <section aria-label="影响链条" className="divide-y divide-line-soft">
      {links.map((l) => {
        const d = DIRECTION[l.direction];
        return (
          <div key={`${l.code}-${l.horizon}`} className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 py-3">
            <span className="mono w-[52px] shrink-0 text-[13px] leading-[1.5] tracking-[0.08em] text-ink-3">{l.code}</span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                <span className="text-[14px] font-semibold text-ink">{l.name}</span>
                {/* Three cues on the direction, same as the price tiles: the arrow for a glance, the
                    word for a reader who cannot use the colour, and the colour itself. */}
                <span className={`inline-flex items-center gap-1 text-[12.5px] ${d.className}`}>
                  <d.Icon size={13} />
                  {d.label}
                </span>
                <span className="text-[12px] text-ink-4">{HORIZON[l.horizon]}</span>
              </div>
              {l.note && <p className="mt-1 text-[13px] leading-[1.7] text-ink-3">{l.note}</p>}
            </div>
          </div>
        );
      })}
    </section>
  );
}
