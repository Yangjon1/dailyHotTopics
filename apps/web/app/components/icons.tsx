// The site's icon set: lucide-react, and nothing else.
//
// Exports keep the historical `Icon*` names so the ~90 files that import them are untouched.
// Geometry is identical to what these were hand-drawn at (24 viewBox, round caps and joins,
// currentColor), so the swap is a change of source, not of look.
//
// Three sizes are in use, and stroke width is the one place the scale is not linear: Lucide's
// default of 2 is right at 24px and too heavy at 16px, where the strokes of a dense glyph close
// into a blob. So width follows size, and there are exactly three of them:
//     16px -> 1.5     20px -> 1.7     24px -> 1.75
// A fourth value is a bug.
import {
  ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight, Bookmark, ChartNoAxesColumn, Check, ChevronDown,
  ChevronLeft, ChevronRight, Clock, Code, Copy, Download, Ellipsis, ExternalLink, Flame, Heart,
  History, Image, Info, LayoutGrid, List, Menu, MessageSquare, Minus, Monitor, Moon, Newspaper,
  Plug, Radar, Rss, Search, Share2, SlidersHorizontal, Sun, TrendingDown, TrendingUp, User, Users,
  X, Zap,
} from "lucide-react";
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

/** Stroke width for a size, from the three-step scale. A size between two steps takes the width of
 *  the step above it, so a 17px icon does not render visibly lighter than a 16px one beside it. */
function weightFor(size: number): number {
  if (size <= 16) return 1.5;
  if (size <= 20) return 1.7;
  return 1.75;
}

/**
 * The props for one icon at `size`: the size and its stroke width, decorative by default, plus
 * whatever the caller passed.
 *
 * Two things are stripped off the caller's props on the way through. `size` is re-derived so an
 * absent one does not spread back as `undefined`. `strokeWidth` is dropped outright and the size
 * scale is authoritative: a caller-supplied weight is how a fourth value gets into the set, and
 * the whole point of the scale is that there are only three. A mark that genuinely needs more ink
 * than its size allows is drawn filled, not by inventing a weight.
 */
function icon(size: number | undefined, props: P, extra?: Partial<SVGProps<SVGSVGElement>>) {
  const { size: _size, strokeWidth: _weight, ...rest } = props;
  const px = size ?? 18;
  return { size: px, strokeWidth: weightFor(px), "aria-hidden": true, focusable: false, ...extra, ...rest } as const;
}

export const IconBolt = (p: P) => <Zap {...icon(p.size, p)} />;
export const IconHeart = (p: P) => <Heart {...icon(p.size, p)} />;
export const IconUsers = (p: P) => <Users {...icon(p.size, p)} />;
export const IconDoc = (p: P) => <Newspaper {...icon(p.size, p)} />;
export const IconList = (p: P) => <List {...icon(p.size, p)} />;
export const IconFlame = (p: P) => <Flame {...icon(p.size, p)} />;
export const IconGrid = (p: P) => <LayoutGrid {...icon(p.size, p)} />;
/** `filled` marks the saved state. The fill is the cue that survives at 16px without relying on
 *  colour, so it is a shape change and not a tint. */
export const IconBookmark = (p: P & { filled?: boolean }) => {
  const { filled, ...rest } = p;
  return <Bookmark {...icon(rest.size, rest, { fill: filled ? "currentColor" : "none" })} />;
};
export const IconChart = (p: P) => <ChartNoAxesColumn {...icon(p.size, p)} />;
export const IconClock = (p: P) => <Clock {...icon(p.size, p)} />;
export const IconPlug = (p: P) => <Plug {...icon(p.size, p)} />;
export const IconRss = (p: P) => <Rss {...icon(p.size, p)} />;
export const IconCode = (p: P) => <Code {...icon(p.size, p)} />;
export const IconInfo = (p: P) => <Info {...icon(p.size, p)} />;
export const IconHistory = (p: P) => <History {...icon(p.size, p)} />;
export const IconMessage = (p: P) => <MessageSquare {...icon(p.size, p)} />;
export const IconSearch = (p: P) => <Search {...icon(p.size, p)} />;
export const IconSun = (p: P) => <Sun {...icon(p.size, p)} />;
export const IconMoon = (p: P) => <Moon {...icon(p.size, p)} />;
export const IconMonitor = (p: P) => <Monitor {...icon(p.size, p)} />;
export const IconArrowLeft = (p: P) => <ArrowLeft {...icon(p.size, p)} />;
export const IconArrowRight = (p: P) => <ArrowRight {...icon(p.size, p)} />;
export const IconArrowUpRight = (p: P) => <ArrowUpRight {...icon(p.size, p)} />;
export const IconChevronDown = (p: P) => <ChevronDown {...icon(p.size, p)} />;
export const IconChevronRight = (p: P) => <ChevronRight {...icon(p.size, p)} />;
export const IconChevronLeft = (p: P) => <ChevronLeft {...icon(p.size, p)} />;
export const IconExternal = (p: P) => <ExternalLink {...icon(p.size, p)} />;
export const IconDownload = (p: P) => <Download {...icon(p.size, p)} />;
export const IconImage = (p: P) => <Image {...icon(p.size, p)} />;
export const IconShare = (p: P) => <Share2 {...icon(p.size, p)} />;
export const IconMenu = (p: P) => <Menu {...icon(p.size, p)} />;
/** Three dots: more actions. Filled, because the dots are the whole mark and a stroked ring this
 *  small reads as smudges. */
export const IconMore = (p: P) => <Ellipsis {...icon(p.size, p, { fill: "currentColor" })} />;
/** The filter control: two rails and their handles, which is what a filter row looks like. */
export const IconFilter = (p: P) => <SlidersHorizontal {...icon(p.size, p)} />;
export const IconUser = (p: P) => <User {...icon(p.size, p)} />;
export const IconClose = (p: P) => <X {...icon(p.size, p)} />;
export const IconArrowUp = (p: P) => <ArrowUp {...icon(p.size, p)} />;
export const IconTrendUp = (p: P) => <TrendingUp {...icon(p.size, p)} />;
export const IconTrendDown = (p: P) => <TrendingDown {...icon(p.size, p)} />;
export const IconMinus = (p: P) => <Minus {...icon(p.size, p)} />;
export const IconCheck = (p: P) => <Check {...icon(p.size, p)} />;
/** A filled check, for a mark too small to read as a stroke. See Controls.tsx's filter chip. */
export const IconCheckFilled = (p: P) => <Check {...icon(p.size, p, { fill: "currentColor" })} />;
export const IconCopy = (p: P) => <Copy {...icon(p.size, p)} />;
export const IconRadar = (p: P) => <Radar {...icon(p.size, p)} />;

/** Kept out of Lucide: the GitHub mark is a trademark, and no icon set may redistribute it. */
const GITHUB_MARK = "M12 2.2a9.8 9.8 0 00-3.1 19.1c.5.1.7-.2.7-.5v-1.7c-2.7.6-3.3-1.3-3.3-1.3-.4-1.1-1.1-1.4-1.1-1.4-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.6.3-1.1.6-1.3-2.2-.3-4.5-1.1-4.5-4.9 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.6 0 0 .8-.3 2.7 1a9.3 9.3 0 014.9 0c1.9-1.3 2.7-1 2.7-1 .5 1.3.2 2.3.1 2.6.6.7 1 1.6 1 2.7 0 3.8-2.3 4.6-4.5 4.9.4.3.7.9.7 1.9v2.8c0 .3.2.6.7.5A9.8 9.8 0 0012 2.2z";
/** The GitHub mark (filled, not stroked). */
export const IconGithub = ({ size = 18, ...rest }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" {...rest}>
    <path d={GITHUB_MARK} />
  </svg>
);
