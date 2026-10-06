# 06 · 金属与能源类信源实测报告

> 负责人：高见远（首席架构师）｜ 实测日期：2026-10-06｜ 归属：金属（贵金属/基础金属/能源/矿业资讯）
> 本轮**未修改任何代码或配置文件**。`industry/sources.json` 由team-lead 统一改动。
> 探测脚本留在 `.workbuddy/tmp-probe/`（probe.mjs 通用探测、discover.mjs feed 发现、final-verify.mjs 三轮稳定性）。

---

## 0. 测试方法（可复现）

用与框架 `listing-fetch.ts` 相同的抓取路径：Node 22+ undici + `redirect: follow`，超时 25s。

> ⚠️ **重要更正（第二轮）**：本报告初版我用了一个**错误的 UA** `dailyHotTopics/1.0`，而框架真实 UA 是
> `Mozilla/5.0 (compatible; MetalsMacroBot/1.0; +<siteUrl>/about)`（`http-fetch.ts:70` + `site/site.ts:80`）。
> 收到 backend 反馈后**全部结论已用真实 UA 重新实测**，并因此**发现一个会静默上线的严重问题（SMM 命中腾讯 WAF，见 §3）**。
> 教训：**探测 UA 必须逐字取自 `DEFAULT_UA`，不能自己编一个像的**——编的 UA 会让WAF 放行，把「上不了线」的源误判为可用。

**先验 HTTP 码，再验内容真伪**——本轮多次遇到「HTTP 200 但内容是 Cloudflare 挑战页 / 腾讯 WAF 验证码页 / 空 feed / 陈旧缓存」。
所有候选源跑 3 轮（部分15 轮）连续请求统计可用率，对判定为「不可用」的源额外复测以排除冷启动偶发。

**第二轮真实 UA 复测结果（`MetalsMacroBot/1.0`）**：

| 源 | 真实 UA 结果 | 结论是否变化 |
|---|---|---|
| SGE 每日行情 | 3/3 · 200 · 18 行 ·含 Au99.99 | 不变 ✅ |
| SHFE 通知公告 / 新闻发布 | 3/3 · 200 · 21 / 20 项 | 不变 ✅ |
| 中国黄金协会 | **15/15 全 200** · 48 `<li>` / 95 时间戳 | 不变 ✅（更稳） |
| USGS 索引 | 3/3 · 200 · 97 tr / 93 日期 | 不变 ✅ |
| OilPrice / investing / worldsteel / WGC | 全部 200 · 条数与日期覆盖不变 | 不变 ✅ |
| EIA todayinenergy | **10/10 全 200** · 8434b · 无拦截 | 不变 ✅（初版那次 ERR 是并发偶发，非 UA 问题） |
| Kitco news | **14/15**（1 次 `fetch failed` 瞬时） | 不变可用，但**注意它偶发失败** |
| **SMM** | **200 但 1697b / 0 item/ 命中腾讯 WAF** | ⚠️ **新增致命问题，见 §3** |

关键框架事实（读码确认，非推测）：

| 事实 | 位置 | 对本次选型的影响 |
|---|---|---|
| `rss` 的 `parseDate` 先 `Date.parse`，失败后剥掉 `星期X` 再试一次；**但不回落 `parseLooseDate`** | `sources/rss.ts:61-68` | 「月」字仍解析不了 → 中文日期 feed 不可用（见 §3 SMM） |
| `json_list` 要求解析结果是数组，但**可用 `itemsPath` 指向嵌套数组** | `json-list.ts:172-174` | **Yahoo `itemsPath:"chart.result"` 能接**（后端纠正，见 §6-2）；gold-api 扁平对象接不了 |
| `json_list` 支持 `html_json_key`（从 HTML 内嵌 JSON 取数组） | `json-list.ts:113-144` | 可救「JS 渲染页」，但仅当内嵌 JSON 含日期字段 |
| **只有 `json_list` 设了 `redirectPolicy:"same-origin"**，web_list/rss 没设 | `json-list.ts:156` | **web_list 会自动跟随 302/308**（http→https 升级也算通过），见 §6-3 |
| `web_list` 的 `html` 模式不执行 JS | `sources/web-list.ts` | 选择器必须取自**原始 HTML**，不能取自浏览器 DOM |
| 无 `publishedAt` 的候选落到 `unknown-publication-time` 归档，永不出现在日报/精选 | `materials.ts:104` + `collect.ts:203` | **0% 日期覆盖 = 0% 上线**，与配置纪律一致 |

---

## 1. 一句话结论

**19 个现有信源我一个都没动。本轮实测出 10 个可直接接入的免key 源，其中 5 个能直接补齐铂金/钯金/铜/原油/天然气这5 个空白主题。**
另有 3 个此前判定失败的源**本轮已恢复可用**（SGE、investing.com、中国黄金协会——后者是清单域名写错了），2 个是**永久性不可用**（CME/LBMA，原因不是技术而是授权与封禁）。

---

## 2. 实测可用的免key 信源（按接入方式分四类）

### 2.1 RSS 类（配`kind: "rss"` 即可，零代码）

| 名称 | 免费 | 接入方式 | 实测能通的完整 URL | 实测结果（3轮） | 覆盖主题 | 备注 |
|---|---|---|---|---|---|---|
| **Investing.com 大宗商品** | 🟢免费 | rss | `https://www.investing.com/rss/commodities.rss` | 3/3 · 200 · 3331b · **10 条/ 10 个 pubDate / 日期覆盖 100%** | 黄金、原油、LNG、OPEC+ | 🔄**本轮最大反转**：上一轮 4UA×3=12/12 全 403（响应体仅 3 字节），本轮同12 组请求全部 200。站方风控已解除。样本标题：「Gold Reprices a Longer US-Iran War」「OPEC+ Holds November Quota」「LNG Weekly: Hormuz Is Healing」。⚠️ `description` 为空，正文需回源页 |
| **OilPrice.com** | 🟢免费 | rss | `https://oilprice.com/rss/main` | 3/3 · 200 · 16KB · **15 条 / 100% 日期** | **原油、天然气**（能源主题最佳单一源） | ✅ 最优能源源。`description` 约 550 字符真实摘要，可直接做 `excerpt` 甚至正文。样本覆盖 Hormuz 原油流量、欧洲甲烷规则、Freeport LNG、沙特炼厂。发布频率高（实测当日多条） |
| **世界钢铁协会 worldsteel** | 🟢免费 | rss | `https://worldsteel.org/feed/` | 3/3 · 200 · 167KB · **10 条 / 10 个 pubDate** | 钢铁、铁矿石、粗钢产量 | 日期自带 `+0000`。偏行业（月度粗钢产量为主），非日常新闻，频率低 |
| **世界黄金协会**（已接，复验） | 🟢免费 | rss | `https://www.gold.org/rss.xml` | **10/10 全200** · 178485b · **10 条 / 11 个 pubDate** | 黄金、央行购金 | ✅ 现有配置无误，**无需改动**。冷启动偶发一次 TypeError，10 连测无复现 |

### 2.2 JSON API 类（⚠️ 全部需 `external` + 自写脚本，不能用 `json_list`）

原因：`json_list` 要求 `items` 是数组，这些接口顶层都是单对象 → `json-list.ts:174` 直接抛错。

| 名称 | 免费 | 接入方式 | 实测能通的完整 URL | 实测结果 | 覆盖主题 | 备注 |
|---|---|---|---|---|---|---|
| **Yahoo Finance chart API** | 🟢免费 | **external 需写脚本** | `https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range=5d&interval=1d` | 3/3 · 200 · JSON 有效 · **9/11 品种通** | **铂金/钯金/铜/原油/天然气/铝** | 🔑**补齐空白主题的主力**。实测通：`PL=F` 铂金 1721.20、`PA=F` 钯金 1170、`HG=F` 铜 6.6595、`CL=F` 原油 89.72、`NG=F` 天然气 3.073、`GC=F` 4149.20、`SI=F` 60.965、`ALI=F` 铝 3243.25、`ZN=F`。✗ **不存在的**：`PB=F` 铅、`NI=F` 镍（404 "No data found"）。结构：`chart.result[0].meta.symbol/currency` + `timestamp[]`(epoch_s) + `indicators.quote[0].close[]`。⚠️ 复用 `scripts/price-snapshot.ts` 的两条硬约束：title 绝不能含价格（否则每日 reviseMaterial 重跑整条管道）、url 用 `https://snapshot.metalsmacro.local/...` 且不含时间戳 |
| **gold-api.com**（已接，需扩展） | 🟢免费 | external（**已实现**） | `https://api.gold-api.com/price/{XAU\|XAG\|XPT\|XPD\|HG}` | 3/3 · 200 · JSON 有效 · `updatedAt` 为 ISO 带 Z | 黄金、白银、铂金、钯金、铜 | ✅ `scripts/price-snapshot.ts` **已覆盖全部 5 个品种**，无需新增。✗ **实测不支持能源**：`WTI`/`BRENT`/`NATGAS`/`NG`/`OIL`/`CL` 全部返回 `{"error":"Symbol not found"}` → 原油/天然气只能靠 Yahoo |
| **CME 结算价（CSV/JSON）** | 🟡有条件 | — | `https://www.cmegroup.com/CmeWS/mvc/Settlements/Futures/Settlements/425/FUT?tradeDate=09/30/2026&strategy=DEFAULT&pageSize=500` | **HTTP 200 但响应体是封禁声明** | 黄金/白银/铜期货 | ❌ **见§4，不接**（IP 级封禁 + 明确禁止爬虫） |

### 2.3 Web List 类（配 `kind: "web_list"`，选择器已实测）

| 名称 | 免费 | 接入方式 | 实测能通的完整 URL | 实测结果 | 覆盖主题 | 备注 |
|---|---|---|---|---|---|---|
| **上期所 SHFE · 通知公告** | 🟢免费 | web_list | `https://www.shfe.com.cn/publicnotice/notice/` | 3/3 · 200 · 128KB · **21 个列表项/ 三要素齐全 20/20** | **铜、有色金属**（沪铜注册公告等） | ✅ 结构极干净：`<div class="table_item_info">` 内`div.info_item_title > a[title]`（标题与链接）+ `div.info_item_date`（`2026-09-30`）。日期 ISO 无时区 → 需配 `publishedAtUtcOffset: "+08:00"`。相对链接 `./202609/t20260930_833624.html` 框架 `absolute()` 会自动补全 |
| **上期所 SHFE · 新闻发布** | 🟢免费 | web_list | `https://www.shfe.com.cn/publicnotice/newsrelease/` | 3/3 · 200 · 125KB · **20 个列表项 / 三要素 20/20** | 有色金属、期货规则 | 同上选择器。样本：「上海期货交易所新闻发布会（2026年10月）」。⚠️ 更新频率低（月度发布会），`interval_minutes` 别小于报告期 |
| **Kitco 贵金属新闻**（已接，复验） | 🟢免费 | web_list | `https://www.kitco.com/news/` | 3/3 · 200 · 242KB · `div.flex.flex-col` 命中 13 · **三要素齐全 11/12** | 黄金、白银、铂金、钯金 | ✅ 现有配置可用，**建议把notes 从「6 条」更正为 11 条**（PM 报的 11 条是对的）。日期 `dateTime="2026-10-05T16:55:39-0400"`，⚠️ **不要配 `publishedAtUtcOffset`**，会覆盖正确时区 |
| **中国黄金协会 · 金市时讯** | 🟢免费 | web_list | `https://www.cngold.org/news/news/` | 3/3 · 200 · 117560b ·平均 0.2s · **严格三要素 76 条/ 日期格式异常 0** | **黄金**（每日行情快评） | ✅ **本轮第三大发现**。⚠️**域名纠错**：你清单里的 `cngold.org` 是**「金投网」**（标题实测「金投网(jt.cn)-黄金价格走势」），**不是**中国黄金协会。协会真实站点是 **`https://www.cngold.org/`**（`.org` 无 `.cn`，标题实测「中国黄金协会」；`www.cngold.org.cn` 与 `ngs.org.cn` 均 404/不可达）。结构极干净：`<li>` 内 `<span class="fr">2026-10-05 12:25</span>` + 分类 `a.tag` + 正文 `a[title]`，文章 URL 规律 `https://www.cngold.org/c/{yyyy-mm-dd}/c{id}.html`。日期是 `YYYY-MM-DD HH:mm` **无时区** → 需配 `publishedAtUtcOffset: "+08:00"`。⚠️ 每条列表项里有 **2 个 `<a>`**（分类 + 正文），`titleSelector` 必须锁定 `a[title]:not(.tag)` 或用 `linkSelector` 精确匹配 `/c/` 路径，否则会抓到分类链接 |
| **USGS 矿产摘要索引** | 🟢免费 | web_list | `https://pubs.usgs.gov/periodicals/mcs2024/` | 3/3 · 200 · 23KB · `<tr>` 97 行 · **含日期行 93/95** | 铜、铁矿石、铝、铅、镍、铂族、金、银 | ⚠️ 是 **`<table>` 不是列表**（`<li>` 0 个），需`itemSelector: "tr"`。日期列`Last modified` = `2024-01-30 15:01`。⚠️ **年度出版物**，一年才更新一次 → `interval_minutes` 必须 ≥ 43200，或干脆不接。92 个 PDF 中 17 个金属类，命名规律 `mcs{年}-{品种}.pdf`（实测 2024/2025 两版均 200） |

### 2.4 CSV 类（**需写脚本**，参考 `scripts/fetch-cftc.ts`）

| 名称 | 免费 | 接入方式 | 实测能通的完整 URL | 实测结果 | 覆盖主题 | 备注 |
|---|---|---|---|---|---|---|
| **上金所 SGE 每日行情** | 🟢免费 | **external 需写脚本** | `https://www.sge.com.cn/sjzx/quotation_daily_new?start_date=2026-09-30&end_date=2026-09-30` | **HTTP 200（curl 8/8、undici 6/6 稳定，平均 134ms）** · 表格 18 行 · **含 Au99.99 / Ag(T+D) / Pt99.95** | **黄金、白银、铂金**（人民币计价） | 🔄**本轮第二大反转**：上一轮 `curl: schannel handshake failed`，本轮彻底正常。列结构：`序号\|日期\|合约\|开盘价\|最高价\|最低价\|收盘价\|涨跌\|涨跌幅\|加权平均价\|成交量(kg)\|成交金额(元)\|市场持仓\|交收方向\|交收量`，17 个合约（Au99.95/99.99/100g、Au(T+D)、**Pt99.95**、**Ag(T+D)**、NYAuTN06/12、PGC30g）。⚠️ **必须写脚本**：这是 HTML 表格不是 JSON/CSV，且 **URL 必须按日拼接 date 参数** → 触犯配置纪律②（url 里放可变参数会无限增长），脚本内部算好日期、对外 url 用 `https://snapshot.metalsmacro.local/sge/{yyyy-mm-dd}` |

---

## 3. 实测失败 / 有坑的关键源

| 源 | 实测结果 | 有无替代路径 |
|---|---|---|
| **SMM 上海有色网** | **`news.smm.cn/rss/meeting` 用框架真实 UA（`MetalsMacroBot/1.0`）请求 → HTTP 200 但仅 1697 字节 / 0 item**，响应体是腾讯 WAF 验证码页（`TCaptcha.js` / `WafCaptcha` / `loadXMLDoc("/WafCaptcha",...)`）。同一 URL 换浏览器 UA 才是真 feed（67 条） | ❌ **双重不可用，且 WAF 比日期问题更隐蔽**。① **WAF 层**：框架 UA 里明写 `MetalsMacroBot/1.0`（`http-fetch.ts:70` + `site/site.ts:80`）→ **必定命中 WAF**。验证码页是 HTTP 200，`health` 记 ok、`fail_count` 不涨 → **连 degraded 都不会触发**，比日期解析失败更难发现。② **日期层**：`rss.ts:61-68` 会先 `Date.parse`、失败后剥掉 `星期X` 重试一次（我初版说「只走 Date.parse」不准确，backend 纠正），但 SMM 的 `周二,06 10月 2026 10:31:40 +0800` 里`月`字 `Date.parse` 不吃 → 实测 6/6 → null。**所以把日期解析修好，SMM 照样一条都出不来，反而会造成「日期能解析了 = 这个源能用了」的假信号。结论：不收。** 另：`/rss/spot`、`/rss/macro` 本就是**空 feed（items=0）**；`/rss` 根路径返 HTML 列表页不是 feed；`news.smm.cn/` 首页 JS 渲染、原始 HTML 0 个文章链接，`web_list` 也救不了。**替代**：基础金属交给 SHFE 通知公告 + investing.com |
| **LBMA 基准金价** | RSS 404（`/rss.xml`、`/news/rss.xml` 都返回 JSON 错误体）、`prices.lbma.org.uk` **401**、JSON 接口 **403 Cloudflare**（换浏览器 UA 仍 403） | ✅ **替代已到位**：黄金/白银/铂金/钯金价格用 gold-api（免费免key，5 品种全覆盖）。LBMA 定价本身不接 |
| **CME / COMEX** | 首页 200、RSS 404、`CmeWS/mvc/Quotes/Future/425/G` **25s 超时**、Settlements 接口 200 但**响应体是封禁声明** | ❌ **永久不可用，不要接**。响应体原文：*"This IP address is blocked due to suspected web scraping activity... Use of scripts, software, spiders, robots... is strictly prohibited by CME Group's website Data Terms of Use."* 这是**IP 级封禁 + 明确禁止自动化抓取**，不是技术问题。**替代**：COMEX 期货等价物用 Yahoo `GC=F`/`SI=F`/`PL=F`/`PA=F`/`HG=F`（免费免key，已实测通） |
| **EIA API** | v2 无 key → **403**；v1 无 key → `API_KEY_MISSING` | ⚠️ **确认必须申请 key**（`api.eia.gov/opendata/register.php`）。免费但要注册。现有 `rss-eia-today`（todayinenergy.xml）实测 3/3 · 200 · 13 条 / 100% 日期，是更好的路径。⚠️ `/rss/` 索引页 **403**、所有兄弟 feed 路径（petroleum/ng/steo/wpsr/opendata）**全 404**——EIA 只有 todayinenergy 这一个可用 feed |
| **OPEC** | 首页 200 且有真实内容（18KB 正文、有真实链接），内嵌 `challenge-platform` 只是 Cloudflare 的 JS 探测脚本 | ❌ **子页面全 403 Cloudflare**：`news-articles.html` / `monthly-oil-market-report.html` / `press-releases.html` 三个入口都403。⚠️ 更重要：**你提到的 PDF 月报思路不可行**——PDF 挂在 403 页面下，浏览器 UA 同样 403。**替代**：OPEC+ 配额消息由 investing.com 覆盖（实测样本「OPEC+ Holds November Quota at 31.01 Million Barrels Daily」）|
| **IEA** | 首页/news/reports 全 200 但 feed=Y、items=0，无可解析 feed | ❌ 不接。**替代**：能源分析内容由 OilPrice + investing.com 覆盖 |
| **USGS 主站** | `www.usgs.gov/...commodity-statistics-and-information` 200/124KB —— 上一轮记的 405 Human Verification **已消失** | ⚠️ 页面 0 个 `<time>`、0 个 ISO 日期串 → 做不了 `web_list`。但 `pubs.usgs.gov` 的 PDF 与索引表可用（见 §2.3） |
| **Mining.com** | `/feed/` 200 但 items=0；`/news/` **404** | ❌ 不接。首页有真实文章链接且 0 个日期串 → 无 `pubDate`（与你上一轮结论一致） |
| **MetalMiner** | `www.metalminer.com/feed/` **403 Cloudflare**，浏览器 UA 也 403 | ❌ 不接 |
| **SteelOrbis** | `/rss/` **404**、`/steel-news/` 200 但 **0 个 `<time>`、0 个日期串** | ❌ 不接。钢铁主题由 worldsteel 覆盖 |
| **Stooq**（我主动加测的免费行情候选） | `q/d/l/?s=xauusd` **403**、多品种 CSV **404** | ❌ 不接。Yahoo + gold-api 已覆盖 |
| **CNBC 能源** | 复验：`search.cnbc.com .../id=19836790` 空 feed | ❌ 维持停用。**原油/天然气由 OilPrice + Yahoo 补齐** |
| **Reuters** | `arc/outboundfeeds/rss/` **404**、`reutersagency.com/feed` **404** | ❌ 不接（维持原判） |
| **中国黄金协会**（清单里写的 `cngold.org`） | ⚠️ **清单域名有误**：`www.cngold.org` 是**金投网**（媒体），非协会。协会真实站点 `https://www.cngold.org/` | ✅ **纠错后可用**，见 §2.3 「中国黄金协会 · 金市时讯」，76 条 100% 日期。`www.cngold.org.cn` 与 `ngs.org.cn` 均 404/不可达，**别用这两个** |
| **Mysteel 我的钢铁** | 首页 200/676KB，但 `/rss/` **404**；路径全为 `/a/453` `/market/111` 短链，0 个 `<time>` | ❌ 不接 |
| **FRED CSV** | `fredgraph.csv?id=SLVPRUSD` **404** | ❌ 不接（宏观由 PM-2-2 负责） |

---

## 4. 付费源（一律标注「不接」，未深测）

| 源 | 结论 |
|---|---|
| Fastmarkets、Argus、CRU、Platts | **不接**（付费订阅，无免费层） |
| Metals Focus、Heraeus、StoneX、CPM Group | **不接**（付费研究报告） |

**对用户「要免费接入」诉求的明确答复**：LME 与 COMEX 的官方行情**均不提供免费免key API**——LME 需 `prices.lbma.org.uk` 授权（实测 401/403），COME 明确禁止自动化抓取并已 IP 封禁。但**这两个市场的价格可被完全免费替代**：COMEX 黄金/白银/铂金/钯金/铜 → Yahoo `GC=F`/`SI=F`/`PL=F`/`PA=F`/`HG=F`；LME 有色 → Yahoo `ALI=F`（铝）等 + 上期所公告；金银铂钯人民币基准 → 上金所 `quotation_daily_new`。**用户要的「免费金属行情」能做到，不需要付费。**

---

## 5. 最值得优先接的 5 个

按「补齐空白主题 ÷ 接入成本」排序：

| # | 信源 | 接入方式 | 补齐什么 | 为什么第一 |
|---|---|---|---|---|
| **1** | **OilPrice** `https://oilprice.com/rss/main` | `rss` | **原油、天然气** | 零代码、零 key、15 条 100% 日期、550 字符真实摘要可当正文。**唯一能一次补齐两个空白主题的免key 源** |
| **2** | **Investing.com 大宗商品** `https://www.investing.com/rss/commodities.rss` | `rss`（**需先删 `enabled: false`**） | 黄金、原油、LNG、OPEC+ | 从 12/12 全 403 恢复到 12/12 全 200。配置里已存在，只需 team-lead 把 `enabled` 改回 true。⚠️ 恢复可能是暂时的，**上线前必须再验一次 HTTP 码** |
| **3** | **Yahoo Finance chart** 扩品种（CL=F/NG=F/PL=F/PA=F/HG=F） | `json_list`（`itemsPath:"chart.result"`，后端纠正）或 `external` | **原油、天然气、铂金、钯金、铜** | 9/11 品种实测通、数据当日新鲜、带 `meta.currency` 可防单位错。**唯一能补齐铂金/钯金/原油/天然气 4 个空白的行情源**。⚠️ **但见 §6-4：Spec §9.5 已把行情带锁死为 5 格，现在不要扩** |
| **4** | **上期所 SHFE 通知公告 + 新闻发布**（2 个源） | `web_list`，选择器已实测（`div.table_item_info`） | **铜、有色金属** | 20/20 三要素齐全、ISO 日期、选择器干净不易失效、平均 61–105ms。是**唯一免费的一手有色金属官方源** |
| **5** | **上金所 SGE 每日行情** | `external` **需写脚本** | **黄金、白银、铂金**（人民币计价） | 免费拿 Au99.99/Ag(T+D)/Pt99.95 人民币基准价，**金银铂的国内定价权**是 LBMA 拿不到的。但要写表格解析脚本，且必须处理 date 参数纪律，优先级略低于前4 |
| **6** | **中国黄金协会 · 金市时讯** `https://www.cngold.org/news/news/` | `web_list`，选择器已实测 | **黄金**（每日快评） | 零代码零 key、**严格三要素 76 条 / 日期格式异常 0**、**真实 UA 15/15 全 200**、平均 0.2s（本轮最稳的源）。⚠️**清单里 `cngold.org` 是金投网，域名是错的**，协会真实站点是 `www.cngold.org`。是唯一免费的**中文黄金每日行情评论**源 |

**关于「优先接 5 个」的取舍说明**：上金所（第5）虽有价值，但要写表格解析脚本且踩配置纪律②；中国黄金协会（第6）零代码、直接补黄金中文内容，**若要控制工作量，建议把第5 位的 SGE 换成协会金市时讯先行**。SGE 可留到下一轮。

**次优先**：worldsteel feed（钢铁，但月度频率）、USGS 索引（年度频率，`interval_minutes` 需 ≥43200，建议先不接）。

---

## 5.5 第二轮修正记录（backend 反馈后逐条复验）

backend 对我第2、3 条提出了反驳，我**逐条实跑复验**，结论如下。**这三条我都错了或不准确**：

| 我原来的说法 | backend 的反驳 | 我的复验结果 |
|---|---|---|
| 「`rss` 只走 `Date.parse()`，不经过 `parseLooseDate`」 | `rss.ts:61-68` 有回落：剥掉 `星期X` 再试一次 | ✅ **backend 对，我错**。我漏读了 `cleaned` 那两行。但**结论不变**：`月` 字仍解析不了（backend 实测 `星期二` 变体也失败，我实测 6/6 → NaN） |
| 「Yahoo 不能用 `json_list`，必须 external」 | `json-list.ts:172` 的 `itemsPath` 可指向嵌套数组 | ✅ **backend 对，我错**。实测 `itemsPath:"chart.result"` → `Array.isArray=true, len=1`，`meta.shortName="Crude Oil Nov 26"`、`meta.currency="USD"` 都能取到。**gold-api 扁平单对象那条我说对了**：`Object.values` 得`["USD","$",1,"Gold",4123.2,...]` 原始值数组，`titlePaths` 取不到，确实接不了 |
| 建议扩 Yahoo 加原油/天然气/铝/锌 | Spec §9.5 锁死 5 格行情带，加品种是改已锁定设计 | ✅ **接受**。`price-snapshot.ts` 现有 5 品种已覆盖锁定范围，**脚本不用动**。单位已由后端做成 `/api/site/quotes` 的 `unit` 字段（从 `raw.unit` 透出），将来扩是「加数据不加契约」 |

另外，**我用自己的 UA 测出的 SMM 可用性是假的**——真实 UA 下命中腾讯 WAF。这条已写进 §0 与 §3。

---

## 6. 与 backend 交叉核验后需要修正的另外三点

**1. `web-pboc-announce` 的 302 不是问题**（backend 说会被拦，我实测不会）
`http-fetch.ts:85` 的 `originBound` 只在 `opts.redirectPolicy === "same-origin"` 时成立，而**全仓只有 `json-list.ts:156` 设了这个**，`web_list` / `rss` 都没设。所以 web_list 会自动跟随重定向（`maxRedirects` 默认 5）。实测：
```
http://www.pbc.gov.cn/... → 302 → https://www.pbc.gov.cn/... → 200 / 35413b
td[height=22] 15 个 | span.hui12 21 个
```
**注意**：http→https 的 origin 确实不同（`http://www.pbc.gov.cn` vs `https://www.pbc.gov.cn`），但既然 web_list 没开 `same-origin`，就不会被拦。配置里的 `allowUrlPrefixes` 写的是 `http://`，跟随后拿到的是 `https://` 链接——**建议 team-lead 把 `allowUrlPrefixes` 改成 `https://`**，否则可能触发前缀不匹配。这条源本身是可用的（15 个列表项、21 个日期 span）。

**2. `web-kitco-news` 的 308 也不是问题**（同样因web_list 不设 same-origin）
实测 `https://www.kitco.com/news/` → 308 → `/news` → 200 / 247286b / `flex flex-col` 13 个 / article 链接 49 / dateTime 22。**源可用**。但实测**14/15 有一次瞬时 `fetch failed`**，若上线后偶发采集失败，属可接受范围（框架会重试一次）。

**3. 确认 `web-cnbc-gold` 与 `rss-cnbc-energy` 确实是死源**（与 backend 一致）
真实 UA 实测：`web-cnbc-gold` 200 / 859650b 但 `ItemListCell-item` **0 个**、`<time>` **0 个**；`rss-cnbc-energy` 200 / **0 字节 / 0 item**。两条都已在配置里 `enabled: false`，维持停用即可。

**4. 关于 `sources.json` 被改**：我确认**不是我改的**——我对 `industry/`、`packages/`、`scripts/` 全程只用 Read/Glob/Grep，未执行任何写入。新增的那 8 个源（`ext-fred-macro`、`web-pboc-announce`、`rss-cnbc-energy`、`web-cnbc-gold`、`web-kitco-news`、`rss-silverinstitute`、`rss-fx-h10`、`rss-goldorg-news`）在我开工前就已存在于文件里。**CFTC 停更是否纳入报头告警这个取舍我同意由team-lead 定**，我倾向不纳入：推脚本型源的健康应看脚本有没有跑（`fetch-cftc.ts` 推成功时更新源健康），而不是看抓取时钟。

---

## 7. 给 team-lead 的配置注意事项（我不改配置，你改时请注意）

1. **investing.com**：`industry/sources.json` 里那条 `rss-investing-commodities` 是 `enabled: false`，恢复只需改 true。但请把notes 里「12/12 全 403」改成「2026-10-06 复测 12/12 全 200，风控已解除，上线前需复验」——**这个反转随时可能再失效**。
2. **Kitco notes 更正**：现有 notes 写「实测严格匹配 6 条」，我实测三要素齐全 **11 条**。建议更正，否则你会按6 条配置 `initialBackfillLimit` 而少取数据。
3. **SMM 不要接**（双重不可用）：① 框架 UA 明写 `MetalsMacroBot/1.0`，**必定命中腾讯 WAF 验证码页**——HTTP 200 但 1697 字节 0 item，`health` 记 ok、连 degraded 都不触发；② 中文日期 `月` 字解析失败。**把rss.ts 日期解析修好也救不了它**，反而会造成「日期能解析了 = 源能用」的假信号。要修需改代码（`parseDate` 回落 `parseLooseDate`），属架构变更，我没动；且**当前 12 个已配源实测全是英文官方源、无一踩这个坑，所以不是当下阻塞项**。
4. **interval_minutes 别踩纪律①**：USGS 是年度、worldsteel 是月度、`interval_minutes` 必须密于报告期，否则 `backfillReason=stale-on-discovery` 静默归档。
5. **SGE / Yahoo 脚本的两条硬约束**（沿用 `scripts/price-snapshot.ts` 注释）：title 绝不能含价格（参与 `content_hash`，每日变动会重跑整条管道）；对外 url 必须是 `https://snapshot.metalsmacro.local/...` 且不含时间戳/token，否则 identityKey 每次都变、无限增长。
6. **原油/天然气单位**：`CL=F` 是美元/桶、`NG=F` 是美元/百万英热，`HG=F` 是美元/磅，金银铂钯是美元/盎司。不标单位读者会拿量级去比。`price-snapshot.ts` 已把 `unit` 放 `raw`，新脚本照做。
7. **域名纠错（重要）**：用户清单里的「中国黄金协会 `cngold.org`」是**错的**——`www.cngold.org` 实测标题为「金投网(jt.cn)-黄金价格走势_实时行情_贵金属门户网站」，是商业媒体。**中国黄金协会真实站点是 `https://www.cngold.org/`**（`www.cngold.org.cn` 与 `ngs.org.cn` 均 404/不可达，别用）。如果按清单域名配，会接进一家媒体站并丢掉唯一免费的中文黄金官方评论源。
8. **中国黄金协会的选择器坑**：每个列表项有 2 个 `<a>`（分类 `a.tag` + 正文 `a[title]`）。`linkSelector` 必须精确匹配正文链接（形如 `/c/{yyyy-mm-dd}/c{id}.html`），否则会抓到分类链接导致大量重复项。
9. **`web-pboc-announce` 的 `allowUrlPrefixes` 要改 https**（见 §6-1）：配置里写的是 `http://www.pbc.gov.cn/...`，但 302 跟随后实际拿到 `https://` 链接。
10. **探测 UA 必须逐字取自 `DEFAULT_UA`**：本次我自己编了个 `dailyHotTopics/1.0` 的 UA，结果放行了腾讯 WAF、误判 SMM 可用。框架真实 UA 是 `Mozilla/5.0 (compatible; MetalsMacroBot/1.0; +<siteUrl>/about)`（`site/site.ts:80` + `http-fetch.ts:70`）。**后续任何人复测信源都不要自己编 UA。**
11. **新增国内源前先验WAF**：国内站（腾讯云防护）会对含 `Bot` 的 UA 返回 HTTP 200 的验证码页。判据是**响应体字节数异常小 + 0 item**（SMM: 1697b / 0 item），而不是 HTTP 码。**这类故障比 404 更危险，因为它让 health 记 ok。**

---

## 7. 与既有 19 信源的交集（避免重复劳动）

| 已有信源 | 本轮复核结论 |
|---|---|
| `rss-goldorg-news`（WGC） | ✅ 10/10 全 200，配置无误，不动 |
| `web-kitco-news` | ✅ 可用，条数应为 11 非 6 |
| `rss-eia-today` | ✅ 可用，13 条 100% 日期。EIA 无其他可用 feed |
| `rss-silverinstitute` | 未复验（属贵金属但已在册，不在本轮扩源范围） |
| `ext-price-snapshot`（gold-api） | ✅ 5 品种全覆盖，**只需扩 Yahoo 补原油/天然气** |
| `rss-investing-commodities` | 🔄 403 → 200，**建议恢复** |
| `rss-cnbc-energy` | ❌ 复验仍空 feed，维持停用 |
| `web-cnbc-gold` | ❌ 维持停用（JS 渲染，选择器失效） |