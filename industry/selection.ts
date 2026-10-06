// 精选的门槛。评分标准本身写在 prompts/selection-score.md；这里只决定“多少分算入选”。
// 每篇资料由评分模型独立打两次分（0–100），两次之和 ≥ 2 × 门槛、并确认不是精选里已有新闻的重复报道才进精选
// （见 docs/selection.md），卡片上显示两次的平均分。
// 门槛按信源分级区分：官方一手信源的门槛低一些，媒体和个人的高一些。改了门槛或评分提示词，
// 用 scripts/eval-selection.ts 在你自己标注的样本上重跑一遍，再决定上线（见 docs/selection.md）。

export const SELECTION = {
  /**
   * 信源分级 → 入选门槛（平均分）。分级在后台“信源”里给每个源设置：
   *   T1 央行与统计机构（美联储、统计局、CFTC、EIA…）· T1_5 准官方账号与署名专栏
   *   T_DATA 官方数据发布方（持仓、库存、矿产、统计口径的数据源）
   *   T2 媒体与个人 · T2_OP 行业观点与研究机构（付费研究、部分券商观点）
   * 分级 EXCLUDE_MP 以及这里没有列出的分级，不参与精选评分（只进“全部动态”）。
   *
   * [!] 下面这组数字是**初值，不是定稿**。它按“官方数据源比媒体更值得先看”的原则给低了 T_DATA，
   * 但金融稿件的价值分布与 AI 行业不同（尤其 market 层必须大量标 reject，否则门槛会被行情噪声抬高）。
   * 必须用 scripts/eval-selection.ts 在 60-80 条金融标注样本上重跑校准后才能定稿（见 docs/selection.md、Spec §13.2）。
   * 注意 eval-selection.ts 走自己的代码路径，tests/setup.ts 的库名校验拦不住它：
   * 手动跑之前先确认 DATABASE_URL 的库名，否则会污染开发库。
   */
  thresholds: { T1: 58, T1_5: 64, T_DATA: 56, T2: 70, T2_OP: 82 } as Record<string, number>,
  /**
   * 没入选、但平均分高于这个数的资料，也用精选的写法（内容理解：标题、摘要、推荐理由）来写，
   * 其余用更便宜的“标题摘要翻译”。
   */
  understandFloor: 50,
} as const;
