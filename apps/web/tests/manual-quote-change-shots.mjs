// Manual probe (not a test — the `manual-` prefix keeps it out of `node --test`).
//
// Renders the price band in each of the three change states Spec §9.4 defines and writes a PNG of
// each, so the states can be looked at rather than only asserted about. The responses are built the
// way packages/backend/src/publication/quotes.ts builds them, and the timestamps are relative to the
// moment this runs, because the component measures the baseline's age against the real clock.
//
//   node apps/web/tests/manual-quote-change-shots.mjs
//
// Writes to apps/web/tests/shots/. Needs a build first: npm run build -w @aihot/web
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const OUT = new URL("./shots/", import.meta.url).pathname.replace(/^\//, "");
mkdirSync(OUT, { recursive: true });

const NOW = new Date();
const iso = (d) => d.toISOString();
const daysAgo = (n) => new Date(NOW.getTime() - n * 86_400_000);

/** One variety's quote, as quotes.ts assembles it from the two newest snapshots. */
function quote(symbol, latestDaysAgo, baselineDaysAgo, price, baselinePrice) {
  if (baselineDaysAgo === null || baselinePrice === null) {
    return { symbol, price, unit: null, updatedAt: iso(daysAgo(latestDaysAgo)), changePct: null, basis: "none", basisAt: null };
  }
  const changePct = Math.round(((price - baselinePrice) / baselinePrice) * 100 * 100) / 100;
  const age = baselineDaysAgo; // ageInDays(baseline.at, now)
  return {
    symbol, price, unit: null, updatedAt: iso(daysAgo(latestDaysAgo)), changePct,
    basis: age <= 1 ? "yesterday" : "lastSnapshot",
    basisAt: iso(daysAgo(baselineDaysAgo)),
  };
}

const OTHERS = [
  ["XAG", 36.421], ["XPT", 1043.8], ["XPD", 944.25], ["HG", 4.512],
];

/** Five varieties; XAU carries the case, the rest stay in the no-baseline state for contrast. */
const response = (xau) => ({
  quotes: [xau, ...OTHERS.map(([s, p]) => ({ symbol: s, price: p, unit: null, updatedAt: iso(daysAgo(0)), changePct: null, basis: "none", basisAt: null }))],
  computedAt: iso(NOW),
});

const CASES = [
  ["1-yesterday", "较昨日：昨收基准，涨，无警示", response(quote("XAU", 0, 1, 4118.4, 4068.1))],
  ["2-last-snapshot-fresh", "较上次：漏跑一天，基准仍新，无警示", response(quote("XAU", 0, 2, 4118.4, 4068.1))],
  ["3-gap-stale", "较上次：断档 6 天，⚠ 警示必须出现", response(quote("XAU", 0, 6, 4118.4, 4068.1))],
  ["4-no-basis", "无基准：灰破折号，无箭头", response(quote("XAU", 0, null, 4118.4, null))],
  ["5-pipeline-stopped", "管道停摆 7 天：格内警示 + 下沿「可能已过期」", {
    quotes: [quote("XAU", 7, 8, 4118.4, 4068.1), ...OTHERS.map(([s, p]) => ({ symbol: s, price: p, unit: null, updatedAt: iso(daysAgo(7)), changePct: null, basis: "none", basisAt: null }))],
    computedAt: iso(NOW),
  }],
  ["6-down", "下跌：绿 + ▼ + 显式负号", response(quote("XAU", 0, 1, 3990.2, 4049.1))],
];

const timeline = {
  filters: { channel: "all", category: null, tag: null },
  cards: [{ key: "k1", anchorAt: iso(NOW), item: { id: "i1", title: "美联储官员表示通胀回落路径未变", summary: "官员在讲话中提到核心通胀回落速度符合预期，并强调将依据数据决定下一步政策。", reason: "涉及利率预期", source: { name: "官方发布", id: "s1", url: null, iconUrl: null, iconSrcSet: null, firstParty: true }, publishedAt: iso(NOW), timelineAt: iso(NOW), category: "macro", tags: ["美债收益率"], score: 80, selected: true, channel: "news" }, group: null }],
  nextCursor: null, hot: null, dayCounts: {},
};

/** The hot ranking as the api sends it, with no entries: the state the page is actually in. */
const hotEmpty = { computedAt: iso(NOW), windowHours: 48, entries: [] };

let current = response(quote("XAU", 0, 1, 4118.4, 4068.1));

const api = createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/api/health") return res.end('{"ok":true}');
  if (req.url === "/api/site/meta") return res.end('{"changelogVersion":"shot"}');
  if (req.url?.startsWith("/api/site/quotes")) return res.end(JSON.stringify(current));
  if (req.url?.startsWith("/api/site/timeline")) return res.end(JSON.stringify(timeline));
  if (req.url?.startsWith("/api/site/hot")) return res.end(JSON.stringify(hotEmpty));
  res.statusCode = 404;
  res.end('{"code":"not_found"}');
});

api.listen(0, "127.0.0.1", async () => {
  const port = api.address().port;
  const web = spawn(process.execPath, ["apps/web/server.ts"], {
    env: { ...process.env, WEB_PORT: "0", API_BASE_URL: `http://127.0.0.1:${port}` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let buf = "";
  const webPort = await new Promise((r) => {
    web.stdout.on("data", (c) => { buf += c; const m = buf.match(/"port":(\d+)/); if (m) r(m[1]); });
  });
  const origin = `http://127.0.0.1:${webPort}`;
  const browser = await chromium.launch({ channel: "chromium" });

  for (const [name, caption, payload] of CASES) {
    current = payload;
    // Desktop width so the whole five-cell band is in one frame, as a reader would see it.
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto(`${origin}/`, { waitUntil: "networkidle" });
    const band = page.locator('section[aria-label="行情数据"]');
    const file = `${OUT}${name}.png`;
    await band.screenshot({ path: file });
    console.log(`${name.padEnd(24)} ${caption}`);
    await ctx.close();
  }

  // The hot page's empty state, in light and dark.
  for (const scheme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, colorScheme: scheme });
    const page = await ctx.newPage();
    await page.addInitScript((s) => localStorage.setItem("aihot:theme", s), scheme);
    await page.goto(`${origin}/hot`, { waitUntil: "networkidle" });
    const file = `${OUT}7-hot-empty-${scheme}.png`;
    await page.screenshot({ path: file, fullPage: false });
    console.log(`7-hot-empty-${scheme.padEnd(15)} /hot 空态（${scheme}）`);
    await ctx.close();
  }

  await browser.close();
  web.kill();
  api.close();
  console.log(`\nshots in ${OUT}`);
  process.exit(0);
});
