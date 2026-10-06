// 抓美国财政部的每日国债收益率曲线，渲染成可分析的中文条目推入。
//
// 为什么写这个（2026-10-06）：
// 财政部是「美债收益率」主题唯一的一手官方源，CSV 免 key、一次给全 14 个期限
// （1 月到 30 年）。这是全站唯一能给出**完整收益率曲线**的免费来源。
//
// 与 FRED 的关键区别（决定了本脚本的实现方式）：
// **财政部 CSV 的 Date 字段就是真实交易日**（如 10/05/2026），不是数据归属期。
// 所以 publishedAt 直接用它，不需要像 FRED 那样推算发布延迟—— 也就没有
// 「publishedAt 早于真实发布导致被 48 小时门槛静默归档」的风险。
//
// 两个必须处理的坑：
//
// 1. 年份写死在 URL 路径里：`/daily-treasury-rates.csv/{year}/all`。
//    写死会在跨年后 404，且报错可能不明显。脚本按当前日期算年份，并在跨年时
//    同时尝试前一年（年末时前一年仍有数据）。
//
// 2. 日期格式是 `MM/DD/YYYY`（美国格式），不是 ISO。直接 `new Date("10/05/2026")`
//    在 Node 里能解析，但排序会错。统一转成ISO 字符串再入库。
//
// 用法：
//   node --env-file=.env scripts/fetch-treasury.ts --dry-run
//   node --env-file=.env scripts/fetch-treasury.ts --base http://127.0.0.1:3001
//   node --env-file=.env scripts/fetch-treasury.ts --file local.csv   # 解析本地文件

import { beijingDate } from "@aihot/contracts/time";
import { fail, fetchText, log, pushItems, type IngestItem } from "./ingest-push.ts";

const SOURCE_ID = "ext-treasury-yield";
const SOURCE_NAME = "美国财政部国债收益率曲线";

/** CSV 里的期限列，按期限从短到长。顺序用于渲染，也用于计算期限利差。 */
const TENORS = [
  "1 Mo", "1.5 Month", "2 Mo", "3 Mo", "4 Mo", "6 Mo",
  "1 Yr", "2 Yr", "3 Yr", "5 Yr", "7 Yr", "10 Yr", "20 Yr", "30 Yr",
] as const;

const TENOR_LABEL: Record<string, string> = {
  "1 Mo": "1 个月", "1.5 Month": "1.5 个月", "2 Mo": "2 个月", "3 Mo": "3 个月",
  "4 Mo": "4 个月", "6 Mo": "6 个月", "1 Yr": "1 年", "2 Yr": "2 年", "3 Yr": "3 年",
  "5 Yr": "5 年", "7 Yr": "7 年", "10 Yr": "10 年", "20 Yr": "20 年", "30 Yr": "30 年",
};

/** 值得关注的关键期限，其余列在正文里全量给出但不逐条解读。 */
const KEY_TENORS = ["3 Mo", "2 Yr", "5 Yr", "10 Yr", "30 Yr"] as const;

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

/** `MM/DD/YYYY` → `YYYY-MM-DD`。不转的话排序会错。 */
function mdyToIso(s: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

type Row = { iso: string; values: Record<string, number | null> };

/** 解析财政部 CSV。首行表头必须含 Date，否则说明拿到的不是 CSV（坑：返回 HTML 错误页）。 */
function parseTreasury(text: string): Row[] {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) fail("财政部返回内容不足两行，可能不是 CSV");
  const header = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  if (header[0] !== "Date" || !header.includes("10 Yr")) {
    fail(`表头不符（首行: ${header.slice(0, 5).join(",")}）。若年份跨过、URL 返回空表，也会走到这里。`);
  }
  const idx: Record<string, number> = {};
  for (const t of TENORS) {
    const i = header.indexOf(t);
    if (i >= 0) idx[t] = i;
  }
  const rows: Row[] = [];
  for (const line of lines.slice(1)) {
    // 末尾可能有逗号，split 后用正则剔除空项
    const cells = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const iso = mdyToIso(cells[0]);
    if (!iso) continue;
    const values: Record<string, number | null> = {};
    for (const [t, i] of Object.entries(idx)) {
      const v = Number(cells[i]);
      values[t] = Number.isFinite(v) ? v : null;
    }
    rows.push({ iso, values });
  }
  // CSV 是倒序的（最新在前），升序方便取上一期
  rows.sort((a, b) => a.iso.localeCompare(b.iso));
  return rows;
}

function n(v: number | null): string {
  return v === null ? "—" : v.toFixed(2);
}

/** 年份写死在 URL 路径里，所以按候选年份依次尝试。 */
function candidateYears(): number[] {
  const now = new Date().getUTCFullYear();
  // 年末时前一年仍可能有数据（新年后才切换），所以两年都试
  return now === 1 ? [now] : [now, now - 1];
}

const localFile = arg("file");
const baseUrl = arg("base") ?? process.env.SITE_URL ?? "http://127.0.0.1:3001";
const dryRun = process.argv.includes("--dry-run");
log(`目标站点 ${baseUrl}（${dryRun ? "试运行" : "正式推送"}）`);

let rows: Row[] = [];
if (localFile) {
  const { readFileSync } = await import("node:fs");
  rows = parseTreasury(readFileSync(localFile, "utf8"));
  log(`解析本地文件 ${localFile}：${rows.length} 个交易日`);
} else {
  for (const year of candidateYears()) {
    const url =
      `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv` +
      `/${year}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`;
    const text = await fetchText(url);
    if (!/^"?Date"?\s*,/m.test(text.split(/\r?\n/)[0] ?? "")) {
      log(`年份 ${year} 返回的不是 CSV（可能是空表或错误页），尝试下一年`);
      continue;
    }
    rows = parseTreasury(text);
    log(`抓取 ${url}`);
    log(`共 ${rows.length} 个交易日（${rows[0]?.iso} 至 ${rows[rows.length - 1]?.iso}）`);
    break;
  }
}

if (rows.length < 2) fail("可用交易日不足 2 天，无法计算变化，不推送");

const items: IngestItem[] = [];
// 只推【最新一个】交易日。框架按「发现时距发布超 48 小时」判 stale-on-discovery（materials.ts:86），
// 所以回填历史交易日必然被标记回填。历史数据首次接入时推一次建立基线即可，
// 之后每天只推当天 —— 这样每条都是新鲜的，也不会把回填标记带进日常运行。
const last = rows.length - 1;
for (let idx = Math.max(1, last); idx <= last; idx++) {
  const cur = rows[idx];
  const prev = rows[idx - 1];
  const p10 = cur.values["10 Yr"];
  const p2 = cur.values["2 Yr"];
  const p3 = cur.values["3 Mo"];
  const spread = p10 !== null && p2 !== null ? p10 - p2 : null;
  const prevSpread = prev.values["10 Yr"] !== null && prev.values["2 Yr"] !== null
    ? prev.values["10 Yr"]! - prev.values["2 Yr"]!
    : null;

  const lines: string[] = [];
  lines.push(
    `美国财政部发布 ${cur.iso} 的国债收益率曲线，共 ${Object.keys(cur.values).length} 个期限。` +
      `该日期为真实交易日，美国国债收益率曲线每日更新（T+1 发布上一交易日数据）。`
  );
  lines.push("");
  lines.push("关键期限");
  for (const t of KEY_TENORS) {
    if (!(t in cur.values)) continue;
    const now = cur.values[t];
    const before = prev.values[t];
    const delta = now !== null && before !== null ? now - before : null;
    lines.push(
      `- ${TENOR_LABEL[t]}（${t}）：${n(now)}%` +
        (delta === null ? "" : `，较上一交易日 ${delta > 0 ? "+" : ""}${delta.toFixed(2)} 个百分点`)
    );
  }

  lines.push("");
  lines.push("完整曲线");
  const full = TENORS.filter((t) => t in cur.values)
    .map((t) => `${TENOR_LABEL[t]} ${n(cur.values[t])}%`)
    .join("；");
  lines.push(full);

  if (spread !== null) {
    lines.push("");
    lines.push(
      `期限利差：10年期减2年期为 ${spread.toFixed(2)} 个百分点` +
        (prevSpread !== null
          ? `，上一交易日为 ${prevSpread.toFixed(2)} 个百分点（${spread > prevSpread ? "走陡" : "走平"}）`
          : "") +
        "。倒挂通常被视为衰退信号，恢复为正说明曲线正常化。"
    );
  }
  if (p3 !== null) {
    lines.push(`短端参考：3 个月 ${n(p3)}%。短端高企会压制长端需求，是黄金利率定价的输入之一。`);
  }

  lines.push("");
  lines.push("数据来源：美国财政部每日国债收益率曲线（Daily Treasury Par Yield Curve Rates），单位为百分比。");

  items.push({
    title: `美国国债收益率曲线 · ${cur.iso}`,
    // url 用数据日期，同一交易日重复推送会命中同一条目
    url: `https://snapshot.metalsmacro.local/treasury/curve/${cur.iso}`,
    // 财政部 CSV 的 Date 就是真实交易日，可直接当发布日期—— 这也是本脚本
    // 不需要像 FRED 那样推算发布延迟的原因。
    publishedAt: `${cur.iso}T21:00:00.000Z`,
    body: lines.join("\n"),
    raw: {
      source: "U.S. Treasury",
      dataDate: cur.iso,
      publishedDate: beijingDate(new Date(`${cur.iso}T21:00:00.000Z`)),
      unit: "%",
      yields: cur.values,
      spread10y2y: spread,
      previousDate: prev.iso,
    },
  });
}

log(`生成 ${items.length} 条（只取最新交易日；回填历史必然被 48 小时门槛标记 stale）`);

if (dryRun) {
  log(`试运行：${items.length} 条，未发送`);
  if (items.length > 0) {
    log("—— 最后一条正文预览 ——");
    for (const l of items[items.length - 1].body!.split("\n").slice(0, 8)) log(`  ${l}`);
  }
} else {
  const created = await pushItems(items, { sourceId: SOURCE_ID, sourceName: SOURCE_NAME, baseUrl });
  log(`推送完成：${items.length} 条，服务端新建 ${created} 条`);
  if (created === 0) log("提示：本次全部命中已有条目（该交易日之前推过）");
}
