// CFTC 持仓报告（贵金属）：抓 cftc.gov/dea/newcot/f_disagg.txt，解析四个贵金属品种，
// 组装成条目后走 POST /api/ingest/items 推入。这是本站差异化 3 的数据底座：
// 「CFTC 显示管理基金净多金减少 6344 手」这类可执行信息，全网没有中文站做中文解读。
//
// 用法：
//   node --env-file=.env scripts/fetch-cftc.ts
//   node --env-file=.env scripts/fetch-cftc.ts --dry-run
//   node --env-file=.env scripts/fetch-cftc.ts --file /path/to/f_disagg.txt    解析本地文件，不联网
//
// 为什么自己解析而不用 json_list：
// - 这是 CSV（带引号的逗号分隔）文本，不是 JSON，json_list 接不了。
// - 该文件没有表头行，第一行就是数据（283 行全是数据）。所以列位置必须对着官方表头核验，
//   不能凭印象写死。列名与下面对应的索引取自 CFTC 官方同格式年度文件
//   https://www.cftc.gov/files/dea/history/fut_disagg_txt_2025.zip 里的 f_year.txt 首行（同样 191 列）。
// - 已核验的恒等式（对全部 283 行成立，可当回归断言）：
//   报告保证金/总持仓 + 非报告方多头 = 总持仓量（idx19+idx21 == idx7）
//   报告保证金/总持仓 + 非报告方空头 = 总持仓量（idx20+idx22 == idx7）
//   这条恒等式是判断列位置有没有搞错的依据，不要绕过它直接写死数字。
//
// 报告日期在第 3 列（1-based，实测 2026-09-29），用它做条目主键的一部分：
// 同一报告期只推一次（天然满足旧文不刷屏），且发布日期用文件里的报告日期而非抓取时间。
import { beijingDate } from "@aihot/contracts/time";
import { fail, fetchText, log, pushItems, type IngestItem } from "./ingest-push.ts";
import { renderCotBody } from "./render-cot-body.ts";

const SOURCE_ID = "cftc-cot-metals";
const SOURCE_NAME = "CFTC 持仓报告（贵金属）";
const REPORT_URL = "https://www.cftc.gov/dea/newcot/f_disagg.txt";

/**
 * The framework archives material first seen more than this long after its source time
 * (STALE_ON_DISCOVERY_MS, materials.ts). Past it the item is stored but never reaches the report, so
 * the script warns instead of letting that happen quietly.
 */
const STALE_AFTER_HOURS = 48;

/**
 * 四个贵金属品种。用 CFTC 文件第 1 列的完整 "品种-交易所" 名精确匹配。
 * 精确匹配是有意的：文件里还有 "MICRO GOLD - COMMODITY EXCHANGE INC."、
 * "GOLD - COMMODITY EXCHANGE INC." 之外的 MICRO SILVER 等微合约行，
 * 用 includes("GOLD") 会把它们一起吞进来，读者看到两个金价条目会困惑。
 */
const MARKETS = [
  { key: "GOLD", row: "GOLD - COMMODITY EXCHANGE INC.", name: "黄金" },
  { key: "SILVER", row: "SILVER - COMMODITY EXCHANGE INC.", name: "白银" },
  { key: "PLATINUM", row: "PLATINUM - NEW YORK MERCANTILE EXCHANGE", name: "铂金" },
  { key: "PALLADIUM", row: "PALLADIUM - NEW YORK MERCANTILE EXCHANGE", name: "钯金" },
] as const;

/** f_disagg.txt 的列位置，字段名与索引对应 CFTC 官方表头（f_year.txt 首行，191 列）。 */
const COL = {
  marketAndExchangeNames: 0, // "GOLD - COMMODITY EXCHANGE INC."
  asOfDateYYMMDD: 1, // 260929
  reportDate: 2, // 2026-09-29
  contractMarketCode: 3,
  marketCode: 4, // CMX
  commodityCode: 6,
  // All 口径的当前值
  openInterestAll: 7,
  prodMercLongAll: 8,
  prodMercShortAll: 9,
  swapLongAll: 10,
  swapShortAll: 11,
  swapSpreadAll: 12,
  managedMoneyLongAll: 13,
  managedMoneyShortAll: 14,
  managedMoneySpreadAll: 15,
  otherReptLongAll: 16,
  otherReptShortAll: 17,
  otherReptSpreadAll: 18,
  totReptLongAll: 19,
  totReptShortAll: 20,
  nonReptLongAll: 21,
  nonReptShortAll: 22,
  // 较上周的变化量（Change_in_*），起点在 idx 55
  changeOpenInterestAll: 55,
  changeProdMercLongAll: 56,
  changeProdMercShortAll: 57,
  changeSwapLongAll: 58,
  changeSwapShortAll: 59,
  changeSwapSpreadAll: 60,
  changeManagedMoneyLongAll: 61,
  changeManagedMoneyShortAll: 62,
  changeManagedMoneySpreadAll: 63,
  changeOtherReptLongAll: 64,
  changeOtherReptShortAll: 65,
  changeTotReptLongAll: 66,
  changeTotReptShortAll: 67,
  changeNonReptLongAll: 68,
  changeNonReptShortAll: 69,
  contractUnits: 185, // "(CONTRACTS OF 100 TROY OUNCES)"
} as const;

/** 把一行按 CSV 规则拆开：双引号内的逗号不是分隔符。 */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cell += '"';
          i++; // 转义的双引号
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      cells.push(cell);
      cell = "";
    } else cell += ch;
  }
  cells.push(cell);
  return cells;
}

function num(cells: string[], index: number): number | null {
  const raw = cells[index]?.trim();
  if (!raw || raw === "." || raw === ",") return null; // CFTC 用 "." 表示不适用
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export interface CotRow {
  market: string;
  reportDate: string;
  contractMarketCode: string;
  marketCode: string;
  openInterest: number;
  prodMercLong: number | null;
  prodMercShort: number | null;
  swapLong: number | null;
  swapShort: number | null;
  swapSpread: number | null;
  managedMoneyLong: number;
  managedMoneyShort: number;
  managedMoneySpread: number | null;
  otherReptLong: number | null;
  otherReptShort: number | null;
  totReptLong: number | null;
  totReptShort: number | null;
  nonReptLong: number | null;
  nonReptShort: number | null;
  changeOpenInterest: number | null;
  changeManagedMoneyLong: number | null;
  changeManagedMoneyShort: number | null;
  changeTotReptLong: number | null;
  changeTotReptShort: number | null;
  changeNonReptLong: number | null;
  changeNonReptShort: number | null;
  contractUnits: string;
}

/**
 * 恒等式校验：报告方 + 非报告方 = 总持仓量（多头侧与空头侧各一次）。
 * 列位置写错时它会失败，这比把错数字推进去强。
 */
function identityHolds(row: CotRow): boolean {
  if (row.totReptLong === null || row.nonReptLong === null) return true;
  if (row.totReptShort === null || row.nonReptShort === null) return true;
  return row.totReptLong + row.nonReptLong === row.openInterest && row.totReptShort + row.nonReptShort === row.openInterest;
}

export function parseRow(line: string): CotRow | null {
  const cells = splitCsvLine(line);
  if (cells.length < 186) return null;
  const market = (cells[COL.marketAndExchangeNames] ?? "").trim();
  if (!market) return null;
  const reportDate = (cells[COL.reportDate] ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) return null;
  const openInterest = num(cells, COL.openInterestAll);
  if (openInterest === null) return null;
  return {
    market,
    reportDate,
    contractMarketCode: (cells[COL.contractMarketCode] ?? "").trim(),
    marketCode: (cells[COL.marketCode] ?? "").trim(),
    openInterest,
    prodMercLong: num(cells, COL.prodMercLongAll),
    prodMercShort: num(cells, COL.prodMercShortAll),
    swapLong: num(cells, COL.swapLongAll),
    swapShort: num(cells, COL.swapShortAll),
    swapSpread: num(cells, COL.swapSpreadAll),
    managedMoneyLong: num(cells, COL.managedMoneyLongAll) ?? 0,
    managedMoneyShort: num(cells, COL.managedMoneyShortAll) ?? 0,
    managedMoneySpread: num(cells, COL.managedMoneySpreadAll),
    otherReptLong: num(cells, COL.otherReptLongAll),
    otherReptShort: num(cells, COL.otherReptShortAll),
    totReptLong: num(cells, COL.totReptLongAll),
    totReptShort: num(cells, COL.totReptShortAll),
    nonReptLong: num(cells, COL.nonReptLongAll),
    nonReptShort: num(cells, COL.nonReptShortAll),
    changeOpenInterest: num(cells, COL.changeOpenInterestAll),
    changeManagedMoneyLong: num(cells, COL.changeManagedMoneyLongAll),
    changeManagedMoneyShort: num(cells, COL.changeManagedMoneyShortAll),
    changeTotReptLong: num(cells, COL.changeTotReptLongAll),
    changeTotReptShort: num(cells, COL.changeTotReptShortAll),
    changeNonReptLong: num(cells, COL.changeNonReptLongAll),
    changeNonReptShort: num(cells, COL.changeNonReptShortAll),
    contractUnits: (cells[COL.contractUnits] ?? "").trim(),
  };
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/**
 * When the report became public, which is NOT its report date.
 *
 * CFTC's disaggregated report covers positions as of the previous **Tuesday** and is released on the
 * following **Friday** around 15:30 ET. The report date is three days earlier than the release, so
 * using it as `publishedAt` puts every report at least 72h before discovery — past the framework's
 * 48h `STALE_ON_DISCOVERY_MS` — and every report would be archived as "stale-on-discovery" and never
 * reach the report. Measured on the 2026-09-29 report: 136h using the report date.
 *
 * The release Friday is found rather than assumed, so a holiday week that shifts the as-of date off
 * Tuesday still gets the right day. The exact minute does not matter: the window is measured in days,
 * and a script that runs on release day is 60+ hours inside it either way.
 */
function publicationInstant(reportDate: string): Date {
  const asOf = new Date(`${reportDate}T00:00:00Z`);
  // The Friday strictly after the as-of date: asOf.getUTCDay() 0=Sun..6=Sat, 5=Fri.
  const daysUntilFriday = ((5 - asOf.getUTCDay() + 7) % 7) || 7;
  return new Date(asOf.getTime() + daysUntilFriday * 86_400_000 + 19.5 * 3_600_000);
}

// ── 取数据 ──────────────────────────────────────────────────────────────────────────
const localFile = arg("file");
let text: string;
if (localFile) {
  const { readFileSync } = await import("node:fs");
  text = readFileSync(localFile, "latin1"); // CFTC 文件是 latin-1，UTF-8 读会乱码
  log(`读取本地文件 ${localFile}（${text.length} 字符）`);
} else {
  text = await fetchText(REPORT_URL);
  log(`抓取 ${REPORT_URL}（${text.length} 字符）`);
}

const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
log(`共 ${lines.length} 行`);

const items: IngestItem[] = [];
const seen = new Set<string>();
for (const target of MARKETS) {
  const line = lines.find((l) => splitCsvLine(l)[COL.marketAndExchangeNames]?.trim() === target.row);
  if (!line) {
    log(`警告：未找到 ${target.row}，跳过`);
    continue;
  }
  const row = parseRow(line);
  if (!row) {
    fail(`${target.key}: 行能匹配上但解析失败（列数或日期格式变了）`);
  }
  if (!identityHolds(row)) {
    // 不静默推进去：列位置错了会把错数字当持仓发出去。
    fail(`${target.key}: 恒等式校验失败（报告方+非报告方 != 总持仓量），列位置可能有误，拒绝推送`);
  }
  // 去重键必须是「品种 + 报告期」而不是只用报告期：同一份文件里四个品种的报告日期是同一天，
  // 只用 reportDate 会让后三个品种被 seen.has() 静默跳过，只推出一条。
  const dedupeKey = `${target.key}/${row.reportDate}`;
  if (seen.has(dedupeKey)) continue;
  seen.add(dedupeKey);

  const netManaged = row.managedMoneyLong - row.managedMoneyShort;
  const changeNetManaged =
    row.changeManagedMoneyLong !== null && row.changeManagedMoneyShort !== null
      ? row.changeManagedMoneyLong - row.changeManagedMoneyShort
      : null;

  // publishedAt is the release, not the report date (see publicationInstant). If that instant is
  // somehow in the future, the file is readable ahead of its release, so the honest answer is "it is
  // available now" — a future claim would be discarded and the item archived anyway.
  const release = publicationInstant(row.reportDate);
  const now = Date.now();
  const published = release.getTime() > now + 3_600_000 ? new Date(now) : release;
  const ageHours = (now - published.getTime()) / 3_600_000;

  // title 只含品种、报告日期与合约单位，不含任何会变的数值。
  // 持仓数字进 raw：raw 不参与 content_hash，所以同一报告期的数值修正不会触发重跑管道
  // （content_hash 只覆盖 title/bodyText/excerpt，materials.ts:contentHash）。
  items.push({
    title: `CFTC 持仓报告 · ${target.name} · ${row.reportDate}`,
    url: `https://cftc.metalsmacro.local/cot/${row.reportDate}/${target.key}`,
    publishedAt: published.toISOString(),
    // 正文由官方 CSV 字段渲染：模型分析时只能看到 body_text，看不到 raw。
    // 不给正文，摘要就只能如实写「暂无具体持仓数据」，本站的差异化就没有了。
    body: renderCotBody(row, target.name, row.contractUnits, published),
    raw: {
      symbol: target.key,
      name: target.name,
      market: row.market,
      marketCode: row.marketCode,
      contractMarketCode: row.contractMarketCode,
      reportDate: row.reportDate,
      // Both dates travel: the report date is what the numbers describe, the release is when it
      // became public. Collapsing the two is what makes a weekly report look a week stale.
      publishedAt: published.toISOString(),
      reportPublishedAt: release.toISOString(),
      unit: "contracts",
      contractUnits: row.contractUnits, // 如 (CONTRACTS OF 100 TROY OUNCES)，不是每手多少盎司
      openInterest: row.openInterest,
      changeOpenInterest: row.changeOpenInterest,
      // 八类交易者分项（CFTC 的 All 口径）
      positions: {
        producerMerchant: { long: row.prodMercLong, short: row.prodMercShort },
        swap: { long: row.swapLong, short: row.swapShort, spread: row.swapSpread },
        managedMoney: { long: row.managedMoneyLong, short: row.managedMoneyShort, spread: row.managedMoneySpread },
        otherReportable: { long: row.otherReptLong, short: row.otherReptShort, spread: null },
        totalReportable: { long: row.totReptLong, short: row.totReptShort },
        nonReportable: { long: row.nonReptLong, short: row.nonReptShort },
      },
      // 净头寸是读者真正要用的数字，显式算好，避免下游重复推导
      netManagedMoney: netManaged,
      changeNetManagedMoney: changeNetManaged,
      changes: {
        openInterest: row.changeOpenInterest,
        managedMoneyLong: row.changeManagedMoneyLong,
        managedMoneyShort: row.changeManagedMoneyShort,
        totalReportableLong: row.changeTotReptLong,
        totalReportableShort: row.changeTotReptShort,
        nonReportableLong: row.changeNonReptLong,
        nonReportableShort: row.changeNonReptShort,
      },
      source: "cftc-cot-disaggregated",
      endpoint: REPORT_URL,
    },
  });
  log(
    `${target.key} ${target.name}  报告日 ${row.reportDate}（发布 ${published.toISOString().slice(0, 16)}Z）  总持仓 ${row.openInterest}  ` +
      `管理基金多 ${row.managedMoneyLong} / 空 ${row.managedMoneyShort}  净 ${netManaged}` +
      (changeNetManaged !== null ? `  净变化 ${changeNetManaged > 0 ? "+" : ""}${changeNetManaged}` : ""),
  );
  // Say it out loud rather than let the item vanish: past 48h the framework archives it as
  // "stale-on-discovery" and it never reaches the report — a silent loss otherwise.
  if (ageHours > STALE_AFTER_HOURS) {
    log(`  警告：${target.key} 距发布已 ${ageHours.toFixed(0)} 小时（超过 ${STALE_AFTER_HOURS}），入库后会被归档、不进日报`);
  }
}

if (!items.length) fail("四个品种一个都没解析出来，不推送");

const baseUrl = arg("base") ?? process.env.SITE_URL ?? "http://localhost:3000";
const dryRun = process.argv.includes("--dry-run");
log(`目标站点 ${baseUrl}（${dryRun ? "试运行" : "正式推送"}）`);
const created = await pushItems(items, { sourceId: SOURCE_ID, sourceName: SOURCE_NAME, baseUrl, dryRun });
if (!dryRun) {
  log(`推送完成：${items.length} 条，服务端新建 ${created} 条`);
  if (created === 0) log("提示：本次全部命中已有条目（该报告期已推送过），未新建");
}
