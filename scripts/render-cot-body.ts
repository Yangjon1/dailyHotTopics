// 把一条 CFTC 持仓记录渲染成人类可读的中文正文。
//
// 为什么需要它（2026-10-05）：模型分析时能看到的只有 articles.body_text，而 POST /api/ingest/items
// 只接受 title/url/publishedAt/author/raw 五个字段，不写 body。所以推送型信源如果只填 raw，
// 模型看到的是「标题 + 空正文」，摘要只能如实写「暂无具体持仓数据」。
//
// 做法：推送时把结构化数字渲染成一段中文正文，进body_text；raw 同时保留，供行情端点等下游按字段取数。
// 这样不改框架、不影响其他信源，也让「CFTC 显示管理基金净多金减少 7071 手」这类信息能被写进摘要。

import type { CotRow } from "./fetch-cftc.ts";

const CN: Record<string, string> = {
  producerMerchant: "生产商与贸易商",
  swap: "互换商",
  managedMoney: "管理基金",
  otherReportable: "其他可报告交易者",
  totalReportable: "可报告交易者合计",
  nonReportable: "非可报告交易者",
};

/** 千分位，便于读数；null/undefined 返回「—」。 */
function n(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return Math.round(v).toLocaleString("en-US");
}

/** 带正负号，用于「较上周变化」。 */
function delta(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const r = Math.round(v);
  return r > 0 ? `+${n(r)}` : n(r);
}

export function renderCotBody(
  row: CotRow,
  name: string,
  contractUnits: string,
  publishedAt: Date | string
): string {
  // 调用方给的是 Date（fetch-cftc.ts 里的 published），这里统一成 YYYY-MM-DD。
  // 报告期与发布日必须分开写：CFTC 的报告日是周二、发布是周五，两者差三天。
  // 早先这里写成「于 {reportDate} 发布」，等于教模型把报告期当发布日，
  // 恰好违反 rules-anti-hallucination.md 里「报告期与发布日期不可混用」那条。
  const publishedDate =
    publishedAt instanceof Date ? publishedAt.toISOString().slice(0, 10) : String(publishedAt).slice(0, 10);
  const lines: string[] = [];

  // 报告期与发布日必须分开写。CFTC 的报告日是周二、发布是周五，两者差三天；
  // 早先这里写成「于 {reportDate} 发布」，等于教模型把报告期当发布日，
  // 恰好违反 rules-anti-hallucination.md 里「报告期与发布日期不可混用」那条。
  lines.push(
    `美国商品期货交易委员会（CFTC）${name}持仓报告（Commitments of Traders，分解口径）。` +
      `报告期：${row.reportDate}；发布日期：${publishedDate}。` +
      `合约单位：${contractUnits}；以下持仓与净头寸均以手（contracts）计。`
  );

  lines.push("");
  lines.push("总持仓与净头寸");
  lines.push(`- 总持仓：${n(row.openInterest)} 手，较上周变化 ${delta(row.changeOpenInterest)} 手`);
  const netManaged = row.managedMoneyLong !== null && row.managedMoneyShort !== null
    ? row.managedMoneyLong - row.managedMoneyShort
    : null;
  const chgNetManaged = row.changeManagedMoneyLong !== null && row.changeManagedMoneyShort !== null
    ? row.changeManagedMoneyLong - row.changeManagedMoneyShort
    : null;
  lines.push(
    `- 管理基金净多头：${n(netManaged)} 手，较上周变化 ${delta(chgNetManaged)} 手` +
      `（多头 ${n(row.managedMoneyLong)} 手，空头 ${n(row.managedMoneyShort)} 手）`
  );
  lines.push(
    `- 可报告交易者合计：多 ${n(row.totReptLong)} 手，空 ${n(row.totReptShort)} 手；` +
      `非可报告交易者：多 ${n(row.nonReptLong)} 手，空 ${n(row.nonReptShort)} 手`
  );

  lines.push("");
  lines.push("各类交易者分项持仓");
  const rows: Array<[string, number | null, number | null, number | null]> = [
    [CN.producerMerchant, row.prodMercLong, row.prodMercShort, null],
    [CN.swap, row.swapLong, row.swapShort, row.swapSpread],
    [CN.managedMoney, row.managedMoneyLong, row.managedMoneyShort, row.managedMoneySpread],
    [CN.otherReportable, row.otherReptLong, row.otherReptShort, null],
  ];
  for (const [label, long, short, spread] of rows) {
    const spreadText = spread === null || spread === undefined ? "" : `，套利 ${n(spread)} 手`;
    lines.push(`- ${label}：多 ${n(long)} 手，空 ${n(short)} 手${spreadText}`);
  }

  lines.push("");
  const net = (long: number | null, short: number | null) =>
    long === null || short === null ? "—" : n(long - short);
  lines.push(
    `净头寸（多减空）：管理基金 ${net(row.managedMoneyLong, row.managedMoneyShort)} 手，` +
      `可报告合计 ${net(row.totReptLong, row.totReptShort)} 手，非可报告 ${net(row.nonReptLong, row.nonReptShort)} 手。`
  );
  lines.push("");
  lines.push(
    `数据来源：CFTC 分解口径持仓报告（${row.market}，报告代码 ${row.marketCode}）。` +
      `本段由采集脚本按官方 CSV 字段自动生成，供摘要与解读使用。`
  );

  return lines.join("\n");
}
