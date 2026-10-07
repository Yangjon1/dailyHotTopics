// Manual probe (not a test — the `manual-` prefix keeps it out of `node --test`).
//
// The price band with nine contracts on two markets, and the trend panel behind a cell. Screenshots
// rather than assertions because the thing most likely to be wrong here is visual: whether the two
// rows read as two markets, whether three different units are legible in a 92px cell, and whether the
// chart's curve actually shows the move it is describing.
//
//   node apps/web/tests/manual-price-band-shots.mjs
//
// Needs a build first: npm run build -w @aihot/web
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const OUT = new URL("./shots/", import.meta.url).pathname.replace(/^\//, "");
mkdirSync(OUT, { recursive: true });

const HOUR = 3_600_000;
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();

/** One contract as the api sends it now: it carries its own unit, exchange and market. */
const q = (symbol, price, msAgo, unit, exchange, market, changePct = null) => ({
  symbol, price, unit, exchange, market, updatedAt: iso(msAgo), changePct,
  basis: changePct === null ? "none" : "yesterday",
  basisAt: changePct === null ? null : iso(msAgo + 24 * HOUR),
  baselineAgeDays: null,
});

/** The nine, as the api actually returns them: the futures fresh, the SGE contracts a week older
 *  because the exchange was shut for a holiday when the futures traded. */
const BAND = {
  quotes: [
    q("GC=F", 4196.8, 2 * HOUR, "USD/oz", "COMEX", "国际期货", 1.24),
    q("SI=F", 61.77, 2 * HOUR, "USD/oz", "COMEX", "国际期货", -0.8),
    q("HG=F", 6.651, 2 * HOUR, "USD/lb", "COMEX", "国际期货", 2.1),
    q("PL=F", 1726, 2 * HOUR, "USD/oz", "NY Mercantile", "国际期货", 0.4),
    q("PA=F", 1167.5, 2 * HOUR, "USD/oz", "NY Mercantile", "国际期货"),
    q("Au99.99", 909, 7 * 24 * HOUR, "CNY/g", "上海黄金交易所", "国内现货"),
    q("Ag(T+D)", 14999, 7 * 24 * HOUR, "CNY/g", "上海黄金交易所", "国内现货"),
    q("Pt99.95", 423.05, 7 * 24 * HOUR, "CNY/g", "上海黄金交易所", "国内现货"),
    q("mAu(T+D)", 908.39, 7 * 24 * HOUR, "CNY/g", "上海黄金交易所", "国内现货"),
  ],
  computedAt: iso(0),
};

/** A month of gold closes with a 1% wobble in it — the case zero-based scaling would flatten. */
const TREND = (symbol, range, base, drift) => ({
  symbol, range, source: "yahoo-finance", exchange: "COMEX", unit: "USD/oz", empty: false,
  points: Array.from({ length: range === "1mo" ? 21 : 40 }, (_, i) => ({
    date: `2026-0${range === "1mo" ? 9 : 8}-${String(1 + (i % 28)).padStart(2, "0")}`,
    close: Math.round((base + drift * i + Math.sin(i / 2.4) * base * 0.006) * 100) / 100,
  })),
});

let trendBody = TREND("GC=F", "1mo", 4150, 2.2);
let quotes = BAND;

const timeline = {
  filters: { channel: "all", category: null, tag: null },
  cards: [{ key: "k1", anchorAt: iso(HOUR), item: { id: "i1", title: "美联储官员表示通胀回落路径未变", summary: "官员在讲话中提到核心通胀回落速度符合预期。", reason: "涉及利率预期", source: { name: "官方发布", id: "s1", url: null, iconUrl: null, iconSrcSet: null, firstParty: true }, publishedAt: iso(HOUR), timelineAt: iso(HOUR), category: "macro", tags: [], score: 80, selected: true, channel: "news" }, group: null }],
  nextCursor: null, hot: null, dayCounts: {},
};

const api = createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  const u = new URL(req.url, "http://local");
  if (u.pathname === "/api/health") return res.end('{"ok":true}');
  if (u.pathname === "/api/site/meta") return res.end('{"changelogVersion":"shot"}');
  if (u.pathname === "/api/site/quotes") return res.end(JSON.stringify(quotes));
  if (u.pathname === "/api/site/quote-trend") {
    const range = u.searchParams.get("range") ?? "1mo";
    if (range === "1d") return res.end(JSON.stringify({ symbol: "GC=F", range: "1d", source: "yahoo-finance", exchange: "COMEX", unit: "USD/oz", empty: true, points: [] }));
    return res.end(JSON.stringify({ ...trendBody, range }));
  }
  if (u.pathname.startsWith("/api/site/timeline")) return res.end(JSON.stringify(timeline));
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

  /** The band, and with it the trend panel when one is opened. */
  async function shot(name, { scheme = "light", open = null } = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2, colorScheme: scheme });
    const page = await ctx.newPage();
    await page.addInitScript((s) => localStorage.setItem("aihot:theme", s), scheme);
    await page.goto(`${origin}/`, { waitUntil: "networkidle" });
    if (open) {
      await page.getByRole("button", { name: new RegExp(open) }).first().click();
      await page.waitForTimeout(400);
    }
    const band = page.locator('section[aria-label="行情数据"]');
    await band.screenshot({ path: `${OUT}${name}.png` });
    console.log(name);
    await ctx.close();
  }

  await shot("11-band-two-markets", {});
  await shot("12-band-dark", { scheme: "dark" });
  await shot("13-band-trend-open", { open: "GC" });
  // A phone width, where the rows scroll sideways: 9 cells do not fit in 375px.
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto(`${origin}/`, { waitUntil: "networkidle" });
    await page.locator('section[aria-label="行情数据"]').screenshot({ path: `${OUT}14-band-phone.png` });
    console.log("14-band-phone");
    await ctx.close();
  }

  await browser.close();
  web.kill();
  api.close();
  console.log(`\nshots in ${OUT}`);
  process.exit(0);
});
