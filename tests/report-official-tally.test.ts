// The masthead's official tally must survive a classification correction. A correction rewrites a
// frozen issue: correctReportClassification clones the stored content, moves the entry to its new
// section and recomputes the release figure. The official tally rides along untouched today, because
// the correction mutates sections and metrics in place rather than rebuilding the content object.
// That is a property of the implementation, not a promise, and nothing else would notice if someone
// changed it to rebuild the object field by field: the tally would vanish from every already
// published issue and the masthead would silently fall back to no line at all. This test is that lock.
//
// It also pins the wording the issue carries. The headline is written once, where the numbers are
// counted, so that no reader-facing surface can word a collection failure differently; in particular a
// partial failure must never be worded as a quiet day (AC-18).
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { overrideFields } from "@aihot/backend/admin/content";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { publishArticle } from "@aihot/backend/publication/publish";
import { officialHeadline } from "@aihot/backend/reports/compose";
import { stopBoss } from "@aihot/backend/jobs/queue";

after(async () => { await stopBoss(); await closeDb(); });

const official = { events: 2, sourcesTotal: 6, sourcesMissed: 0, headline: officialHeadline(2, 0) };

test("a classification correction keeps the official tally and its wording on every issue it rewrites", async () => {
  const sourceId = `official-tally-${tag()}`;
  await sql`INSERT INTO sources (id,name,kind,tier,participation_mode) VALUES (${sourceId},'Tally fixture','rss','T1','editorial')`;
  const { articleId } = await upsertMaterial({
    sourceId, url: `https://example.com/${sourceId}`, title: "CFTC 持仓报告",
    bodyText: "报告正文", bodyStatus: "ok", via: "fetch", publishedAt: new Date(),
  });
  await sql`INSERT INTO analyses (article_id,input_revision,origin,relevance,category,tags,title_zh,summary_zh,score,selected)
    VALUES (${articleId},1,'rule','pass','precious-metals',ARRAY['数据/持仓'],'CFTC 持仓报告','冻结摘要',88,true)`;
  const [story] = await sql`INSERT INTO stories (public_id,title) VALUES (gen_random_uuid(),'持仓事件') RETURNING id`;
  const [fact] = await sql`INSERT INTO facts (public_id,title,story_id) VALUES (${`f-${tag()}`},'持仓发布',${story!.id}) RETURNING id`;
  await sql`INSERT INTO fact_articles (fact_id,article_id,role) VALUES (${fact!.id},${articleId},'report')`;
  await publishArticle(articleId, { releasedAt: new Date() });

  const entry = { itemId: articleId, title: "冻结标题", summary: "冻结摘要", sourceId, firstParty: true, role: "官方" };
  const reports = [
    // A daily and a weekly: the correction path differs between them (sections vs themes), and both
    // must carry the tally through.
    { kind: "daily", key: "2097-03-02", content: { leadItemId: articleId, lead: { title: "冻结头条" }, highlights: [articleId], flashes: [], sections: [{ label: "贵金属", items: [entry] }], metrics: { totalEvents: 1 }, official } },
    { kind: "weekly", key: "2097-W09", content: { headline: "冻结头条", leadItemId: articleId, storyOrder: [articleId], overview: "保留总述", themes: [{ heading: "贵金属", summary: "旧导读", storyRefs: [entry] }], metrics: { totalStories: 1 }, official } },
  ];
  for (const r of reports) await sql`INSERT INTO reports (kind,key,window_start,window_end,content,generated_at,origin)
    VALUES (${r.kind},${r.key},now(),now(),${sql.json(r.content as never)},now(),'imported')`;

  // 贵金属 -> 大宗商品: a real section change, so the correction actually rewrites the issue.
  await overrideFields(articleId, { fields: { category: "industrial-commodities", tags: ["供需/产能"] }, version: 0, reason: "应归大宗商品" }, "test-official-tally");

  for (const r of reports) {
    const [saved] = await sql`SELECT content,revision FROM reports WHERE kind=${r.kind} AND key=${r.key}`;
    assert.equal(saved!.revision, 2, `${r.kind}: the issue was rewritten`);
    const content = saved!.content;
    // The lock: the tally is still there, with the wording it was composed with.
    assert.deepEqual(content.official, official, `${r.kind}: the official tally survived the correction`);
    assert.equal(content.official.headline, "今日要盯的官方发布 2 项");
    // And the correction did its own job, so the assertion above is not passing on an untouched row.
    const moved = r.kind === "daily" ? content.sections[0]?.label : content.themes[0]?.heading;
    assert.equal(moved, "大宗商品", `${r.kind}: the entry actually moved section`);
  }
});

test("the masthead wording keeps a collection failure out of the quiet-day wording", async () => {
  // 0 items with every source collected is a genuinely quiet day and says so in plain words.
  assert.equal(officialHeadline(0, 0), "今日无官方级发布，可轻仓观望");
  // Items collected but some official sources missed: the failure wins, and the count is not lost.
  assert.equal(officialHeadline(2, 1), "部分官方源未成功采集");
  // Nothing collected *because* sources were missed must never read as "nothing today".
  assert.notEqual(officialHeadline(0, 3), "今日无官方级发布，可轻仓观望");
});
