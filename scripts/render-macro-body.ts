// 把一个 FRED 数据点渲染成人类可读的中文正文，供模型分析。
//
// 为什么正文里要写「数据日期」和「发布日期」两个日期（2026-10-06）：
// FRED 的 `observation_date` 是数据归属期，不是发布日。CPI 的 8 月数据行写 2026-08-01，实际发布在 9 月中旬。
// 框架按 publishedAt 判 48 小时门槛，用数据日期会让条目在发布前 40 天就被静默归档。
// 正文里把两个日期都写出来，模型才能在摘要里说清「8 月的数据于 9 月中旬发布」，
// 不会写出「8 月 CPI 于 8 月发布」这种常识性错误。

export interface MacroPoint {
  seriesId: string;
  name: string;
  unit: string;
  note?: string;
  /** 数据归属期，FRED 的 observation_date */
  dataDate: string;
  /** 推算出的发布日期 */
  publishedDate: string;
  value: number;
  previousValue: number | null;
  previousDate: string | null;
  changeAbs: number | null;
  changePct: number | null;
  /** 涨跌幅对读者是否有意义（利率类有意义，波动率指数类没有） */
  showChange: boolean;
  historyPoints: number;
}

function n(v: number | null, digits = 2): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}

function signed(v: number | null, digits = 2): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return v > 0 ? `+${v.toFixed(digits)}` : v.toFixed(digits);
}

export function renderMacroBody(p: MacroPoint): string {
  const lines: string[] = [];

  lines.push(
    `美联储圣路易斯联储（FRED）发布 ${p.name}数据。` +
      `数据归属期：${p.dataDate}；发布日期：${p.publishedDate}。`
  );
  lines.push("");
  lines.push("数值");
  lines.push(`- ${p.name}：${n(p.value)} ${p.unit}`);

  if (p.previousValue !== null) {
    lines.push(
      `- 上期（${p.previousDate ?? "上一期"}）：${n(p.previousValue)} ${p.unit}` +
        `，变化 ${signed(p.changeAbs)}${p.unit}` +
        (p.showChange && p.changePct !== null ? `（${signed(p.changePct)}%）` : "")
    );
  } else {
    lines.push("- 上期：无（该序列历史数据不足或上一期缺失）");
  }

  lines.push("");
  lines.push(`序列编号 ${p.seriesId}，数据来源 FRED（${p.historyPoints} 个历史观测点）。`);

  if (p.note) {
    lines.push("");
    lines.push(`解读要点：${p.note}`);
  }

  lines.push("");
  lines.push(
    "说明：FRED 的 observation_date 是数据归属期而非发布日，本条目的日期已按该序列的官方发布延迟" +
      "推算为发布日期。数值直接取自 FRED 原始 CSV，未做任何加工。"
  );

  return lines.join("\n");
}
