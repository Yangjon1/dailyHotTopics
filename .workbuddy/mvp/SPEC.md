# Spec - 金属与宏观 Metals & Macro v1.0.0

> 生成日期：2026-10-05
> 基于：PRD v1.0（`.workbuddy/mvp/01-pmd.md`）+ 架构文档 v1.0（`.workbuddy/mvp/02-architect.md`）+ UIUX 文档 v1.0（`.workbuddy/mvp/03-design.md`）
> 状态：**已确认**（用户于2026-10-05 确认三文档与站名/Jina/行情快照三项决策）
> 上游框架：github.com/KKKKhazix/AIHOT · MIT License

---

## 1. 产品定义

- **一句话描述**：从央行、交易所、统计机构与财经媒体采集贵金属、大宗商品与股债领域的消息，用模型筛选、归组、算热度，每天出一份可读懂的日报。
- **目标用户**：三类核心用户——①**交易/配置决策者**（每天要知道「昨天发生了什么、为什么金价这么动」，是本站的 A 类用户）②**研究型从业者**（需要 CFTC 持仓、官方统计的原始数字与中文解读）③**财经内容创作者**（需要可溯源的一手材料）
- **核心问题**：现有财经资讯站（金十、华尔街见闻、东方财富）都是**纯时间流**，同一事件反复刷屏、不归组、不解释「为什么重要」；专业财经媒体（财新、FT）有解释但有付费墙且日均 1-2 篇。**没有一个站把「同一件事的多篇报道归成一个事件 + 官方数字翻译成中文 + 按影响排序」串起来。**

### 1.1 三条差异化（对打竞品）

| 差异化 | 对打谁 | 框架能力 |
|---|---|---|
| **事件归组** | 金十、华尔街见闻（纯时间流） | `packages/backend/src/events/` 现成，零开发 |
| **一手优先 + 可溯源** | 财新（付费墙）、Trading Economics（无叙事） | `tier` 分级 + 代表报道选择 |
| **影响链条显式化**（品种 + 方向 + 时间尺度） | 全部竞品 | 靠 `structure.md` 抽取 + `ITEM_TYPES` 加 `official_data` |

**已发现的空白**：全网没有中文站做「CFTC 持仓数字 → 中文解读」；跨资产联动（美联储→金银→原油）无中文站串联；**「今天清淡」本身就是决策信息**，但金十和 Trading Economics 都不给。

---

## 2. MVP 范围（锁定——不在此列表的功能一律不做）

| 优先级 | 功能 | 验收标准摘要 | RICE |
|---|---|---|---|
| P0 | F3 分类体系 | 6 个分类上线，筛选栏/URL/RSS/MCP 全部对齐 | 20 |
| P0 | F2 事件归组 | 同一事件的多篇报道聚成一个事件页，有综述、可溯源 | 12 |
| P0 | F1 T1 官方源精选 | ≥6 个免key T1 源稳定入库，CFTC 持仓能出中文解读 | 9 |
| P0 | F6 每日价格快照 | 5 个品种（XAU/XAG/XPT/XPD/HG）每日快照入库，首页行情带可显示 | 8 |
| P0 | F5 答案先行摘要 + 术语解释 | 摘要含具体数字与术语白话解释，合规转述到位 | 5.4 |
| P0 | **合规四道防线** | 摘要/综述/推荐理由零投资建议、零目标价 | 阻塞项 |
| P1 | F4 影响链条抽取 | 事件页显式标注「品种 + 方向 + 时间尺度」 | 4.2 |
| P1 | F7 热点榜 | 按事件算热度，涨得快的标上升 | 4 |
| P2 | F8 周报 / 月报 | 从日报汇编，模型只写总述与导读 | 2 |

**F6 是本轮新增的 P0**（用户确认「做：每日价格快照」）。原因：V1 已闭环，CFTC 走external 通道时价格快照可复用同一条通道，边际成本仅 +0.2 人日；而没有它，A 类用户会觉得「说了等于没说」。

---

## 3. 明确不做（Out-of-Scope — 锁定）

| 不做的功能 | 原因 | 何时考虑 |
|---|---|---|
| **交易建议 / 目标价 / 仓位建议** | **合规红线**：证券投资顾问业务管理办法。且模型会在「推荐理由」里不自觉转述成建议 → 已在四道防线拦住 | 永不 |
| **价格看板 / K线图 / 实时行情** | 做不过 Wind / TradingView，且价格是最高频噪声源。本站的行情带只做「每日快照 + sparkline」，不做日内行情 | v3.0+ |
| **公众号聚合** | 需极致了（Dajiala）key，按次计费；MVP 零付费 | 用户量稳定后 |
| **用户注册 / 订阅 / 收藏同步** | 匿名只读是框架既定规则；收藏已存在浏览器本地 | 有明确需求后 |
| **农产品** | 已写进 `prefilter.md` 的 BLOCK 规则 | 永不 |
| **个股** | 股债只到利率/汇率/指数层。个股是另一个产品（且合规风险量级完全不同） | 永不 |
| **加密货币** | 框架无相关设计，信源可得性未验证 | v3.0+ |
| **Jina 付费渲染通道** | 用户确认 MVP 不启用。代价：上线初期无国内一手源（SGE/央行全不可达） | 提示词稳定后 |
| **X（Twitter）信源** | 需 SocialData key，按次计费 | v2.0+ |
| **多租户 / SaaS** | 单站，无此需求 | 永不 |

---

## 4. 技术架构（锁定 — 含版本锚定）

> 版本号从 `package.json` 实读，非记忆。Node 版本是**硬阻断**，见 §4.1。

### 4.1 运行环境（Windows 本机，重大偏离已记录 ADR-001）

| 项 | 要求 | 本机实际 | 处置 |
|---|---|---|---|
| **Node.js** | **≥ 24.11**（`package.json` engines） | PATH 首位 **v22.22.2** [NG] | **必须 `export PATH="/d/nodejs:$PATH"`**（该机 v25.8.0 [OK]） |
| PostgreSQL | 16 或 17 | 无原生安装 | Docker Desktop 跑 `postgres:17-alpine` |
| Docker Desktop | 需手动启动 | `com.docker.service=Stopped` | **用户手动启动**（阻塞 V4 验收） |
| 模型 | OpenAI 兼容 | DeepSeek | 需另配 embedding（见下） |

**Windows 兼容性已验证**：`packages/` 下 `process.platform`、`sh -c`、`execSync`、`/var/run`、`path.join('/')` **全部零命中**。框架无 Linux 硬编码。`docs/deploy.md:216` 的WSL2 提示是官方测试矩阵边界，非代码限制。

**Node 版本阻断的隐蔽性**（必须写进 Spec 防止复发）：`npm run dev:api` 用的 `--env-file-if-exists` 在 22.22 上能跑，**所以日常开发不受影响**；但 `npm test` 用的 `--test-global-setup` 在 22.22 上直接 `bad option` 失败，**且报错信息与真实原因毫无关联**。

### 4.2 技术栈锁定

| 层 | 技术 | 版本 | 锁定原因 |
|---|---|---|---|
| 运行时 | Node.js | **25.8.0**（该机 `D:\nodejs`） | 满足 engines ≥24.11 且支持 `--test-global-setup` |
| 语言 | TypeScript | 7.0.2 | 原生类型剥离，无构建步骤 |
| 前端 | React Router（SSR） | 8.4.0 | 框架既定 |
| 前端构建 | Vite | 8.3.1 | 框架既定 |
| 样式 | Tailwind CSS | 4.3.3 | 框架既定，token 走 `@theme` |
| 后端 | Fastify | 5.12.5 | 框架既定 |
| 校验 | Zod | 4.6.5 | 框架既定 |
| 队列 | pg-boss | 12.34.0 | 纯 Postgres 队列，无 Windows 差异 |
| DB 驱动 | pg | 3.4.9 | 框架既定 |
| 图像 | sharp | 0.35.4 | 分享图；有 Windows 预编译包 |
| 数据库 | PostgreSQL | 17-alpine | 框架既定 |
| **图标** | **lucide-react** | **0.544.0** | **全站唯一图标库，不混用**（ADR-004） |
| 数字字体 | Roboto Mono / Roboto Condensed | CDN 或自托管 | 行情表对齐必需，设计师指定 |
| **Embedding** | **DashScope `text-embedding-v4`**（1024 维） | - | **DeepSeek 无 `/embeddings` 端点**（ADR-003） |
| LLM | DeepSeek | `deepseek-v4-flash` | 单模型分层（ADR-005） |
| 部署 | Docker Desktop（仅 PG） + 本机三进程 | - | Windows 唯一可行路径（ADR-001） |

### 4.3 Embedding 是硬需求，不是优化项

**DeepSeek 官方 OpenAI 兼容面只有 `/chat/completions`，无 `/embeddings`**（已联网核实）。若不另配供应商：

- `embeddingsAvailable()` 返回 false，聚簇降级为**字符 bigram 文字重合度**（`relate.ts:194`，阈值 `LEXICAL_MIN=0.25`）
- 对金融术语是最差用例：「缩表」vs「资产负债表缩量」、「COMEX 保证金」vs「纽约商品交易所保证金」**全漏召回**
- 漏召回 → 来源数不足 → `MIN_PARTICIPANTS=2` 不满足 → **真事件进不了热点榜**

**成本**：约¥1.5/月。**不部署本地向量库**：框架向量存储是 Postgres `real[]` + JS 侧 `cosine32`（`recall.ts:113-123`），不是 pgvector，10 万条以下 `Float32Array` 点积够用。

**两个内嵌坑**：
1. `EMBEDDING_DIMS` 变更会让所有存量向量作废重算，**上线后禁止改**
2. `MODEL_CALLS_ENABLED=false` 会**连带关掉 embedding**（`embeddings.ts:20`），聚簇静默降级**且不报错**

### 4.4 图标系统（P0-1 规则落地）

- **唯一库**：`lucide-react`，全项目统一，禁止混用
- **尺寸**：16px（行内）/ 20px（按钮内）/ 24px（独立），三级
- **stroke-width 例外规则（唯一例外，不得出现第四个值）**：16px→1.5、20px→1.7、24px→1.75
- **颜色**：一律 `currentColor` 继承，不传 color prop
- **无障碍**：装饰性 `aria-hidden`；纯图标按钮**必须** `aria-label` + 44×44px 点击区
- **迁移方式**：现有 `apps/web/app/components/icons.tsx` 的 **43 个** `export const Icon*`（实测 68 行、仅 3 处内联 svg）已是Feather 规格（24 viewBox / currentColor / round cap / strokeWidth 1.7），**保留导出名**（`export const IconSearch = Search`），91 个 tsx 的 import 一行不用改
- **删除**：`IconSparkles`（AI 味，本站无生成式功能）
- **禁止**：任何 emoji 作为功能图标

---

## 5. API 端点清单（锁定）

> **本项目不新增任何公开 API 端点**。框架既有的网页/RSS/API v1/MCP 全部沿用，只改内容不改形状。

| Method | Path | 状态 | 说明 |
|---|---|---|---|
| GET | `/` | 沿用 | 首页，**新增行情带区块** |
| GET | `/all` | 沿用 | 全部动态，6 分类筛选 |
| GET | `/hot` | 沿用 | 热点榜，**改为可排序榜单表** |
| GET | `/topics` `/topic/:slug` | 沿用 | 主题页（品种/机构/形态） |
| GET | `/daily` `/weekly` `/monthly` | 沿用 | 报告页 |
| GET | `/item/:id` `/story/:id` | 沿用 | 条目页 / 事件页 |
| GET | `/feed.xml` 等 6 个 | 沿用 | RSS |
| GET | `/api/v1/*` | 沿用 | 公开 API，OpenAPI 3.0 在 `/openapi-v1.json` |
| GET | `/api/mcp` | 沿用 | MCP，`mcpPrefix: "metalsmacro"` |
| GET | `/llms.txt` `/sitemap.xml` `/robots.txt` | 沿用 | 占位符替换 |
| POST | `/admin/*` | 沿用 | 后台 |
| **POST** | **`/api/ingest/items`** | **沿用** | **每日价格快照走这条external 通道** |

**新增的只有内部数据，不新增出口**：

| 名称 | 形态 | 说明 |
|---|---|---|
| `scripts/price-snapshot.ts` | 本机定时脚本 | 抓 `api.gold-api.com` 5 个品种 → 组装成 1-5 条 `{title, url, publishedAt, raw}` → `POST /api/ingest/items` |
| 快照数据 | 存`articles` 表（`participation_mode: isolated` 或独立 source） | 供首页行情带读取，**不进精选/日报** |

**快照条目主键**（关键设计）：`url` 用 `https://snapshot.metalsmacro.local/{symbol}/{yyyy-mm-dd}`，让每日快照天然是不同文章，且满足「旧文不刷屏」。**`urlTemplate` 里绝不能放时间戳/token**（`identityKeyForUrl` 规范化后每次都不同 → 无限增长 + 每次全管道重跑）。

---

## 6. 数据库表清单（锁定）

**本项目不新增数据库表。** 沿用框架 `database/migrations/` 的 57 个迁移。

快照数据落在既有 `articles` 表，字段映射：

| articles 字段 | 快照条目取值 |
|---|---|
| `identity_key` | `url:https://snapshot.metalsmacro.local/{symbol}/{date}` |
| `url` |同上 |
| `title` | `黄金 XAU 快照 2026-10-05` |
| `raw`（JSONB） | `{symbol, name, price, updatedAt, source: "gold-api"}` |
| `published_at` | `updatedAt`（ISO，有真实时间戳，不会触发 48h 窗口） |
| `backfill_reason` | null（每日新日期，不会被判stale） |
| source 的 `participation_mode` | `isolated`（**不进公开列表/精选/日报**，只供行情带读取） |

**为什么用 `isolated` 而不是 `editorial`**：行情快照是数据不是新闻，进了精选会让日报出现「黄金快照」这种无信息量条目。

---

## 7. 页面清单（锁定）

| 页面 | 路由 | 本项目改造 | 对应 API | Token 主题 |
|---|---|---|---|---|
| 首页 | `/` | **新增置顶行情带**（无框通栏、横向滚动、品种码/最新价/涨跌幅/60px sparkline）；下方事件流密度提升 | `/api/site/*` | 浅色 + 行情带 |
| 全部动态 | `/all` | 6 分类筛选 + 13 品种标签筛选 | 同上 | 浅色 |
| 热点榜 | `/hot` | **改为可排序榜单表**（行高 32px、sticky 表头、密度 3→7）；**移除参与者头像**（本站无社区） | 同上 | 浅色 |
| 事件页 | `/story/:id` | **新增影响链条区块**（品种+方向+时间尺度）；左栏 `QuotePanel`（每屏≤1）| 同上 | 浅色 |
| 条目页 | `/item/:id` | 关联品种的 `ReferenceTable` | 同上 | 浅色 |
| 日报 | `/daily` | **刊头 50→44px、正文 17→15px**；移除 24px `font-black` 负字距日期 | 同上 | 浅色 |
| 周报/月报 | `/weekly` `/monthly` | 同日报密度调整 | 同上 | 浅色 |
| 主题页 | `/topics` | 品种主题（13 个）+ 机构主题 + 形态主题 | 同上 | 浅色 |
| 关于页 | `/about` | 文案按站名改写 | 同上 | 浅色 |
| 接入页 | `/agent` | `mcpPrefix` 换新 | 同上 | 浅色 |

**降级预案（Phase 3 定案，推翻初稿）**：若行情快照链路不可用，**首页行情带整块不渲染**，首页其余部分完全正常。**不得降级为 `ReferenceTable`**（理由见 §9.6：两者语义不同源，替换等于让该模块承诺一件它不再是的东西）。

**端点契约（前端已按此实现，字段名一字不改）**：

```ts
GET /api/site/quotes
{ quotes: [{ symbol, price, updatedAt, changePct, basis, basisAt }], computedAt }
basis: "yesterday" | "lastSnapshot" | "none"
```

`basis` 把「有基准 / 降级基准 / 无基准」显式传给前端，**前端不必自己猜**。端点 404/500 时前端静默整块不渲染，首页其余部分不受影响。

---

## 8. 设计 Token（锁定）

> 产出物：`.workbuddy/mvp/design-system/design-tokens.json`（已产出并校验可解析）+ `MASTER.md`。Phase 3 时落到 `apps/web/app/app.css`。

### 8.1 改造方式：**新增 + 改值，不重命名**

**`@theme` 的 `--color-*→ var(--*)` 转发层必须保留**（91 个 tsx 依赖）。

| Token | 位置 | 改动 |
|---|---|---|
| `--font-sans` | `app.css:19` | **只改值不改名**。`system-ui, ...` → Roboto / Roboto Condensed / Roboto Mono + 保留中文系统栈 |
| `--bg` | `app.css:91` | `#faf9f6`（暖纸）→ **`#F7F8F9`**（冷中性灰白）。暖纸底把红推向橙，与警示色/金色产生语义歧义 |
| `--hot` | `app.css:113` | `#b3402a` **保留但语义收窄**为「热度/爆」。**禁止当涨色** |
| `--ok` | `app.css:118` | `#2f7d5c` **保留但语义收窄**为「操作成功」。**禁止当跌色** |
| 深色对应 | `app.css:171/176` | 同上处理 |
| `--accent` | - | **`#176B75` 青，沿用 AIHOT 原值**（与涨跌色正交） |

### 8.2 新增 6 个语义色（WCAG 已核算，浅色主题）

| Token | 值 | 对比度 | 用途 |
|---|---|---|---|
| `--up` | `#C0362C` 深砖红 | 5.19:1 过 AA | 涨 |
| `--up-strong` | `#A32A20` | 7.0:1 | ≥20px 大号数值 |
| `--down` | `#14804F` 深翡翠绿 | 4.67:1 过 AA | 跌 |
| `--down-strong` | `#0F6840` | 7.4:1 | ≥20px |
| `--flat` | `#59656B` 灰 | 5.64:1 | **平盘一律用灰，绝不用红绿** |
| `--warn` | `#8A5E12` 深铜棕 | 5.35:1 | 警示，12px 可用 |
| `--alert` | `#B3261E` | 6.2:1 | 极端，**每屏 ≤1** |
| `--metal-gold` | `#B8860B` | 2.9:1 | **仅图形，禁止文字色** |

**三个被明确否决的色值**（记下来防止后人「优化」回去）：
- 涨红不用 `#E74C3C`：3.8:1 不合格，且是警报橙红，与警示撞语义
- 跌绿不用 `#27AE60`：**2.4:1 完全不合格**，且像「操作成功」
- 警示不用 `#EAB308`：**1.9:1 完全不可用**（这是最常见错误——直接拿 Tailwind yellow-500 当警告色）

### 8.3 金色的使用边界（本站特有风险）

`#FFD700` 在白底仅 **1.4:1** 对比度，且**语义致命**——本站的数据对象就是黄金，界面骨架若是金色的，读者无法区分「金色=品牌」还是「金色=黄金这个品种」。

**金色只允许出现在两处**：① 图表里黄金那条曲线 ② 贵金属分类标签的 1px 规则线。
**永不作为**：按钮底色/ 链接色 / 卡片边框 / 页面背景。
金属感靠质感（1px 发丝线、等宽数字、极轻阴影）而非颜色。

### 8.4 数字排版规范（P0，不依赖行情快照）

**即使没有价格快照，摘要和正文里数字也大量存在**（「金价涨 1.2%」「持仓增加 6344 手」），这些数字现在就没有对齐规范。所以以下规则无条件落地：

- 一切价格、涨跌幅、成交量、日期数字：**`--font-num` + `tabular-nums` + 右对齐**（强制项）
- **三重编码**：颜色 + 显式正负号 + 方向箭头。**不能只靠颜色**（WCAG 1.4.1，色弱用户靠符号读）
- 正数带 `+`、负数带 `-`、**零值显示 `—`**（em dash）
- **单位进列名不进单元格**（单位重复在每行会形成竖向噪音带，是财经表格最大可读性杀手）
- 同列小数位固定：黄金 2 / 白银 3 / 涨跌幅统一 2
- 平盘一律灰

**数据块不用卡片**（DENSITY 7硬规则）。四种形态：`QuoteTile`（无框，`divide-x` 分格）/ `QuotePanel`（有框，**每屏 ≤1**）/ `DataStat`（无框）/ `QuoteTable`（Kitco 式多周期表）。

**表格五条铁律**：无竖线、无斑马纹、sticky 表头 `top: var(--bar-h)`、hover 只改背景色不改边框（否则相邻行 1px 抖动）、首列 `sticky left: 0`。

### 8.5 保留不动的 10 项地基

语义 token 命名法与 `@theme` 转发层 · 六级圆角 · 极轻阴影 · `.num`/`.chip`/`.well`/`.card` 工具类 · `prefers-reduced-motion` 完整降级 · view-transition 页面转场 · **`.prose` 长文排版（17-18px/1.8/每行 42 中文字，行业最优级资产）** · `Delta` + `Sparkline` 组件 · 自定义断点（`lg` 是 961px 不是 1024px，**别动**） · 236px 侧栏 + safe-area 处理。

**三轴刻度**：VARIANCE 4（不变）/ MOTION 5→**3**（取消 `anim-bump`、`anim-pop-in` 弹跳）/ DENSITY 4→**7**（新增 `--row-h-data:32px`，列表行 16→12px，卡片 `p-5 sm:p-6`→`p-4`）。

**图表库约束（P0-2）**：**不得引入带紫红渐变默认主题的图表库**（ECharts 默认主题直接触犯紫粉渐变红线）。sparkline 复用 `features/hot/Sparkline`；需真图表用 uPlot 或原生 SVG path。

---

## 9. 行业配置（锁定）

> [!] **本章节小节号在 Phase 2 收尾期间仍在变动**，引用前请先 `grep "^### 9\." .workbuddy/mvp/SPEC.md` 确认。

### 9.1 每日价格快照的完整设计（Phase 2 锁定）

### 9.2 框架已保证的（两条独立过滤路径，见 §9.3.1）

| 机制 | 位置 | 结论 |
|---|---|---|
| `isolated` 源文章**连详情页都没有** | `publication/rules.ts:33-34` 的 `hasItemPage` 要求 `sourceMode === "editorial"` | `/items/:id` 直接 404 |
| `isolated` 强制 `visibility = "withdrawn"` | `publication/publish.ts:277`，注释原文：「Material from an isolated source reaches no public surface at all: not even a detail page」 | 时间线/RSS/API 全部要求 `visibility='public'` |

**所以 `/all` 不显示快照是框架保证的，零成本，不需要做任何事。**

### 9.3 每日快照的 `recordSignal` 时间戳影响（Phase 3 实测收敛，**降为可选 P2**）

**机制**：`events/group.ts:298` 的 `a.participation_mode !== "editorial"` 时走 `groupSignal()`，最终 `group.ts:563` 调 `recordSignal(..., "signal", observedAt)`，其中 `group.ts:125` 会 `UPDATE stories SET latest_at = ...`。每日快照参与 embedding 召回时会给「黄金相关事件」**按日续命**。

**但实测收敛了后果 —— 最终净后果只有一处**（经三轮交叉复核，设计侧两次自我修正）：

**关键区分：`EXISTS(...)` 作用在 `WHERE` 上，被过滤掉的 story 压根进不了 `ORDER BY` 和取值。**所以「有 `evidenceCondition()` 过滤」不等于「取值安全」——要看**读的是列值还是重算值**。

| 位置 | 过滤链| 排序 / 取值 | 快照能否影响 |
|---|---|---|---|
| **徽章** `stories.ts:161` | — | `text.latest ?? latestReport`，**从可见证据重算** | [NG] 安全（`stories.latest_at` 被绕过） |
| **首页/全部动态/分类页** | — | `timeline.ts:62-63` 锚点是 `min(sort_at)`，来自 `publications` 表 | [NG] 不按 `stories.latest_at` |
| **热榜** `hot.ts:185-186` | 双门槛（`participants >= 2` 且 `editorial_participants >= 1`）已挡掉纯快照事件 | `latest_at` 只是 `heat` **完全相等时**的第二排序键 | [NG] 影响极小 |
| **sitemap `lastmod`** `sitemap.ts:55-61` | `WHERE ... EXISTS(evidenceCondition() AND listedCondition)`。**`evidenceCondition()` 本身不含 participation_mode**（只有 `fa.role <> 'mention' AND NOT compositeCondition()`），挡住 isolated 的是 `listedCondition()` 的 `visibility='public'` + `eligible` | 对**已通过过滤的** story 取 `lastmod: s.latest_at` | [OK] **成立**（见下方前提） |
| **`relatedStories` 次级排序** `stories.ts:130-136` | 同上 | `ORDER BY st.latest_at DESC` **直读列值** | [OK] **成立** |

**sitemap `lastmod` 成立的关键前提**（这条是三种误判的分水岭）：

`recallPool()`（`recall.ts:46-56`）的召回池只收 `fa.role IN ('primary','report')` 且 `JOIN articles`，也就是**只含已分析的真实报道**。`groupSignal` 只在 embedding 召回命中时写 `story_signals`（`group.ts:543`）。

**所以「只有 isolated 证据的 story」不存在** —— 没有 editorial 事实的 story 压根无法被召回，快照挂不上去。

真实场景是：**story 本身有真实报道（真实 `latest_at`）+ 快照每天把它改写成今天→ `lastmod` 就写今天。失真成立。**

**净后果：sitemap `lastmod`（SEO 层）+ `relatedStories` 次级排序，两处均无读者可见的内容失真**（读者看到的报道内容本身没错）。

## 9.3.0[!] 判断「某字段会被某出口消费」的三处核对纪律

本项三人各犯过一次同型误判，共同根因是**只看了名字与局部，没追到数据的实际来源与完整过滤链**：

| 人 | 误判 | 根因 |
|---|---|---|
| 设计侧 | 「旧事件在最新列表置顶」 | 只看字段被读，没追排序键实际是 `sort_at` |
| 架构侧 | 「徽章永远停在持续更新」 | 只看参数名 `latestAt`，没追它来自可见证据重算 |
| 项目侧 | 「sitemap 不失真，因 evidenceCondition 含 participation_mode」 | 只读 SQL 时看了 `ORDER BY`，没读 `WHERE` 的两层 |

**纪律**：任何「某字段会被某出口消费」的判断，**必须同时核对三处** ——① 排序键实际读什么 ② `WHERE` 的完整过滤链（逐层展开，不要假设某个函数含什么条件） ③ `JOIN` 的来源表决定了「什么样的行才存在」。

**推论**：不能假设「story 只有快照证据」—— 必须先确认「有没有 editorial 事实的 story 能否存在」。

### 9.3.1 隔离是两条独立过滤路径，不是一道门

[!] 验证「某条件能否挡住 isolated」时，**必须先确认「存在满足全部其他条件的样本」**。本项最隐蔽的误判就来自漏掉这步：假设了「只有 isolated 证据的 story」，而这样的 story 压根不存在（`recallPool` 收不到）。

| 路径 | 用在哪 | 靠什么挡 isolated |
|---|---|---|
| `storyReportCondition`（`scope.ts:22-24`） | 事件页报告、徽章入参 | `s.participation_mode = 'editorial'` |
| `evidenceCondition` + `listedCondition` | sitemap、relatedStories | **`p.eligible`**（`isPoolEligible`（`rules.ts:25`）要求 `participationMode === "editorial"`） |

[!] **函数名不要记混**（设计师实测纠正）：

```ts
// scope.ts:22-24  —— 含 participation_mode
export function storyReportCondition(now) {
  return sql`p.visibility = 'public' AND s.participation_mode = 'editorial' AND ${releasedCondition(now)}`;
}

// scope.ts:56-58  —— 不含任何 participation_mode
export function evidenceCondition() {
  return sql`fa.role <> 'mention' AND NOT ${compositeCondition()}`;
}
```

**sitemap 用的是 `evidenceCondition` + `listedCondition`，不是 `storyReportCondition`。** 门的位置标错会让人去错误的行找证据。

[!] **但这仍不能让 sitemap 安全** —— `p.eligible` 只能保证「story 有真实报道」，**保证不了「`latest_at` 没被快照改写」**。这正是失真的成因。

### 9.3.2 [!] 并发锁陷阱：跳过整个 UPDATE 会静默破坏数据

`database/migrations/0002_events_reports.sql:82-90` 的表定义：

```sql
story_idbigint NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
PRIMARY KEY (story_id, article_id)
```

**只有 FK + CASCADE，没有任何「目标 story 未被合并」的约束。** story 被合并后行仍在（只是 `merged_into` 被设），所以插入**完全不报错**。

而 `group.ts:122-127` 的 `UPDATE ... WHERE id = ${storyId} AND merged_into IS NULL` + `if (!updated.count) throw` 是一道**并发合并保护**：

```
跳过整个 UPDATE -> 锁消失 -> 合并期间不再抛错
-> story_signals 静默写到已合并的 story（不报错）
-> currentSignals() 把它算进热度
```

**这比原问题更隐蔽。** 因此：

- [NG] **绝对不能跳过整个 UPDATE**（包括 `touchStory = true` 那种「条件跳过」方案——它一样是跳过整个 UPDATE）
- [OK]唯一正确：**`CASE WHEN` 控制三个时间戳列，UPDATE 语句与 `throw` 一行不动**

**若将来要做，最小正确改法**（**[!] 绝对不能跳整个 UPDATE**）：

实测 `group.ts:122-134` 的 UPDATE 承担**并发合并保护**：

```ts
const updated = await db`UPDATE stories SET ... WHERE id = ${storyId} AND merged_into IS NULL`;
if (!updated.count) throw new Error("Grouping target changed; retry against the current story");
```

`AND merged_into IS NULL` + `if (!updated.count) throw` 是一道锁：story 若在此期间被合并进别的 story，UPDATE 影响 0 行 -> 抛错让调用方重试到合并后的 story，保证 `story_signals` 不会写到已合并的 story 上。

**若为 isolated 跳过整个 UPDATE，这道锁就没了** -> `story_signals` 的 INSERT 会**静默**写到已合并的 story 上（该表对 `story_id` 只有 FK，合并后 story 行仍在，**不报错**），而 `hot.ts:126` 的 `currentSignals()` 会把它算进热度。**这比原问题更隐蔽。**

正确写法（CASE WHEN 控制三个时间戳，UPDATE 与抛错完全保留，`story_signals` 的 INSERT 一行不动）：

```ts
const touch = source.participation_mode !== "isolated";
const updated = await db`UPDATE stories SET
    latest_at       = CASE WHEN ${touch} THEN GREATEST(coalesce(latest_at, ${observedAt}), ${observedAt}) ELSE latest_at END,
    first_report_at = CASE WHEN ${touch} THEN LEAST(coalesce(first_report_at, ${observedAt}), ${observedAt}) ELSE first_report_at END,
    updated_at      = CASE WHEN ${touch} THEN now() ELSE updated_at END
  WHERE id = ${storyId} AND merged_into IS NULL`;
if (!updated.count) throw new Error("Grouping target changed; retry against the current story");
await db`INSERT INTO story_signals (...) ON CONFLICT (story_id, article_id) DO NOTHING`;
```

签名改动：`source` 参数类型加 `participation_mode`（当前 `{ id; signal_group_id; }`）。三个调用点里**只有 `group.ts:563` 需要区分**（`corrections.ts:70` / `group.ts:454` 传 `true`，行为完全不变）。成本 0.3 人日。

### 9.4 涨跌幅基准：自算，口径必须诚实标注

**实测确认** `api.gold-api.com/price/XAU` 只有 `price` 和 `updatedAt`，**无** `previousClose` / `changePct` / `open` / `high` / `low`。

**采纳方案 ①**：查 `articles` 表同 symbol 最近 2 条快照自算。零新增信源、零新表。

- ②（砍掉涨跌幅）**拒绝**：行情带退化成静态数字表，用户没有理由每天回访，首页沦为摆设
- ③（换接口）**拒绝**，已记为升级路径

**关键：口径必须诚实标注。** 我们算的是「今日快照 vs 昨日快照」，**这不是金融意义上的日涨跌幅**（后者以昨收为基准）。标成「日涨幅」懂行的读者会发现口径不对——**这比不显示更糟**。

**定名三态**：

| 状态 | 显示 | 样式 |
|---|---|---|
| 有昨日基准 | `较昨日 +1.24%` | 涨跌色 + 箭头 |
| 昨天漏跑 | `较上次 +1.24%` | 涨跌色 + 箭头 |
| 无基准 | `—` | `--flat` 灰，**不显示箭头** |

**三个边界情况**：
1. 无基准 → `—`，不显示箭头
2. 涨跌幅为 0 → `0.00%` 灰**且不显示箭头**（`±0.00%` 是噪音）
3. **断档 >3 天 → 仍显示但加 14px `--warn` `TriangleAlert` + 标签用「较上次」**。这条最容易漏：5 天前的基准会让涨跌幅被误读成日涨跌

**单位陷阱（实测发现）**：`HG`（铜）是**美元/磅**，而金银铂钯是**美元/盎司**。不标单位的话读者会拿 4 美元的铜和 4100 美元的金比量级。**`QuoteTile` 底部必须有单位行。**

小数位：白银 3 位，其余 2 位。

### 9.5 行情带最终形态

**品种顺序：黄金 → 白银 → 铂金 → 钯金 → 铜**

- [NG] 不按 API 返回顺序（gold-api 无内在顺序，**UI 顺序绝不能依赖外部 API**）
- [NG] 不按纯流动性（若按流动性排「金银铜铂钯」，**贵金属会被铜劈成两半**）
- [OK] **同类连续 > 单项最优。顺序本身就是分类信息**，比在 tile 上加分类标签省像素

**取消 sparkline**（设计师读完架构后改了主意，采纳）：

- V1 每天只有 1 条快照 → 上线第一天必然空、第二天 1 个点
- **每日单点没有趋势可表达**，60px 宽 1-2 个点的折线是视觉噪音的替身
- 省下的 32px 做了两件更实在的事：价格从 13px 放大到 **17px**（价格是这条信息的主体，原稿把价格和涨跌幅设成同号是判断失误）、加单位行
- **升级路径**：积累 ≥14 天后在**事件页** `QuotePanel` 加 7 日 sparkline（单品种有语境，比首页并排 5 条趋势线清楚），**首页保持无**

**`QuoteTile` 规格**：

| 项 | 值 |
|---|---|
| 尺寸 | 116px 宽（手机 104px）×92px 高 |
| 行1 | 品种码 13px mono（交易码 `AU9999`/`XAG`/`HG`，hover 显示中文名） |
| 行2 | **价格 17px** |
| 行3 | 涨跌幅 13px |
| 行4 | 单位 11px |
| 容器 | `gap:0` + `border-block` 上下 1px + 格间 1px 竖线 |
| 圆角阴影 | **0 圆角 0 阴影**（圆角会让相邻格出现破口） |

**「数据截至 HH:mm」固定在下沿右端**。超 6 小时或失败 → `--warn` + `TriangleAlert`。

[!] **这条不能省**：行情数据过期而不说，读者会拿旧价格做判断，**这是信任问题不是设计问题**。

### 9.6 ReferenceTable 形态（Phase 3 设计侧补齐）

**重要：首页行情带永不降级成 ReferenceTable**（设计侧裁决，推翻本节初稿）。

理由：两者语义不同源 —— 行情带是**固定的 5 个品种**（数据源驱动），ReferenceTable 是**从单个事件推导的品种集**（内容驱动）。首页把行情带换成它，等于让该模块**承诺一件它不再是的东西**：读者昨天看到 5 个品种价格，今天看到 3 个事件关联品种，会以为品种变了。**宁可整带显示错误并隐藏，不做形态切换。**

**形态规格**：

| 项 | 值 |
|---|---|
| 位置 | **仅事件页**（ 左栏）。**绝不替代首页行情带** |
| 容器 | 无边框，仅  |
| 行高 | **44px**（触摸目标下限） |
| 品种码列 | **定宽 52px**（不定宽会破坏 tabular-nums 纵向对齐） |
| 行内容 | 品种码 / 中文名 / N 条相关事件 |
| 底部说明 | **不可省** ——「近 24 小时无该品种的价格快照」。缺价格列的表看起来像 bug，这句话把「没有价格」从故障变成事实 |
| 品种为 0 时 | 整块不渲染 |
| 切换 | 无动画 |

**诚实性规则**： 的  必须是**站内真实关联事件数**。**若后端给不出，宁可不渲染这一列，不可渲染 0**（与「unit 必须进 raw」同原则：**宁可缺字段，不可错字段**）。

> 前端当前把  硬编码为 0（），**会让每行显示「0 条相关事件」，比留空更糟**。后端接口就位前应不渲染该列。

### 9.7 脚本实现的两条硬约束（Phase 3 必守）

1. **快照 `title` 不能含价格**。`title` 参与 `content_hash`，价格每日变 → `reviseMaterial()` → **整条管道重跑**（浪费 5-6 次调用/条）。
   - 正确格式：**`[XAU] 黄金价格快照 · 2026-10-05`**（只有日期变）
   - 价格/涨跌幅/`updatedAt` **全部只进 `raw`**
2. **13 个品种标签里不要给快照留位置**。否则 `/all` 的筛选会出现一个永远为空的选项——那是空状态设计失误。**快照不是新闻标签，不进 taxonomy。**

### 9.8 字体交付：`font-display: block`（不是 swap，反直觉但正确）

**采纳自托管**（本机 `C:/Windows/Fonts` 无 Roboto；Node 侧有完整字体文件可复制到 `public/fonts/`）。

**但 `font-display` 必须用 `block`，不能用 `swap`**：

- `swap` 会先按系统字（Segoe UI **比例数字**）渲染，再跳成 Roboto（**等宽数字**）
- **行情表列宽会闪一下然后重排** —— 这正是我们花大力气用 `tabular-nums` 要避免的事
- 本地 30-40KB 是毫秒级，`block` 期间用户看到**空白而非错位数字**，3s 超时不会触发
- **「等一下」比「看到错的数字然后跳一下」好得多**
- [!] **给前端一句提醒：不要「顺手改成 swap」**

**另三项优化**：只托管 3 个文件（不托管 500/700，中文只用 400/700）｜只 preload `Roboto-400`（服务正文和所有数字）｜**中文不打包 webfont**。

### 9.9 Windows 字体三条实测事实

1. **雅黑只有 400/700**，`510`/`590` 会被**合成**（伪粗发虚）→ **中文禁止中间字重**。中文正文 400、标题 700，中间字重只给 `.num`/`.mono`/`code` —— **需要在 CSS 上显式隔离，不靠运气**
2. 雅黑**拉丁部分字面偏小**，与 Roboto 混排会显得中文比数字大一号。这是中英混排固有现象**不是 bug**，缓解办法：含数字的行不单独放大字号（价格 17px、单位行 11px，**靠位置区分大小**）
3. `.mono` 的 `0.92em` 缩放对 Roboto Mono 依然必要，换字体后要在 Windows 上**重新目测**

### 9.10 一个已更正的色值

`--metal-gold #B8860B` 在 `#F7F8F9` 上实测 **3.06:1**（设计师原稿写 2.9:1，保守误判）。

**它实际满足 WCAG 1.4.11 非文本 3:1，可用于图形。** 但「仅图形、禁文字」这条纪律不变——**理由从「勉强不达标」变成「达标但不够文字标准」，纪律本身反而更有说服力。**

### 9.11 快照相关 Token（`design-tokens.json` 已更新到 24 个顶层键）

新增 `snapshot` 与 `fontDelivery` 两组。P0 复检：emoji 0 / 紫粉渐变 0 / 弹跳缓动 0。

### 9.12 V2 决策：热点榜保持 10 条（已裁决）

新增 `snapshot` 与 `fontDelivery` 两组。P0 复检：emoji 0 / 紫粉渐变 0 / 弹跳缓动 0。



**架构师自我更正**：他上一轮建议的「10 是爆仓保护、是设计容量、可以调大」**是错的**，我已实测推翻：

```ts
// packages/backend/src/events/hot.ts:190
if (entries.length >= 10) break;   // 在 break 上，不是 LIMIT
// packages/backend/src/publication/hot.ts:23 / :115-117
ranking.entries.slice(0, 5)          // 首页/日报取 5 条
ranking.entries.length < 3           // 少于 3 条不展示
// apps/api/src/routes/v1.ts:21
hotTopics: op([], ...)               // queryKeys 为空数组，公开 API 不接受任何查询参数
```

**真正的语义**：10 是**爆仓保护**（热搜词不够 10 个时回落 `recentFallback`），**不是设计容量**。改成 20 会让补齐逻辑失效。

**实测数据**（8 次抓取 / 156 候选 / 最高单日 45个）：top 10 覆盖率 40%–89%，均值 **66%**。

**决策：采纳方案 A（保持 10 条）作为 MVP。**

- [NG] 不采纳「扩到 20-30」：现阶段纯增加块状元素、稀释热点位、抬高数字幻觉风险，**零读者价值**
- [NG] 不采纳「新增 `site.ts.HOT_LIMIT` 旋钮」：`site.ts` 现无此字段，新增量是「只属于这个站的定制字段」，按框架方向应进 `site.ts` 而非框架包，但为 MVP 加一个永不调整的旋钮是过度设计
- 记入 OPEN-DECISIONS，**用真实运行数据决策而非预先扩**

**分类够不够分的判据（不用猜）**：若MVP 运行期间观察到「top 10 里超过 5 条属于同一分类」，那才是分类不够分的真实信号，届时按数据决定是否扩到 20。**不预先扩是本项目的成本纪律。**

**决策：热榜保持热度驱动的自然排序，不做「6 分类平分」。** 热榜语义是「大家在讨论什么」——强行让每类占1-2 条会把「央行意外降息」这种压倒性热点稀释掉。分类筛选在 `/all` 页已提供。

### 9.13 涨跌幅的显示约束（不改代码版）

架构师建议「3 条半则全量 / 5 条才展示」——**方向对，但本项目不采纳改代码版**：

- 改 `slice(0,5)` / `<3` 会改动 `publication/` 的**公开行为**，`tests/architecture.test.ts` 会卡，且违反 Spec §5「不新增公开 API 端点、只改内容不改形状」
- **采纳等效的零代码方案**：无涨跌幅（无昨收锚点）时**隐藏涨跌幅列**，不改`slice` 逻辑。视觉效果相同，零代码改动、零测试影响

**AC-19 修正**：`AC-19` 原文写的是热点榜数量上限，**与聚簇无关，是写错了**。聚簇相关的验收标准是AC-05/AC-06（事件归组正例/负例）。已在本节更正语义。



| 字段 | 值 |
|---|---|
| `SITE.name` | `金属与宏观` |
| `SITE.subject` | `金属与宏观`（影响「XX日报」拼法，PM 已确认） |
| `SITE.homeTitle` | `金属与宏观 — 贵金属、大宗与股债每日精选与日报` |
| `SITE.description` | 从一批央行、交易所、统计机构与财经媒体采集贵金属、大宗商品与股债领域的消息，归组成事件、算热度，每天早上出一份日报。 |
| `SITE.mcpPrefix` | **`metalsmacro`**（工具名如 `metalsmacro_get_latest`，**接入后不可改**） |
| `SITE.interfaceVersion` | `4.0.0`（沿用，未改接口形状） |
| `SITE.crawlerName` | `MetalsMacroBot/1.0`（**不得冒用 AIHOT**） |
| `SITE.footerNote` | `null`（删掉「由 AIHOT 开源框架驱动」；或改为中性署名） |
| `EDITION_TIMES` | `{ daily: "08:00", weekly: "10:00", monthly: "10:30" }`（沿用默认值） |
| `REPORTS.entry` | `{ measure: "条", noun: "动态" }`（不用「件大事」——金融语境不适用） |

**报头三态逻辑（PM 提出，采纳为硬要求）**：

| 采集状态 | 报头显示 |
|---|---|
| 全部成功且 N>0 | `今日要盯的官方发布 N 项` |
| 全部成功且 N=0 | `今日无官方级发布，可轻仓观望`（**不能只写「0 项」**，那看起来像站点故障） |
| **部分官方源失败** | **`部分官方源未成功采集`** + 仍显示已采到的 N 项 |

第三种是最坏情况的反面：**绝不能用采集失败伪装成「今天没事」**。

### 9.14 `industry/taxonomy.ts` — CATEGORIES（6 个，key 上线后不可改）

| key | label | section | guide（≤30 字，已压缩） |
|---|---|---|---|
| `precious-metals` | 贵金属 | 贵金属 | 金银铂钯及其供需、央行购金、ETF持仓；工业需求也归此类（28 字） |
| `industrial-commodities` | 大宗商品 | 大宗商品 | 铜铝镍锡铅与原油天然气；不含农产品与个股（20 字） |
| `macro` | 宏观货币 | 宏观货币 | 央行政策、通胀就业、美元汇率、实际利率、美债与地缘传导（27 字） |
| `equity-bond` | 股债市场 | 股债市场 | 股指、国债收益率曲线、信用利差、股债资金流；不收个股（26 字） |
| `analysis` | 分析解读 | 分析解读 | 机构观点、分析师解读、策略复盘；以判断论证为主，非事实（27 字） |
| `data` | 数据与报告 | 数据与报告 | 官方数据与持仓报告的发布；数据涨跌归对应资产类别（24 字） |

- `analysis` 标 `commentary: true`
- `RELEASE` = **`null`**（贵金属没有「新模型」那种离散可数的发布；报头改用上面的三态逻辑）
- `PLAIN_TERMS`：PM 提供了 30+ 个全小写行业通用词 + 站名自动算在内
- **压缩 guide 的诚实代价**：压缩后 `macro` 与 `precious-metals` 之间（央行购金）可能仍会误分，**这正是校准要重点测的，别指望 guide 本身能解决**

### 9.15 TOPIC_TAGS（13 个品种 + 主题标签）

**品种（13）**：黄金 / 白银 / 铂金 / **钯金（独立：2022-24 曾与金银完全背离，合并会丢信息）** / 铜 / 基础金属(铝锌镍锡铅) / 原油 / 天然气 / 美元指数 / 美债收益率 / 央行购金 / ETF持仓 / 地缘政治

**关键认知**：品种标签不只是分类标签，**它还是归组召回的锚点**。CFTC 说「管理基金」、中文稿说「投机者」会归不到一组；靠品种标签给召回兜底。

**`TAG_SYNONYMS` 的边界**（架构师补充）：只能解决「模型输出阶段」的同义，**解决不了「候选召回阶段」——两者机制不同，别指望它解决召回**。

### 9.16 `ITEM_TYPES` — 新增 1 类

在现有 7 类基础上加 **`official_data`**（官方数据与持仓报告发布）。

**双维度关系**（PM 确认）：`CATEGORIES` 是**读者筛选维度**，`ITEM_TYPES` 是**评分权重维度**，两者独立存在不打架。

加它的实际意义：CFTC 该看**数据幅度**、分析稿该看**论证质量**，一套权重对两者都不合适；且它天然不是 commentary，**不占日报快讯位置**。

**同步改动要求**（taxonomy 注释明确要求，不是加个值就完事）：`selection-score.md`（加类型权重行）+ `content-understanding.md`（加写法要求）**两份提示词都要改**。

**五轴结构不动**——加轴会破坏权重表和 `news-value.test.ts`。

### 9.17 `industry/selection.ts` — 阈值（待校准）

初始建议：`{ T1: 58, T1_5: 64, T_DATA: 56, T2: 70, T2_OP: 82 }`

[!] **这只是初值，必须用 `scripts/eval-selection.ts` 在 60-80 条金融标注样本上重跑校准后才能定稿**（`selection.ts:6-7` 明确要求）。

**联动改动**：`packages/backend/src/events/hot.ts:35` 的 `TIER_ORDER` 必须同步加新档，否则新分级落到「其他」。

### 9.18 `industry/prompts/` — 改动清单

| 文件 | 改动 | 优先级 |
|---|---|---|
| `prefilter.md` | 行业相关性替换为金融；**加行情播报识别规则**；**BLOCK 农产品/个股/加密货币**；拦「纯荐股/纯目标价」营销号 | P0 |
| `selection-score.md` | **第 3 行读者画像整段重写**（现是 AI 读者）；**`act` 重定义为「决策可用性」**；加 `official_data` 权重行；换「必须正常评价」与「必须压住」的例子 | P0 |
| `rules-anti-hallucination.md` | **追加 4 条金融数字规则**：①数字三件套（数值+单位+基准）不可推断 ②**bp/基点与百分比不可混淆** ③品种-市场必须逐字对齐（COMEX 黄金≠现货≠伦敦金≠沪金）④指标名不可替换（非农≠失业率，PCE≠CPI） | P0 |
| `rules-domain.md` | **合规防线 1/4**：通用禁令（禁目标价/买卖建议/仓位建议/确定性预测） | P0 |
| `content-understanding.md` | **合规防线 2/4**（唯一写「推荐理由」的地方，风险最集中）；三个替代表述档位 | P0 |
| `safety.md` | **合规防线 3/4**：现有全文**只有 1 句防注入，对内容风险零覆盖，必须补** | P0 |
| `story-digest.md` | **合规防线 4/4**：综述会扩散到周报月报最长生命周期载体，复述时再拦一次 | P0 |
| `structure.md` | 分类判定总则（含央行购金的归类依据）、事实抽取加金融指标；同步 `official_data` | P0 |
| `group-definitions.md` | 加总则（行情播报不入事件的双保险） | P1 |
| `summarize-*.md` | 配合 P0 数字规则 | P1 |
| `identity-context.md` | 从 2 行扩成受控事实表（央行/交易所/品种/国家） | P1 |
| `story-digest.md` | 事件综述 | P1 |

**明确不改 `prefilter.md` 装合规**：它只输出 `{label, reason}`，职责是「是不是这个行业的事」。**合规不是相关性问题**，塞进去会让预筛既当裁判又当律师。

### 9.19 行情播报处理（P0-1，最大风险 + 最大成本优化）

财经快讯里 40-60% 是「XX 上涨 2% 触及新高」这种**连续行情读数**，不是事件。

**双保险方案**：
1. `prefilter.md` 加行情播报识别规则：**判据是「有离散发生→保留，只有连续读数→丢」**
2. `packages/backend/src/content/materials.ts` 给丢弃条目打 `grouping_overrides(mode='standalone')`

**框架已有该机制**：`events/hot.ts:126` 显式排除 standalone，**所以不用改热度算法**。

**顺带收益**：每条省 5-6 次模型调用。财经快讯占 40-60%，**这是最大单项成本优化**。

---

## 10. 信源配置（锁定）

### 10.1 免key 可用（MVP 零付费）

| tier | 信源 | 方式 | 备注 |
|---|---|---|---|
| T1 | `cftc.gov/dea/newcot/f_disagg.txt` | `json_list` 或 external | **最高价值**。实测 200、457KB、四品种齐全、8类交易者分项。**CSV 非 JSON** |
| T1 | 美联储 `press_monetary.xml` / `press_all.xml` | `rss` | 实测 200 |
| T1 | ECB press | `rss` | - |
| T1 | EIA todayinenergy | `rss` | - |
| T1 | 国家统计局 zxfb | `web_list` | 需 `publishedAtUtcOffset: "+08:00"` |
| T1 | SEC pressreleases | `rss` | - |
| T1_5 | **Investing.com commodities栏目** | `rss` | PM 复测 200×3。栏目化、标题自带判断。**配成独立可开关便于灰度** |
| T2 | CNBC / Yahoo Finance / Seeking Alpha | `rss` | Seeking Alpha 秒级更新，天然 `hot_signal` |
| — | `api.gold-api.com/price/{XAU\|XAG\|XPT\|XPD\|HG}` | **external 脚本** | 每日快照。返回单对象，`json_list` 接不了 |

### 10.2 V1 已闭环：CFTC 可零代码接入

**机制真相**（既不是「跳过」也不是「新条目」）：`materials.ts:152upsertMaterial()` 的身份键**只做 URL 规范化**，变没变靠 `content_hash`；`ON CONFLICT` 走 DO NOTHING 但冲突目标是 `identity_key`；命中后过 5 道闸门，都不命中才 `reviseMaterial()`（`:264-278`）→ **`revision + 1`，整条管道重跑**。

**所以官方统计源是纯配置 +0.2 人日**，不是 +2~3 人日的中间层。

### 10.3 五个必须遵守的配置纪律（否则内容永远不出现或无限增长）

1. **`interval_minutes` 必须密于报告期**。CFTC 周五发布、采集可能周一才跑 → 超过 `STALE_ON_DISCOVERY_MS = 48h`（`materials.ts:68`）→ `isHistorical()`（`:116-117`）判定归档 → **不进「今天」、不建事件、不加热度 → 永远不出现在热点和日报**。**这个坑不报错、不告警，采集显示成功但内容就是不来**。→ CFTC 设 1 天。
2. **`urlTemplate` 不能放会变的签名参数**（时间戳/token）。`identityKeyForUrl`（`lib/url.ts:8-36`）会规范化 URL，每次 identityKey 都不同 → **每次变新文章 → 无限增长 + 每次全管道重跑**。CFTC Socrata 的 `$order`/`$limit` 不进 identityKey，安全。
3. **官方统计源排在媒体源之前**。跨源只记发现不修订（`materials.ts:218-220`）：媒体源先入库了CFTC 的转载页，官方源后续更正进不来。
4. **`site_fulltext` / `syndicate_fulltext` 保持 `false`**。来源未明确允许转载。
5. **不采集「无 pubDate」的源**。MarketWatch / FT commodities / Economist / Mining.com 实测 200 但无日期，框架硬规则要求不公开；**WSJ 已停更**（最新 2025-01-27）；Reuters 401；BLS/LME/Kitco 403/404 → **全部放弃**。

### 10.4 金十数据：不采集

PM 主动纠正了我的事实错误（金十是**两个不同端点**：`www.jin10.com/flash_newest.js` 实测 200×3，`flash-api.jin10.com/get_flash_list` 实测 502）。但结论仍成立：**同一家两个端点一个通一个不通，说明它对第三方请求的稳定性没有保证，换端点也绕不过去**。一个时好时坏的源进了精选，读者会看到「昨天有今天没」，比没有更伤信任。

### 10.5 信源分级的一个诚实说明

Investing.com 是媒体，本应 T2 门槛 70-76。提为 T1_5（门槛 64）的理由是「栏目化 + 署名专栏」而非所有权。**若 T1_5 不足 3 个，宁可保持 T2 门槛也不要虚标分级**——`tier` 直接决定门槛，虚标会让媒体稿混进精选。

---

## 11. 环境变量与安全阀

### 11.1 必须配置

```dotenv
# Node 路径（Windows 硬阻断）
# export PATH="/d/nodejs:$PATH"  ← 写进 shell profile，不是 .env

DATABASE_URL=postgres://aihot:aihot@127.0.0.1:5432/metalsmacro
AIHOT_DATA_DIR=D:/pytorch/dailyHot/dailyHotTopics/.data   #必须绝对路径
ADMIN_PASSWORD=<≥12位>
SESSION_SECRET=<hex32>
IMG_PROXY_SIGN_SECRET=<hex32>
LLM_BASE_URL=https://api.deepseek.com
LLM_API_KEY=<你的key>LLM_MODEL=deepseek-v4-flash
EMBEDDING_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
EMBEDDING_API_KEY=<你的key>
EMBEDDING_MODEL=text-embedding-v4
EMBEDDING_DIMS=1024          # 上线后禁止改
INGEST_TOKEN=<≥16位>        # 价格快照脚本用
SITE_URL=http://localhost:3000
```

**`AIHOT_DATA_DIR` 必须绝对路径**：否则三进程各自 cwd 不同 → 数据目录分裂成三份。

### 11.2 测试库

`DATABASE_URL` 库名必须以 `_test` 或 `_ci` 结尾。`tests/databases.ts:13` 强制校验，`:28` 硬编码连 `postgres` 库执行 `CREATE DATABASE`（Docker 官方镜像 superuser 天然满足 CREATEDB）。

[!] **`eval-selection.ts` 走自己的代码路径，`tests/setup.ts:13` 的库名校验拦不住它** → 手动跑之前先确认 `DATABASE_URL` 库名，否则污染开发库。

### 11.3 安全阀（开发时保持关闭）

`COLLECT_ENABLED` / `MODEL_CALLS_ENABLED` / `FEISHU_CONTENT_PUSH_ENABLED` / `FEISHU_INTERNAL_ENABLED` / `INDEXNOW_SUBMIT_ENABLED` —— **只有设成小写 `true` 才打开**（以前写 `1` 或 `TRUE` 也算，现在当关闭）。

**注意**：`MODEL_CALLS_ENABLED=false` 会**连带关掉 embedding**，聚簇静默降级且不报错。

---

## 12. 验收标准（EARS 格式，锁定）

| 编号 | 功能 | EARS 验收标准 | 优先级 |
|---|---|---|---|
| AC-01 | 分类 | While 用户访问 `/all`，系统**必须**只显示 6 个锁定分类的筛选项 | P0 |
| AC-02 | 分类 | When 用户访问 `/feed/category/precious-metals.xml`，系统**必须**返回该分类的 RSS | P0 |
| AC-03 | 采集 | While CFTC 信源启用，系统**必须**每周入库持仓快照且 `revision` 递增 | P0 |
| AC-04 | 采集 | If 官方源距离发布超过 48 小时才被抓到，系统**必须**归档该条（不进「今天」/热点/日报） | P0 |
| AC-05 | 精选 | While 同一事件有≥2篇报道，系统**必须**聚成一个事件页 | P0 |
| AC-06 | 精选 | If 两篇报道同题材但不同事件（如本周两次非农），系统**必须**不合并 | P0 |
| AC-07 | 精选 | While 资料是行情读数（无离散发生），系统**必须**标`standalone` 且不进精选 | P0 |
| AC-08 | **合规** | While 生成摘要与推荐理由，系统**必须**不出现目标价、买卖建议、仓位建议、确定性预测 | P0 |
| AC-09 | **合规** | If 原文含「分析师认为金价将突破 3000」，While 生成摘要，系统**必须**保留「认为/预期/预测」的推测语气 | P0 |
| AC-10 | **合规** | While 生成事件综述，系统**必须**同样遵守 AC-08/AC-09 | P0 |
| AC-11 | 数字 | While 渲染任意价格或涨跌幅，系统**必须**用等宽 tabular 数字 + 右对齐 + 显式正负号 + 涨跌色 | P0 |
| AC-12 | 数字 | While 渲染零值，系统**必须**用 `—` 且**必须**用灰色（非红非绿） | P0 |
| AC-13 | 数字 | While 渲染表格单位，系统**必须**把单位放在列名而非每个单元格 | P0 |
| AC-14 | 行情带 | While 每日快照成功入库，When 用户打开首页，系统**必须**显示 5 个品种的最新价与涨跌幅 | P0 |
| AC-15 | 行情带 | If 快照未入库，When 用户打开首页，系统**必须**整块不渲染行情带（**不得降级为 ReferenceTable**，见 §9.6）；首页其余部分**必须**完全正常 | P1 |
| AC-16 | 报头 | If 全部官方源采集成功且 N=0，While 渲染日报报头，系统**必须**显示「今日无官方级发布」而非「0 项」 | P0 |
| AC-17 | 报头 | If **部分**官方源采集失败，While 渲染日报报头，系统**必须**显示「部分官方源未成功采集」**且**仍显示已采到的 N 项 | P0 |
| AC-18 | 报头 | While 渲染日报报头，系统**必须**使用**三态逻辑**，**禁止**用采集失败伪装成「今天没事」 | P0 |
| AC-19 | 聚簇 | While 聚簇金融术语，If 已配置 embedding，系统**必须**用向量相似度而非字符重合度 | P0 |
| AC-20 | 图标 | While 渲染任何功能图标，系统**必须**使用 lucide SVG，**禁止** emoji | P0 |
| AC-21 | 图标 | While 渲染 16px 图标，系统**必须**用 `strokeWidth=1.5`（20px→1.7，24px→1.75），**禁止**出现第四个值 | P0 |
| AC-22 | 视觉 | While 渲染页面，系统**必须**不出现紫色→粉色渐变 | P0 |
| AC-23 | 视觉 | While 渲染数字，系统**必须**使用 Roboto Mono / tabular-nums，**禁止**比例数字 | P0 |
| AC-24 | 品牌 | While 渲染站点标识，系统**必须**使用「金属与宏观」，**禁止**出现 AIHOT 名称或 Logo | P0 |
| AC-25 | API | While 读者打开任何页面，系统**必须**不触发模型调用 | P0 |
| AC-26 | 架构 | While 新增公开出口，系统**必须**走 `packages/backend/src/publication/` | P0 |
| AC-27 | 成本 | While 同一 URL 内容未变，When 重复抓取，系统**必须**不重跑分析管道 | P0 |
| AC-28 | 成本 | While `urlTemplate` 含稳定报告期，When 同一报告期数值修正，系统**必须**命中已有行而非新建文章 | P1 |

---

## 13. 校准方案（三套，顺序不可颠倒）

**执行顺序：先归组→ 再精选 → 最后合规。** 归组是地基（「同一事件」认不准，「该不该选」就无从判断）；合规最后单独跑，因为它要改写作提示词，会影响前两套结果。

### 13.1 归组评测（`eval-relations.ts`）— 120 对

| 类型 | 数量 | 说明 |
|---|---|---|
| SAME_OCCURRENCE | 40 | 同一事件的不同报道 |
| SAME_STORY | 25 | 同一事件的后续进展 |
| **UNRELATED** | **40（33%，最关键）** | **同题材但不同事件**：本周两次非农、两次央行购金、同一周两根金价大波动、同家矿业两个不同项目 |
| ROUNDUP | 15 | 综合稿 |

**UNRELATED 负例全部来自真实信源**。**CFTC 源能贡献大量高质量正例**（官方原文 + 转述天然成对）。

**必须单独统计两类错误**：**漏召回比误合并更严重** —— 误合并只是两条挤一起，漏召回是同一事件刷屏 3 次，**直接摧毁差异化 1（事件归组）**。

### 13.2 精选门槛评测（`eval-selection.ts`）— 60-80 条

**不能用公开数据集替代**（契约层面理由）：`GoldRow.gold.decision` 判的是「该不该进**本站**精选」，依赖我们改过的评分标准。公开数据集的标签是别人在他们标准下打的（Kaggle 给 bull/bear 情绪，CnOpenData 给正负面情感），**都不是「该不该进财经站精选」**。

**但可以用数据集做素材池，省掉找素材的功夫**：

| 数据集 | 适配度 | 用途 |
|---|---|---|
| Kaggle `Financial News & Multi-Asset v1.0`（Alpha Vantage + yfinance，151 交易日，含黄金/白银/原油/铜，**CC BY 4.0 可商用**） | 最高 | 素材池 |
| HF `Kenpache/multilingual-financial-sentiment`（39,829 条，中文 7,930 条，含新浪财经/东方财富/证券时报） | 高 | 中文短句素材池 |

**分层（每层 ≥10 条才有诊断力）**：`policy` / `data` / `market` / `analysis` / `event`

[!] **`market` 层必须大量标 reject**，否则门槛会被行情噪声抬高。

**4 类必备难例各 ≥10 条**：`同义不同词`（缩表/资产负债表缩量）/ `数据发布` / `观点无事件` / `噪声刷屏`

**标注人必须是「以后每天读这个站的人」**，不能由 PM 代标（主观权重会系统性偏向自己设计的分类体系）。留出集 30%，调提示词只看开发集，最后用留出集验证。

```bash
# site/site.ts 配selectionGold: { file: ".data/gold.jsonl", sample: 60, split: "development", sweep: [40, 90] }
node --env-file=.env scripts/eval-selection.ts --gold .data/gold.jsonl --n 60 --split development
node --env-file=.env scripts/eval-selection.ts --gold .data/gold.jsonl --n 60 --split holdout   # 最终验证
```

**成本**：60 条 × 3 次调用= 180 次，约 ¥0.1-0.3。

### 13.3 合规扫描（新增，阻塞项）

正则命中即标记待复核，**宁可误报**（「目标价/必将/建议/仓位/看多/看空/买入/卖出」出现即标记）。

**口径**：送审摘要零命中 + **误报率 < 30%**。

**它不能被前两套替代——摘要可以质量满分但合规不合格。**

---

## 14. 内嵌已知坑（从本次调研积累，防重蹈覆辙）

| 坑 | 触发条件 | 根因 | 修法 |
|---|---|---|---|
| **Node 版本分裂** | Windows + PATH 首位是旧 Node | `npm test` 的 `--test-global-setup` 在 22.22 报 `bad option`，**报错与真实原因无关**；`dev:api` 却能跑 | `export PATH="/d/nodejs:$PATH"` |
| **DeepSeek 无 embedding** | 只配 DeepSeek 不配 embedding | 聚簇降级为字符 bigram，金融术语漏召回 → 热点榜失效 | 配 DashScope `text-embedding-v4` |
| **`MODEL_CALLS_ENABLED` 连带关 embedding** | 开发时关模型调用 | `embeddings.ts:20` 依赖同一开关，**静默降级不报错** | 配 embedding 时保持该开关开启 |
| **48h 归档窗口** | 官方源抓取频率疏于发布周期 | `STALE_ON_DISCOVERY_MS`（`materials.ts:68`）→ `isHistorical()` 归档 → **不报错不告警，内容永不出来** | `interval_minutes` 密于报告期 |
| **`urlTemplate` 含签名参数** | 用了时间戳/token | `identityKeyForUrl` 规范化后每次不同 → 无限增长 + 每次全管道 | 只放稳定字段（报告期） |
| **跨源只记发现不修订** | 媒体源先于官方源入库 | `materials.ts:218-220` | 官方源排前|
| **eval-selection 绕过库名校验** | 手动跑评测脚本 | 走自己的代码路径，`tests/setup.ts:13` 拦不住 | 跑之前确认 `DATABASE_URL` 库名 |
| **taxonomy 改动导致测试失败** | 改了 `industry/taxonomy.ts` | `tests/` 里有AI 行业例子（`ai-models`、"模型发布"、Anthropic） | 换成金融对应项，测的规则本身不用改 |
| **`CATEGORIES.key` 上线后不可改** | — | key 进 URL 和公开 API | 定稿前慎重 |
| **`site.ts` 改完不生效** | — | 需要重新 build | `docker compose up -d --build` |
| **Windows 雅黑只有 400/700** | 中文正文用中间字重 | 字体只有两档 | 中文只用 400/700，中间字重只对拉丁与数字 |
| **AIHOT 数据目录分裂** | `AIHOT_DATA_DIR` 用相对路径 | 三进程 cwd 不同 | 必须绝对路径 |
| **sharp 首次加载 1.7s** | Windows 本机开发，首个带图片处理的请求 | libvips 8.18.6 懒初始化 | **不是 bug**。分享图预热路径首个请求会慢约 1.5s，不要误判 |
| **切换 Node 版本后报 `invalid ELF`** | 换了Node 版本但没重装依赖 | 原生模块按 Node ABI 编译 | **切换 Node 后必须重跑 `npm ci`** |
| **`npm install` 绕过 override** | 用了 `npm install` 而非 `npm ci` | `fflate` 被 `package.json:15-17` 的 `overrides` 锁在 `0.7.5`（安全修复） | **只用 `npm ci`**，否则可能拉回被 override 掉的版本 |

---

## 14.1 已实测通过的门禁（Windows 本机，2026-10-05）

> 这四项是 Phase 3 开发的门禁基线，已由架构师实跑验证，**不是推断**。

| 项 | 实测结果 | 意义 |
|---|---|---|
| **依赖安装** | `npm ci` → 297 个包，55s，无报错 | — |
| **sharp 原生模块** | 0.35.4 + libvips 8.18.6，**实跑生成 84 字节 WebP** | win32-x64 有预编译包，无需编译工具链 |
| **类型门禁** | `npm run typecheck` → **7 个工程全过，退出码 0，51s** | **见下方，这是最省事的防漏手段** |
| **路径归一** | `tests/architecture.test.ts:26` 的 `path.sep → "/"` 归一生效，与 `git ls-files` 风格一致 | 新增 `modules/` 时架构测试**不会在 Windows 上误报** |

### `npm run typecheck` 是改taxonomy 时的防漏首选

TypeScript 7.0.2 + React Router 8.4 typegen 在 Windows 上完整工作，**证明全部 workspace 的类型解析路径（含 `@aihot/*` 的 `exports` 字段映射）没问题**。

**因此**：改 `industry/taxonomy.ts` 引入 `official_data` 新类型后，**这个门禁会立刻报出所有没同步更新的引用点** —— 比人工 grep 全库可靠。

**硬要求**：**每改一次 `taxonomy.ts` / `selection.ts` / `site.ts`，必跑 `npm run typecheck`。** 已列入 §15 验证步骤。

---

## 15. 端到端验证步骤（Spec 锁定的最后一项）

```bash
# 0. 环境前置（Windows 硬阻断）
export PATH="/d/nodejs:$PATH"      # 必须是 v25.8.0
node --version                      # 断言 v25.8.0，不是 v22.x

# 1. Docker Desktop 手动启动后，起数据库
docker run -d --name metalsmacro-pg -e POSTGRES_USER=aihot \
  -e POSTGRES_PASSWORD=aihot -e POSTGRES_DB=metalsmacro \
  -p 127.0.0.1:5432:5432 -v metalsmacro-pgdata:/var/lib/postgresql/data \
  --restart unless-stopped postgres:17-alpine

# 2. 依赖与配置
npm ci
node scripts/init-env.ts --llm-key <DeepSeek key># 再手动补 EMBEDDING_* 与 INGEST_TOKEN

# 3. 迁移与种子
node --env-file=.env scripts/migrate.ts
node --env-file=.env scripts/seed.ts

# 4. 构建
npm run build -w @aihot/web

# 5. 启动三进程（NODE_ENV=production 必带）
NODE_ENV=production node --env-file=.env apps/api/src/main.ts# 3001
NODE_ENV=production node --env-file=.env apps/worker/src/main.ts
cd apps/web && NODE_ENV=production node --env-file=../../.env server.ts  # 3000

# 6. 类型检查（断言零错误）
npm run typecheck

# 7. 测试（库名必须 _test 结尾）
DATABASE_URL=postgres://aihot:aihot@127.0.0.1:5432/metalsmacro_test npm test

# 8. Web 测试
node --test apps/web/tests/*.test.ts

# 9. 冒烟
node scripts/smoke.ts --base http://localhost:3000

# 10. 断言清单
curl -s http://localhost:3000/ | grep -q "金属与宏观"# AC-24站名
curl -s http://localhost:3000/api/site/quotes | head -1                # AC-14 行情带
curl -s http://localhost:3000/all | grep -q "precious-metals"           # AC-01 分类
curl -s http://localhost:3000/openapi-v1.json | grep -q "metalsmacro"  # mcpPrefix
# AC-08 合规：等日报出刊后扫摘要，断言零目标价/买卖建议
```

**测试已知的必要修正**：`tests/` 里有AI 行业例子（`ai-models`、"模型发布"、Anthropic），改 `industry/taxonomy.ts` 后这些会失败，**把例子换成金融对应项即可，测的规则本身不用改**。这是预期内的，不是 bug。

---

## 16. 工作量与成本（锁定）

| 档位 | 工作量 | 运营成本 |
|---|---|---|
| **最小可行（MVP）** | **13.1 人日≈ 2.6 周** | **¥42-60/月** |
| 完整版（含价格看板模块） | 29.0 人日 ≈ 5.8 周 | ¥145-202/月 |

**DeepSeek 基准**：日 60 条资料≈ 6.1 次调用/条（框架自报152 条 930 次），月 token 费 ¥40-90。**embedding 约 ¥1.5/月**。

**行情快照模块**：+0.2 人日（复用 CFTC 的 external 通道）。

---

## 17. 变更记录

| 日期 | 变更内容 | 原因 | 影响范围 |
|---|---|---|---|
| 2026-10-05 | 初版创建 | Phase 1 三文档确认后生成 | 全部 |
| 2026-10-05 | F6 每日价格快照从 P1 升为 P0 | 用户确认「做」；V1 闭环后边际成本仅 +0.2 人日 | §2 §5 §7 §8 |
| 2026-10-05 | 站名定为「金属与宏观 / Metals & Macro」，`mcpPrefix: metalsmacro` | 用户确认 | §9.1 |
| 2026-10-05 | Jina 排除出 MVP | 用户确认零付费 | §3 §10 |

---

## 18. 待外部条件（OPEN-DECISIONS）

| 编号 | 事项 | 阻塞什么 | 谁能解 | 状态 |
|---|---|---|---|---|
| V4 | Docker Desktop 未启动（`com.docker.service=Stopped`，架构师那边 `wsl.exe` 被安全策略拦住） | `npm test` 验收基线 | **用户手动启动** | OPEN |
| V1 | 站名确认 [OK]「金属与宏观 / Metals & Macro」 | — | — | **已解决** |
| V2 | 热点榜上限 10 条（`hot.ts:190` 硬上限）6 分类是否够分 | 热点页设计 | 待用户确认 | OPEN |
| V3 | **Roboto 字体 CDN 外链 vs 自托管**（30-40KB） | 首屏加载 | 用户确认 | OPEN |
| **V3b** | **sharp 0.35.4 兼容性** | — | — | **已解决**（0.35.4 + libvips 8.18.6，实跑生成 WebP） |
| **V3c** | **`npm run typecheck` 跨平台可用性** | — | — | **已解决**（7 工程全过，51s） |
| V5 | 60-80 条校准样本由谁标注 | 门槛定稿 | **必须是以后每天读这个站的人** | OPEN |

`docs/decisions/OPEN-DECISIONS.md` 已建立，上述条目同步登记。

---

## 19. 架构决策记录（ADR 索引）

完整内容见 `docs/decisions/`：

| ADR | 标题 | 状态 |
|---|---|---|
| ADR-001 | Windows 本机三进程 + Docker Desktop 仅跑 PostgreSQL | Accepted |
| ADR-002 | 锁定 Node 25.8.0（`D:\nodejs`），绕开 PATH 首位的 22.22.2 | Accepted |
| ADR-003 | 远程 embedding（DashScope），不部署本地向量库 | Accepted |
| ADR-004 | Lucide 全站统一 + 保留现有 43 个导出名 + 三级 stroke-width 例外规则 | Accepted |
| ADR-005 | 单 DeepSeek 模型分层（`group`/`groupReview` 开thinking） | Accepted |
| ADR-006 | 行情播报预筛丢弃 + `grouping_overrides(mode='standalone')` | Accepted |
| ADR-007 | 价格看板做 `modules/quotes/`（完整版再做，MVP 不做） | Accepted |
| **ADR-008** | **每日价格快照复用 external 通道（`api.gold-api.com` → `/api/ingest/items`）** | Accepted |
| **ADR-009** | **`AIHOT_DATA_DIR` 必须绝对路径**（三进程 cwd 不同否则分裂） | Accepted |

---

## 20. 文档索引

| 文档 | 内容 | 行数 |
|---|---|---|
| `.workbuddy/mvp/01-pmd.md` | PRD：8 竞品、60+ URL 实测信源表、6 分类、用户画像、RICE、三套校准 | 888 |
| `.workbuddy/mvp/02-architect.md` | 技术文档：Windows 可行性、金融场景适配、选型锁定、成本、12 个内嵌坑 | ~1400 |
| `.workbuddy/mvp/03-design.md` | 设计方向：对标品牌、WCAG 色板、图标系统、页面改造清单、数字规范 | 977 |
| `.workbuddy/mvp/design-system/MASTER.md` | 全局设计源：Token 表 + 组件规范 + Do/Don't | — |
| `.workbuddy/mvp/design-system/design-tokens.json` | 机器可读 Token（已校验可解析） | — |
| `.workbuddy/mvp/SPEC.md` | **本文件**：规格契约（18 章） | — |
| `docs/decisions/ADR-001..009.md` | 架构决策记录 | — |
