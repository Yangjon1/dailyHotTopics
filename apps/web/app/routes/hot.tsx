import { useMemo, useState } from "react";
import { useLoaderData } from "react-router";
import { IntentLink } from "../components/ui/IntentLink";
import type { HotEntryView, HotResponse } from "@aihot/contracts/site";
import { subjectAfter, withSubject } from "@aihot/site";
import { edgeTtl, loadOr404, pageExpiresAt } from "../lib/api.server";
import { cachedLoader } from "../lib/page-reuse";
import { pageMeta } from "../lib/seo";
import { monthDayTime } from "../lib/format";
import { Badge } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/Page";
import { IconChevronDown, IconInfo } from "../components/icons";
import { Sparkline } from "../features/hot/Sparkline";
import { PhoneBar } from "../components/shell/PhoneBar";
import type { Screen } from "../components/shell/screens";

export const handle: Screen = { tab: "hot", name: "热点" };
export { shouldRevalidate } from "../lib/page-reuse";
export const clientLoader = cachedLoader<typeof loader>();

export async function loader({ request }: { request: Request }) {
  return { hot: await loadOr404<HotResponse>("/api/site/hot", { signal: request.signal }), expiresAt: pageExpiresAt(120) };
}

export function meta() {
  return pageMeta({
    title: withSubject("热点榜"),
    description: `${subjectAfter("过去 48 小时", "圈")}官方源与媒体跟进最多的 10 个事件：热度指数、趋势与组成热度的公开来源。`,
    path: "/hot",
    image: "/og/pages/hot.png",
  });
}

export function headers() {
  return edgeTtl(120);
}

const BADGES: Record<HotEntryView["badges"][number], { label: string; tone: "hot" | "accent" | "amber"; hint: string }> = {
  surge: { label: "爆", tone: "hot", hint: "跟进来源快速增加" },
  new: { label: "新", tone: "accent", hint: "首报 6 小时内" },
  rising: { label: "发酵中", tone: "amber", hint: "跟进来源仍在增加" },
};

const RANK_COLOR = ["text-rank-1", "text-rank-2", "text-rank-3"];
const rankColor = (rank: number) => RANK_COLOR[rank - 1] ?? "text-rank-rest";
const pad = (rank: number) => String(rank).padStart(2, "0");

/** "某媒体、某账号 等 4 个来源" — the voices, as a count and a couple of names. */
function Voices({ e }: { e: HotEntryView }) {
  const names = e.sourceNames.slice(0, 2);
  return (
    <span className="min-w-0 text-[12.5px] leading-snug text-ink-4">
      <span className="whitespace-nowrap">
        {names.length > 0 && <span className="text-ink-3">{names.join("、")}</span>}
        {e.sourceCount > names.length ? ` 等 ${e.sourceCount} 个来源` : names.length ? " 报道" : `${e.sourceCount} 个来源`}
      </span>
    </span>
  );
}

function Badges({ e }: { e: HotEntryView }) {
  return e.badges.map((b) => (
    <Badge key={b} tone={BADGES[b].tone} title={BADGES[b].hint}>
      {BADGES[b].label}
    </Badge>
  ));
}

/** Opens "热度是怎么算的" at the foot of the page and brings it into view. */
function showMethod() {
  const method = document.getElementById("hot-method") as HTMLDetailsElement | null;
  if (!method) return;
  method.open = true;
  method.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
}

/** The columns a reader can re-order the table by. */
type SortKey = "heat" | "sources" | "trend";

const SORTS: { key: SortKey; label: string; hint: string }[] = [
  { key: "heat", label: "热度", hint: "按热度指数从高到低" },
  { key: "sources", label: "来源", hint: "按报道来源数从多到少" },
  { key: "trend", label: "趋势", hint: "按 6 小时变化从大到小" },
];

/**
 * The ranking as a table the reader can re-order.
 *
 * It is a table rather than a stack of cards because a ranking is a comparison, and a comparison
 * is only possible when the things compared share rows and columns. Cards give each event its own
 * box and its own font sizes, which is fine for reading one and useless for comparing ten.
 *
 * The default order is heat, which is what the server sent and what the page is about. The other
 * orders are a reader's convenience, so the table shows which one is active rather than leaving a
 * reordered table looking like the site's own verdict.
 */
function RankTable({ entries }: { entries: HotEntryView[] }) {
  const [sort, setSort] = useState<SortKey>("heat");
  const rows = useMemo(() => {
    const copy = [...entries];
    if (sort === "sources") copy.sort((a, b) => b.sourceCount - a.sourceCount || a.rank - b.rank);
    // A story with no comparable history has no trend to sort on; it goes last rather than
    // being treated as a 0% change, which would put an unknown in the middle of a ranking.
    else if (sort === "trend") copy.sort((a, b) => trendValue(b) - trendValue(a) || a.rank - b.rank);
    return copy;
  }, [entries, sort]);
  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[12px] text-ink-4">排序</span>
        {SORTS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setSort(s.key)}
            aria-pressed={sort === s.key}
            title={s.hint}
            className={`inline-flex h-8 items-center gap-1 rounded-full border px-3 text-[12.5px] transition-colors ${
              sort === s.key ? "border-accent/35 bg-accent-soft text-accent" : "border-line-strong text-ink-3 hover:border-ink-4 hover:text-ink"
            }`}
          >
            {s.label}
            {sort === s.key && <IconChevronDown size={13} />}
          </button>
        ))}
      </div>
      <div className="scrollbar-thin overflow-x-auto">
        <table className="data-table w-full min-w-[560px]">
          <caption className="sr-only">热点事件榜单，可按热度、来源数或趋势排序</caption>
          <thead>
            <tr>
              <th scope="col" className="sticky-col w-[52px] text-left">#</th>
              <th scope="col" className="text-left">事件</th>
              <th scope="col" className="hidden w-[150px] text-left sm:table-cell">来源</th>
              <th scope="col" className="w-[92px] text-right">报道数</th>
              <th scope="col" className="w-[120px] text-right">24 小时走势</th>
              <th scope="col" className="w-[84px] text-right">热度指数</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.story.publicId}>
                <td className={`mono sticky-col py-0 text-[15px] font-semibold ${rankColor(e.rank)}`} aria-label={`热度排名第 ${e.rank} 位`}>
                  {pad(e.rank)}
                </td>
                <td className="py-0">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <IntentLink viewTransition to={`/story/${e.story.publicId}`} className="line-clamp-1 text-[14.5px] font-semibold leading-[1.5] text-ink transition-colors hover:text-accent">
                      {e.story.title}
                    </IntentLink>
                    {e.badges.length > 0 && (
                      <span className="inline-flex shrink-0 gap-1 align-middle">
                        <Badges e={e} />
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 line-clamp-1 text-[12.5px] text-ink-4 sm:hidden">
                    <Voices e={e} />
                  </div>
                </td>
                <td className="hidden py-0 sm:table-cell">
                  <Voices e={e} />
                </td>
                <td className="num py-0 text-[13px] text-ink-3">{e.sourceCount}</td>
                <td className="py-0">
                  <div className="flex justify-end">
                    <Sparkline values={e.spark} className="h-6 w-[104px]" />
                  </div>
                </td>
                <td className="num py-0 text-[17px] font-semibold text-ink">{Math.round(e.heat)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** A row's 6-hour change, for sorting. Unknown histories sort last instead of counting as zero. */
function trendValue(e: HotEntryView): number {
  if (e.trend === "up") return e.trendPct ?? 0;
  if (e.trend === "down") return -(e.trendPct ?? 0);
  return Number.NEGATIVE_INFINITY;
}

export default function HotPage() {
  const { hot } = useLoaderData<typeof loader>();
  return (
    <div className="pb-10">
      <PhoneBar
        title="热点"
        large
        sub={
          <>
            过去 {hot.windowHours}{`${subjectAfter(" 小时", "圈")}跟进来源最多的 `}{hot.entries.length || 10} 件事
            {hot.computedAt && (
              <>
                {" · "}
                <span className="num">{monthDayTime(hot.computedAt)}</span> 更新
              </>
            )}
          </>
        }
        actions={
          <button type="button" onClick={showMethod} className="flex h-11 items-center gap-1 px-3 text-[14px] text-accent active:opacity-50">
            <IconInfo size={17} /> 怎么算
          </button>
        }
      />
      <header className="hidden flex-wrap items-end justify-between gap-x-6 gap-y-2 pb-4 pt-1 lg:flex">
        <div>
          <div className="flex items-center gap-2 text-[12px] font-semibold tracking-[0.08em] text-hot">
            <span className="relative flex size-2" aria-hidden="true">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-hot opacity-30" />
              <span className="relative inline-flex size-2 rounded-full bg-hot" />
            </span>
            实时热度
          </div>
          <h1 className="mt-1.5 text-[24px] font-bold leading-[1.3] tracking-[-0.01em] text-ink lg:text-[26px]">{withSubject("热点榜")}</h1>
          <p className="mt-1.5 text-[13.5px] text-ink-3">过去 {hot.windowHours} 小时，{withSubject("圈")}跟进来源最多的 {hot.entries.length || 10} 件事</p>
        </div>
        {hot.computedAt && (
          <p className="text-[12px] text-ink-4">
            <span className="num">{monthDayTime(hot.computedAt)}</span> 更新 · 按跟进来源数排序
          </p>
        )}
      </header>

      {hot.entries.length === 0 ? (
        <div className="card rounded-sheet">
          {/*
            The empty state has to explain the rule, not the reader's browsing. "还没有足够多来源"
            reads as though the page had not loaded, so a reader refreshes, waits, and leaves
            thinking something is broken. The honest sentence names the mechanism instead: heat here
            counts how many independent sources and outlets picked an event up, an event needs at
            least two, and a single official release on its own is not one.
          */}
          <EmptyState title="暂时没有热点">
            热点按独立来源的跟进数排序：同一件事要有至少两家官方源或媒体跟进才会上榜。今天还没有事件达到这个门槛。
          </EmptyState>
          <p className="border-t border-line-soft px-5 pb-5 pt-4 text-[12.5px] leading-relaxed text-ink-4">
            只有一家发布的事件不算热点——例如一家央行发布一次声明、一份交易所公告，它们是事实，但还没有第二家跟进。全部动态页按时序列出所有内容。
          </p>
        </div>
      ) : (
        <section aria-label="热点榜单">
          <RankTable entries={hot.entries} />
        </section>
      )}

      <details id="hot-method" className="disclosure group/method mt-8 scroll-mt-[calc(var(--bar-h)+16px)] text-[12px] text-ink-4">
        <summary className="flex items-center gap-1.5 py-1 transition-colors hover:text-ink-2">
          <IconInfo size={15} />
          热度是怎么算的？
          <span className="ml-auto inline-flex items-center gap-0.5">
            <span className="group-open/method:hidden">了解榜单</span>
            <span className="hidden group-open/method:inline">收起</span>
            <IconChevronDown size={13} className="transition-transform duration-200 group-open/method:rotate-180" />
          </span>
        </summary>
        <div className="max-w-[760px] space-y-2 pb-2 pl-[21px] pt-2 leading-[1.75] text-ink-3">
          <p>热度来自跟进同一事件的独立来源与机构：官方源的一次发布算一次，媒体转载同一事实算另一家。同一家的多个渠道只计一次，并按 24 小时半衰期衰减。它衡量有多少来源认为这件事值得跟进，不是报道质量评分。</p>
          <p>一个事件需要至少两家独立来源才会上榜。所以只有一家发布的事情不算热点——央行的一次声明、交易所的一份公告本身是完整的事实，但还没有第二家跟进。榜单统计过去 48 小时，趋势只比较持续覆盖的同一组信源；缺少可比历史时不展示趋势线。</p>
          <p>信源名单只展示可公开阅读的报道来源；计入热度的还包括只提供信号、不公开成文的机构。同一机构的多个渠道可能合并计数，因此热度不一定多于可见信源数。点击事件可查看各方报道与观点。</p>
          <p>表格默认按热度排序，也可以按来源数或 6 小时趋势重排。名次始终是热度名次，不随排序改变。</p>
          <dl className="flex flex-wrap gap-x-5 gap-y-1.5 pt-1">
            {Object.values(BADGES).map((b) => (
              <div key={b.label} className="flex items-center gap-1.5">
                <dt>
                  <Badge tone={b.tone}>{b.label}</Badge>
                </dt>
                <dd>{b.hint}</dd>
              </div>
            ))}
          </dl>
        </div>
      </details>
    </div>
  );
}
