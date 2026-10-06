# 05 · 宏观类信源实测报告

> 实测人：许清楚（产品经理）｜实测时间：2026-10-06｜实测环境：本机 Node 22 + 出口代理
> 方法：全部为真实 HTTP 请求，逐个记录状态码 / 字节数 / Content-Type / 条数或行数 / 字段样例 / 日期字段。
> 本文所有URL 均是**实测跑通过的**（标注实测状态码），没有「大概是这个」。
> 本文不改任何代码或配置，`industry/sources.json` 由 team-lead 统一改。

---

## 0. 先说三个最重要的坑（决定方案怎么写）

这三条是本次实测最有价值的发现，都会直接导致「看似成功、实际推不出东西」。

### 坑 1：FRED 一个坏ID 会让整批请求变成 HTML 错误页

`fredgraph.csv?id=A,B,C` 里只要有**任何一个** ID 不存在或已停用，返回的是
**HTTP 404 + `text/html` 的整页错误**（不是 CSV、不是 200）。

实测：

| 请求 | 结果 |
|---|---|
| `?id=DFII10,DGS10,DGS2,DTWEXBGS,DTWEXAFEGS` | 200 CSV，5 列齐全|
| `?id=GOLDAMGBD228NLBM`（LBMA 金价） | **404 text/html** |
| `?id=DFII10,DGS10,BADID12345` | 200 CSV，**静默丢弃** BADID12345，返回 2 列 |
| `?id=BADID12345`（只有坏 ID） | **404 text/html** |
| `?id=DFII10,BADID12345,PCOPPUSDM`（混合频率 + 坏 ID） | **404 text/html** |

规律：**全批频率一致时，坏 ID 被静默丢弃（危险：你会以为拿到了全部）；频率不一致或整批全坏时，返回 404 HTML（连 CSV 都不是）。**

### 坑 2：FRED 混合频率会返回 ZIP，不是 CSV

不是「序列数超过 5 个」，而是**频率不同**。实测同一天、同一 URL 形态：

|组合 | 返回 |
|---|---|
| 5 个日频 `DFII10,DGS10,DGS2,T10YIE,T10Y2Y` | 200 `application/csv` |
| 2 个周频 `NFCI,ANFCI` | 200 CSV |
| 2 个月频 `PCOPPUSDM,PALUMUSDM` | 200 CSV |
| 日频 + 月频 `DFII10,PCOPPUSDM` | **200 `application/zip`（内容以 `PK` 开头）** |
| 周频 + 月频 `NFCI,ANFCI,PCOPPUSDM` | **200 ZIP** |

脚本必须判 `Content-Type`：是 `application/zip` 就不能按 CSV 解析，要解压。
**结论：FRED 必须按频率分批请求，每批同频率。**

### 坑 3：`observation_date` 是数据日期，不是发布日期

框架用`publishedAt` 判「旧文不刷屏」（48 小时 / 12 个月门槛，见 `docs/sources.md`）。

实测 FRED CPIAUCSL：

```
observation_date,CPIAUCSL
2026-06-01,332.568
2026-07-01,332.813
2026-08-01,334.131← 数据所属8 月
```

`2026-08-01` 是**8 月的数据**，但它是在 **9 月中旬**才发布的。若直接把
`observation_date` 当 `publishedAt` 推上去，会被判成「旧文」静默归档，**站内一条都不会出现**。

**结论：所有统计类源都必须自造发布日期，不能用数据自带的时间字段。**
可用的替代做法（`fetch-cftc.ts` 已经是这个模式）：用「今天」或「官方发布日」当
`publishedAt`，把真实数据日期放进 `raw`。CFTC 用的是文件里的报告日期，那是因为
CFTC 的报告日期本身就是发布周期标记；FRED 没有这个字段。

补充：**ALFRED 不能解决发布时间问题**。实测 ALFRED 的列名是
`CPIAUCSL_20261005`，后缀是「这份数据被快照的日期」，不是官方发布日期；
`https://api.stlouisfed.org/fred/releases`（唯一给发布日历的接口）**需要 key**，免 key 返回 400。

---

## 1. 可用信源清单（分四类，全部实测）

### 1.1 RSS 直接接（免 key，框架 `rss` 类型，零开发）

这一类最省事：填个 `feedUrl` 就能用，且**自带合规的 `pubDate`**。

| 名称 | 免费 | 实测 URL | 状态 | 条数 / 日期 | 补的主题 | 频率 |
|---|---|---|---|---|---|---|
| **BEA**（美国经济分析局） | 🟢 | `https://apps.bea.gov/rss/rss.xml` | 200 `text/xml` | 49 条，`pubDate` 齐全，首条 `Wed, 30 Sep 2026 08:30:00 EDT` | GDP / PCE / 个人收入 / 国际贸易 | 每月 |
| **Census**（美国普查局） | 🟢 | `https://www.census.gov/economic-indicators/indicator.xml` | 200 `application/xml` | 18 条，日期齐全，首条 `Mon, 05 Oct 2026 16:05:06 -0400` | 零售销售 / 住房 / 制造业订单 | 每月 |
| **BoE**（英国央行） | 🟢 | `https://www.bankofengland.co.uk/rss/news` | 200 `text/xml` | 50 条，日期齐全，首条 `Fri, 02 Oct 2026 09:00:00 +0100` | 英国利率 / 通胀 / 英镑 | 每日 |
| **BoJ**（日本央行） | 🟢 | `https://www.boj.or.jp/en/rss/whatsnew.xml` | 200 `text/xml` | 49 条，日期齐全，首条 `Mon, 05 Oct 2026 14:00:00 +0900` | 日本货币政策 / 日元 | 每日 |
| **BIS**（国际清算银行） | 🟢 | `https://www.bis.org/doclist/all_pressrels.rss` | 200 `application/rss+xml` | 10 条，日期齐全，首条 `2026-10-05T00:00:00Z` | 全球银行体系 / 利率 / 跨境流动性 | 每周 |
| **WTO**（世界贸易组织） | 🟢 | `https://www.wto.org/library/rss/latest_news_e.xml` | 200 `text/xml` | 10 条，日期齐全，首条 `Mon, 05 Oct 2026 15:19:59 GMT` | 全球贸易 / 关税 / 争端| 每周 |
| ECB（已接） | 🟢 | `https://www.ecb.europa.eu/rss/press.html` | 200 `application/rss+xml` | 15 条，日期齐全 | 欧元区货币（已有） | 每日 |

**BEA 的实测条目质量**（这四个 RSS 里对贵金属最有用）：

```
Personal Income and Outlays, August 2026          → /news/2026/personal-income-and-outlays-august-2026
GDP, (Third Estimate), Industries, Corporate...   → /news/2026/gdp-third-estimate-...
U.S. International Transactions and Investment Position, 2nd Quarter 2026
U.S. International Trade in Goods and Services, July 2026
```

全是 `T1` 官方一手，且**标题自带数据期次**（`August 2026`、`2nd Quarter 2026`），
正文页有完整表格。对「降息预期 → 实际利率 → 黄金」这条本站主线，
BEA 的 PCE 数据是黄金定价的核心变量之一。

### 1.2 JSON API（免 key，框架 `json_list` 可直吃）

| 名称 | 免费 | 实测 URL | 状态 | 字段样例 / 日期 | 能否 json_list 直吃 |
|---|---|---|---|---|---|
| **Treasury FiscalData**（美债余额） | 🟢 | `https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny?sort=-record_date&page[size]=3` | 200 `application/json` | `data` 数组 3 条；`record_date=2026-10-02`、`tot_pub_debt_out_amt=40242446619209.33` | ✅ **能**。扁平数组，`itemsPath=data`，`publishedAtPath=record_date` |
| **Treasury FiscalData**（平均利率） | 🟢 | `https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates?sort=-record_date&page[size]=5` | 200 JSON | `record_date`、`security_desc`、`avg_interest_rate_amt` | ✅ 能，同上 |
| **chinamoney 中间价**（人民币汇率） | 🟢 | `https://www.chinamoney.com.cn/ags/ms/cm-u-bk-ccpr/CcprHisNew` | 200 JSON 4827B | `records` 数组 15 条；`{"date":"2026-09-30","values":["6.7351",...]}`；`head` 里有 25 个货币对 | ⚠️ 半可用。`records` 是数组可作 `itemsPath`，但 **`values` 是嵌套数组**，框架不支持数组下标 → 建议走脚本 |

FiscalData 这两个端点是我实测到的**唯一两个完全符合 `json_list` 要求的宏观 JSON 源**：
数组扁平、日期字段独立、数值字段独立。配置示例：

```json
{
  "url": "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny?sort=-record_date&page[size]=5",
  "mode": "json_api",
  "itemsPath": "data",
  "titlePaths": ["record_date"],
  "urlTemplate": "https://fiscaldata.metalsmacro.local/debt/{raw:record_date}",
  "publishedAtPath": "record_date",
  "publishedAtUnit": "yyyymmdd"
}
```

注意 `record_date` 是 `2026-10-02` 这种带横线的日期，**不要配 `publishedAtUnit`**（那个是给
`20261002` 这种紧凑格式用的）。

>FiscalData 的价值：美债余额 + 联邦利息支出是「黄金作为非主权储备资产」叙事里
> 最有说服力的**官方数字**。全网中文站基本没有把这条数据日更并解读成中文的。

### 1.3 CSV / 需自写脚本（框架 `json_list` 不吃 CSV）

**这三个是本次实测最值得投入脚本的**——`scripts/fetch-cftc.ts` 已经是这个模式，直接照抄结构。

| 名称 | 免费 | 实测 URL | 状态 | 行数 / 样例 | 日期字段 |
|---|---|---|---|---|---|
| **U.S. Treasury 收益率曲线** | 🟢 | `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/2026/all?type=daily_treasury_yield_curve&field_tdr_date_value=2026&page&_format=csv` | 200 `text/csv` | 192 行（2026-01-02 至 2026-10-05）；表头 `Date,"1 Mo","1.5 Month","2 Mo","3 Mo","4 Mo","6 Mo","1 Yr","2 Yr","3 Yr","5 Yr","7 Yr","10 Yr","20 Yr","30 Yr"` | ✅ `Date` 列，格式 `10/05/2026` |
| **FRED**（多序列，见坑 1/2/3） | 🟢 | `https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFII10,DGS10,DGS2,T10YIE,T10Y2Y&cosd=2026-08-01` | 200 `application/csv` | 91 行；表头 `observation_date,DFII10,DGS10,DGS2,T10YIE,T10Y2Y` | ⚠️ `observation_date` 是**数据日期**，见坑 3 |
| **ECB SDW**（汇率 / 宏观） | 🟢 | `https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?format=csvdata&lastNObservations=30` | 200 `text/csv` | 31 行；表头 `KEY,FREQ,CURRENCY,CURRENCY_DENOM,...,TIME_PERIOD,OBS_VALUE` | ✅ `TIME_PERIOD=2026-10-05`（ISO 日频，可直接用） |
| **BoE 银行利率** | 🟢 | `https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp?csv.x=yes&Datefrom=01/Jun/2026&Dateto=now&SeriesCodes=IUDBEDR&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N` | 200 `application/csv` | 90 行；表头 `DATE,IUDBEDR`，末行 `02 Oct 2026,3.75` | ✅ `DATE` 列 |

**注意 ECB SDW 的坑**：加 `startPeriod` 会 `fetch failed`（实测 ERR），
必须用 `lastNObservations=N`。另外 ECB **没有黄金序列**——`D.XAU.EUR.SP00.A` 返回
404 `No Series was returned`，`D.XAUUSD.SP00.A` 返回 400。想拿欧元金价只能自己用
`EXR/D.USD.EUR.SP00.A` 换算。

**FRED 已实测有效的序列 ID**（逐个单发验证过）：

| ID | 含义 | 频率 | 最新值（实测） |
|---|---|---|---|
| `DFII10` | 10 年期 TIPS 实际收益率 | 日 | 2.92（2026-10-02） |
| `DGS10` / `DGS2` | 10 年 / 2 年美债名义收益率 | 日 | 5.28 / 4.83 |
| `T10YIE` | 10 年盈亏平衡通胀率 | 日 | 2.36 |
| `T10Y2Y` | 10Y-2Y 期限利差 | 日 | 0.47 |
| `DTWEXBGS` | 广义美元指数（**本站缺这个**） | 日 | 121.3848 |
| `DTWEXAFEGS` | 贸易加权美元（AFE 版本） | 日 | 114.8831 |
| `NFCI` / `ANFCI` | 芝加哥联储金融状况指数 | **周** | -0.548（2026-09-25） |
| `PCOPPUSDM` | 铜（全球现货） | **月** | 13542.8（2026-07） |
| `PALUMUSDM` | 铝 | **月** | 3158.27 |
| `DCOILWTICO` | WTI 原油 | 日 | 96.16（2026-09-29） |
| `GVZCLS` | 黄金波动率指数（**本站缺这个**） | 日 | 23.23 |

**已失效、不要用的 ID**（实测 404 text/html）：
`GOLDAMGBD228NLBM`、`GOLDPMGBD228NLBM`（LBMA 金价，FRED 已下架）、
`SLVPRUSD`、`SLVUSD`、`SLVPPUSD`（白银）、`PIALUBMIT`、`NIAGUSDM`、`ZSDOD`。

> 这直接回答了一个产品问题：**FRED 拿不到金银现货价**。
> 本站 `price-snapshot.ts` 用 `api.gold-api.com` 拿金银铂钯铜价格，**这个选择是对的，不要动**。
> FRED 在本站的定位应该是**宏观解释变量**（实际利率、美元指数、期限利差、金融状况），
> 和 `price-snapshot` 互补而不是重复。

分批建议（按频率分，每批 ≤5 个同频率）：

```
批1（日频·债与利率）  DFII10,DGS10,DGS2,T10YIE,T10Y2Y
批 2（日频·美元）     DTWEXBGS,DTWEXAFEGS,GVZCLS,DCOILWTICO
批 3（周频）NFCI,ANFCI
批 4（月频·金属）     PCOPPUSDM,PALUMUSDM
```

### 1.4 web_list 需选择器（有 HTML 列表，框架 `web_list`）

中国部委官网里**实测确认可用的只有2 个**，其余都是 JS 空壳（见第 3 节）。

| 名称 | 免费 | 实测 URL | 状态 | 条目结构 | 日期 |
|---|---|---|---|---|---|
| **国家发改委**（政策发布） | 🟢 | `https://www.ndrc.gov.cn/xxgk/zcfb/fzggwl/` | 200 HTML 35KB | `ul.u-list > li`，`<li>` 50+ 个，链接形如 `./202609/t20260928_1407859.html` | ✅ `<span>2026/09/28</span>`（在 `li` 内） |
| **国家发改委**（新闻发布） | 🟢 | `https://www.ndrc.gov.cn/xwdt/xwfb/` | 200 HTML 8KB | `<li>` 31 个，链接 `./202609/t20260930_1407977.html` | ✅ 同上 |
| **商务部**（新闻发布） | 🟢 | `https://www.mofcom.gov.cn/` | 200 HTML 34KB | `li > a`，链接 `/syxwfb/art/2026/art_<hash>.html`，39 条 | ❌ **`li` 内无日期**，需 `detail` 补抓 |
| **PBOC**（已接的公开市场公告） | 🟢 | `http://www.pbc.gov.cn/goutongjiaoliu/113456/113469/index.html` | 200 HTML 38KB | 已在 `industry/sources.json`（`web-pboc-announce`） |✅ 已有 |

发改委的配置（实测结构）：

```json
{
  "url": "https://www.ndrc.gov.cn/xxgk/zcfb/fzggwl/",
  "parseMode": "html",
  "itemSelector": "ul.u-list > li",
  "linkSelector": "a",
  "titleSelector": "a",
  "publishedAtSelector": "span",
  "allowUrlPrefixes": ["https://www.ndrc.gov.cn/xxgk/zcfb/"]
}
```

发改委实测条目原文（确认 `span` 是日期、标题在 `title` 属性和文本里都有）：

```html
<li><a href="./202609/t20260928_1407859.html" target="_blank"
       title="《水电站大坝运行安全监督管理规定》 2026第47号令">…</a>
    <script>…</script>
    <div class="popbox">…</div>
    <span>2026/09/28</span></li>
```

商务部因为 `li` 内无日期，必须配 `detail`：

```json
{
  "url": "https://www.mofcom.gov.cn/",
  "parseMode": "html",
  "itemSelector": "li",
  "linkSelector": "a",
  "titleSelector": "a",
  "allowUrlPrefixes": ["https://www.mofcom.gov.cn/syxwfb/art/"],
  "detail": { "publishedAtSelector": ".info, .time, .date" }
}
```

> 提醒：商务部首页混了大量 `gov.cn` 转载链接，必须用 `allowUrlPrefixes` 收窄到
> `/syxwfb/art/`，否则会把国务院新闻混进来（实测首页有 9 条 `content_*.htm` 指向 gov.cn）。

---

## 2. 付费源（列出来但不接）

| 源 | 状态 | 说明 |
|---|---|---|
| Reuters / Bloomberg / FT | 🔴 不接 | 授权付费，无免费 API |
| Conference Board | 🔴 不接 | 消费者信心/领先指标为会员订阅，API 需付费 |
| ADP | 🔴 不接 | 私营就业报告为付费产品 |
| LME / CME | 🔴 不接 | 需市场数据授权（清单里标 🟡 但实际是付费） |
| S&P Global / Fastmarkets / Argus / CRU / Platts / Metals Focus | 🔴 不接 | 商品价格与产业链，均需订阅 |
| Harvard CEPII / IEA 完整数据库 / OPEC ASF 历史 | 🔴/🟡 | 部分数据库付费；IEA 站点实测 403/404（见下） |

---

## 3. 实测失败的关键源（附失败原因）

这部分是本文档最有价值的部分——**避免团队重复踩坑**。

### 3.1 被 Cloudflare / Akamai WAF 拦截（本机出口 IP 被判为爬虫）

这些源**在浏览器里能正常打开**，但服务端返回反爬挑战页。**换 UA、加 Accept 头都无效**：

| 源 | 状态 | 拦截方 | 实测响应特征 |
|---|---|---|---|
| **IMF**（全部网页 + RSS） | 403 | AkamaiGHost | `Access Denied` + `errors.edgesuite.net` 引用号 |
| **OECD**（newsroom + SDMX） | 403 | Cloudflare | `Just a moment...` 挑战页 |
| **OPEC**（全部，含 MOMR PDF） | 403 | Cloudflare | `Attention Required! | Cloudflare`，`cf-ray: ...-LAX` |
| Energy Institute | 403 | Cloudflare | 同上 |
| UNCTAD / UNIDO | 403 | Cloudflare | 同上 |
| Richmond Fed / Philadelphia Fed / St. Louis Fed | 403 | — | 58B–3KB 拦截页 |

**这不是源不可用，是我们的出口 IP 被拦。** 三种应对：
（1）部署时换境外/机房出口 IP；（2）走 Jina Reader（`r.jina.ai`，按次计费）；
（3）放弃。**IMF 和 OPEC 的核心内容都有替代**（IMF 数据走下面 1.2 的
DataMapper API；OPEC 供需走 EIA + IEA + Energy Institute）。

**特例：IMF DataMapper API 是免key 可用的**（见 3.3）。

### 3.2 真失败（源本身没有该路径）

| 源 | 实测 URL | 状态 | 原因 |
|---|---|---|---|
| **Treasury 新闻 RSS** | `/rss/press.xml`、`/rss/press_releases.xml`、`/news/press-releases/feed`、`/system/files/126/ofx-press-releases.xml` | **全 404** | Treasury **根本没有 RSS**。注意 `/system/files/126/...` 返回 200但是 HTML 不是 XML，更坑 |
| **Chicago Fed NFCI CSV** | `/~/media/others/nfci/current/nfci-csv.csv` | 404（返回 50KB HTML 404 页） | 路径已变更。**但 `NFCI` 走 FRED 免key CSV 可拿到**（实测 2909 行，末值 -0.548） |
| **IEA** | `/rss/news`、`api.iea.org/stats/indicator/EOBC`、`/dataset/?query=oil` | 404 / 20B 空响应 | IEA API 需注册 key，且 `/rss/news` 已下线 |
| **UN Comtrade** | `/public/v1/preview/C/A/HS?...reporterCode=0` | 200 但 `data=[]`；换正常参数 **429** | preview 端点要 key；免key 会限流 |
| **ILO** | `/rss/news.xml` | 404 | 无此 RSS。ILO SDMX（`rplumber.ilo.org`）实测 200 CSV **7.5MB / 4827 行**，但体量过大、字段稀疏，不建议 |
| **FAO** | `/rss/news/en` | 404（返回 HTML） | 无此路径 |
| **Eurostat RSS** | `/api/dissemination/catalogue/rss/en/eurostat-news.rss` | 404（9B 空body） | 该 RSS 不存在。Eurostat **只有 JSON API**（见 3.3） |
| **OECD SDMX** | `sdmx.oecd.org/public/rest/data/OECD.SDD.STES,DSD_STES@DF_FINMARK,4.1/all` | 404 `Could not find Dataflow` | Dataflow ID 已变更，且无公开文档指向新 ID |
| **BIS SDMX** | `stats.bis.org/api/v1/data/...`、`/api/v2/data/dataflow/...` | 404 | BIS 统计门户 API 需注册。**但 BIS 新闻 RSS 可用**（200/ 10 条） |
| **UN Statistics** | `unstats.un.org/home/nso/` | 404（1245B） | 站点改版 |
| **Chicago Fed** 区域页面 | `/data/nfci/current-data` | 404 | 路径变更 |
| Dallas / Kansas City Fed RSS | `/rss/news.xml`、`/feed/` | 404 | 无RSS。Dallas Fed 的经济调查数据只提供 XLSX 下载 |

### 3.3 中国信源：大量「200 但 items=0」

**这是本次最需要警惕的一类。** 全部返回 HTTP 200，但响应体里**没有任何文章链接**：

| 源 | 实测 URL | 状态 | 响应体 | 为什么失败 |
|---|---|---|---|---|
| **国家统计局** 数据发布日程 | `https://www.stats.gov.cn/sj/fbrc/` | 200 | **仅 575B / 21 行** | JS 渲染，HTML 里0 个文章链接 |
| **国家统计局** 数据查询 API | `https://data.stats.gov.cn/easyquery.htm?m=QueryData...` | **403** | 294B | 反爬拦截 |
| **国家能源局** 统计数据 | `https://www.nea.gov.cn/sjzz/index.htm` | 200 | **仅 2234B / 7 个链接 / 0 个日期** | 空壳页。`/sjzz/tjsj.htm`、`/sjzz/dljy.htm` 均 404 |
| **工信部** 运行监测 | `https://www.miit.gov.cn/gxsj/tjfx/index.html` | 200 | 仅 5039B / 18 链接 / **1 个日期串** | 链接全是 `/index.html` 导航，无文章列表 |
| **金融监管总局** | `/cn/view/pages/ItemList.html?itemPId=914&itemId=915` | 200 | 仅 3964B / 4 个 `<li>` / 0 日期 | 前端框架渲染，响应里没数据 |
| **SAFE**（外汇局） | `/safe/whsj/index.html`、`/safe/tjsj/index.html`、`/safe/whshx/index.html` | **全 404**（1247B 自定义 404 页） | 路径全错。**但首页 `https://www.safe.gov.cn/` 200 / 86KB / 76 个日期串 / 227 个链接，可用** |
| **海关总署** | `http://www.customs.gov.cn/customs/...`、`stats.customs.gov.cn` | **412** | 2089B | 反爬（412 Precondition Failed），https 版直接连不上 |
| **上交所 / 深交所** | `/market/stockdata/overview/`、`/market/overview/index.html` | 200 | 17KB / 27KB，日期极少 | 数据表格 JS 渲染 |
| **CFETS 收益率曲线** | `https://www.chinamoney.com.cn/chinese/ycqx/` | 404（36B） | 路径不存在。`/chinese/bkccpr/` 200 但也是 JS 壳 |
| **财政部** 政策发布 | `http://www.mof.gov.cn/zhengwuxinxi/zhengcefabu/` | 200 | 20KB HTML | 页面有内容，但日期格式需 detail 补抓，可行性中等 |
| **证监会** | `/csrc/c100028/common_list.shtml` | 200 | 14KB | 日期串是 **2021 年**的旧数据，页面结构未变但内容陈旧 |
| **发改委** 原始路径 | `/xxgk/zcfb/` | 200但**仅 54B** | `<script>window.location.href='./fzggwl/'</script>` | **200 但只有一行 JS 跳转**。真实路径是 `/xxgk/zcfb/fzggwl/`（见 1.4） |

**唯一意外收获**：`https://www.chinamoney.com.cn/ags/ms/cm-u-bk-ccpr/CcprHisNew` 是真实可用的
JSON 接口（人民币中间价，25 个货币对），但 `values` 是嵌套数组，框架吃不下，需脚本。

---

## 4. 每类能补齐哪些主题

| 主题（本站现有覆盖） | rss 直接接 | json api | csv 需脚本 | web_list |
|---|---|---|---|---|
| **美债收益率**（现只有 Fed H10 + 新闻） | — | — | ★ Treasury 全期限曲线（1/2/3/6M→30Y，每日）；FRED DGS2/DGS10/T10Y2Y | — |
| **实际利率 / 通胀预期**（黄金定价核心，现缺） | — | — | ★ FRED `DFII10` + `T10YIE`（日频） | — |
| **美元指数**（现缺） | — | — | ★ FRED `DTWEXBGS` + `DTWEXAFEGS`（日频） | — |
| **黄金波动率**（现缺） | — | — | FRED `GVZCLS`（日频） | — |
| **GDP / PCE / 个人收入**（现缺） | ★ **BEA**（49 条，月度） | — | — | — |
| **CPI / 非农**（现缺） | — | BLS v2 免 key（但嵌套数组需脚本） | — | — |
| **零售销售**（现缺） | ★ **Census**（18 条） | — | — | — |
| **金融状况**（现缺） | — | — | FRED `NFCI`/`ANFCI`（周频） | — |
| **美债余额 / 利息支出**（现缺） | — | ★ **FiscalData**（日频，可 json_list 直吃） | — | — |
| **欧元区汇率 / 宏观**（现只有 ECB 新闻 RSS） | ECB（已有） | — | ECB SDW（欧元汇率，日频 ISO 日期） | — |
| **英国利率**（现缺） | ★ **BoE** RSS（50 条，日度） | — | BoE 银行利率 CSV | — |
| **日本货币政策 / 日元**（现缺） | ★ **BoJ** RSS（49 条，日度） | — | — | — |
| **全球银行 / 美元流动性**（现缺） | ★ **BIS** RSS（周度） | — | — | — |
| **全球贸易 / 关税**（现缺） | ★ **WTO** RSS（周度） | — | — | — |
| **人民币汇率**（现缺） | — | chinamoney（需脚本） | — | — |
| **中国宏观政策**（现只有 PBOC + 统计局） | — | — | — | ★ 发改委政策/新闻；商务部（需 detail） |
| **原油**（现只有 EIA RSS） | — | — | FRED `DCOILWTICO`（日频） | — |
| **铜/ 铝**（现只有 gold-api 现货） | — | — | FRED `PCOPPUSDM`/`PALUMUSDM`（月频） | — |

---

## 5. 最值得优先接的 5 个（按投入产出排序）

排序依据：主题缺口大小 × 是否零开发 × 是否免key × 数据可信度（是否 T1 官方）。

### 第 1 名：BEA RSS（`rss`，零开发）

- URL：`https://apps.bea.gov/rss/rss.xml`，实测 200 / 49 条 / 日期齐全
- **理由**：填补最大的主题缺口——本站有 Fed 政策新闻，但**没有任何美国通胀/收入/GDP 的官方数据源**。
  而 PCE 是黄金定价的核心变量（「实际利率」这条本站主线缺了它就讲不完整）。
  `rss` 类型只要填个URL 就能跑，零开发成本，条目是 T1 官方一手。
- 频率：每月 8–10 条，适合「每月宏观数据速递」栏目。

### 第 2 名：FRED CSV 脚本（`external`，一次投入长期收益）

- URL：`https://fred.stlouisfed.org/graph/fredgraph.csv?id=<同频率ID，最多5个>&cosd=<日期>`
- **理由**：**一个源补齐 4 个主题缺口**——美元指数、实际利率、期限利差、金融状况指数，
  外加黄金波动率。这些都是「解释金价为什么涨」的数据，且 FRED 是 T1 官方（圣路易斯联储）。
  关键是**免 key**（`api.stlouisfed.org` 才要 key）。
- 必须遵守三条：按频率分批（否则返回 ZIP）、同批次不能有坏 ID（否则 404）、
  **`publishedAt` 必须自己造**（`observation_date` 是数据日期，用了会被静默归档）。
- 建议顺带把 `price-snapshot.ts` 覆盖不到的「宏观解释变量」补上，
  而不是重复它已有的金银铂钯铜现货价。

### 第 3 名：Treasury 收益率曲线 CSV（`external`）

- URL：见 1.3（`home.treasury.gov/.../daily-treasury-rates.csv/2026/all?...&_format=csv`）
- **理由**：实测 192 行、1 个月到 30 年**全期限**都在一列里，且`Date` 列是`10/05/2026`
  这种**真实交易日**（不是数据所属期），可以直接当发布日期用，省掉坑 3 的麻烦。
  黄金与实际利率的联动是本站主线，这里是唯一官方全期限数据源。
- 注意：URL 里的年份（`/2026/`）要跟着年份跨年更新，脚本里别写死。

### 第 4 名：FiscalData（`json_list`，零开发，但只此一家）

- URL：`https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny?sort=-record_date&page[size]=5`
- **理由**：**唯一实测完全符合 `json_list` 要求的宏观 JSON 源**（扁平数组 + 独立日期字段 +
  独立数值字段），配置即可跑，不需要写脚本。日频更新的美债余额配合利息支出，
  是「债务货币化 → 黄金抗 confiscation 叙事」最硬的官方数字。全网中文站几乎没人做日更。
- `avg_interest_rates` 端点同结构，可作第二个源（联邦平均付息利率）。

### 第 5 名：Census RSS + BoE/BoJ/BIS/WTO RSS（`rss`，零开发，可批量）

- URL：见 1.1
- **理由**：四个RSS 全是 200 + 日期齐全 + T1 官方，加起来**零开发成本**补齐
  零售销售 / 英国利率 / 日本货币政策 / 全球银行体系 / 全球贸易五个主题。
  单独看价值一般，但**边际成本为零**，一次配置四个信源。
  BoJ 和 BoE 尤其重要——它们是黄金的**主要竞争性资产**（负利率、日元套息），
  日本央行政策转向是金价的重要驱动。

**次优先（值得做但不急）**

- ECB SDW CSV：`TIME_PERIOD` 是 ISO 日期可直接用，但 ECB 汇率对本站价值低于美元指数。
- chinamoney 中间价 JSON：人民币汇率，**需脚本**（`values` 嵌套数组）。
- 发改委 `web_list`：中国宏观政策口，实测条目与日期都干净，但本站已有 PBOC + 统计局，
  边际增量中等。
- BLS v2：**免 key 可用**（实测 `REQUEST_SUCCEEDED`，CPI 32 条），
  但有 **25 次/天**免 key 限额，且嵌套数组需脚本。注册免费 key 可提到 500 次/天。

---

## 6. 给team-lead 的落地建议

1. **本轮先接 3 个零开发的**：BEA RSS、Census RSS、FiscalData `json_list`。
   这三个不改任何代码，直接在后台「信源」页新建即可跑通，零风险。
2. **再写1 个脚本**：`scripts/fetch-macro.ts`，参考 `scripts/fetch-cftc.ts` 的结构，
   一次覆盖 FRED（分 4 批）+ Treasury 收益率曲线。这是投入最大但长期收益最高的一步。
3. **顺手批量接 4 个 RSS**：BoE、BoJ、BIS、WTO。一次性配置，无成本。
4. **不要接的**：IMF / OECD / OPEC / Energy Institute / UNCTAD / UNIDO（本机出口 IP 被WAF 拦，
   且都有替代）；海关总署 / 统计局 fbrc / 能源局 / 工信部 / 金融监管总局（真失败，
   JS 空壳或反爬）。
5. **写脚本时务必实现三道断言**（照 `fetch-cftc.ts` 的 `identityHolds` 思路）：
   （a）FRED 响应 `Content-Type` 是 `application/zip` 就报错，不要当 CSV 解析；
   （b）返回列数少于请求序列数就报错（坏ID 被静默丢弃）；
   （c）`publishedAt` 用「今天」而非 `observation_date`，否则会被静默归档。
6. **付费源清单**（Reuters/Bloomberg/FT/Conference Board/ADP/LME/CME/Fastmarkets 等）
   已在第 2 节列出，标注「不接」，无需再测。

---

## 附：实测方法与可复现性

- 所有请求用 Node 22 原生 `fetch`，浏览器 UA，`redirect: follow`，超时 25s。
- 本机存在出口代理（`HTTP_PROXY=127.0.0.1:60715`），**这解释了为什么 Akamai/Cloudflare 会拦**——
  机房 IP 被判为爬虫。部署时若换出口 IP，第 3.1 节的部分源可能直接可用，值得复测一次。
- 临时探针脚本已清理（移至 `.trash-stage/macro-probe/`），未改动任何业务代码或配置。