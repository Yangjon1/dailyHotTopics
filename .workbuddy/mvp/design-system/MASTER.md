# MASTER.md · 全局设计源

> 项目：贵金属 + 大宗商品 + 股债热点站（基于 AIHOT 改造）
> 生成日期：2026-10-05 | 设计师：颜好看
> 完整设计方向见 `.workbuddy/mvp/03-design.md`
> 检索规则：设计某页面前先读本文件，再检查 `pages/<page>.md` 是否存在（存在则仅覆盖差异字段）

---

## 1. Visual Theme & Atmosphere

- **关键词（5）**：冷静、仪器、克制、精确、耐看
- **氛围**：浅色明亮的机构级数据终端。近中性冷白底、1px 发丝线、等宽数字、极轻阴影。不像新闻门户（信息成堆），不像交易终端（黑底荧光），像一台开着的研究工作台。
- **对标品牌**：Bloomberg Terminal（取数字纪律，不取黑底荧光）+ 东方财富/金十数据（取行情入口与涨红跌绿约定，不取模块堆叠）
- **寄存器**：Product | **平台**：web（Windows 本机，SSR）
- **三轴**：VARIANCE 4 / MOTION 3 / DENSITY 7

---

## 2. Color Palette & Roles

### A1-identity（浅色主题 · 主）

| Token | 值 | 备注 |
|---|---|---|
| `--bg` | `#F7F8F9` | 冷中性灰白（**改动**：原 `#faf9f6` 暖纸会让红推向橙） |
| `--surface` | `#FFFFFF` | |
| `--surface-2` | `#FBFCFC` | |
| `--bg-sunk` | `#EFF2F2` | |
| `--ink` | `#182024` | 13.4:1 |
| `--ink-2` | `#303C42` | |
| `--ink-3` | `#59656B` | 5.6:1 |
| `--ink-4` | `#657176` | 4.7:1，不得低于 12px 使用 |
| `--line` | `#DFE4E5` | |
| `--line-soft` | `#EBEFF0` | 表格横线 |
| `--line-strong` | `#C8D1D3` | 表头下沿 |
| `--accent` | `#176B75` | 品牌青，5.8:1。**保留 AIHOT 原值** |
| `--accent-ink` | `#0F545C` | hover |
| `--accent-on` | `#FFFFFF` | accent 上前景 |
| `--accent-soft` | `rgba(23,107,117,0.08)` | 选中行底 |

### A2-semantic（金融语义色 · **新增核心**）

| Token | 值 | 对 `--bg` 对比度 |
|---|---|---|
| `--up` | `#C0362C` | 5.19:1 · 涨（红，中国约定） |
| `--up-strong` | `#A32A20` | 7.0:1 · ≥20px 大号涨 |
| `--up-soft` | `rgba(192,54,44,0.08)` | 行底/徽章底 |
| `--down` | `#14804F` | 4.67:1 · 跌（绿） |
| `--down-strong` | `#0F6840` | 7.4:1 |
| `--down-soft` | `rgba(20,128,79,0.08)` | 行底/徽章底 |
| `--flat` | `#59656B` | 5.64:1 · **平盘一律用灰** |
| `--flat-soft` | `rgba(89,101,107,0.08)` | |
| `--warn` | `#8A5E12` | 5.35:1 · 深铜棕（`#EAB308` 在白底 1.9:1 不可用） |
| `--warn-soft` | `rgba(138,94,18,0.10)` | |
| `--alert` | `#B3261E` | 6.2:1 · 极端波动，每屏 ≤1 |
| `--metal-gold` | `#B8860B` | 2.9:1 · **仅图形，禁止文字** |

### 语义收窄（防冲突 · 关键）

- `--hot #b3402a` → **仅热度/爆**（热榜、爆点标签）
- `--ok #2f7d5c` → **仅操作成功**（复制成功、提交成功）
- **禁止**把 `--hot` 当涨色、`--ok` 当跌色。混用会让「最热事件」与「涨最多」视觉同义。

### B-slot 别名

`--fg`→`--ink` | `--fg-2`→`--ink-2` | `--meta`→`--ink-4` | `--num`→`--ink` | `--num-up`→`--up` | `--num-down`→`--down` | `--num-flat`→`--flat` | `--accent-hover`→`--accent-ink` | `--accent-active`→`#0C484F`

### 色彩配额

- 中性 88% / 强调 5% / 语义 3% / 效果 <1%
- **每屏 `--accent` 可见处 ≤ 2**
- `--up`/`--down` 是数据色不计 accent 配额，但**同屏红绿单元格总数 ≤ 40**（超了说明该用表格而非卡片流）
- **金色纪律**：金色只出现在 (a) 图表中黄金的数据曲线 (b) 贵金属分类标签的 1px 规则线。**永不作为按钮底色、链接色、卡片边框、页面背景**

### 深色主题（可选，非默认）

`--bg #14191C` | `--surface #1B2226` | `--surface-2 #1F272B` | `--bg-sunk #202A2E` | `--ink #E9EDEE` | `--ink-2 #D3DADB` | `--ink-3 #A6B0B3` | `--ink-4 #8A969A` | `--line rgba(255,255,255,0.09)` | `--line-soft rgba(255,255,255,0.055)` | `--line-strong rgba(255,255,255,0.14)` | `--accent #3FBCC8` | `--up #E2705F` | `--down #35B37C` | `--flat #8A969A` | `--warn #D0A34A` | `--metal-gold #C9A227`

深色纪律：不用纯黑 `#000`；层级用亮度递进而非阴影；不叠发光边框与毛玻璃。

---

## 3. Typography

### 字体栈（**改动：现状 `system-ui` 在 Windows 落 Segoe UI + 雅黑，比例数字导致行情表列对不齐**）

```css
--font-display: "Roboto Condensed", "Archivo", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif;
--font-body:    "Roboto", "Archivo", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif;
--font-mono:    "Roboto Mono", ui-monospace, "Cascadia Mono", Consolas, "SFMono-Regular", monospace;
--font-num:     "Roboto", "PingFang SC", "Microsoft YaHei", sans-serif;
```

**为什么 Roboto**：Christian Robertson 的骨架直接参照 DIN（全球金融终端事实标准字体）。选 Roboto 等于选「仪器面板」的声音。Inter 无此血统且是 AI 站默认字体，必须避开。三兄弟同骨架同作者，无割裂感。

**中文策略**：中文**不打包 webfont**（思源全字集 5-10MB 会毁首屏），走系统栈。`Roboto Condensed` 只作用于拉丁与数字（Yahoo/Bloomberg 表格同款处理），中文落 PingFang/雅黑。

**Windows 坑**：雅黑只有 regular/bold。**中文正文只用 400/700**；`510/590` 中间字重只对拉丁与数字生效，须在 Windows + Chrome/Edge 实测。

### 字号阶梯

| Token | px | 行高 | 字距 | 用途 |
|---|---|---|---|---|
| `--text-2xs` | 11 | 1.4 | 0.02em | 表头、单位、脚注（**下限**） |
| `--text-xs` | 12 | 1.5 | 0.01em | 元数据、时间戳 |
| `--text-data` | 13 | 1.4 | 0 | **表格单元格/价格/涨跌幅** |
| `--text-sm` | 13.5 | 1.65 | 0 | 列表摘要 |
| `--text-base` | 14 | 1.6 | 0 | 正文 |
| `--text-md` | 16 | 1.5 | 0 | 小标题 |
| `--text-lg` | 18 | 1.4 | -0.005em | 卡片标题 |
| `--text-xl` | 20 | 1.35 | -0.01em | 节标题 |
| `--text-2xl` | 24 | 1.3 | -0.012em | 页标题 |
| `--text-3xl` | 32 | 1.2 | -0.018em | 数字大屏 |
| `--text-4xl` | 40 | 1.15 | -0.02em | 极少量 |

**硬约束**：数据文字 ≥11px，正文 ≥12px。Bloomberg 的 10px 是为拉丁数字设计，中文与 `%` 在 10px 下不可读。

### 字重三级

Read 400（正文/表格数字）| Emphasize 510（表头/小标题，中文回退 500）| Announce 590（页标题/大号数字，中文回退 700）

### 字距

正文 0 | 小字（11-12px）+0.01–0.02em | **ALL CAPS / 周期表头（`3D` `30D` `YTD` `AU9999`）+0.08em** | 数字 0（tabular 已保证等宽，加字距破坏对齐）| 标题 ≥24px −0.01–0.02em

### 数字字体规范

```css
.num {
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1, "lnum" 1;
  letter-spacing: 0;
}
.mono {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums slashed-zero;
  font-size: 0.92em;  /* 等宽视觉偏小，缩到与正文等视觉重量 */
}
```

**`tabular-nums` 是强制项**，不是可选项。

---

## 4. Components

### 按钮

- Primary：`--accent` 底 / `--accent-on` 字 / `--radius-control` 8px / padding 8px 16px
- Secondary：透明 + 1px `--line-strong` 底边 / `--ink-2` 字
- Ghost：`rgba(23,107,117,0.06)` 底 / `--accent-ink` 字
- Destructive：`--alert` 底 / 白字，**每屏 ≤1**
- 尺寸：小 28px（表格内）/ 中 36px（工具栏）/ 大 40px（移动主操作）
- **移动端触摸目标 ≥44×44px**

### 卡片

1px `--line` + `--radius-card` 12px + `--shadow-card`（0 1px 2px rgba(24,32,36,0.025)）
**数据块禁用卡片**（DENSITY 7 硬规则）—— 用 `divide-y` / 1px 线 / 无框形态 A
圆角上限 12px，禁止 ≥24px

### 数据组件（**新增，Phase 3 必须交付**）

| 组件 | 形态 | 要点 |
|---|---|---|
| `QuoteBar` | 无框通栏，横向滚动 | 8-10 格；每格 品种码/最新价/涨跌幅/60px sparkline；`border-y border-line` |
| `QuoteTile` | 无框数据块 | 116px 宽；`border-r` 分格；红绿格 ≤40 |
| `QuoteTable` | 多周期涨跌表（Kitco 参照） | 行高 32px；无圆角无阴影；列头 right-align |
| `DataTable` | 通用数据表 | sticky 表头 `top: var(--bar-h)`；无竖线；无斑马纹；hover 只改背景色 |
| `QuotePanel` | 有框面板，**每屏 ≤1** | 事件页左栏置顶；1px 边框 + 12px 圆角 + 静态无阴影 |
| `DataStat` | 无框统计块 | 多块并列用 `divide-x`，**不用卡片网格** |

统一放 `apps/web/app/components/quote/`，共享 `features/quote/format.ts`（价格/涨跌幅/小数位/千分位/中文单位缩写的唯一实现，SSR 与客户端必须一致）

### 徽章

双字（`突发`/`首报`/`发酵中`），**禁止单字 + tooltip**（触屏不可达）
11px + `--radius-mark` 5px，底色 `--up-soft`/`--accent-soft`/`--warn-soft`
**语义必须写在可见文字里**，`title` 仅作补充

### 图标（**Spec 锁定：Lucide / `lucide-react`，单库，全项目统一**）

```css
--icon-inline: 16px;    /* 行内：chip、表格单元、按钮内 */
--icon-button: 20px;    /* 按钮内、导航项 */
--icon-standalone: 24px;/* 独立：空态、页头、分类入口 */
```

| 规范 | 规则 |
|---|---|
| viewBox | 24×24（沿用现有几何） |
| stroke-width | 16px→`1.5` / 20px→`1.7` / 24px→`1.75`。**唯一例外规则，不得出现第四个值** |
| 颜色 | 一律 `stroke="currentColor"`，**不传 `color` prop**，由父级 `text-*` 决定 |
| 尺寸 | 传 `size={16}` 数字 prop |
| fill 变体 | 仅 GitHub 标 / BrandMark / `Bookmark`(已收藏) / `BellRing`(预警开启) 用 `fill="currentColor"`，其余 `fill="none"` |
| 无障碍-装饰 | `aria-hidden="true"` + `focusable="false"` |
| 无障碍-独立按钮 | **必须** `aria-label` + 44×44px 触摸目标。禁止只靠 `title` |
| 禁止 | 禁止用图标代替文字标签；禁止同语义不同图标；禁止混用其他库或手写 SVG（Logo/品牌标/行情专用图形除外） |

**落选记录**：Heroicons 仅 292 个 + 描边固定 1.5 + 变体在 import 路径；Phosphor 每图标开销 16-18×（实测 50 图标 +33.9KB vs Lucide +5.16KB）+ 6 字重违反单声音规则；Radix 15×15 网格 + 单入口不 tree-shake（50 图标 +63KB）；Iconify/react-icons 单入口（+81KB@50）。

**迁移**：`components/icons.tsx` 的 55 个导出改为从 `lucide-react` re-export，**保留导出名**以免改 91 个 tsx 的 import（`export const IconSearch = Search`）。`IconSparkles` 删除。新建 `components/Icon.tsx` 封装 size→strokeWidth 映射。

---

## 5. Layout & Spacing

### 密度（DENSITY 7 · 从 AIHOT 的 4-5 上调）

| 维度 | 现状 | 目标 |
|---|---|---|
| 基准字号 | 14px | 13px（数据）/ 14px（正文） |
| 卡片内边距 | `p-5 sm:p-6`（20/24） | `p-4`（16） |
| 列表行垂直间距 | 16px | **12px** |
| 栅格 gap | 16px | 12px |
| 行情表行高 | （无此组件） | **32px** |
| 单屏可见信息 | 4-5 条卡片 | **行情行 ≥12 + 事件摘要 3**（约 2.5-3×） |
| 节间距（桌面） | 64px | 48px |

### 间距（4px 网格，禁止 5/7/13/22/30）

`0.5:2px`（表格上下内边距）| `1:4px`（图标与数字）| `1.5:6px`（行情行内）| `2:8px` | `3:12px`（列表行 / gap）| `4:16px`（卡片内）| `5:20px`（模块）| `6:24px` | `8:32px` | `12:48px`（页面级节距）

### 行高 Token（密度固化为 Token 而非临场值）

`--row-h-data: 32px` | `--row-h-data-lg: 36px` | `--row-h-head: 28px` | `--row-h-list: 44px`（移动端触摸目标，WCAG 2.5.5）

### 容器（**改动**）

```css
--page-max-reading: max(1100px, calc(200dvh - 236px));              /* 文章/日报，保留 */
--page-max-data:    max(1440px, calc(300dvh - 236px));              /* 行情/热榜/动态，新增 */
```

理由：现状 `--page-max-wide` 在 21:9 屏拉到 1900px 但无表格填充，行情页需要更宽的容器才产生价值。

### 栅格

桌面 12 列 / 平板 8 / 手机 4，gap **12px**（现状 24px）

### 圆角（**保留现状六级，不动**）

`--radius-mark 5`（徽章/行内代码）| `--radius-control 8`（按钮/输入）| `--radius-tile 10`（列表行）| `--radius-card 12`（卡片，**上限**）| `--radius-panel 14`（wells/图片）| `--radius-sheet 16`（弹层）| pill

**行情表不加圆角**（表格是网格，圆角破坏对齐感）

### 阴影（保留现状，已正确）

`--shadow-card: 0 1px 2px rgba(24,32,36,0.025)` | `--shadow-card-hover: 0 3px 12px rgba(24,32,36,0.055)`
**禁止**任何元素 `border` + `box-shadow blur ≥16px` 同时出现（幽灵卡片）；禁止装饰性毛玻璃。

### 断点（**保留，不动**）

`sm 641 / md 768 / lg 961 / xl 1280 / 2xl 1536` —— `lg` 为 961px 而非 1024px，是为平板横屏特意调过，改动会出回归。

### 外壳

236px 侧栏 + `--bar-h` 48px 手机顶栏 + `safe-area-inset-*` 侧沟槽 + `.bleed` 通栏工具类 —— 全部保留

---

## 6. Depth & Elevation

- `--elev-flat`: 无（默认）
- `--elev-ring`: `0 0 0 1px var(--line)`（选中态轮廓）
- `--elev-raised`: `--shadow-card`（卡片静态/hover）
- `--elev-pop`: `--shadow-pop`（弹层）

z-index：`base 0 / sticky 1100 / dropdown 1000 / modal 1200 / toast 1300`
表格 sticky 表头 `z-index: 10`（在页面层内）
毛玻璃/模糊：**仅用于有功能目的**的半透明（`sheet` 背板），不作装饰

---

## 7. Do's & Don'ts

### 应该做

- 行情数据用 `tabular-nums` + 右对齐 + 显式正负号 + 方向箭头（**四重编码**，色弱可读）
- 数据块用无框 + `divide-y` / 1px 线，叙事内容才用卡片
- 平盘用 `--flat` 灰，**绝不用红绿**
- 单位进列名，不进单元格
- 徽章语义写在可见文字里（双字），不靠 tooltip
- 事件页左栏置顶「受影响品种 + 价格 + 多周期涨跌」
- 日报顶部给「今日盘面」条（3 品种 + 3 关键事件）
- 中文长文沿用 `.prose`（17-18px / 1.8 / 每行 ~42 中文字）
- 数据类组件 Error 内联降级，**正文永远可用**
- 涨跌幅正数带 `+`、负数带 `-`、零值显示 `—`

### 不应该做

- **禁止 emoji 作为功能图标**（P0）。零命中，正则 `[\x{1F300}-\x{1F9FF}\x{2600}-\x{26FF}\x{2700}-\x{27BF}]`
- **禁止紫色→粉色渐变主视觉**（P0）。`#7C3AED` `#A855F7` `#9333EA` `#EC4899` 之间任意渐变组合零出现；`linear-gradient` 全站仅允许同色系深浅
- **禁止满屏金色**。金色只作图表黄金曲线 + 贵金属分类 1px 规则线
- **禁止把 `--hot`/`--ok` 当涨跌色用**（会与热度/成功语义冲突）
- 禁止单字徽章（爆/新）+ tooltip（触屏不可达）
- 禁止 24px `font-black` + 负字距的大号超粗数字（AI 模板特征）
- 禁止圆角 ≥24px
- 禁止装饰性动效；`anim-bump`(320ms scale 1.08) / `anim-pop-in`(460ms) 取消
- **禁止弹跳缓动 `cubic-bezier(0.68, -0.55, 0.265, 1.55)`**（P0）。保留 `--ease-out-quart: cubic-bezier(0.25, 1, 0.5, 1)`
- 禁止组件内裸 hex（唯一例外 `#fff` `#000`）
- 禁止千篇一律 Hero（大图居中 + 渐变标题 + 立即开始）
- 禁止 "Lorem ipsum" / "Welcome to" / "Sign up today" / "Get started" / "Elevate" / "Seamless" / "Unleash" / "Next-Gen" 等空洞文案
- 禁止 `Faces` 式社交头像装饰（本项目无社区）
- 禁止把「AI 评分」放在事件页首屏（折叠进 `<details>`）
- 禁止纯图标按钮只靠 `title` 传达功能
- 禁止同一屏 accent 可见处 >2；红绿单元格 >40

### 行业反模式（财经站）

- 涨跌色被当装饰色用（东方财富/金十/Investing）→ 品牌主色与涨跌色**正交**
- 全屏无中性锚点（Investing）→ 中性占 88%
- 首页多横条模块堆叠 → 通栏行情带 + 两栏资讯
- 首页 Hero 大图居中 → 真实行情数据带
- 斑马纹表格 → 1px 横线（有色数字时斑马纹产生摩尔纹）
- 竖线分隔的数字表 → 无竖线（栅栏会切碎数字）
- 涨跌幅只用颜色编码 → 必须显式正负号

---

## 8. Responsive & Accessibility

### 响应式

- mobile-first。断点见 §5
- 手机 TabBar **4 项**：`今日 / 行情 / 热点 / 我的`（日报移入「我的」与侧栏 —— 日报是结算物，热点是过程）
- 桌面 `xl:grid-cols-2`（**不是四列**）—— 中文定义句在四列下每列不足 200px 会截断成碎句
- 行情带手机横向滚动 `scrollbar-none` + `snap-x`，首屏可见 4-5 格
- 数据表手机端：周期列横向滚动，表头与首列同时 `sticky`
- 移动端日报字号 15px（比桌面更大），保证小屏可读
- 触摸目标 ≥44×44px（`--row-h-list: 44px`）

### 无障碍

- 对比度：正文 ≥4.5:1，大字 ≥3:1。本方案所有文本色已核验：ink 13.4 / ink-3 5.6 / ink-4 4.7 / accent 5.8 / up 5.19 / down 4.67 / warn 5.35 / alert 6.2
- `--metal-gold` 2.9:1 → **仅图形，不可作文字色**
- 键盘：`:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }`（现状已达标，保留）
- 表头 sticky 且可键盘滚动；`scope="col"` + `scope="row"`（首列品种名）
- 涨跌**四重编码**：颜色 + 显式正负号 + 方向箭头（▲▼）+ 单位。不依赖颜色单独传达（WCAG 1.4.1）
- 纯图标按钮 `aria-label` 必填 + 44×44px
- `prefers-reduced-motion` 完整降级（现状已达标，含 view-transition 全禁）
- 徽章语义写在可见文字（不靠 `title`）

### 动效（MOTION 3 · 时长收敛）

| 场景 | 时长 | 缓动 |
|---|---|---|
| 即时反馈 | 50-100ms | ease-out |
| 状态确认（hover/选中） | 120-150ms | `--ease-out-quart` |
| 内容进入（下拉/弹层） | 200-320ms | `--ease-out-quart` |
| 页面 push/back 转场 | 360-400ms | `cubic-bezier(0.32, 0.72, 0, 1)`（保留现状） |

禁止弹跳缓动。取消 `anim-bump` / `anim-pop-in`。

### 5 态（数据类组件）

| 组件 | Loading | Empty | Error | Populated | Edge |
|---|---|---|---|---|---|
| `QuoteTable` | 5 条骨架行（复用 `.skeleton`） | 「还没有该品种的行情记录」+ `RefreshCw` 重试 | 「行情源超时，已展示最后一次成功抓取（时刻）」+ 重试，**不弹 toast** | 正常 | 代码缺失→`--ink-4` 占位；单周期无数据→`—` |
| `QuoteBar` | 6 格骨架 | 「行情带暂不可用，下方资讯不受影响」 | 静默降级 + 顶部 1px `--warn` 提示条 | 正常 | 单品种失败→该格 `opacity .5`，**其余照常** |
| 榜单表 | 10 行骨架 | 「过去 48 小时没有达到热度阈值的事件」+「查看全部动态」 | 「热度数据加载失败」+ 重试 | 正常 | 标题 2 行截断 + `title`；品种 >3 → `+N` |
| 事件页行情面板 | 3 格骨架 | 「该事件未关联品种」（**正常状态**） | 「行情暂不可用，正文不受影响」 | 正常 | 停牌→`--warn`「已停牌」+ 最后价与日期 |
| 搜索 | 顶部 1px 进度线（不动顶栏高度） | 「没有匹配 X 的事件」+ 放宽建议 | 「搜索服务异常」+ 重试 | 正常 | 无结果的 X 按 key 处理 |

**统一**：数据类组件 Error 不做全屏错误页、不弹 toast，只在数据位置内联降级 + 一句可操作的话。**资讯正文永远可用。**

---

## 9. Agent Implementation Guide

### Tailwind config

```js
export default {
  theme: {
    extend: {
      colors: {
        // 命名严格遵守「用途而非色相」：不叫 blue/gold，叫 up/down/accent
        bg: "var(--bg)", "bg-sunk": "var(--bg-sunk)", "bg-muted": "var(--bg-muted)",
        surface: "var(--surface)", "surface-2": "var(--surface-2)",
        ink: "var(--ink)", "ink-2": "var(--ink-2)", "ink-3": "var(--ink-3)", "ink-4": "var(--ink-4)",
        line: "var(--line)", "line-soft": "var(--line-soft)", "line-strong": "var(--line-strong)",
        accent: "var(--accent)", "accent-ink": "var(--accent-ink)",
        up: "var(--up)", "up-strong": "var(--up-strong)", "up-soft": "var(--up-soft)",
        down: "var(--down)", "down-strong": "var(--down-strong)", "down-soft": "var(--down-soft)",
        flat: "var(--flat)", "flat-soft": "var(--flat-soft)",
        warn: "var(--warn)", "warn-soft": "var(--warn-soft)", alert: "var(--alert)",
        metal: "var(--metal-gold)",
        hot: "var(--hot)", "hot-soft": "var(--hot-soft)",   // 仅热度，禁作涨跌色
        ok: "var(--ok)", "ok-soft": "var(--ok-soft"),       // 仅操作成功
        rank: { 1: "var(--rank-1)", 2: "var(--rank-2)", 3: "var(--rank-3)", rest: "var(--rank-rest)" },
      },
      fontFamily: {
        sans: ["Roboto", "Archivo", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", "sans-serif"],
        display: ["Roboto Condensed", "Archivo", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", "sans-serif"],
        mono: ["Roboto Mono", "ui-monospace", "Cascadia Mono", "Consolas", "monospace"],
        num: ["Roboto", "PingFang SC", "Microsoft YaHei", "sans-serif"],
      },
      fontSize: {
        "2xs": ["11px", { lineHeight: "1.4", letterSpacing: "0.02em" }],
        xs: ["12px", { lineHeight: "1.5", letterSpacing: "0.01em" }],
        data: ["13px", { lineHeight: "1.4", letterSpacing: "0" }],
        sm: ["13.5px", { lineHeight: "1.65", letterSpacing: "0" }],
        base: ["14px", { lineHeight: "1.6", letterSpacing: "0" }],
        md: ["16px", { lineHeight: "1.5" }],
        lg: ["18px", { lineHeight: "1.4", letterSpacing: "-0.005em" }],
        xl: ["20px", { lineHeight: "1.35", letterSpacing: "-0.01em" }],
        "2xl": ["24px", { lineHeight: "1.3", letterSpacing: "-0.012em" }],
        "3xl": ["32px", { lineHeight: "1.2", letterSpacing: "-0.018em" }],
        "4xl": ["40px", { lineHeight: "1.15", letterSpacing: "-0.02em" }],
      },
      borderRadius: { mark: "5px", control: "8px", tile: "10px", card: "12px", panel: "14px", sheet: "16px" },
      height: { "row-data": "32px", "row-data-lg": "36px", "row-head": "28px", "row-list": "44px" },
      spacing: { 0.5: "2px", 1.5: "6px" },
      transitionTimingFunction: { "out-quart": "cubic-bezier(0.25, 1, 0.5, 1)" },
    },
  },
};
```

### 数字表格 CSS

见 `03-design.md` §8.3。核心：`border-collapse: separate`、无竖线、无斑马纹、`th.num{text-align:right}`、sticky 表头 `top: var(--bar-h)`、hover 只改背景色。

### 关键注意点

1. **不要重写 `app.css` 的 token 层**。`@theme` 的 `--color-* → var(--*)` 转发层与语义命名法必须保留（91 个 tsx 依赖）。改造是**新增** `--up/--down/--flat/--warn/--alert/--metal-gold` + 改 `--bg` 一个值，**不是重命名**。
2. **`--font-sans` 变量名不变**，只改值 → 所有 `font-sans` 类自动生效，91 个 tsx 无需改。
3. **Webfont**：Roboto / Roboto Condensed / Roboto Mono 三个 woff2，`font-display: swap`，只 preload Roboto 400。**中文不打包 webfont**。若要求完全离线，自托管到 `apps/web/public/fonts/`（约 30-40KB）。
4. **禁止引入**：shadcn/ui、Radix、framer-motion 扩大使用、CSS-in-JS、任何带紫红渐变默认主题的图表库（ECharts 默认主题触犯 P0-2）。sparkline 复用 `features/hot/Sparkline`；需真图表用 `uPlot` 或原生 SVG `<path>`。
5. **P0 自查**：emoji 正则零命中；`#7C3AED`/`#A855F7`/`#9333EA`/`#EC4899`/`linear-gradient` 零命中；颜色走 `var(--*)`；每个纯图标按钮有 `aria-label` + 44×44px；涨跌数字四重编码。

### 已知坑（pitfalls）

- 雅黑只有 400/700，中间字重只对拉丁/数字生效（须 Windows 实测）
- SSR 下 `tabular-nums` 的 FOIT：Roboto 加载完成前数字用 fallback 比例字，表格会闪一次。建议 `size-adjust` fallback 或对 `.num` 单独 preload
- `height: 44px` 在 `display: table-cell` 上不生效，移动端行高用 `padding` 或 `display: block` + flex

---

## 变更记录

| 日期 | 变更 | 原因 | 影响范围 |
|---|---|---|---|
| 2026-10-05 | 初版 | Phase 2 设计方向 | 全站 |