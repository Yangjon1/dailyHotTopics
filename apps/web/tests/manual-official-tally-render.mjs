// Renders the masthead against the *real* api response shape, built the way
// publication/reports.ts builds it, to confirm the frontend and backend agree on the field.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { REPORTS } from "@aihot/site";

const DAY = "2026-10-05";

/** The six cases compose.ts can produce, via its own officialHeadline(). */
function officialHeadline(events, missed) {
  if (missed > 0) return REPORTS.officialTally.incomplete;
  return events > 0 ? REPORTS.officialTally.withItems(events) : REPORTS.officialTally.empty;
}
const cases = [
  ["quiet, all ok      ", { events: 0, sourcesMissed: 0 }],
  ["items, all ok      ", { events: 3, sourcesMissed: 0 }],
  ["items, 2 missed    ", { events: 3, sourcesMissed: 2 }],
  ["NOTHING, 4 missed  ", { events: 0, sourcesMissed: 4 }],
  ["items, all missed  ", { events: 5, sourcesMissed: 6 }],
];

let cur = null;
const api = createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/api/health") return res.end('{"ok":true}');
  if (req.url === "/api/site/meta") return res.end('{"changelogVersion":"x"}');
  if (req.url?.startsWith("/api/site/reports/daily/navigation/")) return res.end('{"items":[]}');
  if (req.url?.startsWith("/api/site/reports/daily/")) {
    return res.end(JSON.stringify({
      kind: "daily", key: DAY, issueNumber: 1, title: "测试日报", generatedAt: `${DAY}T00:00:00Z`,
      lead: null, leadItemId: null, overview: null, highlights: [], sections: [], flashes: [], cover: null,
      metrics: { totalEvents: 12, sourcesCount: 8 },
      official: { ...cur, sourcesTotal: 6, headline: officialHeadline(cur.events, cur.sourcesMissed) },
      readingMinutes: 4, prev: null, next: null,
    }));
  }
  res.statusCode = 404;
  res.end("{}");
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
  for (const [name, tally] of cases) {
    cur = tally;
    const html = await (await fetch(`${origin}/daily/${DAY}`)).text();
    const i = html.indexOf("分钟读完");
    const band = html.slice(Math.max(0, i - 2000), i)
      .replace(/<[^>]+>/g, "|").replace(/\|+/g, " |").replace(/\s+/g, " ").trim();
    const warned = /text-warn/.test(html);
    console.log(`[${name}] warn=${String(warned).padEnd(5)} ${band.split("|").slice(-5).join("").trim()}`);
  }
  web.kill();
  api.close();
  process.exit(0);
});
