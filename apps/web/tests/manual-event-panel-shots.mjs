// Manual probe (not a test — the `manual-` prefix keeps it out of `node --test`).
//
// Screenshots the event page's price panel, which is the block that rendered on no event page at
// all for the whole of Phase 4. Two states matter: prices present, and a collection old enough that
// the freshness line has to say so.
//
//   node apps/web/tests/manual-event-panel-shots.mjs
//
// Needs a build first: npm run build -w @aihot/web
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const OUT = new URL("./shots/", import.meta.url).pathname.replace(/^\//, "");
mkdirSync(OUT, { recursive: true });

const PUBLIC_ID = "fixture-event";
const HOUR = 3_600_000;
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();

/** One variety, as the api sends it. */
const quote = (symbol, price, msAgo, changePct = null) => ({
  symbol, price, unit: null, updatedAt: iso(msAgo), changePct,
  basis: changePct === null ? "none" : "yesterday",
  basisAt: changePct === null ? null : iso(msAgo + 24 * HOUR),
});

const WITH_PRICES = {
  quotes: [
    quote("XAU", 4118.4, HOUR, 1.24),
    quote("XAG", 36.42, HOUR, -0.8),
    quote("XPT", 1043.8, HOUR, 0.4),
    quote("XPD", 944.25, HOUR),
    quote("HG", 4.512, HOUR, 2.1),
  ],
  computedAt: iso(HOUR),
};

const STALE = {
  quotes: WITH_PRICES.quotes.map((q) => quote(q.symbol, q.price, 9 * 24 * HOUR, q.changePct)),
  computedAt: iso(9 * 24 * HOUR),
};

const NO_PRICES = {
  quotes: [quote("XAU", null, 0), quote("XAG", null, 0), quote("XPT", null, 0), quote("XPD", null, 0), quote("HG", null, 0)],
  computedAt: iso(0),
};

const story = {
  publicId: PUBLIC_ID, title: "美联储官员表示通胀回落路径未变", status: "active", reportCount: 4, sourceCount: 3,
  firstReportAt: iso(72 * HOUR), latestAt: iso(HOUR), digest: "官员讲话与随后发布的通胀数据指向同一方向，市场对下一步政策的预期在两次发布之间发生明显变化。",
  digestUpdatedAt: iso(HOUR), summary: "官员讲话与通胀数据指向同一方向。", excerpt: null,
  latest: "最新进展", latestReport: { id: "r1" },
  whyHot: { participants48h: 0, newParticipants6h: 0, recentReports24h: 4, observationComplete: true, rank: null },
  developments: [], officialReports: [], timeline: [], heat: [], related: [], topics: [],
};

let quotes = WITH_PRICES;

const api = createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/api/health") return res.end('{"ok":true}');
  if (req.url === "/api/site/meta") return res.end('{"changelogVersion":"shot"}');
  if (req.url?.startsWith("/api/site/quotes")) return res.end(JSON.stringify(quotes));
  if (req.url?.startsWith(`/api/site/stories/${PUBLIC_ID}`)) return res.end(JSON.stringify(story));
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

  const cases = [
    ["8-event-panel-fresh", WITH_PRICES, "事件页行情面板：有报价 + 「数据截至」"],
    ["9-event-panel-stale", STALE, "事件页行情面板：9 天未更新 → 「可能已过期」"],
    ["10-event-panel-no-prices", NO_PRICES, "事件页降级：无快照 → 品种清单"],
  ];

  for (const [name, payload, caption] of cases) {
    quotes = payload;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto(`${origin}/story/${PUBLIC_ID}`, { waitUntil: "networkidle" });
    // The right-hand rail, which is where the panel lives. `aside` first-match is the left nav.
    const rail = page.locator('section[aria-label="相关品种行情"]');
    const target = (await rail.count()) > 0
      ? rail
      : page.getByText("相关品种", { exact: true }).locator("xpath=ancestor::*[3]");
    await target.screenshot({ path: `${OUT}${name}.png` });
    console.log(`${name.padEnd(28)} ${caption}`);
    await ctx.close();
  }

  await browser.close();
  web.kill();
  api.close();
  console.log(`\nshots in ${OUT}`);
  process.exit(0);
});
