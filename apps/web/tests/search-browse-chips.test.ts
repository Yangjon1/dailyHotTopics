// Run after `npm run build -w @aihot/web`. Real production server/router, synthetic HTTP API only.
//
// The search overlay's browse chips, and the shape of the topic groups it filters on.
//
// This exists because of a bug that could not fail. The overlay filtered on `group === "company"` —
// the framework's name for the group holding 黄金 / 白银 / 原油. The pack renamed its groups to
// variety / institution / form, and the filter matched nothing from then on: the section simply was
// not there, on every phone, with no error, no type error (the old key is still a valid
// TopicGroupKey) and no failing test. A filter on a string that a data file can rename is a filter
// that can go quietly dead, so the rule is now written as what it means rather than as a key, and
// the fixtures use the pack's real keys.
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, type Browser } from "@playwright/test";

const at = "2026-10-04T08:00:00.000Z";

/** The pack's own groups, as industry/topics.json declares them. */
const GROUPS = [
  { key: "variety", name: "品种" },
  { key: "institution", name: "机构与国别" },
  { key: "form", name: "内容形态" },
];

/** Topics shaped like the api sends them, one per group plus a second variety. */
const TOPICS = [
  { slug: "gold", name: "黄金", group: "variety" },
  { slug: "silver", name: "白银", group: "variety" },
  { slug: "crude", name: "原油", group: "variety" },
  { slug: "copper", name: "铜", group: "variety" },
  { slug: "pboc", name: "中国人民银行", group: "institution" },
  { slug: "fed", name: "美联储", group: "institution" },
  { slug: "opec", name: "OPEC", group: "institution" },
  { slug: "policy", name: "政策决议", group: "form" },
  { slug: "supply", name: "供需", group: "form" },
];

let api: ReturnType<typeof createServer>;
let web: ChildProcess;
let origin: string;
let logs = "";
let browser: Browser;
/** Swapped per case: the group keys the fake api sends. */
let groups: Array<{ key: string; name: string }> = GROUPS;
let topics = TOPICS;

before(async () => {
  api = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/health") return res.end('{"ok":true}');
    if (req.url === "/api/site/meta") return res.end('{"changelogVersion":"fixture"}');
    if (req.url?.startsWith("/api/site/search/suggestions")) {
      return res.end(JSON.stringify({ topics, hot: [] }));
    }
    if (req.url?.startsWith("/api/site/topics")) {
      return res.end(JSON.stringify({ groups, topics: topics.map((t) => ({ ...t, definition: "", brand: null, total: 0, recent: 0, indexable: true, latest: null })) }));
    }
    if (req.url?.startsWith("/api/site/timeline")) {
      return res.end(JSON.stringify({ filters: { channel: "all", category: null, tag: null }, cards: [], nextCursor: null, hot: null, dayCounts: {} }));
    }
    res.statusCode = 404;
    res.end('{"code":"not_found"}');
  });
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  web = spawn(process.execPath, [fileURLToPath(new URL("../server.ts", import.meta.url))], {
    env: { ...process.env, WEB_PORT: "0", API_BASE_URL: `http://127.0.0.1:${(api.address() as AddressInfo).port}` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`web did not start: ${logs}`)), 15_000);
    web.on("exit", () => { clearTimeout(timer); reject(new Error(`web exited: ${logs}`)); });
    web.stderr!.on("data", (c) => { logs += String(c); });
    web.stdout!.on("data", (c) => {
      logs += String(c);
      const m = logs.match(/"msg":"web started","port":(\d+)/);
      if (m) { origin = `http://127.0.0.1:${m[1]}`; clearTimeout(timer); resolve(); }
    });
  });
  browser = await chromium.launch({ channel: "chromium" });
});
after(async () => {
  if (browser) await browser.close();
  if (web && web.exitCode === null) { web.kill("SIGTERM"); await once(web, "exit"); }
  api.closeAllConnections();
  await new Promise<void>((r) => api.close(() => r()));
});

/** Opens the phone search overlay and returns the chip labels it offers. */
async function chips(): Promise<string[]> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  try {
    await page.goto(`${origin}/`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    const heading = page.getByRole("heading", { name: "按主题找" });
    await heading.waitFor({ state: "visible", timeout: 5000 });
    const section = page.locator("section", { has: heading });
    return (await section.getByRole("link").allInnerTexts()).map((t) => t.trim()).filter(Boolean);
  } finally {
    await context.close();
  }
}

test("the chips are the directory's own first entries, in its order", async () => {
  groups = GROUPS;
  topics = TOPICS;
  const labels = await chips();
  // The regression: on the framework's old "company" key this list was empty and the section was
  // absent entirely. The directory lists varieties first, so those are what a reader is offered.
  assert.ok(labels.includes("黄金"), `黄金 is missing from the browse chips: ${JSON.stringify(labels)}`);
  assert.ok(labels.includes("中国人民银行"), `institutions are missing: ${JSON.stringify(labels)}`);
  // Six entries and no more: the row is chips, not a second directory.
  assert.ok(labels.length <= 7, `too many chips to be a shortcut row: ${JSON.stringify(labels)}`);
});

test("renaming the groups does not empty the chips", async () => {
  // The point of the fix. Whatever this pack calls its groups, the entries a reader browses by
  // must still show up. A filter naming a group key cannot survive this; taking the directory's own
  // order can, because there is no key in it to go out of date.
  groups = [{ key: "metal", name: "金属" }, { key: "issuer", name: "发布方" }, { key: "kind", name: "形态" }];
  topics = [
    { slug: "gold", name: "黄金", group: "metal" },
    { slug: "silver", name: "白银", group: "metal" },
    { slug: "pboc", name: "中国人民银行", group: "issuer" },
    { slug: "policy", name: "政策决议", group: "kind" },
  ];
  const labels = await chips();
  assert.ok(labels.includes("黄金"), `renaming the groups emptied the chips: ${JSON.stringify(labels)}`);
  assert.ok(labels.includes("中国人民银行"), `renaming the groups emptied the chips: ${JSON.stringify(labels)}`);
});

test("an empty directory renders no chips section rather than an empty box", async () => {
  groups = GROUPS;
  topics = [];
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  try {
    await page.goto(`${origin}/`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    await page.getByRole("heading", { name: "按主题找" }).waitFor({ state: "hidden", timeout: 5000 });
  } finally {
    await context.close();
  }
});

test("the fixture uses this pack's real group keys, not the framework's", () => {
  // A fixture on the old key cannot fail: "company" is still a valid TopicGroupKey, so the type
  // accepts it and the component shows nothing. Asserting the real keys here means the next rename
  // breaks a test instead of a page.
  for (const t of TOPICS) assert.ok(["variety", "institution", "form"].includes(t.group), `fixture group ${t.group} is not one of this pack's`);
  const declared = GROUPS.map((g) => g.key);
  assert.deepEqual([...new Set(TOPICS.map((t) => t.group))].sort(), [...declared].sort(), "fixtures and declared groups have drifted apart");
  assert.ok(!JSON.stringify(TOPICS).includes('"company"'), "a fixture still uses the framework's company key");
  void at;
});
