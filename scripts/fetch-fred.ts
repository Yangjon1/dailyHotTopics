// 抓 FRED（美联储圣路易斯联储）的免key CSV，渲染成可分析的中文条目推入。
//
// 为什么写这个脚本（2026-10-06）：
// FRED 是本站最重要的免费宏观数据源，一次能补齐美元指数、实际利率、期限利差、金融状况四个空主题，
// 且 `fredgraph.csv` 路径完全免 key（`api.stlouisfed.org` 才要 key）。
//
// 三个实测踩过的坑（都已在下面代码里处理，写在这里防止后人重犯）：
//
// 1. `observation_date` 是【数据日期】，不是发布日期。CPI 的 8 月数据行写 `2026-08-01`，实际发布在 9 月中旬，
//    相差 40 多天。框架按 publishedAt 判 48 小时门槛（STALE_ON_DISCOVERY_MS），直接用数据日期会让
//    **每一条都在发布前 40 天就被判为 stale-on-discovery 而静默归档，站内一条都出不来**。
//    处理：按各序列的官方发布延迟表把数据日期推算成发布日期。延迟表不精确也没关系——
//    晚几天报出来是「保守正确」，早几天会被静默归档，那才是致命的。
//
// 2. 返回 CSV 还是 ZIP 取决于【是否混合频率】，不是「序列数超过几个」。
//    实测：同频率 5 个 → application/csv；`DFII10,PCOPPUSDM`（日+月）→ application/zip（内容以 PK 开头）。
//    所以必须按频率分批请求，并按 Content-Type 判断。
//
// 3. 一个坏 ID 会让整批变成 HTML 错误页（404 text/html），不是 CSV。
//    而且当整批频率一致时，坏 ID 会被**静默丢弃**——你会以为拿到了全部。
//    处理：读第一行判断是不是 CSV 表头，不是就报明确错误并逐个 ID 定位。
//
// 用法：
//   node --env-file=.env scripts/fetch-fred.ts --dry-run
//   node --env-file=.env scripts/fetch-fred.ts --base http://127.0.0.1:3001
//   node --env-file=.env scripts/fetch-fred.ts --group dollar   # 只跑某一组

import { beijingDate } from "@aihot/contracts/time";
import { fail, fetchText, log, pushItems, type IngestItem } from "./ingest-push.ts";
import { renderMacroBody } from "./render-macro-body.ts";

const SOURCE_ID = "ext-fred-macro";
const SOURCE_NAME = "美联储 FRED 宏观数据";

/**
 * 各序列的元信息。`lagDays` 是「数据日期到官方发布日」的近似天数。
 * 取值偏保守（宁可报晚，不可报早）——报早会被框架静默归档，报晚只是晚几天出现在站上。
 */
type Series = {
  id: string;
  name: string;
  /** 数值单位，用于「数字三件套」里的单位 */
  unit: string;
  /** 发布延迟近似天数 */
  lagDays: number;
  /** 涨跌幅是否对读者有意义（价格类为true，指数类看情况） */
  showChange?: boolean;
  note?: string;
};

/** 按频率分组：同组才能一次请求成 CSV，混合频率会返回 ZIP。 */
const GROUPS: Record<string, Series[]> = {
  // 利率组（日频）
  rates: [
    { id: "DFII10", name: "10年期通胀保值国债实际收益率", unit: "%", lagDays: 1, showChange: true,
      note: "实际利率是黄金定价的直接因子：实际利率上行，金价承压" },
    { id: "DGS10", name: "10年期美债名义收益率", unit: "%", lagDays: 0, showChange: true },
    { id: "DGS2", name: "2年期美债收益率", unit: "%", lagDays: 0, showChange: true },
    { id: "T10Y2Y", name: "10年期与2年期美债期限利差", unit: "%", lagDays: 0, showChange: true,
      note: "利差倒挂通常被视为衰退信号" },
    { id: "T10YIE", name: "10年期盈亏平衡通胀率", unit: "%", lagDays: 1, showChange: true,
      note: "市场预期的通胀水平，是黄金的定价输入之一" },
  ],
  // 美元与商品组：按频率拆开——GVZCLS/DCOILWTICO 是日频，DTWEXBGS/DTWEXAFEGS 是周频，
  // 混在一个请求里 FRED 会返回 ZIP 而不是 CSV（实测确认）。
  dollar: [
    { id: "DTWEXBGS", name: "美元指数（名义有效汇率）", unit: "指数", lagDays: 1, showChange: true,
      note: "广谱美元指数，覆盖主要贸易伙伴货币" },
    { id: "DTWEXAFEGS", name: "美元指数（亚洲货币）", unit: "指数", lagDays: 1, showChange: true },
  ],
  // 日频商品与波动率：GVZCLS 与 DCOILWTICO 虽然都是工作日频率，但**起始日期不同**，
  // FRED 同样判定为混合频率并返回 ZIP（实测两者单独请求都是 CSV，合起来就是 zip）。
  // 所以这类「同频但起点不同」的序列必须一个一个请求。
  goldVol: [
    { id: "GVZCLS", name: "黄金隐含波动率 GVZ", unit: "指数", lagDays: 1,
      note: "黄金波动率飙升通常先于价格剧烈波动" },
  ],
  oil: [
    { id: "DCOILWTICO", name: "WTI 原油价格", unit: "美元/桶", lagDays: 0, showChange: true,
      note: "原油是通胀预期的主要载体，与黄金的定价因子相反" },
  ],
  // 金融状况组（周频）
  finance: [
    { id: "NFCI", name: "芝加哥联储金融状况指数", unit: "指数", lagDays: 4,
      note: "零值为中性，正值代表金融环境收紧" },
    { id: "ANFCI", name: "金融状况指数（美国自适应版）", unit: "指数", lagDays: 4 },
  ],
  // 金属与铜组（月频）
  metals: [
    { id: "PCOPPUSDM", name: "全球铜价（IMF 月度）", unit: "美元/公吨", lagDays: 32, showChange: true,
      note: "铜是工业需求的风向标" },
    { id: "PALUMUSDM", name: "全球铝价（IMF 月度）", unit: "美元/公吨", lagDays: 32, showChange: true },
  ],
};

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

/** 解析 FRED 的 CSV。只认第一行表头——第一行不对说明整批坏了（坑 3）。 */
function parseFredCsv(text: string, ids: string[]): Map<string, Array<{ date: string; value: number }>> {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) fail("FRED 返回内容不足两行，可能不是 CSV");
  const header = lines[0].split(",").map((h) => h.trim());
  if (header[0] !== "observation_date" || !header.slice(1).every((h) => ids.includes(h))) {
    // 坏 ID 会让整批变成 HTML 错误页；这一行是唯一能提前发现的地方。
    fail(
      `FRED 返回的不是预期 CSV（表头: ${header.slice(0, 6).join(",")}）。` +
        `常见原因：某个 ID 不存在，整批被降级成 HTML 错误页。请逐个 ID 验证。`
    );
  }
  const out = new Map<string, Array<{ date: string; value: number }>>();
  for (const id of header.slice(1)) out.set(id, []);
  for (const line of lines.slice(1)) {
    const parts = line.split(",");
    const date = parts[0]?.trim();
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    for (let i = 1; i < parts.length; i++) {
      const v = parts[i]?.trim();
      // FRED 用 "." 表示假期与周末的缺失值
      if (!v || v === ".") continue;
      const value = Number(v);
      if (Number.isFinite(value)) out.get(header[i])!.push({ date, value });
    }
  }
  return out;
}

/**
 * 数据日期 + 发布延迟 = 发布时刻（坑 1 的处理）。
 * 返回完整的 ISO 串，**不要再往上拼时间部分**——拼两次会得到
 * "...T12:00:00.000ZT20:00:00.000Z" 这种非法格式，`new Date()` 解析失败会让
 * publishedAt 静默变成 null，条目全部落 unknown-publication-time 被归档。
 */
function publishedFor(dataDate: string, lagDays: number): string {
  const d = new Date(`${dataDate}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + lagDays);
  // 定在 20:00 UTC = 北京时间次日 04:00，避开「当天 00:00」这个边界
  d.setUTCHours(20, 0, 0, 0);
  return d.toISOString();
}

/** 同一系列相邻两期的变化量。 */
function changeOf(rows: Array<{ value: number }>, at: number): { abs: number; pct: number } | null {
  if (at < 1) return null;
  const cur = rows[at].value;
  const prev = rows[at - 1].value;
  if (prev === 0) return null;
  return { abs: cur - prev, pct: ((cur - prev) / Math.abs(prev)) * 100 };
}

const groups = arg("group") ? [arg("group")!] : Object.keys(GROUPS);
const dryRun = process.argv.includes("--dry-run");
const baseUrl = arg("base") ?? process.env.SITE_URL ?? "http://127.0.0.1:3001";

log(`目标站点 ${baseUrl}（${dryRun ? "试运行" : "正式推送"}${groups.length === 1 ? "，组: " + groups[0] : ""}）`);

const items: IngestItem[] = [];
let totalPoints = 0;

for (const g of groups) {
  const series = GROUPS[g];
  if (!series) fail(`未知分组 ${g}，可选：${Object.keys(GROUPS).join(", ")}`);
  const ids = series.map((s) => s.id);
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${ids.join(",")}`;

  // 按 Content-Type 判断 CSV 还是 ZIP（坑 2）
  const response = await fetch(url, {
    headers: { "user-agent": "MetalsMacroBot/1.0 (+https://github.com/KKKKhazix/AIHOT)", accept: "text/csv,*/*" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    log(`跳过 ${g}：HTTP ${response.status} ${url}`);
    continue;
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("csv")) {
    log(`跳过 ${g}：Content-Type 是 ${contentType}（不是 csv，通常意味着组内频率不一致，需再拆分）`);
    continue;
  }
  const text = await response.text();
  let byId: Map<string, Array<{ date: string; value: number }>>;
  try {
    byId = parseFredCsv(text, ids);
  } catch (e) {
    log(`跳过 ${g}：${(e as Error).message}`);
    continue;
  }

  // 每条序列只取最新一个有值的那一期，生成一条条目。
  // 这样每期日报只多一条，不会因为FRED 一次性给出十年历史而灌进几百条。
  for (const s of series) {
    const rows = byId.get(s.id) ?? [];
    if (rows.length === 0) {
      log(`  ${s.id} 无数据点`);
      continue;
    }
    const at = rows.length - 1;
    const latest = rows[at];
    const prev = at > 0 ? rows[at - 1] : null;
    const chg = changeOf(rows, at);
    const pub = publishedFor(latest.date, s.lagDays);

    items.push({
      title: `${s.name} · ${latest.date}`,
      // url 用数据日期而非发布日期，这样同一期数据重复推送时命中同一条目（不刷屏）
      url: `https://fred.metalsmacro.local/series/${s.id}/${latest.date}`,
      publishedAt: pub,
      body: renderMacroBody({
        seriesId: s.id,
        name: s.name,
        unit: s.unit,
        note: s.note,
        dataDate: latest.date,
        publishedDate: beijingDate(new Date(pub)),
        value: latest.value,
        previousValue: prev?.value ?? null,
        previousDate: prev?.date ?? null,
        changeAbs: chg?.abs ?? null,
        changePct: chg?.pct ?? null,
        showChange: s.showChange ?? false,
        historyPoints: rows.length,
      }),
      raw: {
        source: "FRED",
        seriesId: s.id,
        name: s.name,
        unit: s.unit,
        dataDate: latest.date,
        publishedDate: pub,
        value: latest.value,
        previousValue: prev?.value ?? null,
        changeAbs: chg?.abs ?? null,
        changePct: chg?.pct ?? null,
        observationNote: s.note ?? null,
      },
    });
    totalPoints += 1;
    log(`  ${s.id} ${s.name} ${latest.value}${s.unit}（数据日 ${latest.date} → 发布 ${pub.slice(0, 10)}）`);
  }
}

if (items.length === 0) fail("没有解析到任何数据点，不推送");
log(`解析到 ${items.length} 条（覆盖 ${groups.join(",") || "全部"} 组）`);

if (dryRun) {
  log(`试运行：${items.length} 条，未发送`);
} else {
  const created = await pushItems(items, { sourceId: SOURCE_ID, sourceName: SOURCE_NAME, baseUrl });
  log(`推送完成：${items.length} 条，服务端新建 ${created} 条`);
  if (created === 0) log("提示：本次全部命中已有条目（同期数据之前推过），未新建");
}
