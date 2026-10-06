// 这个行业的分类体系：类别、标签词表、主体（央行/交易所/品种/国家）名录，以及防止张冠李戴的身份词典。
// 模型按这里的词表打标签，主题页（topics.json）按标签归类，筛选栏按类别分组。
// 换行业时：类别的 key 会出现在网址里（/all?category=…），上线后就不要再改；标签和名录可以随时增减。

/**
 * 网页上的类别（筛选栏、卡片角标、RSS 分类订阅）。key 是网址和接口里的身份，上线后不要改。
 * section 是日报里的分节标题（几个类别可以共用一节，按这里的顺序排）；guide 告诉结构抽取模型这一类收什么、
 * 和相邻类别的边界在哪（总的归类原则写在 prompts/structure.md 里）。guide 会全量注入提示词，写长了挤占模型注意力，
 * 所以只写“收什么 + 一条最易混的边界”，边界解释放 structure.md。
 * commentary 标出评论类：日报写过的事又有评论类的后续报道，只占一行快讯（报道它的信源够多时除外）。
 * 没归上类的资料在日报里放进第一个 key 为 industry 的类别所在的节（没有就放最后一节）。
 * feedLabel 是分类 RSS 标题里的名字（不写就用 label）。公开接口、RSS 和 MCP 里要把一类并进另一类发布，写在站点设置里（site/site.ts 的 PUBLIC_CATEGORIES）。
 */
export const CATEGORIES = [
  { key: "precious-metals", label: "贵金属", feedLabel: "贵金属", section: "贵金属", guide: "金银铂钯及其供需、央行购金、ETF持仓；工业需求也归此类" },
  { key: "industrial-commodities", label: "大宗商品", feedLabel: "大宗商品", section: "大宗商品", guide: "铜铝镍锡铅与原油天然气；不含农产品与个股" },
  { key: "macro", label: "宏观货币", feedLabel: "宏观货币", section: "宏观货币", guide: "央行政策、通胀就业、美元汇率、实际利率、美债与地缘传导" },
  { key: "equity-bond", label: "股债市场", feedLabel: "股债市场", section: "股债市场", guide: "股指、国债收益率曲线、信用利差、股债资金流；不收个股" },
  { key: "analysis", label: "分析解读", feedLabel: "分析解读", section: "分析解读", guide: "机构观点、分析师解读、策略复盘；以判断论证为主，非事实", commentary: true },
  { key: "data", label: "数据与报告", feedLabel: "数据与报告", section: "数据与报告", guide: "官方数据与持仓报告的发布；数据涨跌归对应资产类别" },
] as const satisfies ReadonlyArray<{ key: string; label: string; feedLabel?: string; section: string; guide: string; commentary?: true }>;

/**
 * 这个行业最受关注的一类发布。贵金属没有等价物：数据发布天天有、不可数，「今日 5 项数据」对读者没有决策价值
 * （他自己知道要去查日历）；「价格突破」不是发布事件；「央行购金」多数月份为 0 次。
 * 所以 RELEASE = null，报头不显示这个数；报头改用 REPORTS.officialHeadline 的三态文案（见 site/site.ts）。
 */
export const RELEASE: { category: string; tag: string; unit: string } | null = null;

/**
 * 周报月报的总述可以直接写、不必在报道里找到出处的行业通用词（小写）。站名会自动算进去。
 * 只放行业通用词，不放公司名和具体数字：框架会检查总述里出现的专名和三位以上数字，
 * 不在词表里的会被判为“写出了条目里没有的名字或数字”而丢弃总述。
 */
export const PLAIN_TERMS: readonly string[] = [
  // 品种与原油
  "gold", "silver", "platinum", "palladium", "copper", "crude", "brent", "wti", "natgas",
  // 央行与机构
  "fed", "ecb", "pboc", "boe", "rba", "cftc", "comex", "sge", "lbma", "opec", "doj",
  // 经济数据
  "cpi", "ppi", "pmi", "nfp", "gdp", "pce",
  // 汇率、利率与载体
  "dxy", "usd", "cny", "treasury", "yield", "etf",
];

// ── 标签词表 ────────────────────────────────────────────────────────────────────────────

/**
 * 内容理解一步给每篇资料判的“内容类型”（写在 prompts/content-understanding.md 里，改了类型要同步改那份提示词）。
 * 评分提示词（prompts/selection-score.md）按类型给五个维度不同的权重。
 * official_data 是本站新增的一类：官方统计与持仓报告的发布。它按“数据幅度”评价值，分析稿按“论证质量”评，
 * 一套权重对两者都不合适。它天然不是 commentary，不占日报快讯位置。
 */
export const ITEM_TYPES = ["official_data", "policy_event", "market_move", "supply_demand", "industry_event", "opinion_analysis", "explainer_guide"] as const;

/** 每篇资料的第一个标签必须是这些“分类标签”之一。 */
export const CATEGORY_TAGS = [
  "数据/持仓", "政策/央行", "供需/产能", "行情/价格", "地缘/贸易", "机构观点", "分析/解读", "宏观/通胀", "就业/经济", "股债/资金流", "其他",
] as const;

/**
 * 可选的主题标签。13 个品种标签不只是分类标签，还是归组召回的锚点：CFTC 原文说“管理基金”，中文稿说“投机者”，
 * 字面不重合，靠品种标签给召回兜底。TD_SYNONYMS 只能收敛“模型输出阶段”的同义，解决不了召回阶段，两者机制不同。
 */
export const TOPIC_TAGS = [
  "黄金", "白银", "铂金", "钯金", "铜", "基础金属", "原油", "天然气",
  "美元指数", "美债收益率", "央行购金", "ETF持仓", "地缘政治",
  "通胀", "就业", "货币政策", "贸易摩擦", "库存", "矿山",
] as const;

/** 可选的实体标签（央行、交易所、统计机构、主要国家）。 */
export const ENTITY_TAGS = [
  "美联储", "欧洲央行", "中国人民银行", "美国商品期货交易委员会", "世界黄金协会", "上海黄金交易所", "伦敦金银市场协会",
  "美国能源信息署", "美国劳工统计局", "中国国家统计局", "国际能源署", "欧佩克",
  "美国", "中国", "欧元区", "日本", "英国", "瑞士", "印度",
] as const;

/**
 * 模型常写的近义词，统一成词表里的写法。
 * 「实际利率」「美债」「10年期美债」在检索层归并到“美债收益率”：用户搜“实际利率”就是为了理解黄金定价。
 * 但表述层不可混同——实际利率 = 名义收益率 - 通胀预期，摘要里仍要写“实际利率”，PLAIN_TERMS 与正文保持区分。
 */
export const TAG_SYNONYMS: Readonly<Record<string, string>> = {
  // 品种归并（检索层）
  "au9999": "黄金", "沪金": "黄金", "comex黄金": "黄金", "现货金": "黄金", "xau": "黄金", "金价": "黄金", "黄金价格": "黄金",
  "ag9999": "白银", "沪银": "白银", "comex白银": "白银", "现货银": "白银", "xag": "白银", "银价": "白银",
  "nymex铂": "铂金", "现货铂": "铂金", "xpt": "铂金", "铂": "铂金",
  "nymex钯": "钯金", "现货钯": "钯金", "xpd": "钯金", "钯": "钯金",
  "lme铜": "铜", "沪铜": "铜", "comex铜": "铜", "铜价": "铜",
  "铝": "基础金属", "锌": "基础金属", "镍": "基础金属", "锡": "基础金属", "铅": "基础金属",
  "wti": "原油", "brent": "原油", "布伦特": "原油", "布油": "原油", "opec+": "原油",
  "henry hub": "天然气", "ttf": "天然气", "lng": "天然气",
  "美元指数": "美元指数", "dxy": "美元指数", "美元": "美元指数",
  "美债": "美债收益率", "10年期美债": "美债收益率", "十年期国债收益率": "美债收益率", "美债利率": "美债收益率", "实际利率": "美债收益率", "真实利率": "美债收益率",
  "央行购金": "央行购金", "官方储备": "央行购金", "黄金储备": "央行购金", "储备购金": "央行购金",
  "spdr": "ETF持仓", "gld": "ETF持仓", "黄金etf": "ETF持仓", "持仓": "ETF持仓",
  // 主题与形态
  "数据": "数据/持仓", "持仓报告": "数据/持仓", "官方数据": "数据/持仓", "统计": "数据/持仓", "cpi数据": "数据/持仓",
  "政策": "政策/央行", "央行": "政策/央行", "利率决议": "政策/央行", "货币政策": "政策/央行", "监管": "政策/央行", "法规": "政策/央行",
  "供需": "供需/产能", "产能": "供需/产能", "库存": "供需/产能", "产量": "供需/产能", "矿山": "供需/产能",
  "行情": "行情/价格", "价格": "行情/价格", "涨跌幅": "行情/价格", "报价": "行情/价格",
  "地缘": "地缘/贸易", "贸易": "地缘/贸易", "关税": "地缘/贸易", "制裁": "地缘/贸易", "冲突": "地缘/贸易",
  "观点": "机构观点", "机构": "机构观点", "分析师": "机构观点", "策略": "分析/解读", "解读": "分析/解读", "复盘": "分析/解读", "报告": "分析/解读",
  "通胀": "宏观/通胀", "cpi": "宏观/通胀", "ppi": "宏观/通胀", "pce": "宏观/通胀", "通缩": "宏观/通胀",
  "就业": "就业/经济", "非农": "就业/经济", "失业率": "就业/经济", "gdp": "就业/经济", "pmi": "就业/经济",
  "股债": "股债/资金流", "资金流": "股债/资金流", "股指": "股债/资金流", "信用利差": "股债/资金流",
};

// ── 主体名录 ────────────────────────────────────────────────────────────────────────────

/**
 * 主体：央行、交易所、统计机构、行业协会与主要国家。id → 显示名、卡片上显示的标签（null 表示只用 entity:<id> 归类）、别名。
 * aliases 给结构抽取模型看；otherNames 是该主体自己的其他称呼（官方英文名、缩写、子品牌），
 * 把事实的主体对到发布方时也认它们。
 */
export const ENTITIES: Record<string, { name: string; displayTag: string | null; aliases: string[]; otherNames?: string[] }> = {
  // 央行与货币政策机构
  "fed": { name: "美联储", displayTag: "美联储", aliases: ["美联储", "联邦储备委员会", "FOMC"], otherNames: ["Federal Reserve", "US Federal Reserve", "Federal Open Market Committee", "鲍威尔"] },
  "ecb": { name: "欧洲央行", displayTag: "欧洲央行", aliases: ["欧洲央行", "ECB"], otherNames: ["European Central Bank", "欧央行"] },
  "pboc": { name: "中国人民银行", displayTag: "中国人民银行", aliases: ["中国人民银行", "央行", "人民银行"], otherNames: ["PBOC", "PBoC", "People's Bank of China", "中国人民银行行长"] },
  "boe": { name: "英国央行", displayTag: null, aliases: ["英国央行", "BOE"], otherNames: ["Bank of England"] },
  "boj": { name: "日本央行", displayTag: null, aliases: ["日本央行", "BOJ"], otherNames: ["Bank of Japan"] },
  "rba": { name: "澳洲联储", displayTag: null, aliases: ["澳洲联储", "RBA"], otherNames: ["Reserve Bank of Australia"] },
  "boc": { name: "加拿大央行", displayTag: null, aliases: ["加拿大央行", "BOC"], otherNames: ["Bank of Canada"] },
  "snb": { name: "瑞士央行", displayTag: null, aliases: ["瑞士央行", "SNB"], otherNames: ["Swiss National Bank"] },
  "bis": { name: "国际清算银行", displayTag: null, aliases: ["国际清算银行", "BIS"], otherNames: ["Bank for International Settlements"] },
  "imf": { name: "国际货币基金组织", displayTag: null, aliases: ["国际货币基金组织", "IMF"], otherNames: ["International Monetary Fund"] },

  // 交易所与监管机构
  "cftc": { name: "美国商品期货交易委员会", displayTag: "美国商品期货交易委员会", aliases: ["美国商品期货交易委员会", "CFTC"], otherNames: ["Commodity Futures Trading Commission", "持仓报告", "COT报告", " Commitments of Traders"] },
  "comex": { name: "COMEX", displayTag: null, aliases: ["COMEX", "纽约商品交易所"], otherNames: ["CME", "CME Group", "纽约金属交易所"] },
  "cme": { name: "CME 集团", displayTag: null, aliases: ["CME", "芝商所"], otherNames: ["CME Group", "Chicago Mercantile Exchange"] },
  "nymex": { name: "纽约商业交易所", displayTag: null, aliases: ["NYMEX", "纽约商业交易所"], otherNames: ["New York Mercantile Exchange"] },
  "lme": { name: "伦敦金属交易所", displayTag: null, aliases: ["伦敦金属交易所", "LME"], otherNames: ["London Metal Exchange"] },
  "sge": { name: "上海黄金交易所", displayTag: "上海黄金交易所", aliases: ["上海黄金交易所", "SGE"], otherNames: ["Shanghai Gold Exchange", "上金所"] },
  "shfe": { name: "上海期货交易所", displayTag: null, aliases: ["上海期货交易所", "SHFE"], otherNames: ["Shanghai Futures Exchange", "沪铜", "沪金", "沪银", "上期所"] },
  "lbma": { name: "伦敦金银市场协会", displayTag: "伦敦金银市场协会", aliases: ["伦敦金银市场协会", "LBMA"], otherNames: ["London Bullion Market Association"] },
  "ice": { name: "洲际交易所", displayTag: null, aliases: ["洲际交易所", "ICE"], otherNames: ["Intercontinental Exchange"] },
  "sec": { name: "美国证券交易委员会", displayTag: null, aliases: ["美国证券交易委员会", "SEC"], otherNames: ["Securities and Exchange Commission"] },
  "esma": { name: "欧洲证券与市场管理局", displayTag: null, aliases: ["欧洲证券与市场管理局", "ESMA"], otherNames: ["ESMA"] },
  "csrc": { name: "中国证监会", displayTag: null, aliases: ["中国证监会", "CSRC"], otherNames: ["China Securities Regulatory Commission"] },

  // 统计与能源机构
  "eia": { name: "美国能源信息署", displayTag: "美国能源信息署", aliases: ["美国能源信息署", "EIA"], otherNames: ["Energy Information Administration"] },
  "bls": { name: "美国劳工统计局", displayTag: "美国劳工统计局", aliases: ["美国劳工统计局", "BLS"], otherNames: ["Bureau of Labor Statistics"] },
  "bea": { name: "美国经济分析局", displayTag: null, aliases: ["美国经济分析局", "BEA"], otherNames: ["Bureau of Economic Analysis"] },
  "census": { name: "美国人口普查局", displayTag: null, aliases: ["美国人口普查局"], otherNames: ["US Census Bureau"] },
  "nbs": { name: "中国国家统计局", displayTag: "中国国家统计局", aliases: ["中国国家统计局", "统计局", "国家统计局"], otherNames: ["National Bureau of Statistics of China", "NBS"] },
  "customs": { name: "中国海关总署", displayTag: null, aliases: ["中国海关总署", "海关总署"], otherNames: ["General Administration of Customs of China"] },
  "iea": { name: "国际能源署", displayTag: "国际能源署", aliases: ["国际能源署", "IEA"], otherNames: ["International Energy Agency"] },
  "opec": { name: "欧佩克", displayTag: "欧佩克", aliases: ["欧佩克", "OPEC", "OPEC+"], otherNames: ["Organization of the Petroleum Exporting Countries"] },
  "usgs": { name: "美国地质调查局", displayTag: null, aliases: ["美国地质调查局", "USGS"], otherNames: ["US Geological Survey"] },
  "wgc": { name: "世界黄金协会", displayTag: "世界黄金协会", aliases: ["世界黄金协会", "WGC"], otherNames: ["World Gold Council"] },
  "silver-institute": { name: "白银协会", displayTag: null, aliases: ["白银协会"], otherNames: ["Silver Institute", "The Silver Institute"] },
  "icc": { name: "国际镍研究小组", displayTag: null, aliases: ["国际镍研究小组", "INSG"], otherNames: ["International Nickel Study Group"] },
  "ilzsg": { name: "国际铅锌研究小组", displayTag: null, aliases: ["国际铅锌研究小组", "ILZSG"], otherNames: ["International Lead and Zinc Study Group"] },
  "itf": { name: "国际锡业研究组织", displayTag: null, aliases: ["国际锡业研究组织", "ITF"], otherNames: ["International Tin Study Group"] },
  "cpb": { name: "荷兰经济政策分析局", displayTag: null, aliases: ["荷兰经济政策分析局", "CPB"], otherNames: ["CPB Netherlands Bureau for Economic Policy Analysis"] },

  // 交易所会员与做市商（贵金属供需与库存数据的常见发布方）
  "shfe-members": { name: "上期所会员持仓", displayTag: null, aliases: ["上期所会员持仓", "会员持仓"], otherNames: ["SHFE warehouse stocks", "上期所库存"] },
  "comex-stocks": { name: "COMEX 库存", displayTag: null, aliases: ["COMEX库存", "COMEX registered stocks"], otherNames: ["registered eligible stocks", "注册仓单"] },
  "lme-stocks": { name: "LME 库存", displayTag: null, aliases: ["LME库存", "伦铜库存"], otherNames: ["LME warehouse stocks"] },

  // 主要国家与地区（地缘、贸易与货币政策的传导主体）
  "us": { name: "美国", displayTag: "美国", aliases: ["美国", "美方"], otherNames: ["United States", "US", "USA", "华盛顿"] },
  "cn": { name: "中国", displayTag: "中国", aliases: ["中国", "中方", "国内"], otherNames: ["China", "PRC", "北京"] },
  "eu": { name: "欧元区", displayTag: "欧元区", aliases: ["欧元区", "欧盟", "欧洲"], otherNames: ["Eurozone", "EU", "European Union"] },
  "jp": { name: "日本", displayTag: "日本", aliases: ["日本"], otherNames: ["Japan", "东京"] },
  "uk": { name: "英国", displayTag: "英国", aliases: ["英国"], otherNames: ["United Kingdom", "UK", "London"] },
  "ch": { name: "瑞士", displayTag: "瑞士", aliases: ["瑞士"], otherNames: ["Switzerland"] },
  "in": { name: "印度", displayTag: "印度", aliases: ["印度"], otherNames: ["India"] },
  "ru": { name: "俄罗斯", displayTag: null, aliases: ["俄罗斯"], otherNames: ["Russia"] },
  "sa": { name: "沙特阿拉伯", displayTag: null, aliases: ["沙特阿拉伯", "沙特"], otherNames: ["Saudi Arabia"] },
  "ir": { name: "伊朗", displayTag: null, aliases: ["伊朗"], otherNames: ["Iran"] },
  "ua": { name: "乌克兰", displayTag: null, aliases: ["乌克兰"], otherNames: ["Ukraine"] },
  "il": { name: "以色列", displayTag: null, aliases: ["以色列"], otherNames: ["Israel"] },
  "tr": { name: "土耳其", displayTag: null, aliases: ["土耳其"], otherNames: ["Turkey"] },
  "br": { name: "巴西", displayTag: null, aliases: ["巴西"], otherNames: ["Brazil"] },
  "au": { name: "澳大利亚", displayTag: null, aliases: ["澳大利亚", "澳洲"], otherNames: ["Australia"] },
  "ca": { name: "加拿大", displayTag: null, aliases: ["加拿大"], otherNames: ["Canada"] },
  "kr": { name: "韩国", displayTag: null, aliases: ["韩国"], otherNames: ["South Korea", "Korea"] },
  "tw": { name: "中国台湾", displayTag: null, aliases: ["中国台湾", "台湾"], otherNames: ["Taiwan"] },
  "hk": { name: "中国香港", displayTag: null, aliases: ["中国香港", "香港"], otherNames: ["Hong Kong"] },
};

/**
 * 身份词典：摘要和标题里出现的主体，必须在原文里也出现过，否则退回原标题、丢掉摘要（防止模型张冠李戴）。
 */
export const IDENTITY_LEXICON: ReadonlyArray<{ id: string; name: string; patterns: RegExp[] }> = [
  { id: "fed", name: "美联储", patterns: [/\bfed\b|federal reserve|美联储|联邦储备|美国央行|\bfomc\b|\bpowell\b|鲍威尔/i] },
  { id: "ecb", name: "欧洲央行", patterns: [/\becb\b|european central bank|欧洲央行/i] },
  { id: "pboc", name: "中国人民银行", patterns: [/\bpboc\b|people\'s bank of china|人民银行|中国央行|央行行长/i] },
  { id: "boe", name: "英国央行", patterns: [/\bboe\b|bank of england|英国央行/i] },
  { id: "boj", name: "日本央行", patterns: [/\bboj\b|bank of japan|日本央行/i] },
  { id: "cftc", name: "美国商品期货交易委员会", patterns: [/\bcftc\b|commodity futures trading commission|商品期货交易委员会|持仓报告|\bcot\b|commitments of traders/i] },
  { id: "comex", name: "COMEX", patterns: [/\bcomex\b|纽约商品交易所|\bcmx\b/i] },
  { id: "lme", name: "伦敦金属交易所", patterns: [/\blme\b|伦敦金属交易所|伦铜|伦铝|伦镍/i] },
  { id: "sge", name: "上海黄金交易所", patterns: [/\bsge\b|上海黄金交易所|上金所|\bau99\d\d\b|\bag99\d\d\b/i] },
  { id: "shfe", name: "上海期货交易所", patterns: [/\bshfe\b|上海期货交易所|上期所|沪铜|沪锌|沪镍|沪锡|沪铅/i] },
  { id: "lbma", name: "伦敦金银市场协会", patterns: [/\blbma\b|伦敦金银市场协会/i] },
  { id: "wgc", name: "世界黄金协会", patterns: [/\bwgc\b|world gold council|世界黄金协会|黄金需求趋势/i] },
  { id: "eia", name: "美国能源信息署", patterns: [/\beia\b|energy information administration|美国能源信息署|能源信息署|原油库存周报|\bapi\b.*库存/i] },
  { id: "bls", name: "美国劳工统计局", patterns: [/\bbls\b|美国劳工统计局|非农|非农就业|\bnfp\b|失业率|就业人数/i] },
  { id: "bea", name: "美国经济分析局", patterns: [/\bbea\b|美国经济分析局|\bpce\b|个人消费支出/i] },
  { id: "nbs", name: "中国国家统计局", patterns: [/\bnbs\b|national bureau of statistics|国家统计局|统计局|工业增加值|社会消费品零售|规模以上工业/i] },
  { id: "customs", name: "中国海关总署", patterns: [/海关总署|海关统计|进出口数据|贸易顺差|贸易逆差/i] },
  { id: "iea", name: "国际能源署", patterns: [/\biea\b|国际能源署|月度石油市场报告/i] },
  { id: "opec", name: "欧佩克", patterns: [/\bopec\b|organization of the petroleum exporting countries|欧佩克|\bopec\+|石油输出国组织|减产协议|增产协议/i] },
  { id: "usgs", name: "美国地质调查局", patterns: [/\busgs\b|美国地质调查局|矿产摘要|矿物商品摘要/i] },
  { id: "icc", name: "国际镍研究小组", patterns: [/\binsg\b|国际镍研究小组|镍库存/i] },
  { id: "ilzsg", name: "国际铅锌研究小组", patterns: [/\bilzsg\b|国际铅锌研究小组|锌库存|铅库存/i] },
  { id: "itf", name: "国际锡业研究组织", patterns: [/\bitf\b|国际锡业研究组织|锡库存/i] },
  { id: "imf", name: "国际货币基金组织", patterns: [/\bimf\b|国际货币基金组织|世界经济展望|\bwmo\b/i] },
  { id: "bis", name: "国际清算银行", patterns: [/\bbis\b|国际清算银行/i] },
  { id: "sec", name: "美国证券交易委员会", patterns: [/\bsec\b|美国证券交易委员会/i] },
  { id: "us", name: "美国", patterns: [/\bus\b|united states|u\.s\.|america|白宫|美国政府|华盛顿/i] },
  { id: "cn", name: "中国", patterns: [/\bchina\b|中国|我国|北京|国务院|发改委/i] },
  { id: "eu", name: "欧元区", patterns: [/\beurozone\b|欧元区|欧盟|\beu\b|europe/i] },
  { id: "jp", name: "日本", patterns: [/japan|日本|东京|日经/i] },
  { id: "uk", name: "英国", patterns: [/\buk\b|united kingdom|britain|英国|伦敦/i] },
  { id: "ch", name: "瑞士", patterns: [/switzerland|瑞士|苏黎世|瑞郎/i] },
  { id: "in", name: "印度", patterns: [/india|印度|孟买|卢比/i] },
  { id: "ru", name: "俄罗斯", patterns: [/russia|俄罗斯|莫斯科|卢布/i] },
  { id: "sa", name: "沙特阿拉伯", patterns: [/saudi|沙特/i] },
  { id: "ir", name: "伊朗", patterns: [/iran|伊朗|德黑兰/i] },
  { id: "ua", name: "乌克兰", patterns: [/ukrain|乌克兰|基辅/i] },
  { id: "il", name: "以色列", patterns: [/israel|以色列/i] },
  { id: "tr", name: "土耳其", patterns: [/turkey|turkiye|土耳其/i] },
  { id: "br", name: "巴西", patterns: [/brazil|巴西/i] },
  { id: "au", name: "澳大利亚", patterns: [/australia|澳大利亚|澳洲/i] },
  { id: "ca", name: "加拿大", patterns: [/canada|加拿大/i] },
  { id: "kr", name: "韩国", patterns: [/korea|韩国|首尔/i] },
  { id: "tw", name: "中国台湾", patterns: [/taiwan|台湾|台北/i] },
  { id: "hk", name: "中国香港", patterns: [/hong kong|香港/i] },
];

/** 这些域名上的文章，发布方就是对应的主体（托管平台、聚合站不算）。 */
export const PUBLISHER_DOMAINS: ReadonlyArray<{ entityId: string; domains: readonly string[] }> = [
  { entityId: "fed", domains: ["federalreserve.gov"] },
  { entityId: "ecb", domains: ["ecb.europa.eu"] },
  { entityId: "pboc", domains: ["pbc.gov.cn"] },
  { entityId: "cftc", domains: ["cftc.gov"] },
  { entityId: "eia", domains: ["eia.gov"] },
  { entityId: "bls", domains: ["bls.gov"] },
  { entityId: "bea", domains: ["bea.gov"] },
  { entityId: "nbs", domains: ["stats.gov.cn"] },
  { entityId: "customs", domains: ["customs.gov.cn"] },
  { entityId: "lbma", domains: ["lbma.org.uk"] },
  { entityId: "wgc", domains: ["gold.org"] },
  { entityId: "sge", domains: ["sge.com.cn"] },
  { entityId: "iea", domains: ["iea.org"] },
  { entityId: "opec", domains: ["opec.org"] },
  { entityId: "usgs", domains: ["usgs.gov"] },
];

/** 原文里的这些写法也算提到了对应主体。 */
export const IDENTITY_CONTEXT_ALIASES: ReadonlyArray<{ entityId: string; pattern: RegExp }> = [
  { entityId: "fed", pattern: /\bFOMC\b|联邦公开市场委员会/i },
  { entityId: "cftc", pattern: /\bCOT\b|持仓报告|管理基金|投机者|套保者|商业套保者/i },
  { entityId: "ecb", pattern: /\bECB\b|欧洲央行行长/i },
  { entityId: "pboc", pattern: /\bLPR\b|贷款市场报价利率|MLF|逆回购/i },
  { entityId: "eia", pattern: /\bEIA\b|原油库存|汽油库存|馏分油库存/i },
  { entityId: "bls", pattern: /\bNFP\b|非农|失业率|平均时薪/i },
  { entityId: "opec", pattern: /\bOPEC\+\b|OPECPlus|欧佩克+|减产|增产/i },
  { entityId: "sge", pattern: /Au\(T\+D\)|mAu\(T\+D\)|黄金延期|白银延期|延期合约/i },
  { entityId: "wgc", pattern: /黄金需求趋势|央行购金|ETF持仓|金饰消费/i },
];
