// Run after `npm run build -w @aihot/web`. Real production server/router, synthetic HTTP API only.
//
// The masthead's official-release line and its three states. The one that matters most is the third:
// when some official sources did not report, the line must say so AND keep the count that did arrive.
// Rendering it as "nothing official today" there is the failure this test exists to catch — it tells
// a reader the market was calm on a day when the desk simply did not hear from three of its sources.
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { ReportDetail } from "@aihot/contracts/site";
import { REPORTS } from "@aihot/site";
import { readOfficial } from "../app/features/report/official.ts";

const DAY = "2026-10-05";

/** A tally as the api sends it. */
const tally = (events: number, sourcesMissed: number, headline: string) => ({
  events, sourcesTotal: 6, sourcesMissed, headline,
});

/** The api's own wording, recomputed here the way compose.ts composes it. */
const withItems = (n: number) => REPORTS.officialTally.withItems(n);

let web: ChildProcess;
let origin: string;
let logs = "";
let current: unknown = null;
const api = createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/api/health") return res.end(JSON.stringify({ ok: true }));
  if (req.url === "/api/site/meta") return res.end(JSON.stringify({ changelogVersion: "2026-01-01T00:00" }));
  // The navigation request is matched first: its path also starts with the report's own prefix, so
  // matching the report first would hand the archive a ReportDetail and leave `items` undefined.
  if (req.url?.startsWith("/api/site/reports/daily/navigation/")) return res.end(JSON.stringify({ items: [] }));
  if (req.url?.startsWith("/api/site/reports/daily/")) {
    const report: ReportDetail = {
      kind: "daily", key: DAY, issueNumber: 1, title: "测试日报", generatedAt: "2026-10-05T00:00:00Z",
      lead: null, leadItemId: null, overview: null, highlights: [], sections: [], flashes: [], cover: null,
      metrics: { totalEvents: 1, sourcesCount: 1 }, readingMinutes: 1, prev: null, next: null,
      ...(current ? { official: current as NonNullable<ReportDetail["official"]> } : {}),
    };
    return res.end(JSON.stringify(report));
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ code: "not_found" }));
});

before(async () => {
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  web = spawn(process.execPath, [fileURLToPath(new URL("../server.ts", import.meta.url))], {
    env: { ...process.env, WEB_PORT: "0", API_BASE_URL: `http://127.0.0.1:${(api.address() as AddressInfo).port}` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`web did not start: ${logs}`)), 15_000);
    web.on("exit", () => { clearTimeout(timeout); reject(new Error(`web exited: ${logs}`)); });
    web.stderr!.on("data", (c) => { logs += String(c); });
    web.stdout!.on("data", (c) => {
      logs += String(c);
      const m = logs.match(/"msg":"web started","port":(\d+)/);
      if (m) { origin = `http://127.0.0.1:${m[1]}`; clearTimeout(timeout); resolve(); }
    });
  });
});
after(async () => {
  if (web && web.exitCode === null) { web.kill("SIGTERM"); await once(web, "exit"); }
  api.closeAllConnections();
  await new Promise<void>((r) => api.close(() => r()));
});

/** The masthead's text, so an assertion can be about what a reader sees. */
async function masthead(): Promise<string> {
  const res = await fetch(`${origin}/daily/${DAY}`);
  assert.equal(res.status, 200, logs);
  const html = await res.text();
  const start = html.indexOf("分钟读完");
  assert.ok(start > 0, `masthead not rendered: ${html.slice(0, 400)}`);
  return html.slice(Math.max(0, start - 3000), start);
}

test("a quiet day says so in words, and never as a bare zero", async () => {
  current = tally(0, 0, REPORTS.officialTally.empty);
  assert.deepEqual(readOfficial(current), { kind: "empty", events: 0, headline: REPORTS.officialTally.empty });
  const text = await masthead();
  assert.ok(text.includes(REPORTS.officialTally.empty), "the quiet-day sentence is missing");
  // A "0" beside "今日无官方级发布" restates it and, on its own, reads like a failed count.
  assert.ok(!text.includes(">0<"), "a bare zero is showing next to the quiet-day sentence");
});

test("a day with official releases states the count", async () => {
  current = tally(3, 0, withItems(3));
  const state = readOfficial(current);
  assert.equal(state?.kind, "withItems");
  const text = await masthead();
  assert.ok(text.includes(withItems(3)), "the headline sentence is missing");
});

test("an incomplete collection warns AND still shows what arrived", async () => {
  current = tally(3, 2, REPORTS.officialTally.incomplete);
  const state = readOfficial(current);
  assert.equal(state?.kind, "incomplete");
  assert.equal(state?.kind === "incomplete" ? state.events : null, 3);
  const text = await masthead();
  assert.ok(text.includes(REPORTS.officialTally.incomplete), "the incomplete-collection warning is missing");
  // The count that did arrive has to be on screen with the warning.
  assert.ok(/项已采到/.test(text), "the arrived count is missing from the warning");
  assert.ok(/>3</.test(text), "the arrived count's number is missing");
  // And the failure must never be dressed as a quiet day.
  assert.ok(!text.includes(REPORTS.officialTally.empty), "an incomplete collection was rendered as a quiet day");
});

test("an incomplete collection outranks a zero count, even with nothing collected", async () => {
  // The worst case: nothing arrived AND sources were missing. "今日无官方级发布" would be a lie
  // here — it asserts the desk checked and found nothing, when in fact it did not get to check.
  current = tally(0, 4, REPORTS.officialTally.incomplete);
  const state = readOfficial(current);
  assert.equal(state?.kind, "incomplete");
  const text = await masthead();
  assert.ok(text.includes(REPORTS.officialTally.incomplete), "the warning is missing when nothing arrived either");
  assert.ok(!text.includes(REPORTS.officialTally.empty), "a failed collection was rendered as a quiet day");
});

test("an issue without the tally renders no such line, rather than an empty one", async () => {
  current = null;
  const text = await masthead();
  assert.ok(!text.includes(REPORTS.officialTally.empty), "a missing tally fell through to the quiet-day wording");
  assert.ok(!text.includes(REPORTS.officialTally.incomplete), "a missing tally fell through to the warning wording");
});

test("a tally with no headline is unknown, never a quiet day", () => {
  // The dangerous input: counts that look fine but no sentence. Falling back to `empty` here would
  // turn a missing field into a claim about the world.
  assert.equal(readOfficial(tally(0, 0, "")), null);
  assert.equal(readOfficial(tally(0, 0, "   ")), null);
  assert.equal(readOfficial({ events: 0, sourcesMissed: 0 }), null);
  assert.equal(readOfficial({ events: "0", sourcesMissed: 0, headline: "x" }), null);
  assert.equal(readOfficial(undefined), null);
  assert.equal(readOfficial(null), null);
});
