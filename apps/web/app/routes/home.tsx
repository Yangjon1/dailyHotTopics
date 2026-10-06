import { data as withHeaders, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/home";
import type { TimelineResponse } from "@aihot/contracts/site";
import { apiDeadlineCache, apiGet, loadOr404, pageExpiresAt } from "../lib/api.server";
import { cachedLoader } from "../lib/page-reuse";
import { filterParams, itemListLd, listPath, pageMeta, readFilters, siteLd } from "../lib/seo";
import type { Screen } from "../components/shell/screens";
import { Timeline } from "../features/feed/Timeline";
import { HotTopics } from "../features/feed/HotTopics";
import { ActiveFilters, CategoryTabs, FeedBar, SearchField } from "../features/feed/Filters";
import { QuoteBar } from "../features/quotes/QuoteBar";
import type { QuotesResponse } from "../features/quotes/model";

export const handle: Screen = { tab: "featured", name: "精选" };
export { shouldRevalidate } from "../lib/page-reuse";
export const clientLoader = cachedLoader<typeof loader>();

/**
 * The price bar's data, or null when it is not there.
 *
 * A missing or failing snapshot endpoint must not take the page with it: the bar is an addition
 * to the front page, not a condition of it, and a reader who came for the events still gets the
 * events. Null renders as the honest empty bar rather than as an error, and nothing here retries —
 * the snapshot is a daily batch, so a second attempt in the same request would only add latency.
 */
async function loadQuotes(signal: AbortSignal): Promise<QuotesResponse | null> {
  try {
    return await apiGet<QuotesResponse>("/api/site/quotes", { signal });
  } catch {
    return null;
  }
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q");
  // Search lives on /all; keep the parameters so old links still land on results.
  if (q && q.trim()) throw redirect(`/all${url.search}`);
  const filters = readFilters(url.searchParams);
  const upstream = new Headers();
  // The feed decides the page's cache lifetime, so the bar reads at the same cadence rather than
  // setting a shorter one that would only affect part of the document.
  const [feed, quotes] = await Promise.all([
    loadOr404<TimelineResponse>(listPath("/api/site/timeline", filterParams(filters)), { responseHeaders: upstream, signal: request.signal }),
    loadQuotes(request.signal),
  ]);
  return withHeaders({ data: feed, filters, quotes, expiresAt: pageExpiresAt(60, upstream) }, { headers: apiDeadlineCache(60, Date.now(), upstream) });
}

export function meta({ loaderData }: Route.MetaArgs) {
  const path = listPath("/", loaderData ? filterParams(loaderData.filters) : {});
  const titles = loaderData?.data.cards.map((c) => c.item.title) ?? [];
  return pageMeta({ path, jsonLd: path === "/" ? [...siteLd(), itemListLd("/", "精选", titles)] : undefined });
}

export function headers({ loaderHeaders }: Route.HeadersArgs) {
  return loaderHeaders;
}

export default function Home() {
  const { data, filters, quotes } = useLoaderData<typeof loader>();
  const title = filters.tag ? `#${filters.tag}` : "精选";
  return (
    <div className="pb-6">
      {/* Phones: the bar (精选 | 全部, filter, search), the filter in use, today's hot topics, the feed. */}
      <FeedBar base="/" category={filters.category} channel={filters.channel} />
      <ActiveFilters base="/" category={filters.category} channel={filters.channel} tag={filters.tag} />
      <div className="hidden lg:block">
        <h1 className="text-[24px] font-semibold leading-[1.3] text-ink">{title}</h1>
        <div className="mb-5 mt-4 flex items-center justify-between gap-4">
          <CategoryTabs base="/" category={filters.category} channel={filters.channel} layoutId="home-cat-desk" className="min-w-0" />
          <SearchField keep={{ category: filters.category }} />
        </div>
      </div>

      {/* Above the hot topics, not below: a reader opening the front page is asking what the
          market did today, and the events are the answer to a different question. */}
      {quotes && <QuoteBar data={quotes} />}

      {data.hot && <HotTopics entries={data.hot} />}

      <Timeline initial={data} filters={data.filters} />
    </div>
  );
}
