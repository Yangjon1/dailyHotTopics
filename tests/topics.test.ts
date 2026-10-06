// Topic pages: which articles a topic takes, and their counts.
// Written before the code, from the ways it can go wrong:
// - a company topic takes an article about another company that only mentions it (several subjects,
//   its name nowhere in the title), or drops one about it whose title names it in English, in another
//   case, next to Chinese text, or only by a product (it is the article's only subject);
// - a Latin name matches inside another word ("Metadata" is not Meta); a headline naming a company
//   that is not a subject of the article gets in;
// - a technical-direction topic stops taking its tags;
// - withdrawn or not yet released articles appear in a list or a count;
// - an article or story page names a topic its reports do not belong to;
// - a topic without content has no page, or an unknown slug or a page past the end has one.
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { publishArticle } from "@aihot/backend/publication/publish";
import { loadTopicPage, listTopicSummaries, topicsOfStory } from "@aihot/backend/publication/topics";
import { buildApp } from "../apps/api/src/app.ts";

const T = tag();
const OFFICIAL = `test-topics-official-${T}`;
const MEDIA = `test-topics-media-${T}`;
const app = await buildApp();

before(async () => {
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, first_party, next_fetch_at) VALUES
    (${OFFICIAL}, 'Official', 'rss', 'T1', 'editorial', true, '2100-01-01'),
    (${MEDIA}, 'Media', 'rss', 'T2', 'editorial', false, '2100-01-01')`;
});
after(async () => {
  await app.close();
  await stopBoss();
  await closeDb();
});

let n = 0;
interface Report {
  source?: string;
  at: Date;
  title: string;
  originalTitle?: string;
  subjects?: string[];
  tags?: string[];
  score?: number;
  selected?: boolean;
  fact?: number;
  category?: string;
}

/** A published report; `fact` links it to a fact before publishing, as grouping would. */
async function report(r: Report): Promise<string> {
  n += 1;
  const { articleId } = await upsertMaterial({
    sourceId: r.source ?? MEDIA, url: `https://example.com/topics-${T}-${n}`, title: r.originalTitle ?? r.title, bodyText: "body", bodyHtml: "<p>body</p>", bodyStatus: "ok", via: "fetch", publishedAt: r.at,
  });
  await sql`UPDATE articles SET discovered_at = ${r.at}, timeline_at = ${r.at}, grouped_at = now() WHERE id = ${articleId}`;
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, score, selected, subjects, tags)
            VALUES (${articleId}, 1, 'rule', 'pass', ${r.category ?? "precious-metals"}, ${r.title}, ${`摘要 ${n}`}, ${r.score ?? 80}, ${r.selected ?? true}, ${r.subjects ?? []}, ${[r.category === "macro" ? "政策/央行" : r.category === "analysis" ? "分析/解读" : r.category === "equity-bond" ? "股债/资金流" : r.category === "industrial-commodities" ? "供需/产能" : r.category === "data" ? "宏观/通胀" : "数据/持仓", ...(r.tags ?? [])]})`;
  if (r.fact) await sql`INSERT INTO fact_articles (fact_id, article_id, role) VALUES (${r.fact}, ${articleId}, 'report')`;
  await publishArticle(articleId, { releasedAt: new Date(r.at.getTime() + 60_000) });
  return articleId;
}

async function story(title: string): Promise<{ id: number; publicId: string }> {
  const publicId = randomUUID();
  const [s] = await sql<{ id: number }[]>`INSERT INTO stories (public_id, title, first_report_at, latest_at) VALUES (${publicId}, ${title}, now(), now()) RETURNING id`;
  return { id: s!.id, publicId };
}

async function fact(storyId: number | null, title: string): Promise<number> {
  const [f] = await sql<{ id: number }[]>`INSERT INTO facts (public_id, story_id, title) VALUES (${`f-${T}-${randomUUID()}`}, ${storyId}, ${title}) RETURNING id`;
  return f!.id;
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);
const ids = (items: Array<{ id: string }>) => items.map((i) => i.id);
const page = async (slug: string, p = 1) => {
  const data = await loadTopicPage(slug, p, new Date());
  assert.ok(data, `${slug} page ${p}`);
  return data;
};
/** Every article of a topic, over all its pages. */
async function members(slug: string): Promise<string[]> {
  const first = await page(slug);
  const out = ids(first.items);
  for (let p = 2; p <= first.pageCount; p++) out.push(...ids((await page(slug, p)).items));
  return out;
}

test("a company topic takes the articles about it, not the ones that only mention it", async () => {
  const about = await report({ at: hoursAgo(30), title: `CFTC 公布持仓报告 ${T}`, subjects: ["cftc"] });
  const product = await report({ at: hoursAgo(32), title: `持仓报告口径调整 ${T}`, subjects: ["cftc"] });
  const english = await report({ at: hoursAgo(33), title: `新持仓数据发布 ${T}`, originalTitle: `the CFTC published its positions report ${T}`, subjects: ["cftc", "fed"] });
  const subpoena = await report({ at: hoursAgo(34), title: `美联储主席向国会发表讲话 ${T}`, subjects: ["fed", "cftc", "lbma"] });
  const lowerCase = await report({ at: hoursAgo(35), title: `fomc 公布新的点阵图 ${T}`, subjects: ["fed", "cftc"] });
  const pact = await report({ at: hoursAgo(36), title: `多国央行签署互换协议 ${T}`, subjects: ["fed", "cftc", "iea"] });
  const metadata = await report({ at: hoursAgo(37), title: `美元指数跌破 100，美联储官员发表评论 ${T}`, subjects: ["us", "fed"] });
  const adjacent = await report({ at: hoursAgo(38), title: `发布美国的新货币政策声明 ${T}`, subjects: ["us", "fed"] });
  const headline = await report({ at: hoursAgo(39), title: `国际能源署被一篇盘点提到 ${T}`, subjects: ["iea"] });
  const gold = await report({ at: hoursAgo(40), title: `黄金基金持仓发布 ${T}`, tags: ["黄金"] });

  const cftc = await members("cftc");
  for (const id of [about, product, english]) assert.ok(cftc.includes(id), "about the CFTC");
  for (const id of [subpoena, lowerCase, pact, headline]) assert.ok(!cftc.includes(id), "only mentions the CFTC");
  const fed = await members("fed");
  for (const id of [subpoena, lowerCase, metadata]) assert.ok(fed.includes(id), "about the Fed");
  for (const id of [english, pact]) assert.ok(!fed.includes(id), "only mentions the Fed");
  const us = await members("united-states");
  assert.ok(us.includes(adjacent), "US next to Chinese text");
  assert.ok(!us.includes(metadata), "USD is not US");
  assert.ok((await members("gold")).includes(gold), "a variety takes its tag");

  // The article page names the topics it belongs to.
  const topicsOf = async (id: string) => {
    const res = await app.inject({ method: "GET", url: `/api/site/items/${id}` });
    return (JSON.parse(res.body) as { topics: Array<{ slug: string }> }).topics.map((t) => t.slug);
  };
  assert.deepEqual(await topicsOf(about), ["cftc", "official-data"]);
  assert.deepEqual(await topicsOf(subpoena), ["fed", "official-data"]);
  assert.deepEqual(await topicsOf(pact), ["official-data"]);
  assert.deepEqual(await topicsOf(gold), ["gold", "official-data"]);
});

test("a story page names the topics of its reports", async () => {
  const launch = await story(`智能体框架 V2 发布 ${T}`);
  await report({ source: OFFICIAL, at: hoursAgo(26), title: `黄金基金持仓 V2 发布 ${T}`, tags: ["黄金"], fact: await fact(launch.id, "发布 V2") });
  assert.deepEqual(await topicsOfStory(launch.id), [{ slug: "gold", name: "黄金" }, { slug: "official-data", name: "官方数据与持仓" }]);
});

test("withdrawn articles stay out of lists and counts", async () => {
  const kept = await report({ at: hoursAgo(5), title: `欧洲央行维持利率 ${T}`, subjects: ["ecb"] });
  const withdrawn = await report({ at: hoursAgo(4), title: `欧洲央行撤回的消息 ${T}`, subjects: ["ecb"] });
  await sql`UPDATE publications SET visibility = 'withdrawn' WHERE article_id = ${withdrawn}`;

  const data = await page("ecb");
  assert.deepEqual(ids(data.items), [kept]);
  assert.equal(data.topic.total, 1);
  const summary = (await listTopicSummaries()).topics.find((t) => t.slug === "ecb")!;
  assert.equal(summary.latest?.title, `欧洲央行维持利率 ${T}`, "the index shows the newest public article");
});

test("every topic has a page; unknown topics and pages past the end have none", async () => {
  const empty = await page("pboc");
  assert.equal(empty.topic.indexable, false, "a topic without content is not indexed");
  assert.deepEqual(empty.items, []);
  assert.equal(await loadTopicPage("not-a-topic", 1, new Date()), null);
  assert.equal(await loadTopicPage("pboc", 2, new Date()), null);
  const index = await app.inject({ method: "GET", url: "/api/site/topics" });
  const body = JSON.parse(index.body) as { groups: Array<{ key: string }>; topics: Array<{ slug: string }> };
  assert.deepEqual(body.groups.map((g) => g.key), ["variety", "institution", "form"]);
  assert.equal(body.topics.length, 34);
});
