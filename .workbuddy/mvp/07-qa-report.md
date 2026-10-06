# 07 — QA 独立验收报告（Phase 4）

> **verdict: fail**
> 验证者：mvp-dev-expert-team-qa（未参与 Phase 3 任何实现）
> 依据：`.workbuddy/mvp/SPEC.md` 第 12 章 AC-01 ~ AC-28（唯一合同）
> 方法：自建请求、自查库、自截图。不采信任何 Phase 3 开发者结论。
> 时间：2026-10-06 03:20 ~ 04:05 UTC

---

## 1. 结论摘要

| 维度 | 结果 |
|---|---|
| 28 条 AC | **24 通过/ 1 无法验证 / 3 不通过** |
| P0 四项规则扫描 | 全部零命中（真实输出见 §3） |
| 静默失败专项 | 4 项全部实测，**发现 1 处P1**（/hot 空榜） |
| 五源对齐 | 设计 42 色 token 中 **2 项未落地** |
| 测试套件 | 694 项 / 628 通过 / **66 失败**（根因已定位，非业务代码缺陷） |
| 测试完整性反作弊 | **通过**（0 skip/0 only/0 断言弱化） |

**判定 fail 的理由**：66 个测试红。虽已证明根因是「测试夹具未随taxonomy 迁移」而非业务代码错误，但**合同 AC 未被验证即上线 = 未完成**。按 §12 锁定验收，红色测试不允许带入生产。

---

## 2. 28 条 AC 逐条结论

| 编号 | 功能 | 结论 | 证据 |
|---|---|---|---|
| AC-01 | 6 分类筛选 | **通过** | `industry/taxonomy.ts:15-20` 6 个 key；`/all` HTML 实测渲染 `category=` × 6 |
| AC-02 | 分类 RSS | **通过** | 6 个 `/feed/category/*.xml` 全 200；`precious-metals` 返回 `金属与宏观 — 贵金属` |
| AC-03 | CFTC 周入库 + revision 递增 | **无法验证** | 4 条数据在库且 `revision=1`，但**无法证明「递增」**——需二次抓取同一报告期，当前仅 1 个报告期快照，无第二次修订可比 |
| AC-04 | 超 48h 归档 | **通过** | CFTC 4 条 `backfill=t, backfill_reason=stale-on-discovery`（published 10-02 19:30 / discovered 10-06 03:18 = 79.8h > `STALE_ON_DISCOVERY_MS` 48h，`materials.ts:68`）。**负向亦通过**：`/hot`、`/daily`、`/api/site/hot` 中 "CFTC" 出现 **0 次**。**确认这是正确行为，不是 bug** |
| AC-05 | ≥2 篇聚一事件 | **通过** | `grouping_decisions` 有 verdict 记录；`story_signals` 7 条分布 7 个 story。当前数据每簇 1 篇（信源特性），聚簇机制经`manual-official-tally-render` 与 `group.ts` 判据验证 |
| AC-06 | 同题材不同事件不合并 | **通过** | CFTC 黄金/白银/铂金/钯金 4 条**未被合并**（`grouping_decisions` verdict=new-story × 7），符合「同题材不同品种不合并」 |
| AC-07 | 行情读数标 standalone | **通过** | 快照源 `participation_mode=isolated`（已隔离）；`group.ts:303/318` 返回 `verdict:"standalone"`；实测 `/`、`/hot`、`/daily` 中「价格快照」出现 **0 次** |
| AC-08 | 合规：无目标价/买卖/仓位建议 | **通过** | 生成字段全量扫描 **0 命中**：`stories.digest`(7)、`selection_value_reason`(99)、`articles.excerpt`(61)。<br>注：`articles.body_text` 有 1 处「买入」，经查为**原文逐字稿**（"中长期资金合计净买入A股超过6000亿元"= 资金流事实陈述），非生成建议，不在 AC-08 管辖范围 |
| AC-09 | 保留「认为/预期/预测」推测语气 | **无法验证** | `body_text ~ '认为\|预期\|预测'` 在非 backfill 条目中**返回 0 行**，无匹配样本可验证。代码层`prompts/` 未见删除推测语气词的动作，但缺实测样本 |
| AC-10 | 事件综述同守AC-08/09 | **通过** | `stories.digest`/`summary` 禁用词 0 命中 |
| AC-11 | 等宽 tabular + 右对齐 + 正负号 + 涨跌色 | **通过** | `app.css:366/372/398/427` 四处 `tabular-nums`；`proportional-nums` 全仓 **0 命中**；截图确认价格右对齐等宽 |
| AC-12 | 零值用 `—` 且灰色 | **通过** | `QuoteTile.tsx:29` `text-flat` + `:32` `text-flat title="没有可比较的基准"`；截图实测 5 个品种均显示 `—` 灰色 |
| AC-13 | 单位进列名不进单元格 | **通过** | 行情带单位独立成行（`QuoteTile.tsx` 末行 `QUOTE_UNIT[symbol]`）；截图确认 `美元/盎司` ×4 + `美元/磅` ×1（铜单位正确区分） |
| AC-14 | **行情带 5 品种价+ 涨跌幅** | **部分通过** |✅ **前端渲染已首次真实验证**（截图 `qa_shots/home.png`）：5 品种齐全、顺序正确（金→银→铂→钯→铜）、单位区分正确、「数据截至 11:28」在位<br>⚠️ **但 5 个品种 `changePct=null`/`basis="none"`** —— 因上线首日仅 1 条快照，无昨基可比。**符合 SPEC §9.4 三态定义的第3 态**（无基准→`—`），非缺陷。**但 AC-14 字面要求「显示最新价与涨跌幅」，涨跌幅当前全为空**，见 blocking#1 |
| AC-15 | 快照未入库则整块不渲染 | **通过** | 快照已入库故不触发；另`/topics/palladium` 空主题页实测优雅降级（「这个主题暂时还没有精选内容」+ 解释文案，非白屏） |
| AC-16 | 全成功且 N=0 → 「今日无官方级发布」 | **通过** | `site/site.ts:219` `empty: "今日无官方级发布，可轻仓观望"`；`official.ts:56` 判定；实测渲染 `[quiet, all ok] warn=false 今日无官方级发布` |
| AC-17 | 部分失败 → 警告 **且** 仍显示已采到 N | **通过** | 实测 5 用例：`[items, 2 missed] warn=true 3 项已采到`、`[NOTHING, 4 missed] warn=true 0 项已采到`（警告与计数并存） |
| AC-18 | 三态逻辑，禁止伪装「今天没事」 | **通过** | 三态视觉分级已**首次真实验证**：<br>· `empty` → `text-ink-3` 灰、**无图标**（`OfficialTallyLine.tsx:15`）<br>· `incomplete` → **`text-warn` 全站唯一使用点**（`:20`，`grep -rn 'text-warn' features/report/` 仅此1 处）<br>· `withItems` → 无警告<br>· `readOfficial()` 对 headline 为空的 tally 返回 `null`（**未知≠空**，`:51`），杜绝静默替换 |
| AC-19 | 聚簇用向量相似度 | **通过** | `embeddings` 表 27 条 `text-embedding-v4`，`array_length(vector,1)=1024`（真实向量，**非字符 bigram 降级**）；`group.ts:533` `embeddingsAvailable()` 门控 + `cosine32` |
| AC-20 | lucide SVG，禁 emoji | **通过** | emoji 全正则扫描 **0 命中**（见 §3）；`icons.tsx` 注释「lucide-react, and nothing else」，44 个 `Icon*` 导出 |
| AC-21 | strokeWidth 三档，禁第四值 | **通过** | `icons.tsx` `weightFor()`：`≤16→1.5`/`≤20→1.7`/`else→1.75`，全文件仅 3 处 `strokeWidth` |
| AC-22 | 禁紫粉渐变 | **通过** | `7C3AED\|A855F7\|EC4899` 全仓 **0 命中** |
| AC-23 | Roboto Mono / tabular，禁比例 | **通过** | 自托管 3 字体已落地 `public/fonts/`；`font-display: block` ×3，**`swap` 0 命中**（符合 §9.8 反直觉要求）；`proportional-nums` 0 命中 |
| AC-24 | 「金属与宏观」，禁 AIHOT | **通过** | 全站可见文本站名均为「金属与宏观」；`AIHOT` 唯一命中为 `localStorage` key `'aihot-theme'`（浏览器存储键名，**非可见品牌**） |
| AC-25 | 读页面不触发模型调用 | **通过** | **实测法**：记录 `BEFORE receipts=824 / analyses=178` → 访问全部 9 页面 ×3 轮（27 次）→ `AFTER receipts=824 / analyses=178`，**零增长** |
| AC-26 | 新增出口走 `publication/` | **通过** | `apps/api/src/routes/site.ts:20` `import { loadQuotes } from "@aihot/backend/publication/quotes"`，`:162` 仅做路由挂载；业务逻辑在 `publication/quotes.ts:94` |
| AC-27 | 同 URL 内容未变不重跑管道 | **通过** | 182 个 URL 组，`multi_revision=0`；快照 `title` 不含价格（§9.7 硬约束遵守） |
| AC-28 | 同报告期数值修正命中已有行 | **无法验证** | 快照 URL 为 `https://snapshot.metalsmacro.local/{symbol}/2026-10-06`（**键格式正确，无时间戳/token**，符合设计），但无「同报告期二次修订」数据可比对|

### 公开端点全量实测（Spec 第 5 章）
`/` `/all` `/hot` `/topics` `/about` `/agent` `/daily` `/weekly` `/monthly` `/feed.xml` `/llms.txt` `/sitemap.xml` `/robots.txt` `/openapi-v1.json` `/api/site/quotes` `/api/site/hot` `/api/v1/items` → **全部 200**
`/api/mcp` →405（POST-only端点，GET 返回 405 属正确）

---

## 3. P0 四项规则扫描（真实输出，非「已检查」）

```
===== P0-1 EMOJI SCAN (完整正则, apps/web/app site/ industry/, *.tsx|ts|md) =====
--- exit=1 (empty above = ZERO MATCH) ---
零命中

===== P0-2 紫粉渐变 (7C3AED / A855F7 / EC4899) =====
--- exit=1 ---零命中

===== P0-3 弹跳缓动 (0.68, -0.55) =====
--- exit=1 ---  零命中

===== P0-4 tsx 硬编码颜色 (排除 #fff/#000) =====
apps/web/app/root.tsx:61: <meta name="theme-color" ... content="#f7f8f9" />
apps/web/app/root.tsx:62: <meta name="theme-color" ... content="#14191c" />
→仅 2 处，且为浏览器 chrome 的 theme-color meta（非 UI 用色），判定不违规
```

**Spec §8.2 八个关键色值落地核对**（全部 1:1 精确命中）：
`--up #C0362C` ✅ `--down #14804F` ✅ `--flat #59656B` ✅ `--warn #8A5E12` ✅ `--alert #B3261E` ✅ `--metal-gold #B8860B` ✅ `--accent #176B75` ✅ `--bg #F7F8F9` ✅

**§8.3 金色边界**：`#FFD700` 全仓 0 命中；`--metal-gold` 仅定义为 CSS 变量，未作文字色/按钮底/卡片边框使用 ✅

---

## 4. 静默失败专项（实测数据）

| 检查项 | 实测 | 判定 |
|---|---|---|
| 信源静默失效 | 16 个 enabled 源，`last_error` **全为空**；抓取数分布 seekingalpha 35 / kitco 17 / nbs 15 / pboc 15 / fred 13 … 分布合理无断崖 | ✅ 无静默失效 |
| 条目入库但不可见 | `backfill=135` / `not backfill=46`，共 181 | ⚠️ backfill 占 **74.6%**，但**非缺陷**：CFTC 4 条 + 早期抓取的历史条目按48h 规则归档是 Spec §14 明列的设计行为（AC-04）。已验证归档条目不进公开出口 |
| 分析卡住 | `analyzed=142` / `blocked=34` / `skipped=5` / **`new=0`** | ✅ worker 在消费，无积压 |
| 端点 404 | 见 §2 端点清单，**0 个 404** | ✅ |

### 4.1 ★ 发现：`/hot` 热点榜恒为空（P1）

**现象**：`/hot` 页面显示「暂时没有热点」；`hot_rankings` 表有 **69 条**记录（每 5 分钟一条，机制在跑），但**全部 `jsonb_array_length(entries)=0`**。

**根因（已逐层排除，最终定位）**：
1. 排除信源过滤：7 条 `story_signals` 的 `participation_mode<>'isolated'` ✅ 通过
2. 排除 withdrawn：7/7 ✅ 通过
3. 排除 evidence 关联：7/7 `fact_articles` 与 `stories` 完整对应 ✅ 通过
4. 排除 48h 窗口：6/7 信号在窗口内（7.2~19.6 小时）✅ 通过
5. ✅ **命中**：`hot.ts:60` `const MIN_PARTICIPANTS = 2`，`:185` 过滤 `participants >= 2`。实测**每个 story 的participant 均为 1**（`story_id 2~7` 各 1 个）→ **全部被滤除**

**性质判定**：**这是框架「热点=社区热议」语义与本站「官方源+ 转载」内容模型的错配**，非代码 bug。`evidence->>'minParticipants'` 已记录 2、`candidates=0`。

**Spec 已预告**：SPEC 第 107 行明确写出「漏召回 → 来源数不足 → `MIN_PARTICIPANTS=2` 不满足 → **真事件进不了热点榜**」。即架构师已知此风险。

**为何仍列为问题**：SPEC §7 将「热点榜改为可排序榜单表」列为本站 P1 改造项，页面已按榜单表实现（含「按讨论热度排序」下拉），但**功能实际不可用**。属于「UI 已交付、数据恒空」。

---

## 5. 五源对齐差异清单

设计源：`.workbuddy/mvp/design-system/design-tokens.json`（26 顶层键，已核实）↔ 代码：`apps/web/app/app.css` ↔ 渲染：自截图

### 5.1 设计要求了但代码没做（2 项）

| # | Token | 设计值 | 代码实测 | 影响 |
|---|---|---|---|---|
| 1 | `colorDark.accent` | `#3FBCC8` | **`#12ccd8`**（`app.css:270`，浏览器 computed 实测一致） | 深色主题强调色偏亮偏青。同组的 `colorDark.warn` 设计 `#D0A34A` ↔ 代码 `#d0a34a` **精确匹配**，证明转换链路本身可靠，故此项是真实偏差而非转换错误 |
| 2 | `color.lineSoft` | `#EBEFF0` | **`#ebeef0`**（`app.css:188`） | 差 1 个十六进制位（`F`→`E`），肉眼不可见。极低风险 |

**其余 40 个设计色 token 全部 1:1 落地。**

### 5.2 代码做了但设计没要求
- **无**。未发现「代码擅自新增设计未定义的语义色」。tsx 层无硬编码颜色（仅 root.tsx 的 theme-color meta）。

### 5.3 契约字段：后端产出但前端不读（3 项，触发架构守卫失败）

`tests/architecture.test.ts` 断言失败，实际值：
```
packages/contracts/src/site.ts: participantCount   (×2 处声明)
packages/contracts/src/site.ts: baselineAgeDays
```
- `baselineAgeDays`：`publication/quotes.ts:88` 产出，但前端改用 `quote.basis === "lastSnapshot"` 判断断档（`QuoteTile.tsx:47`），功能等价 → **该字段冗余**
- `participantCount`：后端 `events/hot.ts:240`、`publication/hot.ts:125`、`stories.ts:264/295` 均产出，前端 0 读取 →因 `/hot` 恒空，榜单参与者数无消费方

---

## 6. 测试完整性与测试套件

### 6.1 反作弊门禁（5 项全通过）

| 检测项 | 结果 | 详情 |
|---|---|---|
| 测试文件删除 | ✅ | `git log --diff-filter=D -- tests/` 空输出 |
| 断言数下降 | ✅ | 被改 3 文件：`pool-relevance` 10→10、`search-sharing` 13→**13**、`category-corrections` 断言结构等价重写；`git diff | grep '^-.*assert'` **零命中** |
| 新增 skip/xfail/.only | ✅ | `grep -rn '\.skip\|xit(\|xdescribe\|\.only(\|focus' tests/` **零命中** |
| 硬编码断言（贴实现） | ✅ | `report-official-tally.test.ts` 断言来自 Spec 文案（`REPORTS.officialTally.*`），非实现返回值 |
| 框架/阈值篡改 | ✅ | `git diff -- package.json` 零命中；`scripts.test` 未变；测试库名 `_test` 后缀守卫**仍在生效**（我误用 `aihot_test2` 时被 `tests/setup.ts:14` 拒绝拦截 ✅） |

**规模**：137 个测试文件、3168 处断言。新增 `tests/report-official-tally.test.ts` + `apps/web/tests/report-official-tally.test.ts`（web 侧 6 个三态渲染用例，**补上了team-lead 指出的「三态视觉从未验证」空白**）。

### 6.2 测试套件结果：66 失败（根因已定位）

```
ℹ tests 694    ℹ pass 628    ℹ fail 66    ℹ skipped 0    ℹ todo 0
```

**根因判定（已用控制实验证明）**：
- `industry/taxonomy.ts` 的 `CATEGORIES` / `ENTITY_TAGS` / `ITEM_TYPES` 已从 AI 行业迁移为金融（`ENTITY_TAGS` 由 `["OpenAI","Anthropic",...]` → `["美联储","欧洲央行",...]`）
- **25 个测试文件仍用旧 AI 夹具**（`ai-models`/`模型发布`/`Anthropic`）
- 失败文件 27 个中，**18 个含未迁移 AI 夹具**
- 失败形态印证：如 `tests/topics.test.ts:93` 报 `AssertionError: anthropic page 1` —— "Anthropic" 已不在 `ENTITY_TAGS`，实体主题页解析不到

**这是 SPEC §14 明确预告的**（第850 行「taxonomy 改动导致测试失败…换成金融对应项，测的规则本身不用改」；第 931 行「这是预期内的，不是 bug」）。

**但迁移只做了 3/25**，Spec §15 验证步骤第 7 步「测试」因此**未通过**。

**业务代码本身健康（已验证）**：已迁移的 `category-corrections.test.ts` **pass 2 / fail 0**。

**排除的环境噪声（避免误判为产品缺陷）**：
- `every environment variable ... is listed in a template` → `Error: spawnSync git ENOENT`，容器内无 `git`，**环境问题非代码问题**
- 我最初两次运行分别因 `-e MODEL_CALLS_ENABLED=false`（禁用 stub 依赖的调用）与误传真实 `DASHSCOPE_API_KEY`（绕过本地 stub 打真实付费 API）导致大量假失败；**已用干净环境重跑确认**。`tests/setup.ts:22` 注释「Paid providers are local stubs」证实该诊断

---

## 7. blocking（必须修复方可上线）

### blocking-1 · AC-14 涨跌幅当前全为空 —— 优先级 P1
- **未满足**：AC-14 字面要求「显示 5 个品种的**最新价与涨跌幅**」
- **证据**：`GET /api/site/quotes` 全部 5 条 `"changePct":null,"basis":"none","basisAt":null`；截图 `qa_shots/home.png` 5 个 tile 的涨跌幅位均显示 `—`
- **期望**：需**连续两日快照**才能验证涨跌幅渲染路径。本次仅单日数据，属数据时序限制而非代码缺陷——**但这意味着 AC-14 的涨跌幅分支至今从未被真实验证过**。建议：明日在有 2 日快照后重跑本项，或由前端负责人提供 `basis="yesterday"` 的构造数据做渲染验证。

### blocking-2 · 66 个测试红（夹具未迁移）—— 优先级 P0
- **未满足**：SPEC §15 端到端验证步骤第 7 步「测试」；且测试完整性要求「回归率与解决率同时达标才算完成」
- **证据**：`ℹ fail 66`；25 个测试文件残留 `ai-models`/`Anthropic`/`模型发布`；失败形态如 `AssertionError: anthropic page 1`（`tests/topics.test.ts:93`）
- **期望**：按 SPEC §14 修法，把 25 个文件的**夹具数据**（不是断言逻辑）换成金融对应项——`ai-models`→`precious-metals`、`模型发布`→`数据/持仓`、`Anthropic`/`OpenAI`→`美联储`/`世界黄金协会` 等。**断言本身一律不动**。迁移后 `ℹ fail` 应归零。
- **注意**：此为 SPEC 已预告的预期内修正，但**未做完即上线 = 未验证**。

### blocking-3 · 3 个契约字段无人消费（架构守卫红）—— 优先级 P1
- **未满足**：`tests/architecture.test.ts` 断言「网站自身接口的每个字段都必须被网站读取」
- **证据**：
  ```
  + packages/contracts/src/site.ts: participantCount   (×2)
  + packages/contracts/src/site.ts: baselineAgeDays
  ```
- **期望**：二选一——① 若确认 `basis==="lastSnapshot"` 已完全覆盖断档语义，则从 `packages/contracts/src/site.ts:389` 删除 `baselineAgeDays`；`participantCount` 因 `/hot` 恒空暂无消费方，同理处理或等 hot 修复后接入。② 或补上前端读取。
- **注**：我已验证断档告警**功能上是实现的**（`QuoteTile.tsx:47` 用 `basis` 判断，截图外还渲染了 `IconClock` warn 标记），故这是**契约冗余**而非功能缺失。

---

## 8. advisory（不阻断，记录待办）

1. **`/hot` 恒空（P1，根因已定位到 `hot.ts:60 MIN_PARTICIPANTS=2`）** —— 架构语义（社区热议）与本站模型（官方源+转载）错配。SPEC 第 107 行已预告此风险。当前页面 UI 已交付但功能不可用。建议二选一：本站语境下将门槛降到 1，或改用「官方源数+ 转载数」为热度口径。**我倾向后者**（更符合「金属与宏观」定位），但这属产品决策，请产品裁决。
2. **`colorDark.accent` 与设计差一个色值**（设计 `#3FBCC8` / 代码 `#12ccd8`）—— 请设计确认哪个是终稿，另一侧对齐。
3. **`color.lineSoft` 差 1 位**（设计 `#EBEFF0` / 代码 `#ebeef0`）—— 肉眼不可见，建议顺手对齐以免五源比对长期报错。
4. **`钯金` 主题页为空**（13 品种中唯一）—— 但空状态文案优雅（「钯金的全部动态：供应过剩…」+「共收录 1 条」+ 暂无精选提示），符合设计。**建议在 §9.15 注明「钯金因独立成类，早期样本少」**，避免后续被当bug 重复排查。
5. **AC-03 / AC-09 / AC-28 无法验证** —— 三者均需「时间跨度」或「特定样本」：AC-03 需同报告期二次修订、AC-09 需含「认为/预期」的摘要样本（当前 0 条）、AC-28 需同报告期数值修正。建议明日快照或补构造数据后复验。

---

## 9. 回归集更新建议

本轮未发现「修复A 弄坏 B」型回归（业务代码 0 修改，纯验证）。但发现两类**应沉淀的回归用例**：

1. `tests/regression/taxonomy-fixture-migration.test.ts` —— 断言 `tests/` 下无任何 `ai-models`/`Anthropic` 类夹具残留。**这是防止同类静默失败复发的最有效闸门**（本次 66 红全部源于此）
2. `tests/regression/quotes-baseline-age.test.ts` —— 构造 `basis="lastSnapshot"` + 断档 >3 天数据，锁定 `QuoteTile` 的 warn 标记（该分支至今无真实数据覆盖）

---

## 10. 生产就绪评级

| 维度 | 档位 | 证据 |
|---|---|---|
| 测试 + 回归 | **Bronze** | 66 失败待归零（blocking-2） |
| 契约 | **Bronze** | 3 字段未消费，架构守卫红（blocking-3） |
| 安全 | Silver | 无新增公开出口（AC-26 通过）；`/api/site/quotes` 仅读公开快照 |
| 无障碍 | Silver | `sr-only` 文本齐备（断档告警有 `sr-only`「基准间隔超过三天，不是日涨跌」）；语义化标签完整 |
| 性能 | Silver | AC-25 证实零模型调用；页面 `s-maxage=60` 缓存 |
| 可观测 | Bronze | 信源 `last_error` 全空，无告警样本可验证（SPEC §13 alerts 未能实测） |
| 发布安全 | Bronze | 66 红未清即发布 = 门禁未通过 |

**总档：Bronze**（取最低）。按纪律「未达 Silver 不交付商业生产」——**当前不可上线**。

---

## 11. 复验清单（修完 blocking 后）

1. `npm test` → `ℹ fail 0`（25 文件夹具迁移）
2. 复验 `tests/architecture.test.ts` → 9/9 绿
3. 明日复验 AC-14 涨跌幅分支（有 2 日快照后）
4. 产品裁决 `/hot` 口径后复验 AC-07/AC-19 联动
5. 重跑 emoji/紫粉/弹跳/硬编码色四项 P0 扫描（确认修改未引入回归）
6. 重截 `home.png` 确认行情带涨跌幅位由 `—` 变为带符号数值

---

## 附：证据文件

- 截图：`qa_shots/home.png`（行情带）、`qa_shots/daily.png`（报头 incomplete 态 warn 色）、`qa_shots/hot.png`（空榜）、`qa_shots/topics-palladium-empty.png`（空状态降级）、`qa_shots/home-dark.png`（深色主题）
- 三态独立渲染输出：
  ```
  [quiet, all ok      ] warn=false 今日无官方级发布，可轻仓观望
  [items, all ok      ] warn=false 3 项官方发布
  [items, 2 missed    ] warn=true  3 项已采到
  [NOTHING, 4 missed  ] warn=true  0 项已采到
  [items, all missed  ] warn=true  5 项已采到
  ```