# 悬而未决登记册

> **规则**：只追加 + 就地关闭（OPEN → RESOLVED，补 Resolution 字段）。
> 不删除、不改写历史条目 —— 未决项为什么留着、后来怎么关的，本身就是决策轨迹。
>
> 关闭的条目可升格为 `docs/decisions/ADR-XXX.md`（架构决策记录）。
>
> slug 用这三个之一：
> - `waiting-on-external-condition` —— 等外部条件（用户确认 / 第三方审批）
> - `design-decision-to-evaluate` —— 设计待评估（需做 POC 对比）
> - `existing-design-boundary` —— 现有设计边界约束

| Date | Source | Open Item | Related Constraints | Current Leaning | Blocked By | Resolves When | Status |
|---|---|---|---|---|---|---|---|
| 2026-10-06 | Phase 4 验收 | 事件页「影响链条」因缺数据源未实现。`story.impact` 契约字段不存在，后端 `stories.ts` 从未产出，前端 `ImpactChain.tsx` 读到 `undefined` 后返回 `[]`。连带三个区块失效：影响链条、事件页行情面板（`hasPrices` 恒 false）、`ReferenceTable`（参数来自 `impact.map()`）。Spec §9.6「ReferenceTable 只出现在事件页」因此从未真正落地 | 数据源需由模型在结构化阶段产出「品种 + 方向 + 时间尺度」，方向判断必须过四道合规防线（不得写成「建议关注」）。字段名已定死为 `marketImpact`（`impact` 已被 `operations/alerts.ts` 用作告警影响面），**须在写第一行代码前定死** | **(a) 与 (b′) 不互斥，建议分两步**：(a) 提示词新增 `marketImpact` 输出，代价大但复活全部三块；(b′) 事件页带出 category，**纯数据搬运、无合规风险**，复活行情面板与 ReferenceTable。做完 (b′) 则「三块全死」变「一块死、两块活」 | 后端给方案 | 三方案定案 | OPEN |
| 2026-10-06 | Phase 4 验收 | ~~方案 (b′) 事件页带出分类~~ **已完成（2026-10-06）**。原因为「事件页拿不到 category」，实际原因是我误查了表：这两列在 **`publications`** 上（`articles` 没有），且 `stories.ts` 早已 JOIN publications，只需多取一列。`StoryReportView` 现已有 `category: string | null`。**教训：下结论前先查 schema，不要凭印象说「某字段在某表」。** **未做**：① 把分类映射到品种（`precious-metals`→金银铂钯、`industrial-commodities`→铜油汽、`macro`/`equity-bond`/`analysis`/`data`→不显示）；② 按分类收窄事件页行情面板 | 分类到品种的映射需产品判断（`macro` 不该显示品种）| 未决 | 映射表定案并实现 | OPEN |
| 2026-10-06 | Phase 4 验收 | 精选门槛仍是初值 `{T1:58, T1_5:64, T_DATA:56, T2:70, T2_OP:82}`，未用人工标注样本校准 | `scripts/eval-selection.ts` 需在 60-80 条**人工标注**的金融样本上重跑。标注人必须是「以后每天读这个站的人」 | 维持初值运行，等样本齐备再校准 | 样本标注 | 样本标注完成且门槛重跑后 | OPEN |
| 2026-10-06 | Phase 4 验收 | `tests/mcp.test.ts`、`tests/outlet-invariants.test.ts` 在镜像内「零失败通过」——文件级崩溃不计入 fail 统计，数字比实际干净 | 根因是 `Dockerfile:24` 的 `npm prune --omit=dev` 把只被测试引用的 devDependency（`@modelcontextprotocol/client`）剪掉。挂载补齐的两种方式都不通（整份 `node_modules` 会覆盖 workspace 符号链接；单挂该包报 invalid mode） | 在镜像里 `npm i -D` 装回，或在有 git 与完整依赖的环境跑这两个文件 | 需要构建流程改动 | 这两个文件能在镜像内真实执行 | OPEN |
| 2026-10-06 | Phase 4 验收 | 热点榜因框架语义与本站模型错配而恒空（`hot.ts:60` 要求 ≥2 参与方，本站 6 个事件全为 1 参与方 1 来源） | 框架「热点」= 社区讨论数（Reddit/HN 式），本站 = 官方源发布 + 媒体转载，**官方源发一条即全部事实，不存在「讨论」**。降到 1 会得到 `/all` 的翻版 | 保持门槛 2不改算法；已改页面文案使其不再承诺「讨论」语义。长期方案是让 `/api/site/topics` 带上 `entityId`，用站点的「覆盖品种数」替代「参与方数」 | 需要产品裁决口径 | 口径确定并实现后 | OPEN |

| 2026-10-06 | 数据源复核 | ⚠️ **已下线** `api.gold-api.com`：它是第三方聚合，**接口不标明源交易所**（无法回答「这个价格来自哪个市场」），且**没有历史**（趋势图拿不到）。已由 `Yahoo（COMEX/NYMEX 期货）` + `上金所（人民币/克）` 取代 | 用户明确问了「价格来源是哪里」——**一个说不出来源的报价对读者没有价值** | 行情带两行：国际期货 5 格 + 国内 4 格，每格带 `exchange` | 已完成 | 行情带两行上线 | RESOLVED（2026-06-06：Yahoo + 上金所接入，9 格，`exchange` 取上游自报值）|
| 2026-10-06 | 行情带调度 | 快照类源（`kind: external`）**框架调度器不采集**（`events/hot.ts:92` 白名单只有 rss/web_list/json_list/x_search），`interval_minutes` 对它**完全无效**。曾因此只有一个很低的 `interval_minutes` 配置给人「已在每天更新」的错觉，实际是手动跑的一次 | `interval_minutes` 写在 external 源上是**误导性配置**，应删 | 推送型源一律用 compose 常驻服务或 cron 调度，不靠 `interval_minutes` | 已完成 | 改为 compose `snapshot` / `sge-daily` 两个服务 | RESOLVED（2026-10-06：compose 常驻服务，分钟级+日级）|
| 2026-10-06 | 架构守卫收尾 | 守卫「网站自己接口的每个字段都必须被读到」现在**只剩 `participantCount` 一个红点**（`exchange`/`market`/趋势各字段已全部接上）。**裁决：删这个字段** | 它是 `/hot` 的参与方数，而 `/hot` 因**语义错配**恒空（框架要「社区讨论数」，本站是「官方源发布+转载」）。**字段本身对 `/hot` 仍有价值**——将来若把口径改成「覆盖信源数」，这个字段直接可用。**但在口径未定前，它是一个没人读、却让人以为「参与方数已实现」的字段** —— 与 `marketImpact` 同类，留在契约里是误导 | ~~删 `participantCount`~~ **已删（2026-10-07）**。核实依据：`apps/web/app/routes/hot.tsx` 全文只渲染 `sourceCount`（来源/报道数），**没有任何位置渲染参与方数**，故恢复读取等于「为覆盖率而覆盖率」。删除范围**仅限网站契约**：删 `packages/contracts/src/site.ts` 的 `HotStripEntry`/`HotEntryView` 两处声明 + 两个填充点（`publication/hot.ts` 的 `loadHotStrip`、`publication/stories.ts` 的 v2 映射）。**保留**后端内部 `HotEntry.participantCount`（`events/hot.ts`）与 `v1HotTopics` 的对外字段 —— 后者是机器客户端契约，`tests/hot-avatar-payload.test.ts` 已钉住其键集 | `/hot` 口径定案 | `/hot` 口径定案并按新口径实现后 | OPEN |
| 2026-10-06 | 镜像与仓库 | `tests/migration-check.test.ts` 报 `fatal: not a git repository` —— **镜像里有 git 二进制但没有 `.git` 目录**（`.dockerignore:9` 排除了它）。**这是有意的**：镜像不该带 git 历史（会让镜像大几百 MB） | 装 git 二进制只解决了「命令找不到」，而这条测试要的是**一个仓库**。**裁决：这条测试属于「需要工作区」范畴，不适合在纯镜像里跑** —— 镜像的正确用法是**跑产物**，不是跑需要 git 上下文的检查 | 改测试的**运行位置**（宿主/CI 跑，镜像不跑），**不改断言**。若要放镜像，得先解掉 `.dockerignore` 的 `.git` 排除并接受镜像变大 | 决定测试在哪里跑 | OPEN |
