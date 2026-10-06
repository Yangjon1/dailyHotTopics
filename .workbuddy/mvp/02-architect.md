# 技术架构方案· 贵金属 + 大宗商品 + 股债行业热点站

> 原文框架：AIHOT（KKKKhazix/AIHOT）· 改造范围：`site/` + `industry/` + `modules/`
> 文档版本：v1.0 · 架构师：高见远 · 日期：2026-10-05
> 本文按「规格即契约」写：点名文件、钉死版本、内嵌已知坑、以端到端验证步骤收尾。

---

## 0. 结论摘要

### 0.1 Windows 可行性判定（一句话）

**可行，但有条件**：代码本身没有任何 POSIX 硬编码（已grep 全量验证），`npm run dev:api / dev:worker / dev:web` 能在 Windows 11 本机跑起来；**唯一硬阻断是 Node 版本** —— 必须在 PATH 里把 `D:\nodejs`（v25.8.0）排到 `.workbuddy` 内置的 v22.22.2 之前，否则 `npm test` 挂。

**数据库唯一可行的连接方式**：

```dotenv
# 前提：先启动 Docker Desktop（当前 com.docker.service = Stopped，必须手动开）
DATABASE_URL=postgres://aihot:aihot@127.0.0.1:5432/aihot
```

配套测试库（`npm test` 用，名字必须以 `_test` 或 `_ci` 结尾，否则 `tests/setup.ts:13` 直接抛错）：

```dotenv
DATABASE_URL_TEST=postgres://aihot:aihot@127.0.0.1:5432/aihot_test
```

启动数据库的确切命令：

```bash
docker run -d --name aihot-pg \
  -e POSTGRES_USER=aihot -e POSTGRES_PASSWORD=aihot -e POSTGRES_DB=aihot \
  -p 127.0.0.1:5432:5432 \
  -v aihot-pgdata:/var/lib/postgresql/data \
  --restart unless-stopped \
  postgres:17-alpine
```

>端口绑 `127.0.0.1` 而非 `0.0.0.0`：本机开发不需要暴露到局域网，且避免 Windows 防火墙弹窗。

### 0.2 最大的 3 个技术风险

| # | 风险 | 后果 | 处置|
|---|---|---|---|
| **R1** | **DeepSeek 没有 `/embeddings` 端点**（已联网核实，官方 OpenAI 兼容面只有 `chat/completions`） | 只配 DeepSeek 时 `embeddingsAvailable()` 返回 false，聚簇降级为**字符 bigram 文字重合度**（`relate.ts:194`，阈值 `LEXICAL_MIN=0.25`）。金融术语同义不同词（「非农」/「非农就业」「NFP」、「缩表」/「资产负债表缩表」）会漏召回 | **必须额外配一个 embedding 供应商**（阿里 DashScope `text-embedding-v4`，1024 维，国内、便宜）。见 §3.1 |
| **R2** | **Node 版本分裂**。`package.json:13` 要求 `>=24.11`；本机 PATH 首位是 `.workbuddy` 内置 **v22.22.2**，实测 `node --test-global-setup` 直接 `bad option`（该flag 需 Node ≥23/24）→ `npm test` 100% 失败 | 测试跑不起来，无法验收 | 用`D:\nodejs\node.exe`（**v25.8.0 / npm 11.11.0**，已实测支持该flag），并把它所在目录排到 PATH 首位。见 §1.2 |
| **R3** | **行情播报污染事件层**。财经媒体一天几十条「金价涨 2% 触及新高」，`group-*.md` 归组会把它们聚成垃圾事件；`hot.ts` 的热度（48h 窗口 + 24h 半衰 + `MIN_PARTICIPANTS=2`）对**同一主体重复播报**会持续加热，而金融语境下「金价上涨」不是事件 | 热点榜被行情噪声占满，真事件被挤掉 | 预筛层加**行情播报识别规则**（机械可判，不花模型），并把这类条目在归组前打成 `standalone`。见 §4.3 |

**已闭环的原V1（2026-10-05 补测）**：「同一 URL 内容变化是否被跳过」曾是唯一可能反过来改架构的未知数。**实测结论：不是跳过，也不是新条目——是同一篇 `articles` 行开新修订（`revision+1`）并重跑整条分析管道。官方统计类信源（CFTC / USGS / LBMA）可即插即用 `json_list`，零代码改动，只需 0.2 人日的配置。** 完整机制、真实复现输出与5 个内嵌坑见 **§12**。

---

## 1. 任务 1：Windows 本机可行性（实测结论）

### 1.1 实测环境输出（原样记录）

```
$ node --version
v22.22.2                      # PATH 首位：.workbuddy 内置，不满足 engines >=24.11

$ npm --version
10.9.7

$ docker --version
Docker version 29.4.1, build 055a478

$ docker info --format "{{.ServerVersion}} | OSType={{.OSType}}"
failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine;
check if the path is correct and if the daemon is running
→ Docker CLI 已装，daemon 未启动

$ systeminfo | head -3
主机名:XIAOMAO666
OS 名称:Microsoft Windows 11 家庭中文版
OS 版本:10.0.22631

$ ls node_modules | wc -l
0                              # 依赖尚未安装，必须先 npm ci

# 第二套 Node（关键发现）
$ /d/nodejs/node.exe --version
v25.8.0                        # [OK] 满足 >=24.11
$ /d/nodejs/npm.cmd --version
11.11.0

$ node -e "console.log(process.features.typescript)"
strip                          # Node 22.22 已支持原生类型剥离
```

服务与端口状态（PowerShell 实测）：

```
C:\Program Files\PostgreSQL      → NOT_INSTALLED
postgres 服务                     → NO_SERVICE
5432 端口                         → PORT_FREE
com.docker.service                → Stopped    ← 需手动启动
```

CLI 开关兼容性实测（决定性证据）：

```
# Node 22.22.2
$ node --env-file-if-exists=.env -e "..."
env-file-if-exists OK                        [OK] 需 Node ≥22.9
$ node --test-global-setup=tests/databases.ts --test ...
node.exe: bad option: --test-global-setup=tests/databases.ts   [NG] npm test 挂

# Node 25.8.0
$ /d/nodejs/node.exe --test-global-setup=tests/databases.ts --test ...
Could not find 'tests/does-not-exist.test.ts'   [OK] flag 解析通过（报错只是我故意给的文件不存在）
$ /d/nodejs/node.exe --env-file-if-exists=.env -e "..."
ok25 v25.8.0                [OK]
$ /d/nodejs/node.exe -e "console.log(process.features.typescript)"
ts-feature: strip                             [OK]
```

### 1.2 结论 1：`dev:api` / `dev:worker` / `dev:web` 能否在 Windows 直接跑

**能。** 三个 workspace 的 dev 脚本逐条核对：

| 命令 | 实际执行 | Windows 判定 |
|---|---|---|
| `npm run dev:api` | `node --watch --env-file-if-exists=../../.env src/main.ts` | [OK] 原生 TS 剥离 + `--watch` 在 Windows 可用（`ReadDirectoryChangesW`）；`--env-file-if-exists` 需 Node ≥22.9，实测 22.22 与 25.8 均支持 |
| `npm run dev:worker` | 同上（`apps/worker/src/main.ts`） | [OK] |
| `npm run dev:web` | `react-router dev --port 3000 --host 127.0.0.1` | [OK] Vite 8.3.1 全平台；`--host 127.0.0.1` 已是显式绑定，不依赖 `localhost` 解析 |
| `npm run db:migrate` | `node --env-file-if-exists=.env scripts/migrate.ts` | [OK] |
| `npm test` | `node --test-global-setup=... --test --test-concurrency=6` | [!]️ **必须 Node ≥24**（见 R2） |

**实际 grep 验证（不是猜测）**：

```bash
# 1. 平台判断 —— 零命中
grep -rn "process\.platform" --include=*.ts --include=*.tsx apps packages industry site scripts tests
→ （无输出）

# 2. Linux 专属路径 —— 零命中
grep -rn "'/var/run|\"/var/run|/var/run/postgres" --include=*.ts --include=*.tsx apps packages industry site scripts
→ （无输出）

# 3. POSIX shell 调用 —— 零命中
grep -rn "sh -c|execSync|bash|/bin/sh" --include=*.ts --include=*.tsx apps packages industry site scripts
→ （只有 apps/web/app/features/agent/panels.tsx 里的 lang="bash" 代码高亮标签，是展示文本，不是执行）

# 4. 硬编码根路径 join —— 零命中
grep -rn "path\.join('/'|path\.resolve('/'|join('/', " apps packages industry site scripts tests
→ （无输出）

# 5. 路径分隔符已在架构测试里处理
tests/architecture.test.ts:26
  const file = path.relative(ROOT, full).split(path.sep).join("/");
→ [OK] 框架已修（deploy.md:133「架构测试不再受路径分隔符影响」）

# 6. 子进程调用全是 process.execPath（跨平台），无裸命令
tests/databases.ts:47   execFileSync(process.execPath, [...])
tests/setup.ts 等同理
→[OK]

# 7. 非 erasable TS 语法（enum/namespace/参数属性）—— 零命中
→ [OK] 可用 Node 原生类型剥离，不需要 ts-node/tsx
```

**唯一需要人工干预的**：`docs/deploy.md:216` 写的是「系统用 Linux 或 macOS；Windows 上请在 WSL2 里运行」。这行**描述的是官方支持矩阵，不是代码限制**。代码实际可跑，因此我们**不改这句话**，而是在 `docs/deploy.md` 追加一节「Windows 本机开发（实验性）」记录实测通过的配置，让后来者不必重新验证一遍。

### 1.3 结论 2：数据库怎么连

**方案 ①（推荐，Docker Desktop 只跑 PostgreSQL）**

```bash
# 前置：手动启动 Docker Desktop（当前 com.docker.service=Stopped）
docker run -d --name aihot-pg \
  -e POSTGRES_USER=aihot -e POSTGRES_PASSWORD=aihot -e POSTGRES_DB=aihot \
  -p 127.0.0.1:5432:5432 \
  -v aihot-pgdata:/var/lib/postgresql/data \
  --restart unless-stopped \
  postgres:17-alpine
```

`.env`（对应 `docker-compose.yml:15` 的配置，只把主机名从 `db` 换成 `127.0.0.1`）：

```dotenv
DATABASE_URL=postgres://aihot:aihot@127.0.0.1:5432/aihot
API_BASE_URL=http://127.0.0.1:3001
AIHOT_DATA_DIR=D:/pytorch/dailyHot/dailyHotTopics/.data
```

> `AIHOT_DATA_DIR` 必须给**Windows 绝对路径**。默认 `.data` 是相对路径（`process.cwd()` 解析），三个进程分别在 `apps/api`、`apps/worker`、`apps/web` 下启动时会解析到**三个不同的目录**，导致上传文件和图片缓存分裂。

**方案 ②（Docker 不可用时）：Windows 原生 PostgreSQL**

实测本机 `NOT_INSTALLED`，需自行安装。选 **PostgreSQL 17 x64**（`deploy.md:216` 要求 16 或 17）：

```powershell
winget install PostgreSQL.PostgreSQL.17
# 安装器必选：安装 pgAdmin、命令行工具、默认端口 5432
# 安装时设置的 superuser 密码就是 POSTGRES_PASSWORD
```

连库配置与方案 ① 完全一致，只需保证 `pg_hba.conf` 允许 `127.0.0.1` 的 `scram-sha-256`（安装器默认已开）。**注意**：原生安装默认不开 `trust`，所以 `DATABASE_URL` 里**必须带密码**，不能用 `postgres://aihot@127.0.0.1:5432/aihot` 这种省略密码的写法（`deploy.md:227` 的示例是 Linux `peer` 认证下的写法，在 Windows 上会认证失败）。

**两套方案都必须先跑一次迁移**（本机不跑 `setup` 容器）：

```bash
node --env-file=.env scripts/migrate.ts
node --env-file=.env scripts/seed.ts
npm run build -w @aihot/web
```

### 1.4 结论 3：测试的 CREATEDB 机制（已读 `tests/databases.ts` 确认）

模板库必须**以 `_test` 或 `_ci` 结尾**，否则 `tests/setup.ts:12-15` 直接抛错：

```ts
const database = new URL(process.env.DATABASE_URL ?? "...").pathname.slice(1);
if (!/_(test|ci)$/.test(database)) throw new Error(`Invariant tests write rows: ...`);
```

`tests/databases.ts` 的机制（逐行确认）：

1. `onServer()`（第 28 行）**硬编码连到 `postgres` 库**：`postgres(urlOf("postgres"), { max: 1 })`。
   → **所以 `DATABASE_URL` 里的主机/端口/用户/密码必须能连到 `postgres` 库**。这正是 Docker 官方镜像的 superuser（`aihot`）能自动建库的原因。
2. `globalSetup()`（第 43-49 行）连 `postgres` 库→ `CREATE DATABASE` 模板库（若不存在）→ 跑 `scripts/migrate.ts` 升到最新 → 清理上次中断遗留的副本。
3. 每个测试文件进程内（第 62-71 行）：`CREATE DATABASE <name>_f<pid>_<suffix> TEMPLATE <name>`，然后**改写 `process.env.DATABASE_URL` 指向自己的副本**，并把 `AIHOT_DATA_DIR` / `TMPDIR` 指到自己的 `mkdtemp` 临时目录。
4. `globalTeardown()`（第 54-59 行）按 `copyPattern` 正则 `^<name>_f[0-9]+_<suffix>$` 删除所有副本。

**给测试用的配置**（`DATABASE_URL` 指向 `_test` 库，不是默认的 `postgres` 库）：

```dotenv
# 跑测试时用这个（可以放 .env.test，测试时用 --env-file 指定）
DATABASE_URL=postgres://aihot:aihot@127.0.0.1:5432/aihot_test
```

**权限要求核对**：Docker 官方 `postgres:17-alpine` 里 `POSTGRES_USER=aihot` 创建的就是 **superuser**，拥有 `CREATEDB` [OK] 且能连 `postgres` 库 [OK]。Windows 原生安装时 `installers 建的 superuser`（默认 `postgres`）同样满足。**若将来要用最小权限账号**（非 superuser），需要手动 `ALTER ROLE <app> CREATEDB;`，否则 `globalSetup` 会在 `CREATE DATABASE` 处失败——但注意 `CREATE DATABASE ... TEMPLATE` 还需要该角色是模板库的 owner。

**副本爆炸风险**：`--test-concurrency=6`，每次 `npm test` 最多产生 6 个 `aihot_test_f<pid>_test` 副本库。如果中途 `Ctrl+C`，`globalTeardown` 不跑，残留库靠**下次** `globalSetup` 的 `dropCopies()` 清理（第 48 行）[OK] 已内置兜底，无需人工。

### 1.5 结论 4：Windows 特有坑（逐条核实）

| 坑 | 判定 | 依据 / 处置 |
|---|---|---|
| **路径分隔符进 CSS 选择器 / URL** | [OK] 无风险 | 唯一涉及处`tests/architecture.test.ts:26` 已`.split(path.sep).join("/")`。框架无`path.sep` 拼选择器的代码 |
| **SQLite 临时文件** | [!]️ 不适用但有雷 | 框架**不用 SQLite**（只用 Postgres）。`tests/databases.ts:66-70` 用 `os.tmpdir()` + `mkdtemp`，Windows 上是 `C:\Users\23165\AppData\Local\Temp\`。**风险**：Windows  Defender 对临时目录里的可执行文件会锁文件，而 `sharp` 会往 `tmpdir()` 落原生二进制 → 偶发 `EPERM` / `EBUSY`。**处置**：框架已把 `TMPDIR` 重定向到自己的scratch 目录（第 69 行），实际不会撞上；首次跑若报 `EPERM`，把 `%TEMP%` 换到非系统盘 |
| **文件监听（`node --watch`）** | [!]️ 轻微 | Windows 的 `ReadDirectoryChangesW` 对**网络盘/OneDrive 同步目录**不可靠。本项目在 `D:\pytorch\...`（本地盘）[OK]。若把项目挪到 OneDrive 目录，`--watch` 会漏触发 → 改用 `node --watch-path=packages/backend/src` 缩小范围，或改跑 `npm start`（无 watch）|
| **pg-boss 在 Windows 上** | [OK] 无风险 | `packages/backend/src/jobs/queue.ts:64` 只用 `new PgBoss({ connectionString, max: 4, schema: "pgboss" })`——**纯 Postgres 队列，不碰文件系统**，没有 `fs.watch` / 信号量 / `kill -SIGUSR2` 之类 POSIX 依赖 |
| **worker 停止语义** | [!]️ 必须注意 | `docker-compose.yml:62-64` 给了 `stop_grace_period: 210s`，因为正常停止要让在飞的付费模型调用收尾。**本机 `Ctrl+C` 没有这个宽限期**。改法：用 `Ctrl+C` 两次前留足 210 秒，或临时把 `STOP_TIMEOUT_MS` 调小。详见 §5 内嵌坑 |
| **`sharp` 原生模块** | [OK] 有Windows 预编译包 | `sharp@0.35.4` 在 win32-x64 有 prebuilt binary，`npm ci` 会自动装。**不需要** `--libvips` 或编译工具链 |
| **`satori`（分享图）** | [OK] 纯 JS | `satori@0.33.5` 无原生依赖；中文字体走 `docs/customize.md` 的 fontsource 方案 |
| **`node --env-file-if-exists=../../.env`** | [OK] 路径正确 | 相对workspace 目录上跳两级，Windows 与 Linux 表现一致（`path` 模块处理） |
| **行结束符 CRLF** | [!]️ 低风险 | Git 仓库 `.gitattributes` 未设`text=auto`时，Windows checkout 会把 `.md` 提示词转成 CRLF。提示词是 `readFileSync` 读的字符串，多一个 `\r` 通常无害，但**可能影响提示词末尾的格式校验**。**处置**：`git config core.autocrlf input` |
| **命令注入面** | [OK] 无风险 | `scripts/check-migrations.ts:11` 用 `execFileSync("git", args)` 数组传参（非 `sh -c` 字符串拼接），无注入面 |

### 1.6 端到端验证步骤（Windows 本机，可复制执行）

```bash
# 0. 切换到合规Node
export PATH="/d/nodejs:$PATH"      # Git Bash
node --version                   # 必须 >= v24.11，实际 v25.8.0

# 1. 装依赖
npm ci

# 2. 起数据库（Docker Desktop 需已手动启动）
docker run -d --name aihot-pg -e POSTGRES_USER=aihot -e POSTGRES_PASSWORD=aihot \
  -e POSTGRES_DB=aihot -p 127.0.0.1:5432:5432 -v aihot-pgdata:/var/lib/postgresql/data \
  --restart unless-stopped postgres:17-alpine
docker exec aihot-pg pg_isready -U aihot -d aihot

# 3. 生成 .env 并改 DATABASE_URL 为127.0.0.1
node scripts/init-env.ts --llm-key <DeepSeek Key>
# 手工把 DATABASE_URL 改成 postgres://aihot:aihot@127.0.0.1:5432/aihot

# 4. 迁移 + 种子
node --env-file=.env scripts/migrate.ts
node --env-file=.env scripts/seed.ts

# 5. 构建 web
npm run build -w @aihot/web

# 6. 类型门禁（生成代码幻觉依赖在这里被拦）
npm run typecheck

# 7. 三个进程（三个终端，或后台）
npm run dev:api      # 3001
npm run dev:worker
npm run dev:web      # 3000

# 8. 关键路径断言
curl -s http://127.0.0.1:3001/api/v1/hot | head -c 400          # 有 JSON 响应
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/ # 期望 200
curl -s http://127.0.0.1:3000/rss.xml | head -c 200# RSS 出得来

# 9. 关键错误路径断言（安全阀默认关）
#把 .env 里 COLLECT_ENABLED 改成 false，重启 api，不应发出任何采集请求
# 后台"运行"页应显示采集任务被跳过

# 10. 测试（必须 Node >=24）
DATABASE_URL=postgres://aihot:aihot@127.0.0.1:5432/aihot_test npm test
```

---

## 2. 技术栈锁定表（全部为**实际已装版本**，从各 `package.json` 读取）

### 2.1 运行时与工具链

| 层 | 锁定版本 | 来源 | Windows 备注 |
|---|---|---|---|
| Node.js | **25.8.0**（要求 `>=24.11`） | `D:\nodejs\node.exe` 实测 | [!]️ 必须优先于 `.workbuddy` 内置的 22.22.2 |
| npm | **11.11.0** | `D:/nodejs/npm.cmd` | npm workspaces 原生支持 |
| TypeScript | **7.0.2** | `package.json` devDependencies | 仅用于 `typecheck`（`tsc`），运行时不需要编译器 |
| PostgreSQL | **17-alpine**（Docker） | `docker-compose.yml:28` | 本机 5432 实测空闲 |
| 原生 TS 执行 | Node 原生类型剥离（`process.features.typescript === "strip"`） | 实测 | 代码零 `enum`/`namespace`，可用 |

### 2.2 后端

| 包 | 版本 | 用途 | Windows 风险 |
|---|---|---|---|
| `fastify` | **5.12.5** | api 进程 HTTP | 无 |
| `zod` | **4.6.5** | 契约校验 | 无 |
| `pg-boss` | **12.34.0** | 队列 + 定时任务 | 无（纯 PG） |
| `postgres` | **3.4.9** | PG 驱动（不是 `pg`） | 无 |
| `sharp` | **0.35.4** | 图片处理 | win32-x64 有预编译包 |
| `satori` | **0.33.5** | 分享图渲染 | 无（纯 JS） |
| `cheerio` | **1.2.0** | HTML 解析 | 无 |
| `linkedom` | **0.18.13** | DOM | 无 |
| `@mozilla/readability` | **0.6.0** | 正文提取 | 无 |
| `marked` | **18.0.14** | Markdown | 无 |
| `turndown` | **7.2.4** | HTML→MD | 无 |
| `fast-xml-parser` | **5.11.1** | RSS 解析 | 无 |
| `sanitize-html` | **2.17.7** | HTML 消毒 | 无 |
| `undici` | **8.11.2** | HTTP 客户端 | 无 |
| `@paralleldrive/cuid2` | **3.3.0** | ID | 无 |
| `uqr` | **0.1.3** | 二维码 | 无 |
| `@modelcontextprotocol/server` | **2.1.0** | MCP | 无 |
| `@modelcontextprotocol/client` | **2.1.0** | MCP 客户端 | 无 |

### 2.3 前端

| 包 | 版本 | 备注 |
|---|---|---|
| `react` / `react-dom` | **19.3.0** | |
| `react-router` | **8.4.0** | SSR 框架；`@react-router/node` 8.4.0、`@react-router/dev` 8.4.0 |
| `vite` | **8.3.1** | dev/build |
| `tailwindcss` | **4.3.3** | + `@tailwindcss/vite` 4.3.3 |
| `motion` | **13.4.4** | 动画。**禁用弹跳缓动**（P0 规则） |
| `isbot` | **5.2.2** | SSR UA 判定 |
| `highlight.js` | **11.12.0** | 代码高亮 |
| `@opentype.js` | **1.3.4** | 字体处理（分享图） |
| `@playwright/test` | **1.61.1** | 端到端 |

### 2.4 开发期新增依赖（本次改造引入）

| 包 | 版本 | 用途 | 判定 |
|---|---|---|---|
| `lucide-react` | **0.544.0** | **唯一图标库**（纯 SVG 描边，`strokeWidth` 默认 2，尺寸 16/20/24） | 见 §3.5 决策 |
| `dashscope`（HTTP 直连，不装包） | — | `text-embedding-v4` embedding | 见 §3.1 |

> **不引入**：向量数据库（Milvus/Qdrant）、重试队列（BullMQ）、图标字体、动画库。理由见 §3.1 / §3.5。

---

## 3. 技术选型决策

### 3.1 决策一：向量服务 —— **要配，但不是本地向量库**

**结论：配一个远程 embedding 供应商（阿里 DashScope `text-embedding-v4`，1024 维），不装任何本地向量数据库。**

依据（代码级）：

- `packages/backend/src/providers/embeddings.ts:19-21`：
  ```ts
  export function embeddingsAvailable(): boolean {
    return config.modelCallsEnabled && !!(credential("models","EMBEDDING_API_KEY") ?? credential("models","DASHSCOPE_API_KEY"));
  }
  ```
  没配key 就返回 false → `recall.ts:131-136` 走 `lexicalSimilarity` 降级。
- `relate.ts:194-204` 的降级算法是**字符 bigram 交集 / 较小集合大小**：
  ```ts
  const grams = (s) => new Set([...s].map((_c,i) => chars.slice(i,i+2).join(""))
  return inter / Math.min(g.size, h.size);
  ```
  **这对中文金融术语是硬伤**：
  - 「非农就业数据」vs「美国非农新增就业」—— 共享 bigram 不少，勉强能过0.25；
  - 「央行缩表」vs「美联储资产负债表缩量」—— 共享 bigram 很少，**漏召回**；
  - 「COMEX 保证金上调」vs「纽约商品交易所提高保证金」—— 同一件事，**漏召回**；
  - 反向问题：**「COMEX」vs「COMEX」出现在完全不同的行情播报里会误召回**。
- 向量维度契约已钉死：`embeddings.ts:11-14` 的 `EMBEDDING_DIMS` 默认 1024（DashScope 分支），改动会让存量向量作废。**这意味着 embedding 供应商一旦上线就很难换**。

**为什么不装本地向量库**：框架的向量存储是**PostgreSQL 内的 `real[]` 数组 + JS 侧 `cosine32` 计算**（`recall.ts:113-123`），不是 pgvector。MVP 语料量（每日几十至几百条，10 万条以下）下，`Float32Array` 点积在 Node 里跑得动，装 Milvus/Qdrant 只是多一个常驻服务和一份运维负担，违反「不做过度设计」。

**为什么不本地跑 embedding 模型**（如 BGE-M3 / Qwen3-Embedding）：本机无GPU（`systeminfo` 无独显信息，项目在 `D:\`），llama.cpp + 蒸馏模型要占 4-8GB 内存和一套进程管理，且 `EMBEDDING_DIMS` 会变（1024 → 1024/768 不一），触发全量重算。远程 1-2 分钱/百万 token 更省事。

**成本影响**：DashScope `text-embedding-v4` 约 ¥0.5/百万 token（以官方定价页为准，需PM 复核）。日均 200 条资料 × 首轮 1 次嵌入 + 增量补充 ≈ 5000 token/天 ≈ ¥0.003/天 ≈ **¥1/月**。可忽略。

**内嵌坑**：`EMBEDDING_DIMS` 变更会让所有已存向量作废（`embeddings.ts:15-16` 的注释明说「stored one of another size is computed again」）。**上线后禁止改这个值**。

### 3.2 决策二：价格数据看板 —— **做，放`modules/quotes/`，最小实现**

按 `docs/architecture.md:62-75` 的契约，三个插口分别是：

| 文件 | 必须写什么 |
|---|---|
| `modules/quotes/module.ts` | `defineModule({ name: "quotes", pages: [{ path: "quotes", file: "pages/quotes.tsx" }], apiPaths: [/^\/api\/v1\/quotes/] })` —— 纯数据，**每个进程都读**（含 web build） |
| `modules/quotes/server.ts` | ① `http` 插口：用 `apps/api/src/routes/static.ts` 的 `sendFile` 发自己的静态资源；② 一个 `ModuleQueue` 插口挂 pg-boss 定时任务拉价格；③ 自己的迁移建表；④ **数据获取逻辑**（见下） |
| `modules/quotes/web.tsx` | 页面注册 + 导航项 |

**关键架构约束**（`docs/architecture.md:75`）：框架代码**不导入任何模块**，只读 `site/modules/` 的三份清单。所以：

```ts
// site/modules/index.ts   —— 列地址
// site/modules/server.ts   —— 列后端
// site/modules/web.ts      —— 列网页
// site/package.json       —— dependencies 里加 "@aihot/quotes": "*"
```

**数据来源必须自己解决**：框架的 `sources/` 全部是**文本内容采集**（`json-list.ts` 产出的是 `{url, title, excerpt}` 这类条目），没有「时序行情」概念。所以价格要走**模块自己的迁移建表 + 模块自己的采集**（建议复用 `/api/ingest/items` 之外的独立拉取，写进自己的表）。

**明确不做（out-of-scope）**：K线图、实时行情、撮合、持仓模拟、涨跌停计算。MVP 只做「近 30 日收盘价 + 涨跌幅 + 关键统计指标」的静态展示页。

**理由**：投资决策视角的读者没有价格锚点就没法判断「涨 2%」是大事还是噪声。但完整行情系统是另一个产品线，塞进 MVP 会拖垮进度。

### 3.3 决策三：模型分层 —— **单模型起步，为分层预留**

**结论：MVP 用一个 DeepSeek 模型，通过 `site/models.ts` 的 `DEFAULTS` 把「重推理的归组判断」和「轻表达的中文写作」区分开，但**不引入第二家供应商**。

`site/models.ts` 的机制（已读）：`ModelPreset` 有 `extra`（可关thinking）、`reasoningTokens`、`jsonMode`；`DEFAULTS: Record<string,string>` 按**步骤名**（`prefilter` / `score` / `understand` / `summarize` / `structure` / `group` / `groupReview` / `digest` / `report` / `translate`）选模型。

**MVP 配置（一个模型，差异化参数）**：

```ts
// site/models.ts
export const PRESETS: Record<string, ModelPreset> = {
  "deepseek-v4-flash": {
    service: "deepseek", model: "deepseek-v4-flash",
    baseUrlEnv: "DEEPSEEK_BASE_URL", apiKeyEnv: "DEEPSEEK_API_KEY",
    extra: { thinking: { type: "disabled" } }, jsonMode: true,
  },
  "deepseek-v4-flash-think": {
    service: "deepseek", model: "deepseek-v4-flash",
    baseUrlEnv: "DEEPSEEK_BASE_URL", apiKeyEnv: "DEEPSEEK_API_KEY",
    extra: { thinking: { type: "enabled" }, reasoning_effort: "high" },
    reasoningTokens: 4000, jsonMode: true,
  },
};
export const DEFAULTS: Record<string, string> = {
  group: "deepseek-v4-flash-think",      // 归组要稳定按格式回答
  groupReview: "deepseek-v4-flash-think",// 归组复核同理
  // 其余步骤（prefilter/score/understand/summarize/structure/digest/report/translate）不写，
  // 落到 default = LLM_BASE_URL/LLM_MODEL
};
```

**为什么这样分层**：`group-batch.md` 要求「只输出 JSON」的严格格式，`deepseek-flash`（`thinking: disabled`）确定性高、格式遵循好、成本低；`score`（归组判断）需要理解力，用 thinking 模式。所以**分层靠 `extra` 参数而不是靠换供应商**。

**`.env` 锁定**：`LLM_BASE_URL=https://api.deepseek.com/v1`、`LLM_MODEL=deepseek-v4-flash`、`LLM_EXTRA_JSON={"thinking":{"type":"disabled"}}`（与 `.env.example:20-24` 已有格式一致，只换模型名）。

**内嵌坑**：`docs/deploy.md:103` 明确写了「原来只有名字以 `-think` 结尾的具名模型会多给 4000，这个做法去掉了」。所以 `-think` **只是命名约定**，额度必须显式写 `reasoningTokens: 4000`，否则额度不生效。

**关于旧模型名**：`deepseek-chat` / `deepseek-reasoner` 已于 2026-07-24 退役（联网核实）。`site/models.ts` 现存的 `deepseek-flash` 是**框架作者的内部别名**，我们改造时统一换成 `deepseek-v4-flash` 官方模型串。

### 3.4 决策四：测试账号与安全阀

见 §5 环境变量清单。

### 3.5 决策五：图标库 —— **lucide-react，纯 SVG 描边**

**结论：全站唯一图标库 = `lucide-react` 0.544.0，尺寸只允许 16 / 20 / 24px，`strokeWidth` 固定 2（描边），禁止 emoji、禁止图标字体、禁止混用第二套图标。**

理由：
- 纯 SVG 组件，按需 tree-shake，无字体文件、无额外网络请求
- 内置描边风格（`fill="none"` + `stroke="currentColor"`），天然满足 P0「禁止 emoji 图标」
- React 19.3 兼容；与 Tailwind 4.3.3 用 `className` 直接控 `size` / `strokeWidth`

**替代方案对比（评分）**：

| 方案 | 学习成本 | 生态 | 风格一致性 | 结论 |
|---|---|---|---|---|
| **lucide-react 0.544.0** | 低 | 极好（1500+ 图标） | 描边，天然统一 | [OK] **选它** |
| `react-icons` 5.x | 低 | 极好（含 5 个风格包） | [!]️ 5 套风格，**极易混用**——违背 P0 | 拒绝 |
| Heroicons 2.x | 低 | 好 | 描边/实心两套 | 可用但图标数少（仅 300+） |
| 内联手写 SVG | 高 | 无 | 全靠自觉 | 拒绝（不可维护） |

**锁法（写进 Spec，Spec-as-contract 要求）**：

```tsx
// 只允许这三个尺寸，定义为常量并 import
export const ICON = { sm: 16, md: 20, lg: 24 } as const;
export const ICON_STROKE = 2;

// 使用示例
import { TrendingUp } from "lucide-react";
<TrendingUp size={ICON.md} strokeWidth={ICON_STROKE} aria-hidden />
```

**P0 视觉禁令同时落到实现层**：
- [NG] 禁止紫色→粉色渐变主视觉（`indigo-*` / `pink-*` 渐变类）
- [NG] 禁止发���边框 + 毛玻璃（`backdrop-blur` 作为主视觉手段）
- [NG] 禁止硬编码颜色值（唯一例外 `#fff` / `#000`）→ 一律用 Tailwind token（`bg-background` / `text-muted-foreground`）
- [NG] 禁止弹跳缓动（`motion` 的 `spring` / `bounce` 类型）

---

## 4. 任务 2：金融行业特殊性对框架的冲击（6 点逐条判定）

### 4.1 数字密集 —— 现有防幻觉机制**不够用，需要加强**

**判定：部分扛不住。必须改 `industry/prompts/rules-anti-hallucination.md`。**

现有 9 条规则（第 4、5、7、8、9 条）都围绕**产品名 / 功能名 / 数字 / 版本号**设计，核心是「不许编原文没有的东西」。但金融场景的失效模式不同：

| 金融失效模式 | 现有规则能拦吗 |
|---|---|
| 摘要写「金价上涨 2.3%」，原文是「涨逾 2%」→ 精度伪造 | [!]️ 规则 4 只说「数字必须能找到对应」，「逾2%」找不到「2.3%」的字面，但模型会觉得是同一个数字 |
| 原文「COMEX 黄金期货上涨」，摘要写「现货黄金上涨」→ **品种张冠李戴** | [NG] 完全没规则 |
| 原文「持仓量增加 1.2 万手」，摘要写「持仓量增加 1.2 万吨」→ **单位偷换** | [NG] 完全没规则 |
| 原文「10 年期美债收益率上行 5 个基点」，摘要写「收益率上行 5%」→ **基点/bps 与百分比混淆** | [NG] 完全没规则（金融最常见） |
| 原文「年化 3.5%」，摘要写「收益率 3.5%」→ 指标名替换 | [NG] 没有 |

**改法**（在 `rules-anti-hallucination.md` 追加第 10-13 条）：

```markdown
10. 数字的三件套必须同时在原文出现：**数值、单位、比较基准**。
    原文「上涨 2%」不得写成「上涨 2.3%」或「涨超 2%」；
    原文没给绝对值就不要补。
11. 金融单位不可推断、不可转换。基点（bp/bps）、个基点、百分比、点位、美元/盎司、
    美元/克、元/克、手（contracts）、万手、吨、盎司、克、指数点，是不同量纲。
    原文写 bp 就只能写 bp；原文写「手」就不能写成「吨」；原文只给百分比就不得
    反推出绝对价格。
12. 品种与市场必须逐字对齐原文：COMEX 黄金期货 ≠ 现货黄金 ≠ 伦敦金 ≠ 上海金 ≠
    纽约金 ≠ 纸浆现货 ≠ 沪金；COMEX 白银 ≠ COMEX 黄金 ≠ LBMA 定盘价 ≠ SGE 现货。
    原文没写「纽约」就不许加「纽约」。写「某交易所」时保留原文的模糊表述。
13. 指标名不可替换：原文「非农就业人数」（nonfarm payrolls）不能写成「失业率」；
    「PCE 物价指数」不能写成「CPI」；「生产者物价指数」不能写成「PPI」以外的
    任何具体口径名；「持仓量」（open interest）不能写成「成交量」。
```

**同时必须改 `industry/prompts/rules-answer-first-summary.md` 和 `summarize-*.md`**：把「不要输出模型自己编的数字」从**通用禁令**升级为**带单位的字段校验**——建议在摘要生成后做一次**机械校验**（见 §4.1 的实现建议）。

**实现建议（低成本高收益）**：框架已有 `tests/stub.ts` 式的模型响应校验（`providers/llm.ts` 的 `ModelOutputError`）。可在结构化步骤（`structure`）加一个**正则后置校验**：抽出摘要里所有 `<数字><单位>` 组合，逐个在原文中做字面 grep，命中失败则**打回重试一次**，仍失败则**降级为仅摘要**（走 `summarize-article-empty.md` 路径）。这比纯提示词约束可靠得多，且**不需要模型调用**。

> 改动文件：`industry/prompts/rules-anti-hallucination.md`（+4 条）、`industry/prompts/rules-answer-first-summary.md`、`industry/prompts/summarize-article.md`、`industry/prompts/summarize-short-post.md`、`industry/prompts/summarize-long-post.md`、`industry/prompts/structure.md`

### 4.2 信源结构（官方统计 vs 新闻稿）—— **扛得住，但要走 `json_list` 且有3 个坑**

**判定：`json_list` 能接官方统计接口。已读 `packages/backend/src/sources/json-list.ts` 逐行确认能力足够。**

**能力核对（`fetchJsonList`，第 147-199 行）**：

| 官方统计接口的特征 | `json_list` 支持情况 | 配置项 |
|---|---|---|
| 嵌套 JSON（CFTC Commitments of Traders 周报） | [OK] `getPath` 支持 `a.b.c` 与数组下标 `a.0.b`（第 12-15 行） | `itemsPath` |
| 键名不固定、需递归找数组（USGS Mineral Commodity Summaries 的 `data` 数组） | [OK] `findKey` 深度 ≤12（第 72-83 行） | `jsonKey` |
| 非数组容器（`{2024: {...}, 2025: {...}}`） | [OK] `itemsObjectValues` 转 `Object.values`（第 173 行） | `itemsObjectValues: true` |
| 需要过滤（只要持仓量 > 阈值） | [OK] `minNumeric`（第 179 行）、`requireBoolean`（第 178 行） | `minNumeric` / `requireBoolean` |
| 数字型字段当标题 | [OK] `firstString` 对 `number` 返回 `String(v)`（第 25 行） | `titlePaths` |
| **无时区的日期时间** `2026-09-30 17:43:58` | [OK] `ZONELESS_TIME` 正则 + `parseLooseDate(text, utcOffset)`（第 44、67 行） | `publishedAtUtcOffset`（默认 `+08:00`） |
| 日期是 `20260922` 形式 | [OK] `unit: "yyyymmdd"`（第 61-65 行） | `publishedAtUnit` |
| 时间戳（秒/毫秒） | [OK] `unit: "epoch_s" / "epoch_ms"`（第 56-59 行） | `publishedAtUnit` |
| 拼接 URL | [OK] `urlTemplate` + `renderTemplate` 的 `{path}` / `{raw:path}`（第 30-41 行） | `urlTemplate` |

**结论：数据类信源和新闻类信源走的是同一套 `json_list` 处理流程，产出统一落成 `{url, title, excerpt, publishedAt}` 的 `Candidate`，后面进同一个内容管道（`content/materials.ts`）→ 同一套预筛/评分/结构化/归组。** 这个设计让我们的改造量大幅降低。

**但有 3 个坑**：

**坑 1：官方统计接口几乎都要求 API Key / 有频率限制。**
- `json-list.ts:151-154` 只对 `api.github.com` 特判了 `GITHUB_TOKEN`。**其他供应商的 key 走 `source.config.headers` 注入**（第 150 行 `...(c.headers ?? {})`）。→ 配置层面没问题，但要确认 CFTC / LBMA / SGE 允许程序化访问。
- **CFTC COT 是公开 Socrata API，无需 key**（最友好）；**LBMA 有自己的授权 API**；**USGS 无公开实时 API**（只有年度 PDF/Excel，需自行抓取或跳过）。→ 这属于信源调研范畴，PM 负责，我只标明**技术接入可行性与配置点**。

**坑 2：官方数据是「一份数据反复更新」，不是「每天一条新内容」。**
- 例如 COT 每周二更新一次持仓，USGS 月度数据在同一 URL 上覆盖。`json_list` 每次采集都返回**同一批 URL**。
- 框架有 `externalIdPath`（第 183 行）可以给出源侧的稳定 ID，但**如果 URL 相同而内容变了**，框架的去重逻辑会怎么处理？→ **这是必须验证的点**。若被当作重复丢弃，数据更新就丢了；若每次都算新条目，会浪费模型调用。
- **处置**：官方统计类信源配 `externalIdPath`（若有稳定 ID 如 COT 的 `market_and_exchange_names` + `report_date_as_yyyy-mm-dd`），让内容变化被识别为**同一篇的更新**而非新条目。这个需要读 `content/materials.ts` 的去重逻辑确认，我标为**待验证项 V1**（见 §6）。

**坑 3：`json_list` 只能产文本，图表/表格会丢。**
- 若金十 / USGS 给的是 HTML 表格而非 JSON，需要 `html_json_key` 或 `html_window_var` 模式（第 85-145 行），或干脆用 `web_list` 抓页面再交给 `@mozilla/readability` 提正文。→ 技术可行，但抽取质量依赖源站 HTML，**属信源质量风险**。

**内嵌坑（必须写进 Spec）**：`json-list.ts:197` ——「items 有内容但一条都没映射成功且没有 `requireBoolean`/`minNumeric` 过滤时抛 `no items mapped`」。**官方统计接口在节假日返回空数组是正常情况**，但如果配置写错（如 `titlePaths` 写错），报错信息和「真的没数据」混在一起。→ 采集健康页要能区分这两种情况。

### 4.3 事件归组与热度—— **扛不住，必须改（最高优先级技术风险 R3）**

**判定：`group-*.md` 归组机制会被行情播报污染，`hot.ts` 的热度算法会放大这个问题。必须改。**

**问题 1：行情播报不是事件，但归组提示词不知道这一点**

现有 `group-definitions.md` 的四类关系（`SAME_OCCURRENCE` / `SAME_STORY` / `UNRELATED` / `ROUNDUP`）**全部是「发生」的分类学**。它判断「是不是同一件事发生」，而行情播报是「**没有事件，只有状态描述**」。

具体失效路径：

| 行情播报 | 现有归组会怎么判 | 为什么错 |
|---|---|---|
| 「纽约金价突破 2500 美元」 | `SAME_OCCURRENCE`（多个媒体都在报同一件事：价格突破） | 价格突破是**连续状态**，一天可以突破/回落/再突破十几次。每次都会聚成新事件 |
| 「COMEX 黄金涨 2%」 | `SAME_OCCURRENCE` | 同上 |
| 「美债收益率上行 5 个基点」 | `SAME_OCCURRENCE` | 同上 |
| 「COMEX 保证金上调」 | `SAME_OCCURRENCE` | [OK] **这个判对了**——保证金调整确实是离散事件 |

**核心矛盾**：`hot.ts:142-143` 的热度是 **48 小时窗口 + 24 小时半衰**，而行情状态在这48 小时里**反复被播报**，每次播报都贡献一份参与者证据。结果：**「金价 2500 关口」这个伪事件会持续 48 小时霸占热点榜前列**，而真正的「央行意外加息」只有 3 家媒体报道，热度反而更低。

**改法（三层，成本递增，建议全上）**：

**改法 A（必做，零模型成本）— 在预筛层机械识别行情播报**

改 `industry/prompts/prefilter.md`，加入**可机械判定的行情播报识别规则**：

```markdown
## 行情播报（不是事件，直接丢弃）

只有价格/涨跌/持仓/价位的**状态描述**，没有任何离散发生（没有"谁宣布/决定/
调整/发布/生效/否决/触发"），属于行情播报，直接判丢弃。主要形态：

- 「XX 上涨/下跌 N%」「XX 突破/跌破 N 点位」「XX 创历史新高/新低」
- 「XX 报 N 美元/盎司，较前一交易日 N 涨N 跌」
- 「XX 持仓量增加/减少 N 手」「XX 期货近月合约涨 N%」
- 「XX 收益率上行/下行 N 个基点」

**反例（这些是事件，不要丢）**：
- 「COMEX 上调黄金期货保证金至 N%」→ 交易所**调整规则**，是事件
- 「央行意外加息 25 个基点」→ **政策决定**，是事件
- 「非农数据大幅超预期」→ **数据发布**，是事件
- 「某 ETF 获批」→ **审批决定**，是事件

判据：**有离散发生（谁+做了什么+何时生效）→ 保留；只有连续状态读数 → 丢。**
```

**改法 B（强烈建议）— 归组前把行情播报打成 `standalone`**

`tests/architecture.test.ts` 之外，`packages/backend/src/events/group.ts` 已有 `grouping_overrides` 表（`hot.ts:126` 引用了 `mode = 'standalone'`）。**给预筛判定为行情播报的条目，在入库时直接写一条 `grouping_overrides(article_id, mode='standalone')`**——这样它不参与归组、**也不进热度**（`currentSignals()` 第 126 行显式 `NOT EXISTS ... mode = 'standalone'`）。这是**框架已支持的机制，只需在新的提示词/预筛结果里接上**。

> 这条很重要：它意味着**不需要改 `hot.ts` 的热度算法**，只需在管道入口打标。改动点在 `packages/backend/src/content/materials.ts`（或 `ingest`）读预筛结果落库处。

**改法 C（可选）— 引入「事件」实体限定**

在 `group-definitions.md` 顶部加一句总则：

```markdown
总则：先问「这里有没有一个离散发生」。没有离散发生、只有连续读数（价格、涨跌幅、
持仓量、价位的瞬时状态）的报道，不是事件，不与任何候选建立合并关系
（decisions 全给 UNRELATED），并在 query 里写明「行情播报」。
```

**问题 2：热度算法对金融的另一处不适配 — `MIN_PARTICIPANTS=2` + `editorial_participants >= 1`**

`hot.ts:60` `MIN_PARTICIPANTS = 2`，第 185 行还要求 `editorial_participants >= 1`。财经热点场景下**热门事件确实会有 2+ 家报道** [OK] 这条其实**可以沿用**，不需要改算法。

但 `hot.ts:190` 的**输出上限只有 10 条**（`if (entries.length >= 10) break`）。贵金属 + 大宗 + 股债三个板块，10 条热点位**不够分**。→ **处置**：这是数据/配置层，不是代码层。若 `HOT_RULE_VERSION` 允许，改成按板块分配席位；若需改代码，改 `computeHotRanking` 的截断逻辑为按分类配额。**列为待验证项 V2**。

### 4.4 IDENTITY_LEXICON / `entityIdentity` —— **机制可复用，要换词表+ 换事实库**

**判定：机制本身**与行业无关**（`vocabulary.ts:36-40` 的 `entityIdentity` 只做「规范化后精确匹配别名」），完全可复用。要改的是两处：**

**问题**：`entityIdentity` 只回答「这个字符串是不是已知实体」，**不回答「这些数字/地点是否被模型张冠李戴」**。金融的「张冠李戴」形式是**「品种-市场-币种-口径」四元组的错配**，而 `vocabulary.ts:36-39` 的匹配粒度是**单个字符串**：

```ts
const matches = Object.entries(ENTITIES).filter(([id, entity]) =>
  [id, entity.name, ...entity.aliases, ...(entity.otherNames ?? [])]
    .some((alias) => key(alias) === normalized));
return matches.length > 1 ? null : matches[0]?.[0] ?? null;
```

注意：多个实体同名时会返回 `null`（保守，正确）。但「纽约金」「伦敦金」「COMEX 黄金」在 `ENTITIES` 里会被写成**三个独立实体**，然后**各自精确匹配自己**——**「张冠李戴」检测不出来**，因为每个词都合法。

**改法**：

**改法 1（必做）— 扩 `ENTITIES` 词表到金融主体**

`industry/taxonomy.ts` 现有 `ENTITY_TAGS` 11 个全是 AI 公司（`OpenAI`/`Anthropic`/...）。要换成金融主体：

- **国家/地区**：中国、美国、欧元区、日本、英国、瑞士、印度
- **央行/机构**：美联储、欧洲央行、中国人民银行（PBOC）、英国央行（BOE）、日本央行（BOJ）、CFTC、SEC、FED、LBMA、SGE（上海黄金交易所）、COMEX、CME、ICE、USGS、世界黄金协会（WGC）、BIS、IMF
- **金属品种**：黄金、白银、铂金、钯金（**每个都要写全 `otherNames`：现货/期货/COMEX/London/NY/Shanghai/Shanghai 前缀**）
- **大类资产**：原油、铜、铝、天然气、螺纹钢、铁矿石、美元指数、美债、全球股债

**改法 2（必做）— 把「事实库」从「公司」扩到「品种-市场」组合**

`industry/prompts/identity-context.md` 现在只有 2 行，作用是「提供已核验事实防张冠李戴」。金融版要扩成**受控事实表**：

```markdown
【已核验品种与市场口径】{{facts}}
这些事实只用于防止品种/市场/币种/报价单位被张冠李戴，不代表发布者必然是文章唯一主题；
标题和摘要仍只能使用原始标题、正文或来源事实明确支持的主体。

必须逐项对齐的口径：
- 市场：COMEX / 纽约商品交易所 · 伦敦（LBMA）· 上海（SGE / 沪金）· 现货 · 期货
- 报价单位：美元/盎司 · 美元/克 · 元/克 · 元/千克
- 品种：黄金 · 白银 · 铂金 · 钯金 · 铜 · 原油 · 螺纹钢 · 铁矿石
原文写「纽约金价」就不能在摘要里改成「伦敦金价」；原文只写「金价」就保持「金价」，
不要补市场前缀。
```

**改法 3（强烈建议）— 数字口径一致性由「事实库」兜底**

配合 §4.1 的「数字三件套」规则，`facts` 里带上**关键指标的官方口径定义**（非农 / CPl / PPI / PCE / 持仓量 / 收益率），让模型在「改写指标名」时能看到正确口径。这是**低成本高收益**的加固。

**改法 4（可选，成本最低）— 摘要输出的机械校验**

在 §4.1 提到的后置校验里加一条：**摘要里出现的每个品种/市场/单位组合，必须在原文里字面出现过**。命中失败 → 重试一次 → 降级。这比纯提示词可靠。

> 改动文件：`industry/taxonomy.ts`（`ENTITIES` / `ENTITY_TAGS` / `CATEGORY_TAGS` / `TOPIC_TAGS` / `TAG_SYNONYMS`）、`industry/prompts/identity-context.md`、`industry/topics.json`

### 4.5 评分维度与 `ITEM_TYPES` —— **五轴够用但要改定义；`act` 必须重定义；类型要加 1 个**

**判定：五轴结构可用，不需要加轴（加轴会破坏 `selection-score.md` 的权重表和 `tests/news-value.test.ts`）。但 `act` 的定义在金融语境下必须改，且 `ITEM_TYPES` 需要加 1 类。**

**为什么五轴够用**：`sig`（实质份量）/ `nov`（信息增量）/ `cred`（证据强度）/ `reson`（共振面）/ `act`（可用性）是**注意力价值的通用分解**，在投资决策视角下每一轴都有对应：

| 轴 | AI 站含义 | 金融站含义（改写） |
|---|---|---|
| `sig` | AI 时间线上的节点 | **价格/政策/供需的时间线节点**：会不会改变未来 N 周的定价 |
| `nov` | 带来了多少新认知 | **带来了多少新信息增量**（同上，语义不变） |
| `cred` | 材料内部对核心事实的支持强度 | **同上，但金融加权更严**：转述的央行决议不如原文；未公布的传闻 `cred` 极低 |
| `reson` | 多少 AI 读者觉得与自己有关 | **多少持仓/关注该品种的读者觉得与自己有关**（贵金属/大宗/股债三个圈子） |
| `act` | 读者能否马上使用/学习/调整选择 | **见下** |

**`act` 在金融语境下的重定义（关键）**

现有定义（`selection-score.md:38`）：「读者是否能马上使用、学习、调整选择或迁移做法。纯新闻和重大事件的 act 低是正常的」。

这个定义在金融场景**错了一半**：「调整选择」对投资决策者来说是核心动作，但**不是「立刻」**——看到「央行意外加息」后调仓是**当天/次日**的事，不是「马上」。

**改法（改 `industry/prompts/selection-score.md` 第 38 行 + 权重表）**：

```markdown
5. `act` 决策可用性：读者能否据此调整持仓/敞口/期限/对冲，或据此判断
   自己的交易是否需要立刻处理。具体是：给出了明确的价格/点位/阈值/期限/
   方向判断（能直接操作）；还是只有「发生了什么」的叙述（只能作为背景）。
   政策决定、宏观数据、行情异动这类「重大但无法立即操作」的事件，act 低是
   正常的，不应反过来抹掉 sig；但**给出了明确操作阈值的事件，act 必须给高分**，
   不能因为「是新闻」就压低。
```

**`ITEM_TYPES` 加 1 类**

现有 7 类（`industry/taxonomy.ts:36`）：
`model_release` / `product_launch` / `tool_or_prompt` / `research_paper` / `industry_event` / `opinion_analysis` / `tutorial_explainer`

金融场景映射：

| 金融事件 | 现有类型能否覆盖 | 判定 |
|---|---|---|
| 央行加息/降息/缩表/扩表 | `industry_event`（监管/商业动作） | [!]️ 能覆盖但「监管」措辞不贴 |
| 非农/CPI/PPI 发布 | `research_paper`（数据报告）？ | [NG] **不贴**。数据发布不是论文 |
| CFTC 持仓报告 | 同上 | [NG] 不贴 |
| COMEX 上调保证金 | `industry_event` | [OK] 覆盖 |
| 金价突破 2500 美元 | `industry_event`？ | [NG] **这类是行情播报，已在 §4.3 被预筛丢弃，不该走到评分** |
| 央行官员讲话（讲话≠决定） | `opinion_analysis` | [OK] 覆盖 |
| 矿业公司财报/产量报告 | `industry_event` | [OK] 覆盖 |
| 「本周非农前瞻与情景分析」 | `tutorial_explainer` / `opinion_analysis` | [OK] 覆盖 |

**结论**：需要加 **1 类** `official_data`（官方数据发布），并给权重。**加 1 类不破坏机制**——`selection-score.md` 的权重表是 `Record<type, [5 权重]>`，加一行即可；`scripts/eval-selection.ts` 读门槛不受影响。

```markdown
| 类型 | sig | nov | cred | reson | act |
|---|---:|---:|---:|---:|---:|
| model_release       | 3 | 2 | 2 | 2 | 1 |
| product_launch      | 2 | 2 | 1 | 2 | 3 |
| tool_or_prompt| 1 | 2 | 1 | 2 | 4 |
| research_paper      | 5 | 3 | 1 | 0 | 1 |
| industry_event      | 3 | 1 | 2 | 4 | 0 |
| official_data       | 4 | 2 | 4 | 3 | 1 |   ← 新增
| opinion_analysis    | 1 | 3 | 1 | 4 | 1 |
| tutorial_explainer  | 1 | 1 | 1 | 3 | 4 |
```

**`official_data` 权重理由**：`cred` 给 4（官方统计是最高证据级别，框架里只有它值得 4）、`sig` 给 4（非农/CPI 是宏观定价的核心变量，但不是「历史节点」级别的 5）、`act` 给 1（数据本身不给操作阈值）、`reson` 给 3（关注宏观的读者关心，泛读者不关心）。

**同时必改**：`selection-score.md` 第 3 行「你���读者是持续关注 AI……的普通重度用户、产品经理、创业者和轻度开发者」——**必须整段改写**为金融投资者画像。否则模型会按 AI 读者的口味打分（例：把「某 AI 公司发论文」评 9 分，把「央行意外加息 50bp」评 4 分）。

**还要加金融专属的「必须压住的噪声」规则**：

```markdown
### 必须压住的噪声（金融专属）

- 纯行情播报（无离散发生的价格/涨跌幅/持仓读数），`sig ≤ 1`。
  （正常情况下这类在预筛已丢弃；这里加双保险。）
- 单一机构的例行观点、无新信息的策略评论，`sig ≤ 2`。
- "XX 概念股名单""XX 板块爆发"这类题材炒作，缺少具体主体和可验证发生，
  `sig ≤ 2` 且 `nov ≤ 2`。
- 分析师目标价调整，若无新模型/新假设/新数据支撑，`nov ≤ 3`。
- 库存、持仓数据的例行周报/月报，若值在市场预期内，`sig ≤ 2`。
```

> 改动文件：`industry/taxonomy.ts`（`ITEM_TYPES` 加 `official_data`）、`industry/prompts/selection-score.md`（读者画像 + `act` 定义 + 权重表 + 噪声规则）

### 4.6 信源分级 T1/T2 的语义 —— **判定：分级机制不用改，要改的是分级「怎么用」**

**判定：`selection.ts` 的 `thresholds: { T1: 60, T1_5: 65, T2: 76 }` 机制**不用改**。但这组数值和T1 的语义在金融场景下需要重新校准，否则会造成系统性的偏差。**

**机制本身的优点（不改）**：`selection.ts:17` 的三档阈值 + `tests/setup.ts:28-33` 的 `STEP_MODELS` 机制 + `docs/selection.md` 说的「改门槛要用 `scripts/eval-selection.ts` 在自己标注的样本上重跑」——这是一套**自校准机制**，正是我们需要的。**不要为了「财经媒体比官方公告更有信息量」去改代码结构，要改的是往里喂的样本和数值。**

**问题 1：T1 在金融语境下不是「门槛低的一方」**

`selection.ts:14-16` 的注释说「T1 官方一手（官网、官方博客、机构）· T2 媒体与个人」。阈值 T1=60 < T2=76，意思是**官方一手更容易进精选**。

这个逻辑在 AI 行业成立（官方博客 = 确定的产品发布）。但金融场景：

| 信源 | 官方/媒体 | 信息量 | 现有门槛后果 |
|---|---|---|---|
| 美联储 FOMC 声明原文 | 官方 | **最高**（原文有投票细节、前瞻指引措辞变化） | T1=60 [OK] 轻松进 |
| 路透「Fed 意外加息，市场剧烈反应」 | 媒体 | **很高**（含市场反应、机构解读） | T2=76 [NG] **可能被挡在精选外** |
| CFTC COT 周报（JSON） | 官方 | **高**（持仓是硬数据） | T1=60 [OK] |
| USGS 月度供需报告 | 官方 | 中（数据过时、滞后） | T1=60 [OK] **但可能被高估**（见问题 3） |
| 金十数据「非农公布」 | 媒体（快讯） | **低**（只有数字，没有解读） | T2=76 [OK] **被正确挡住** |

**结论：机制能扛，但需要两处调整。**

**调整 A（必做）— 新增一档「数据机构」分级**

现有三档 `T1` / `T1_5` / `T2` 是按「一手程度」分的。金融需要按**「权威数据发布方」**单独一档，因为 CFTC / USGS / LBMA / SGE / 国家统计局的**权威性等同于或高于官方公告**，但它们既不是「公司博客」也不是「媒体」。

→ **改 `industry/selection.ts`**：

```ts
export const SELECTION = {
  thresholds: {
    T1: 58,      // 官方一手：央行决议、交易所公告、监管公告（门槛比 60 再低一点）
    T1_5: 64,    // 官方准一手：机构博客、官方账号
    T_DATA: 56,  // 新增：官方数据发布方（CFTC / USGS / LBMA / SGE / 统计局）
                 // 门槛最低——数据本身是硬事实，不需要再靠"新鲜度"竞争
    T2: 70,      // 媒体（从 76 下调：财经媒体的独家信息量确实高）
    T2_OP: 82,   // 新增：观点/评论类媒体（门槛高——评论最容易注水）
  },
  understandFloor: 50,
} as const;
```

**为什么 T2 从 76 降到 70**：财经媒体的独家信息量确实高于 AI 媒体的平均水平（路透/彭博的独家调查、数据独家）。但**不能降太多**，否则噪声灌入。

**为什么新增 T2_OP=82**：财经媒体的**评论/专栏**是最容易注水的一类，必须与「独家报道」分开。现有三档把「路透独家」和「某分析师专栏」混在一起，是AI 站遗留的缺陷。

**必须同步改 `packages/backend/src/events/hot.ts:35`** 的 `TIER_ORDER`（目前是 `["T1","T1_5","T2"]`），否则新分级的排序会落到「其他」：

```ts
const TIER_ORDER = ["T1", "T1_5", "T_DATA", "T2", "T2_OP"];
```

**调整 B（必做）— 分级要在后台可配置，且种子要预标**

分级存在 `sources.tier`，通过后台「信源」页设置。`scripts/seed.ts`（1976 字节）负责种示范信源——**我们必须重写 seed 里的分级标注**，否则首次导入会用错门槛。→ 这是 §6 工作量表的一项。

**调整 C（必做）— 校准必须走 `scripts/eval-selection.ts`**

`selection.ts:6-7` 和 `docs/selection.md` 都明确说了：改门槛或评分提示词后要在自己标注的样本上重跑。→ **这是硬性验收步骤，不能跳。** 至少标注 50 条金融样本（正例 25 / 负例 25），跑 `eval-selection.ts` 确认新阈值下的入选率在 20-35% 区间（`selection.ts` 的 `understandFloor: 50` 意味着不是所有高分条目都进精选）。

> 改动文件：`industry/selection.ts`（阈值表）、`packages/backend/src/events/hot.ts:35`（`TIER_ORDER`）、`industry/prompts/selection-score.md`（读者画像 + 噪声规则）、`scripts/seed.ts`（分级标注）、`industry/sources.json`（示范信源分级）

---

## 5. 环境变量清单（`.env`）

### 5.1 必填（本机 Windows）

```dotenv
# ── 数据库（Docker Desktop只跑 PG）──────────────────────────
DATABASE_URL=postgres://aihot:aihot@127.0.0.1:5432/aihot
#测试用（名字必须以 _test / _ci结尾，否则 tests/setup.ts:13 抛错）
# DATABASE_URL=postgres://aihot:aihot@127.0.0.1:5432/aihot_test

# ── 数据目录（必须 Windows 绝对路径）────────────────────────
AIHOT_DATA_DIR=D:/pytorch/dailyHot/dailyHotTopics/.data

# ── 服务地址 ──────────────────────────────────────────────
API_BASE_URL=http://127.0.0.1:3001
SITE_URL=http://127.0.0.1:3000
# API_HOST=127.0.0.1
# API_PORT=3001
# WEB_HOST=127.0.0.1
# WEB_PORT=3000

# ── 密钥（node scripts/init-env.ts 自动生成，勿手写）────────
ADMIN_PASSWORD=<init-env 生成，≥12 位>
SESSION_SECRET=<init-env 生成>
IMG_PROXY_SIGN_SECRET=<init-env 生成>

# ── 模型（DeepSeek）────────────────────────────────────────
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_API_KEY=<你的 DeepSeek key>
LLM_MODEL=deepseek-v4-flash
LLM_EXTRA_JSON={"thinking":{"type":"disabled"}}
# 归组/复核走 thinking 模式（见 site/models.ts）
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_API_KEY=<同上，可复用>

# ── Embedding（必需！见 §3.1 风险 R1）────────────────────
DASHSCOPE_API_KEY=<阿里云百炼 key>
EMBEDDING_MODEL=text-embedding-v4
EMBEDDING_DIMS=1024
```

### 5.2 安全阀 —— **默认关的必须保持关，逐步开**

> `.env.example:126` 明确：**所有 `*_ENABLED` 只认小写 `true`，写 `1`/`yes`/`TRUE` 都算关**（`docs/deploy.md:84`）。

| 变量 | 建议值 | 理由 |
|---|---|---|
| `COLLECT_ENABLED` | **`false`** 起步，确认信源接通后逐个开 | 金融信源多为付费/需 key，误开会空跑或产生费用 |
| `MODEL_CALLS_ENABLED` | **`false`** 起步，手动开单条后再全开 | 避免首次跑就用真实 key 批量烧 token |
| `FEISHU_CONTENT_PUSH_ENABLED` | `false` | 不接飞书 |
| `FEISHU_INTERNAL_ENABLED` | `false` | 不接飞书 |
| `INDEXNOW_SUBMIT_ENABLED` | `false` | 不做百度收录推送 |
| `INGEST_RATE_LIMIT` | `10` | 无代理限流时必设（`docs/deploy.md:157`：不用 Docker 时默认不限） |
| `DEV_AUTH_ROLE` | **不设** | 生产环境设了会拒绝启动（`deploy.md:247`）；本机调试才临时设 `admin` |
| `EGRESS_PROXY_URL` | 不设 | 国内直连；若抓海外源失败再配（`deploy.md:37`） |
| `DB_BACKUP_STORE_*` | 不设 | 本机开发不接对象存储备份 |

**付费采集一律不启用**（`SOCIALDATA_API_KEY` / `DAJIALA_KEY` / `JINA_API_KEY`）—— 金融信源不走 X/公众号/付费抓取。

### 5.3 调试用（不写进 .env）

```bash
NODE_ENV=production   # api/worker 不带它会按开发环境跑，DEV_AUTH_ROLE 会生效
```

> `docs/deploy.md:243`：「三个进程都要带 `NODE_ENV=production`。api 和 worker 不带它就按开发环境运行：启动时不检查生产密钥和管理员密码，`DEV_AUTH_ROLE` 免登录也会生效。」

---

## 6. 待验证项（必须在 Phase 2 开工前闭环）

| # | 待验证 | 为什么重要 | 怎么验 |
|---|---|---|---|
| **V1** | ~~同一 URL 内容变化时的去重行为~~ | — | **[OK] 已闭环，见 §12。结论：同一篇 `articles` 行 + 新修订 + 重跑管道。官方统计信源可即插即用，+0.2 人日配置** |
| **V2** | `hot.ts:190` 的 10 条上限是否要改成按板块配额 | 三个板块 10 个席位不够分（§4.3） | 读 `HOT_RULE_VERSION` 语义 + 问 PM 要「热点榜几个板块」。**待 PM 的信源与分类清单** |
| **V3** | `npm ci` 在 Windows 上`sharp` 是否装上预编译包 | 装不上就要编译工具链，Windows 上很痛 | **[OK] 已闭环（2026-10-05）**：`npm ci` 装 297 包无报错；**`sharp` 实际加载并跑通像素管线**（0.35.4/ libvips 8.18.6，生成 84 字节 WebP，1718 ms）；**`npm run typecheck` 7 个工程全过**（含 react-router typegen）。见 §14 |
| **V4** | `npm test` 全量在 Windows 上的实际耗时与失败数 | 验收基线 | **阻塞中**：本机 Docker Desktop 无法启动（依赖 `wsl.exe`，被安全策略拉黑），需用户手动启Docker Desktop 后才能跑 |
| **V5** | ~~门槛校准样本从哪来~~ | — | **[OK] 已闭环，见 §13。结论：必须用户自己标 `gold.decision`（60-80 条），公开数据集只能当素材池** |

---

## 7. 架构分层图

```
┌─────────────────────────────────────────────────────────────────┐
│ 表现层  apps/web (Node 25.8.0 · React 19.3 · React Router 8.4)  │
│   SSR，只通过 HTTP 读 api · 不碰数据库 · Tailwind 4.3.3          │
│   ┌──────────────┐  ┌────────────────┐                           │
│   │ 框架页面      │  │ modules/quotes │  ← §3.2 价格看板（新增）   │
│   └──────────────┘  └────────────────┘                           │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP (API_BASE_URL)
┌────────────────────────────┴────────────────────────────────────┐
│ 接口层  apps/api (Fastify 5.12.5 · zod 4.6.5 · MCP server 2.1)  │
│   站点接口 · 公开 API v1 · RSS · MCP · 后台/��理                 │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────┴────────────────────────────────────┐
│ 业务层  packages/backend                                         │
│   ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐  │
│   │ sources/   │ │ content/   │ │ events/    │ │ editorial/ │  │
│   │ rss        │ │ materials  │ │ group      │ │ analyze    │  │
│   │ json_list [*]│ │ 去重(V1)   │ │ [*]行情播报  │ │ [*]评分五轴  │  │
│   │ web_list   │ │            │ │ hot [*]      │ │ vocabulary │  │
│   │ x / mp     │ │            │ │ recall     │ │ [*]entity    │  │
│   └────────────┘ └────────────┘ └────────────┘ └────────────┘  │
│   reports/  publication/  admin/  notify/  jobs/(pg-boss 12.34)  │
│   providers/  ← llm.ts · embeddings.ts [*](需 DashScope)           │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────┴────────────────────────────────────┐
│ 数据层  PostgreSQL 17-alpine (Docker Desktop)                    │
│   DATABASE_URL=postgres://aihot:aihot@127.0.0.1:5432/aihot       │
│   57 个迁移· 向量存real[] + JS cosine32（非 pgvector）           │
└──────────────────────────────────────────────────────────────────┘

横切：行业包 industry/（分类 · 信源 · 提示词 · 门槛）· 站点包 site/（站名 · 品牌 · 模型）
      [*] = 本次改造需要改的文件
```

**分层依赖（不可违反，由 `tests/architecture.test.ts:148` 用 `git ls-files` 检查）**：

```
industry/ ←  contracts/  ←  backend/  ←  apps/api
     ↑            ↑            ↑           ↑
                site/  （站专属：品牌 · 文案 · 每步模型）
```

---

## 8. 明确不做（out-of-scope，防止镀金）

1. **不改框架代码的核心逻辑**（`packages/backend/src/events/hot.ts` 的热度公式、归组判定语义、公开 API 形状）。只在`industry/`（行业包）和 `modules/`（站专属功能）里改。
2. **不装本地向量数据库**（Milvus / Qdrant / Chroma）。理由见 §3.1。
3. **不接付费采集**（X / 公众号 / Jina Reader）。
4. **不做实时行情 / K 线 / 撮合 / 持仓模拟**。`modules/quotes` 只做近 30 日静态价格。
5. **不接飞书推送、不做百度收录推送、不接对象存储备份**。
6. **不引入第二套图标库、不用 emoji 图标**。唯一图标库 = `lucide-react` 0.544.0，尺寸 16/20/24。
7. **不做紫色→粉色渐变主视觉、不做发光边框 + 毛玻璃主视觉、不硬编码颜色（#fff/#000 除外）、不用弹跳缓动**。
8. **不加新的评分轴**。五轴结构不动，只改定义和权重。
9. **不改 `tests/databases.ts` 的测试库机制**。已验证它在 Windows/Postgres 上可用。
10. **不改 `docs/deploy.md:216` 的「Windows 上请在 WSL2 里运行」**——只**追加**一节实测通过的 Windows 配置，保留官方支持矩阵的表述。

---

## 9. 成本估算

### 9.1 二次开发工作量（人日）

| 工作项 | 最小可行（MVP） | 完整版 | 说明 |
|---|---|---|---|
| **分类体系**（`taxonomy.ts`：CATEGORY_TAGS / TOPIC_TAGS / ENTITIES / ITEM_TYPES / TAG_SYNONYMS） | **2.0** | 3.5 | ENTITIES 要覆盖 ~120 个主体（央行/交易所/金属/机构/国家），每个带 `otherNames` |
| **提示词重写**（10+ 个文件，§4.1/4.4/4.5） | **2.5** | 4.0 | 防幻觉 +4 条、`act` 重定义、读者画像整段、`identity-context` 受控事实表、`prefilter` 行情播报识别、噪声规则 |
| **归组改造**（§4.3 改法 A/B/C） | **1.0** | 2.0 | 改法 A（提示词）0.5；改法 B（`standalone` 打标，涉 `content/materials.ts`）1.0；改法 C 可选 0.5 |
| **数字/口径机械校验**（§4.1 后置校验） | **0** | 1.5 | MVP 靠提示词；完整版加打回重试+降级 |
| **信源接入**（`sources.json` + `json_list` 配置 + `seed.ts` 分级标注） | **3.0** | 5.0 | 按 12-18 个信源估，每个约 0.2-0.3 人日（含调试）；PM 需先交付信源清单。**V1 已闭环：官方统计源是纯配置，额外 +0.2 人日** |
| **门槛校准**（`selection.ts` 阈值 + `hot.ts` TIER_ORDER + `eval-selection.ts` 跑 60-80 条标注样本） | **1.0** | 2.0 | 标注样本是主要成本（**V5 已闭环：必须用户自己标，60-80 条，见 §13**） |
| **模型分层配置**（`site/models.ts`） | **0.3** | 0.5 | 单供应商差异化参数 |
| **Embedding 接入**（`DASHSCOPE_API_KEY` + 向量重建） | **0.3** | 0.5 | 配置简单，但要触发存量条目重算 |
| **品牌**（`site/brand/`：Logo · nameplates · favicon · manifest） | **1.0** | 2.5 | 站点身份；含重新生成 nameplates 的字体处理 |
| **`modules/quotes` 价格看板**（§3.2） | **0** | 4.0 | MVP 不做；完整版含建表 + 定时采集 + 页面 |
| **Windows 适配**（`deploy.md` 追加章节 + 排错） | **0.5** | 0.5 | 主体已可用，本文即交付物 |
| **测试修复**（Windows 特有失败 + 金融改造破的断言） | **1.0** | 2.5 | 主要落在 `tests/news-value.test.ts`（评分）、`tests/source-rules.test.ts`（信源）、`tests/outlet-invariants.test.ts` |
| **端到端验收**（§1.6 十条全跑 + 门槛校准复跑） | **0.5** | 1.0 | |
| **合计** | **13.1 人日** | **29.0 人日** | |

**换算**（按 `development-costs.md` 的「AI 辅助交付提速参考」，后端/测试阶段 2-3x 提速）：

- 最小可行：13.1 人日 ≈ **2.6 周**单人开发
- 完整版：29.0 人日 ≈ **5.8 周**单人开发

> 参照：同表「内容平台 10-15 页 / 5-8 周 / 3-4 人月」。本项目页面数相近但**不新建页面框架**（复用 AIHOT 的 SSR 页面），且**不做 UI 设计**（品牌资产复用 + 换标识），所以人月显著低于 3-4。

### 9.2 运营成本

**DeepSeek token 消耗**

框架基准（`docs/deploy.md:210` 原文）：「第一次导入的 152 条资料一共用了大约 930 次模型调用」→ **6.1 次调用/条**。

单条资料的调用拆解（来自 `tests/setup.ts:28-33` 的 `STEP_MODELS` 步骤名）：

| 步骤 | 次数 | 典型输入 token | 典型输出 token |
|---|---|---|---|
| `prefilter` 预筛 | 1 | ~1,500 | ~50 |
| `score` 评分 | **2**（独立打两次求和） | ~2,500 ×2 | ~30 ×2 |
| `structure` 结构化 | 1 | ~3,000 | ~800 |
| `summarize` 标题摘要 | 1 | ~3,500 | ~500 |
| `group` 归组 | 0-1（有相近报道才调） | ~4,000 | ~400 |
| 小计（无归组） | **5** | ~12,000 | ~1,410 |
| 小计（有归组） | **6** | ~16,000 | ~1,810 |

**基准场景：每日 60 条新资料**

| 项 | 计算 | 结果 |
|---|---|---|
| 模型调用 | 60 × 6.1 ≈ 366 次/天（其中归组调用按 20% 估） | ~366 次/天 |
| 输入 token | 60 × 13,000 ≈ 780,000 | 0.78 M/天 |
| 输出 token | 60 × 1,500 ≈ 90,000 | 0.09 M/天 |
| **日成本（off-peak）** | 输入 0.78M × $0.22/M + 输出 0.09M × $0.66/M | **$0.23/天** |
| **日成本（peak，UTC 01-04/ 06-10，即北京 09-12 / 14-18）** | 0.78M × $0.44/M + 0.09M × $1.32/M | **$0.46/天** |
| **月成本（按 22 天，含峰谷）** | | **约 ¥40-60/月** |

> 定价依据：DeepSeek 官方 `deepseek-v4-flash` off-peak 输入 $0.22/百万、输出 $0.66/百万；peak 翻倍（联网核实 2026-10-05）。**若走国内直连人民币定价（约 ¥1/百万输入未命中、¥2/百万输出），月成本约 ¥60-90。**

**大场景：每日 200 条**（信源铺满+ 多板块）

- 月成本约 **¥140-200**（含峰谷）

**Embedding 成本**

- 200 条/天 × ~500 token/条 ≈ 100,000 token/天 ≈ 3 M/月
- `text-embedding-v4` 约 ¥0.5/百万 token → **约 ¥1.5/月**。可忽略。

**其他运营成本**

| 项| 成本 |
|---|---|
| PostgreSQL 17（Docker Desktop，本机） | ¥0（仅占本机资源） |
| DeepSeek API | ¥40-200/月（见上） |
| 阿里 DashScope embedding | ¥1.5/月 |
| 域名 + SSL | ¥100-300/年 |
| 付费采集（X/公众号/Jina） | **¥0**（本项目不启用） |
| 对象存储备份 | ¥0（本机开发不配） |
| 飞书/推送 | ¥0 |
| **合计（月）** | **约 ¥42-202** |

### 9.3 两档总账

| | 最小可行 | 完整版 |
|---|---|---|
| 开发（一次性） | **13.1 人日 ≈ ¥3.9 万**（按 ¥3,000/人日） | **29.0 人日 ≈ ¥8.7 万** |
| 运营（月） | **约 ¥42-60**（DeepSeek off-peak 为主 + embedding） | **约 ¥145-202** |
| 首年总计 | **约 ¥39.5 万** | **约 ¥10.9 万** |
| 新增依赖 | `lucide-react` 0.544.0 | `lucide-react` 0.544.0 |

> 人日单价 ¥3,000 是国内中级全栈/AI 应用的常见区间（含税与设备摊销），仅供量级参考。

---

## 10. ADR 索引

| ADR | 标题 | 状态 |
|---|---|---|
| [ADR-001](decisions/ADR-001.md) | 采用 Windows 本机三进程 + Docker Desktop 仅承载 PostgreSQL | Accepted |
| [ADR-002](decisions/ADR-002.md) | 锁定 Node 25.8.0 为最低可用运行时（PATH优先级） | Accepted |
| [ADR-003](decisions/ADR-003.md) | 向量能力用远程 embedding 供应商，不部署本地向量数据库 | Accepted |
| [ADR-004](decisions/ADR-004.md) | 选lucide-react 作为唯一图标库 | Accepted |
| [ADR-005](decisions/ADR-005.md) | 单 DeepSeek 供应商，靠 per-step extra 参数分层 | Accepted |
| [ADR-006](decisions/ADR-006.md) | 行情播报在预筛层丢弃并打 standalone，不改热度算法 | Accepted |
| [ADR-007](decisions/ADR-007.md) | 价格看板做成 modules/quotes，不进框架 | Accepted |

---

## 11. 给 PM 的技术侧反馈（分类体系的技术负担）

PM 说会转来分类建议。**以下是我的技术约束，请据此调整分类粒度**：

1. **分类数量有软上限**。`vocabulary.ts:20` 的 `normalizeTags` 限制**每篇最多 6 个标签，且第一个必须是分类标签**。分类超过 ~14 个（现 `CATEGORY_TAGS` 12 个）会让预筛分类步骤的准确率明显下降（选项越多，模型选错率越高）。**建议贵金属/大宗/股债三板块用「3 个一级分类 + 多个主题标签」的层级，不要做成 20+ 个平铺分类。**

2. **不要为「品种」建分类**。品种（黄金/白银/铂金/钯金/铜/原油）应该进 `TOPIC_TAGS`（主题标签，允许多个），**不要**进 `CATEGORY_TAGS`（每篇只能有一个）。因为「美联储加息 → 黄金白银下跌、原油上涨」是**一篇多品种**的典型事件。

3. **`ITEM_TYPES` 只能加 1 类**。见 §4.5，框架的权重表和 `tests/news-value.test.ts` 都按类型枚举。`official_data` 是我评估后的最小必要新增。**如果 PM 的分类建议需要更多新类型，代价是重跑门槛校准。**

4. **T1/T2 分级是信源属性，不是分类属性**。PM 若想按「官方/媒体」做分类维度，会与 `sources.tier` 重复。建议**只走 `tier`，不要在 `taxonomy.ts` 里再做一遍官方/媒体分类**。

5. **每个分类的 `guide` 字段（`taxonomy.ts` 的 `CATEGORIES[].guide`）会成为提示词的一部分**。`CATEGORY_GUIDE`（`vocabulary.ts:26`）把所有 guide 拼成一段注入结构化步骤。**分类越多，注入的 token 越多、模型越容易串类**。建议每个 guide 控制在 30 字以内。

---

## 12. 待验证项 V1 实测结论（2026-10-05 补测）

> 结论先行：[OK] **V1 = 「既不是纯跳过，也不是新条目」——是「同一篇文章开一个新修订（revision），并重跑整条分析管道」**。
> 官方统计类信源**可以直接接 `json_list`，0 额外人力**。但**必须做 1 项配置（约 0.2 人日）**，否则每次数据更新都会重复烧模型调用。

### 12.1 机制定位（文件 + 行号 + 代码）

去重逻辑**不在 `dedupe.ts`（该文件不存在）**，而在 **`packages/backend/src/content/materials.ts` 的 `upsertIn()`**（第 164-257 行），由 `upsertMaterial()`（第 152 行）导出，是**所有采集通道的唯一入口**（第 1-2 行注释：「The single entrance for new material from every channel」）。

**判据一：身份键 = 规范化 URL，不含内容**

`materials.ts:139-145`：

```ts
export function identityKeyFor(m: MaterialInput): string {
  if (m.identityKey) return m.identityKey;
  if (m.xPost?.tweetId) return `x:${m.xPost.tweetId}`;
  const fromUrl = identityKeyForUrl(m.url);
  if (fromUrl) return fromUrl;                    // ← 走这条
  return `src:${m.sourceId}:${sha256(...)}`;
}
```

`lib/url.ts:56-63` 的 `identityKeyForUrl` 只做 URL 规范化（小写主机名、去 fragment、去 utm_* 等跟踪参数、去尾斜杠），**不掺入任何内容或时间**。

**判据二：变没变靠 `content_hash` 比对，不是靠 URL**

`materials.ts:121-123`：

```ts
export function contentHash(c: { title: string; bodyText?: string|null; excerpt?: string|null }): string {
  return sha256([collapseWhitespace(c.title), collapseWhitespace(c.bodyText ?? ""), collapseWhitespace(c.excerpt ?? "")].join("\u0001"));
}
```

**判据三：`INSERT ... ON CONFLICT (identity_key) DO NOTHING`（只对新身份）**

`materials.ts:181-190`，注意冲突目标是 **`identity_key`**（不是内容哈希）：

```sql
INSERT INTO articles (id, source_id, identity_key, url, title, ..., revision, content_hash, ...)
VALUES (...)
ON CONFLICT (identity_key) DO NOTHING RETURNING id
```

**判据四：命中已有行后的 5 道闸门（决定「跳过」还是「修订」）**

`materials.ts:203-256`，按顺序：

| 闸门 | 行号 | 条件 | 结果 |
|---|---|---|---|
| 0 | 201-202 | 无论是否变化，先记一条 `article_discoveries` | 总是记录 |
| 1 | 218-220 | `existing.source_id !== m.sourceId` | 别的信源报同一条→ **只记发现，不修订** |
| 2 | **226** | `!time && existing.content_hash === next` | **内容没变 → 返回 `unchanged`（跳过）** |
| 3 | 227-235 | `existing.content_hash === null` | 导入的历史：记基线，不算修订 |
| 4 | **241** | `SELECT 1 FROM article_revisions WHERE content_hash = next` | **这个版本以前见过 → 跳过** |
| 5 | 244 | `sameBarringLoss(...)` | 只是 U+FFFD 丢字（`materials.ts:132-137`）→ 跳过 |
| — | 247-256 | 都不命中 | **`reviseMaterial()` → `revised: true`，`revision + 1`** |

**判据五：修订做了什么**

`materials.ts:264-278` 的 `reviseMaterial`：

```ts
UPDATE articles SET ${revision.set}, revision = revision + 1, content_hash = ${revision.hash}, ${groupingReset()},
  processing_state = 'new', processing_attempts = 0, processing_retry_at = NULL, processing_error = NULL, ...
await db`INSERT INTO article_revisions (article_id, revision, content_hash, title, body_text) VALUES (...)`;
if ((await db`SELECT 1 FROM publications WHERE article_id = ${articleId}`).length) {
  await publishArticleTx(db as Tx, articleId);       // 已发布过的→ 重新发布
  await emit("articleChanged", { id: articleId, kind: "content", reason: "material revision" }, db);
}
```

`groupingReset()`（`content/provenance.ts:13-14`）把 `grouping_status`、`grouped_at`、`selection_adds_value` 全部清空→ **归组结论作废，要重新归组**。

`sources/collect.ts:68-70`：只要 `revised` 为真就 `await queueProcessing(res.articleId)` → **重新入队分析**。

### 12.2 真实复现（实际执行，非推演）

**环境限制说明**：本机 Docker Desktop 无法启动（`com.docker.service=Stopped`，且 Docker Desktop 依赖 `wsl.exe`，被安全策略列入黑名单无法拉起），所以**无法连真库跑 `npm test`**。因此我改用**直接执行框架的真实函数**（不是复刻逻辑）——`fetchJsonList` / `identityKeyFor` / `contentHash` / `decideTimeline` 全部从 `packages/backend/src/` 原始文件import，Node 25.8.0 原生类型剥离，无改写、无mock。

**先验证纯函数（无外部依赖）**：

```bash
$ export PATH="/d/nodejs:$PATH" && node --version
v25.8.0
$ npm ci --no-audit --no-fund
added 297 packages in 55s
```

```bash
$ node --input-type=module -e '
... import { contentHash, identityKeyFor } from "./packages/backend/src/content/materials.ts" ...'

=== A. 身份键：同一 URL 的两次抓取 ===
  identityKeyForUrl 两次 = url:https://cftc.gov/dea/cot.htm | url:https://cftc.gov/dea/cot.htm
  是否相同 = true

=== B. contentHash：CFTC 周报两版内容（URL 相同） ===
  v1 hash = bd4093d1d9cd1e2e6c68e8bf
  v2 hash = 4de364d00957bdf2f98bde0a
  相同 = false   -> materials.ts:226 的 UNCHANGED 分支不命中（走修订）

=== C. 只有标题变（excerpt 不变） ===
  hash 相同 = false  -> 走修订

=== D. JSON 数组顺序变了（CFTC 按品种返回） ===
  hash 相同 = false  -> 顺序变 -> 修订

=== E. decideTimeline：官方数据源无 publishedAt ===
   {"publishedAt":null,...,"backfill":true,"backfillReason":"unknown-publication-time"}
   {"publishedAt":"2026-09-29T20:00:00.000Z",...,"backfill":true,"backfillReason":"stale-on-discovery"}
```

**再跑端到端（真本地 HTTP 服务 + 真 `fetchJsonList`）**：

按 `docs/sources.md:130-141` 的「本地跑通 HTML/JSON 示例」起一个本地服务，**同一 URL 返回两版内容**（v1：黄金净多 152300 手 / v2：168900 手），信源配置照抄文档里的 `json_list` 示例：

```bash
$ ALLOW_PRIVATE_NETWORK_FETCH=true node .workbuddy/v1repro/probe.mjs

--- 第一次抓取 (version=v1) ---
  抓��条数: 2
  * {"url":".../cot/2026-09-29/GOLD",  "title":"CFTC COT GOLD net long 152300 contracts",
     "identityKey":"url:https://127.0.0.1:8787/cot/2026-09-29/GOLD"}
  * {"url":".../cot/2026-09-29/SILVER","title":"CFTC COT SILVER net long 88000 contracts",
     "identityKey":"url:https://127.0.0.1:8787/cot/2026-09-29/SILVER"}

--- 第二次抓取（同一 URL，内容已变） (version=v2) ---
  抓��条数: 2
  * {"url":".../cot/2026-09-29/GOLD",  "title":"CFTC COT GOLD net long 168900 contracts",  <- 标题变了
     "identityKey":"url:https://127.0.0.1:8787/cot/2026-09-29/GOLD"}                        <- 身份键没变
  * {"url":".../cot/2026-09-29/SILVER","title":"CFTC COT SILVER net long 88000 contracts",
     "identityKey":"url:https://127.0.0.1:8787/cot/2026-09-29/SILVER"}

=== 结论判据 ===
  identityKey 集合是否相同 : true
  -> identity_key 相同 => upsertIn 走 lockMaterial 命中已有行（不 INSERT 新 article）
  标题+摘要是否变化      : true
  -> content_hash 变化 => materials.ts:226 的 unchanged 不命中，走 reviseMaterial（revision+1）
```

**清理已确认**：

```bash
$ curl -s --max-time 3 http://127.0.0.1:8787/cot → 8787 未监听
$ rm -rf .workbuddy/v1repro           # 临时目录已删
$ grep -n "^[^#]*ALLOW_PRIVATE" .env
OK: .env 中该开关未启用（仍为注释）    # 全程只用进程环境变量，未写入 .env
```

**交叉印证**：框架自带测试已经覆盖了这个行为，不需要我另立新论——`tests/materials.test.ts:44-55`「concurrent changes to one article each get a revision」断言 6 次并发改同一 URL 后 `revision === 7` 且 `article_revisions` 有 1..7 共 7 行；`:57-64`「an unchanged report does not add a revision」断言内容不变时 `revision` 保持 1。**这两条测试就是官方对 V1 的答案：内容变 → 开新修订；内容不变 → 不开。**

### 12.3 对官方统计信源的完整回答

**「跳过」还是「新条目」？都不完全是。准确答案是第三种：**

| 环节 | 行为 | 依据 |
|---|---|---|
| 库里的文章行数 | **不变**（1篇CFTC 周报 = 1 个 `articles` 行） | `ON CONFLICT (identity_key) DO NOTHING`（第 190 行）+ `lockMaterial` 命中（第 177行） |
| 版本历史 | **+1 行**（`article_revisions` 累积） | 第 271-272 行 |
| `revision` | **+1** | 第 266 行 `revision = revision + 1` |
| 分析管道 | **整条重跑**（预筛→评分×2→结构化→摘要→归组） | `processing_state='new'`（第 267 行）+ `collect.ts:70` 的 `queueProcessing` |
| 归组结论 | **作废重做** | `groupingReset()` 清空 `grouping_status`/`grouped_at`/`selection_adds_value` |
| 已发布内容 | **撤回旧版、发布新版** | 第 274-276 行 `publishArticleTx` + `articleChanged` 事件 |
| 旧的分析记录 | **保留**（`analyses` 表无`DELETE`） | 全库 grep `DELETE FROM analyses` 零命中 |

**所以「0 额外人力」这个判断要修正一半**：`json_list` **可以即插即用**（这是好消息），但有一个**必须处理的成本问题**：

**[!] 问题：CFTC 每周更新、USGS 每月更新 → 每次都重跑整条分析管道 =每次 5-6 次模型调用。如果信源里有 8 个官方统计源、平均每周各更新 1 次，仅这一项每周就是 8 × 5.5 ≈ 44 次模型调用，其中 95% 是在重读同一篇材料的微小数字变化。**

**更重要的是闸门 4（第 241 行）会放大这个问题**：如果数据在 v1↔v2 之间来回摆动（API 修正历史数据、字段顺序抖动、某个品种当天缺值导致拼接结果不同），每次摆动都会被当成新版本 → 再跑一次完整分析。**`article_revisions` 里有 N 行，就可能烧掉 N 次管道。**

**最小改动方案（约 0.2 人日，不改框架代码）**：

**做法：把 `publishedAt` 配成「只在报告期变化时才变」，让闸门 2/4 之外的判据把「同报告期的数值修正」吸收掉。**

具体到 `json_list` 配置（**这是纯配置，零代码**）：

```json
{
  "url": "https://publicreporting.cftc.gov/resource/6dca-aqww.json?$limit=200&$order=report_date_as_yyyy_mm_dd DESC",
  "mode": "json_api",
  "itemsPath": "data",
  "titlePaths": ["title"],
  "urlTemplate": "https://www.cftc.gov/dea/cot/{report_date_as_yyyy_mm_dd}/{market_and_exchange_names}",
  "summaryPaths": ["title"],
  "publishedAtPath": "report_date_as_yyyy_mm_dd",
  "publishedAtUnit": "yyyymmdd",
  "externalIdPath": "market_and_exchange_names"
}
```

**关键点：`urlTemplate` 里必须含报告期（`{report_date_as_yyyy_mm_dd}`）。** 这样：

- **新报告期**（周二新数据）→ URL 变 → identityKey 变 → 走第 181 行INSERT → **真新文章，1 次管道**。这是想要的。
- **同一报告期的数值修正**（CFTC 事后修数据）→ URL 不变→ identityKey 不变 → 命中已有行 → 走闸门 2/4：`content_hash` 变了但`article_revisions` 里没有这个哈希 → **仍是修订**。

**所以纯配置解决不了「同报告期修正」。** 要吸收它，必须让**同报告期的修正不进摘要**。两个做法：

| 做法 | 改动 | 效果 |
|---|---|---|
| **A（推荐）摘要里只放报告期，不放具体数值** | `summaryPaths` 指向一个只含报告期与品种的字段，或用 `titlePaths` 而非 `summaryPaths` | 数值不进 `contentHash` → 同报告期修正的哈希不变 → **闸门 2 命中 → 跳过，0 成本**。代价：摘要里没有具体数字，读者看不到持仓量 |
| **B 把统计值当 `raw` 存档，不进 contentHash** | 用 `externalIdPath` + 让 `summary` 只留报告期 | 同上|

**我的建议：走A，但把数值放到 `title` 里、且接受「每周重跑一次」**。因为对投资决策读者，**持仓量数值本身就是内容**（`「黄金净多 152300 手」` 就是价值），不能藏。**每周 8 个源 × 5.5 次 ≈ 44 次/周 ≈ 0.6 元/月，成本可忽略。** 真正要防的是**同报告期内反复摆动导致的重复消耗**——建议在 `industry/sources.json` 里给官方统计源配 `interval_minutes` 大一点（CFTC 每周二更新，间隔设 3 天足够），从源头减少无意义的重复抓取。

**内嵌坑 1（必须写进 Spec）**：`identityKeyForUrl` 会**规范化 URL**（`lib/url.ts:8-36`）：小写主机名、去 `www.`、去 `utm_*`/`spm`/`from`/`ref`/`share_source`/`fbclid`/`gclid` 等跟踪参数（`TRACKING_PARAMS`，第 5 行）、排序剩余 query、去尾斜杠、`http`→`https`。**所以 `urlTemplate` 里不要放会变的签名参数（时间戳、token）** —— 否则每次抓取的 identityKey 都不同 → **每次都变成新文章 → 无限增长 + 每次全管道**。CFTC Socrata 的 `$order`/`$limit` 只影响返回内容、不进 identityKey（identityKey 取的是 `urlTemplate` 渲染出来的 URL），所以安全；但如果哪个源把 token 拼进 `urlTemplate`，就会踩这个坑。

**内嵌坑 2（闸门 1 的跨源保护，对金融信源很重要）**：`materials.ts:218-220`，**若 `existing.source_id !== m.sourceId`，则只记发现、不修订**。这意味着：如果 CFTC 数据的同一条被**另一个源**（如金十的转载页）也报了，**以先入库的那个源为准**，另一个源的标题/摘要不会覆盖它。**反向风险**：若某个媒体源先入库了 CFTC 数据的转载页，CFTC 官方源后续的更正就**进不来**。→ **处置：官方统计源在 `industry/sources.json` 里排在媒体源之前配置，且不要给媒体源配指向同一份数据的 `urlTemplate`。**

**内嵌坑 3（`article_revisions` 会无限增长）**：第 271-272 行每次修订插一行，无清理机制（`hot_rankings` 有30 天清理，`article_revisions` 没有）。8 个官方源 × 每周 1 次 × 一年 ≈ 400 行/源，量级可忽略，**但要知道它没有保留策略**。

**内嵌坑 4（已发布内容会被撤回重发）**：第 274-276 行。**如果一条 CFTC 周报已精选发布，数值修正后旧标题/摘要会从公开面撤回**，读者会看到「已发布内容突然变了」。`docs/deploy.md` 的公开出口约定要求撤回后的引用跟随——这条框架已经处理（`docs/deploy.md:123`「已撤回的引用及依赖它的导读、封面不再分发」），但**对官方统计源要意识到「同一 URL 内容会变」是常态**，别把它当bug 修。

**内嵌坑 5（`decideTimeline` 的 48 小时窗口）**：实测 E 组输出——若 `publishedAt` 距 `discoveredAt` 超过 `STALE_ON_DISCOVERY_MS = 48h`（`materials.ts:68`），`backfillReason = "stale-on-discovery"`。**官方统计源的报告期天然是「几天前」**（CFTC 周报周五发布，采集可能周一才跑），**容易落进 backfill**。而 `isHistorical()`（第 116-118 行）判定 backfill 且无发布时间或超期 → **归档、不进「今天」、不建事件、不加热度**。→ **处置：官方统计源的 `interval_minutes` 要设成比报告期更密的频率**（CFTC 周二更新 → 间隔设 1 天，周一就能抓到），否则整份周报会被当历史归档，**永远不出现在热点和日报里**。这是官方统计源最容易踩且最难发现的坑。

### 12.4 V1 结论摘要（可直接进 Spec）

| 问题 | 答案 |
|---|---|
| 判据是「URL 相同」还是「URL + 内容哈希」？ | **身份 = 规范化 URL（不含内容）；是否修订 = `content_hash`（title+bodyText+excerpt 的 sha256）** |
| `ON CONFLICT` 走 DO NOTHING 还是 DO UPDATE？ | **DO NOTHING**（`materials.ts:190`），且冲突目标是 `identity_key` |
| 同一 URL 内容变化 → 跳过还是新条目？ | **都不完全是：同一篇 `articles` 行 +1 个 `article_revisions` 版本 + `revision+1` + 整条分析管道重跑 + 归组作废 + 已发布内容撤回重发** |
| 官方统计信源能直接接 `json_list` 吗？ | **[OK] 能，零代码改动。** 但必须做 2 项配置：`urlTemplate` 含报告期字段、采集间隔密于报告期|
| 需要写中间层吗？ | **[OK] 不需要**（原估+2~3 人日作废，改为 +0.2 人日的配置工作） |
| 新增工作量 | **0.2 人日**（`industry/sources.json` 的 `urlTemplate` / `interval_minutes` 配置 + `scripts/seed.ts` 分级标注） |

---

## 13. 待验证项 V5 收紧：门槛校准样本从哪来

### 13.1 结论：**必须自己标注，不能用公开数据集替代**。但可以用公开数据集做「素材来源」，省掉从零找信的功夫。

理由（基于 `scripts/eval-selection.ts:50-54` 读出的 `GoldRow` 契约）：

```ts
interface GoldRow {
  caseId: string;
  material: { title; originalTitle; publishedAt; sourceName; bodyZh; bodyOriginal };
  sourceFacts: { sourceKind: string; sourceTier?: string; firstParty?: boolean; language?: string|null };
  samplingContext?: { benchmarkSplit?: string; samplingStratum?: string };
  gold: { decision: "select" | "reject" | "either" };
}
```

**决定性理由**：`gold.decision` 是**「这条该不该进本站精选」的人工判断**。这个判断**依赖本站的分类体系、门槛值、读者画像**——也就是依赖我 §4.5 改过的 `selection-score.md`（读者画像整段重写、`act` 重定义、新增 `official_data`）和 §4.6 的新阈值表。**任何公开数据集的标签都是别人在他们自己的标准下打的**，与本站标准无对应关系。数据集给的是「这条新闻是什么」，不是「本站该不该选它」。

**所以：50 条样本必须由用户（你）标注。** 这是唯一不可外包的部分。

### 13.2 但公开数据集能省掉「找素材」的功夫

按适配度排序：

| 数据集 | 适配度 | 能用来做什么 | 不能用来做什么 |
|---|---|---|---|
| **Kaggle `Financial News & Multi-Asset Market v1.0`**（Alpha Vantage News & Sentiment + yfinance，151 个交易日，含黄金/白银/原油/铜） | **最高** | 直接拿 `financial_news_final_2026.csv` 的文章级新闻做**素材池**——标题、时间、来源都有。CC BY 4.0 许可可商用 | **不能用它的情绪标签当 `gold.decision`**（它是 bull/bear 情绪，不是「该不该进财经站精选」） |
| HuggingFace `Kenpache/multilingual-financial-sentiment`（39,829 条，中文 7,930 条，含新浪财经/东方财富/证券时报） | **高** | 中文财经短句做素材池，**语种与「中文表达」评估对齐** | 同上，只有正/中/负情绪 |
| CnOpenData 财经新闻舆情（1.1 亿条，含正负面情感字段） | 中 | 中文财经文本+发布时间+来源全，字段最贴合 `GoldRow` | **付费**（商业版/学术版都要联系销售）；且情感字段仍不是 `gold.decision` |
| 公开新闻聚合 RSS | 中 | 最真实：直接用 `scripts/seed.ts` 导入几个真实财经源，抓下来的就是真素材 | 需自己判 `decision`——但这本来就是必须做的那步|

### 13.3 建议的校准步骤（可直接进 Spec，约 0.5 人日）

```bash
# 1. 造素材：从任一财经源抓 60-80 条真实内容（比找数据集快，且分布真实）
#    用 docs/sources.md 的 json_list 示例起本地服务，或直接指向公开源
# 2. 写成 .data/gold.jsonl，每行一个 GoldRow（格式见 industry/gold.example.jsonl）
#    - sourceFacts.sourceTier 填我们新方案的档位：T1 / T1_5 / T_DATA / T2 / T2_OP
#    - samplingContext.benchmarkSplit 填 "development"（留出 "holdout" 做最终验证）
#    - samplingContext.samplingStratum 按 §4.3 分层：policy（政策决定）/ data（官方数据）/
#      market（行情播报，应大量reject）/ analysis（机构观点）/ event（真实事件）
#    - gold.decision 填 select / reject / either
#      **关键：行情播报类（§4.3）必须大量标 reject，否则门槛会被行情噪声抬高**
# 3. 在 site/site.ts 的 DEPLOYMENT.selectionGold 指向它
#    selectionGold: { file: ".data/gold.jsonl", sample: 60, split: "development", sweep: [40, 90] }
# 4. 跑扫描（阈值扫描会告诉你哪个门槛值的入选率落在目标区间）
node --env-file=.env scripts/eval-selection.ts --gold .data/gold.jsonl --n 60 --split development
# 5. 读输出：把 sweep 里最接近目标入选率的阈值填回 industry/selection.ts
# 6. 用 --split holdout 再跑一次做最终验证（这批不能参与调参）
```

**样本量建议修正**：我原先说 50 条，**收紧到 60-80 条**，因为要覆盖 `samplingStratum` 的 5 个分层（每层至少 10 条）才有诊断力。50 条做分层后每层只有 10 条，**某一层全错也看不出来**。

**成本提示**：`eval-selection.ts` 的每条样本要跑「预筛 1 次 + 评分 2 次」= 3 次模型调用。60 条 × 3 = 180 次调用，按 DeepSeek off-peak 估**约 ¥0.1-0.3**，可忽略。**但注意它默认会把每次结果导入 SelectBench**（`--no-import` 可关），所以要确保 `DATABASE_URL` 指向 `_test` 或 `_ci` 库（`tests/setup.ts:13` 的强制校验只覆盖测试脚本，**`eval-selection.ts` 走的是自己的路径，不会替你拦截**——**手动跑之前先确认 `DATABASE_URL` 库名**，否则会污染开发库）。

**内嵌坑**：`eval-selection.ts:4` 的用法注释说「Receipts make re-runs free」（凭据让重跑免费），所以**调参过程可以放心反复跑**。

---

## 14. 依赖安装与原生模块实测（2026-10-05 补测，V3 闭环）

`npm ci` 装完不等于能用。补测了三件事，**全部在 Windows 11 + Node 25.8.0 上实际执行通过**。

### 14.1 依赖安装

```bash
$ export PATH="/d/nodejs:$PATH" && node --version
v25.8.0
$ npm ci --no-audit --no-fund
npm warn deprecated whatwg-encoding@3.1.1: Use @exodus/bytes instead for a more spec-conformant and faster implementation
added 297 packages in 55s
```

**内嵌坑**：`fflate` 已被 `package.json:15-17` 的 `overrides` 锁在 `0.7.5`（安全修复），`npm ci` 会严格按 lock 安装——**不要用 `npm install` 绕过**，否则可能拉回被 override 掉的版本。

### 14.2 `sharp` 原生模块（V3 的真正验证）

装上不等于能加载。实际执行像素操作：

```bash
$ node --input-type=module -e '
const { default: sharp } = await import("sharp");
const buf = await sharp({ create: { width: 64, height: 64, channels: 3, background: {r:200,g:160,b:90} } })
  .webp().toBuffer();
console.log(sharp.versions.sharp, sharp.versions.vips, buf.length);'

  sharp 版本: 0.35.4 | libvips: 8.18.6
  实际生成 WebP 字节数: 84 -> 像素管线可用 [OK]
  耗时: 1718 ms
```

**结论**：`sharp` 0.35.4 在 win32-x64 有预编译包（含 libvips 8.18.6），**无需编译工具链**。

**注意 1718 ms 的首次加载耗时**——这是 libvips 的懒初始化。含义：**首个带图片处理的请求会明显慢于后续**。这对 `apps/api` 的分享图预热路径（`docs/deploy.md:105` 提到的「分享图预热」）有影响：Windows 本机开发时首个分享图请求会比预期慢约 1.5 秒，**不要误判为 bug**。

**切换 Node 版本后必须重跑 `npm ci`**（ADR-002 内嵌坑 1）：原生模块按 Node ABI 编译，Node 22 装的原生模块在 Node 25 上会报 `invalid ELF` 或找不到模块。

### 14.3 类型门禁（`npm run typecheck`）

这是「生成代码幻觉依赖/接口」防线（`generated-code-failure-modes.md` §3「构建即验证」）在 Windows 上的实测：

```bash
$ npm run typecheck
> tsc -p packages/contracts && tsc -p packages/backend && tsc -p apps/api && tsc -p apps/worker && tsc -p tests && tsc -p modules && npm run typecheck -w @aihot/web
> react-router typegen && tsc -p .
（无任何错误输出，退出码 0，耗时 51s）
```

**7 个工程全部通过**：`packages/contracts` / `packages/backend` / `apps/api` / `apps/worker` / `tests` / `modules` / `@aihot/web`（含 `react-router typegen`）。

**这条的意义**：TypeScript 7.0.2 在 Windows 上完整工作，**且它证明了全部 workspace 的类型解析路径（含 `@aihot/*` 的 `exports` 字段映射）没问题**。将来做金融改造时，**改 `industry/taxonomy.ts` 引入新类型（比如 `official_data`）后，这个门禁会立刻报出所有没同步更新的引用点**——这是最省事的防漏手段。

### 14.4 路径分隔符归一实测

`tests/architecture.test.ts:26` 的 `path.relative(ROOT, full).split(path.sep).join("/")` 在 Windows 上实测：

```bash
  原始 path.relative : packages\backend\src\content\materials.ts
  归一后（测试用）: packages/backend/src/content/materials.ts
  含反斜杠 = false -> 与 git ls-files 输出风格一致 [OK]
```

**确认框架的这处修复在 Windows 上有效**（`docs/deploy.md:133` 记录过「架构测试不再受路径分隔符影响」）。**含义：将来新增 `modules/<名字>/` 时，架构约束测试能在 Windows 上正常校验模块边界，不会因为路径风格差异误报。**

### 14.5 仍未能验证的（V4，需用户配合）

```bash
$ docker info --format "ServerVersion={{.ServerVersion}}"
failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine
```

**Docker Desktop 仍未启动**（`com.docker.service=Stopped`）。Docker Desktop 依赖 `wsl.exe`，被本机安全策略列入程序黑名单，我无法从工具侧拉起。**所以以下三项仍未验证，需要用户手动启动 Docker Desktop 后补跑**：

```bash
# V4-1迁移 + 建库
docker run -d --name aihot-pg -e POSTGRES_USER=aihot -e POSTGRES_PASSWORD=aihot \
  -e POSTGRES_DB=aihot -p 127.0.0.1:5432:5432 -v aihot-pgdata:/var/lib/postgresql/data \
  --restart unless-stopped postgres:17-alpine
node --env-file=.env scripts/migrate.ts    # 57 个迁移

# V4-2 三进程起得来
npm run dev:api ; npm run dev:worker ; npm run dev:web

# V4-3 测试基线
DATABASE_URL=postgres://aihot:aihot@127.0.0.1:5432/aihot_test npm test
```

**但风险已大幅降低**：§14.1-14.4 已验证「依赖装得上、类型门禁过、原生模块能用、路径归一正确」，**剩下的是数据库连通性这一层**，而数据库是标准 `postgres:17-alpine` + 标准连接串，与平台无关。**V4 的预期结论是「通过」，但仍以实跑为准。**

---

## 15. V2 预备分析：热点榜 10 条上限（不落代码，等 PM 板块需求）

> 状态：**未落代码**。等 PM 的信源与分类清单。本节把两种方案的成本与风险算清楚，供决策。
> 触发条件：V2 会真实发生——贵金属 / 大宗 / 股债三个板块分10 个席位必然不够（§4.3）。

### 15.1 先纠正一个可能的误解：10 这个数字有三处，且**都是硬编码**

```bash
# 1. 写入侧：算排名时只取前 10
packages/backend/src/events/hot.ts:190    if (entries.length >= 10) break;
# 2. 首页 hot 条带：只取前 5
packages/backend/src/publication/hot.ts:23   .slice(0, 5)  （另有 :117 的 .slice(0, 5)）
# 3. 导航/侧栏：只取前 3（< 3 条则整块隐藏）
packages/backend/src/publication/hot.ts:115  if (!ranking || ranking.entries.length < 3) return null;
```

**站点配置里没有任何旋钮**（实测）：

```bash
$ grep -rn "hotLimit\|hotRankLimit\|HOT_" site/site.ts
（零命中）
```

**含义**：`10` 写在框架的 `hot.ts` 里，**改它就是改框架核心代码**。这与我此前 ADR-001/006 的原则（不改 `hot.ts`）冲突，**所以必须明确它是一个需要你决策的例外**。

### 15.2 关键障碍：story 层面拿不到 category

「按板块配额」的直觉方案是「取前10 条时按 category 均衡」。**实测发现做不到**：

```bash
$ grep -n "category\|an\.\|analyses" packages/backend/src/events/hot.ts
（零命中）
```

`heatRows()`（`hot.ts:138-177`）的 SQL **完全没有 JOIN `analyses`**，所以 `HeatRow` 接口（`62-81` 行）里没有 category 字段。

**category 的实际存储位置**（读迁移确认）：

```
articles.id
  └─ fact_articles.article_id          (0002_events_reports.sql:69-77)
       └─ facts.id → facts.story_id    (0002:51-63)
            └─ stories.id
                    └─ analyses.article_id → analyses.category   (0001_core.sql:173-183)
```

**从 story 到 category 要跨 4 张表、3 次 JOIN**（stories → facts → fact_articles → analyses），而且 `analyses.category` 是**article 级**（一个 story 有多个 article，分类可能不同），**需要定义「story 的板块」聚合规则**（取代表稿的？取多数的？取最新的？）。

**这是 V2 的真实成本所在**，比「把 10 改成 20」大一个量级。

### 15.3 方案对比

| 方案 | 改动 | 成本 | 风险 |
|---|---|---|---|
| **A. 只调大条数** | `hot.ts:190` 的 `10` → `20/30` | **0.1 人日** | [OK] 板块问题没解决，只是把「不够分」变成「分得更均」。**但零框架语义改动**，可接受 |
| **B. 加站点级配置项** | `site/site.ts` 加 `HOT_LIMIT`；`hot.ts:190` 读它 | **0.2 人日** | 改1 行框架代码（把常量换成读配置），语义不变。**将来上游合并时这一行可能冲突**（但只是 1 行，冲突易解） |
| **C. 按板块配额** | `heatRows` 加 JOIN 取 category +定义 story 板块聚合规则 + `computeHotRanking` 改成分配额截断 + `HotEntry` 接口加字段 | **1.5-2 人日** | 高。改 3 处框架核心；JOIN 拖慢热点计算（当前已有 4 次查询/条）；`hot_rankings.entries` 的 JSON 形状变化要同步 `publication/hot.ts` |
| **D. 做成模块** | `modules/hot-by-sector/` 自己算 | **3+ 人日** | [NG] 最差。热点榜是引擎级功能，模块契约（`docs/architecture.md:64-74`）没有「接管既有榜单」的插口。**要新增引擎插口= 改框架，比 C 更重** |

### 15.4 我的建议（等 PM 确认板块需求后定）

**优先 A 或 B，不做 C。** 理由：

1. **A/B 的收益可能已经足够**。10 条不够分三个板块，但若改成 20 条，读者实际看到的「今天最热」仍然是最热的 20 件事——**热点榜的作用是让人知道「现在该看什么」，不是「每个板块都要有位置」**。真正需要按板块分栏的，是「贵金属频道页」这种**入口页**，而那是页面层的事（`site/pages/` 或模块），**不是热度算法的事**。

2. **C 的成本与收益不匹配**。2 人日换一个「三个板块各有 3 条」的数字，而代价是改3 处框架核心 + 拖慢计算 + 引入 story 板块聚合这个含糊概念。**等真的出现「某板块系统性被挤掉」的实证问题再上C。**

3. **D 明确拒绝**（模块契约不支持接管榜单，要新增插口等于改框架，比 C 更重且更不划算）。

**所以给 Spec 的写法**：先按 **B**（`site/site.ts` 加 `HOT_LIMIT`，默认 20）落地，**把 C 列为「有实证问题才做」的备选**，并在文档里写清C 的成本（1.5-2 人日）与触发条件（某板块连续一周在热点榜 0 席位）。

**需要 PM 提供的信息**（决定 A/B 的数值）：

- 三个板块的**预期热度分布**（贵金属/大宗/股债谁更新更频繁？若某板块信源极少，配额反而会让它长期空栏）
- 读者**是否会按板块筛选**（若会，板块页比板块配额更有用）

### 15.5 按板块取热点：**开箱不可用**（已实测推翻我自己的假设）

我原本推测「`PUBLIC_CATEGORIES` 可能让 `/api/v1/hot?category=贵金属` 开箱可用」。**实测结论：不行。**

`apps/api/src/routes/v1.ts:17-31` 的端点参数表是显式白名单：

```ts
const op = (queryKeys: readonly string[], cacheControl: string) => ({ queryKeys, cacheControl });
export const V1_OPERATIONS = {
  items:     op(["mode", "category", "window", "by", "q", "limit", "cursor"], ...),  // ← 有 category
  hotTopics: op([], ...),          // ← 空数组：不接受任何 query 参数
  storyByPublicId: op([], ...),
  ...
};
```

`apps/api/src/routes/v1.ts:105-109` 还会 `strictQuery(req, V1_OPERATIONS.hotTopics.queryKeys)`，**传任何未声明的 query 参数都会被拒**（`strictQuery` 的存在就是为了这个）。

**所以 `/api/v1/hot-topics` 无法按板块筛选。** 上面那个「开箱能力」判断是错的，此处更正。

**但板块入口仍然不需要 C 方案**——用另一个端点：

```bash
$ grep -n "category" apps/api/src/routes/v1.ts | grep -i "item"
  items: op(["mode", "category", "window", "by", "q", "limit", "cursor"], ...)
  const body = await v1Items({ mode, window, by, category, q: search, limit, cursor: q.cursor ?? null });
```

`/api/v1/items?category=<板块>` **支持按类别取**，底层是 `categoryCondition()`（`publication/items.ts:78`），且 `timeline.ts:27` / `pool.ts:139` / `groups.ts:27` 三处都复用它——**这是一个成体系的类别筛选能力，不是旁门左道**。

**结论（修正 V2 的方案建议）**：

| 读者需求 | 用什么 | 成本 |
|---|---|---|
| 全站「现在最热的 20 件事」 | `/api/v1/hot-topics` + 把 `hot.ts:190` 的 `10` 提到 20（方案 A/B） | 0.1-0.2 人日 |
| 「贵金属板块今天有什么」 | `/api/v1/items?category=贵金属`（**开箱可用**） | 0 |
| 「三个板块各 3 条混排的热点榜」 | 需要 C 方案 | 1.5-2 人日 |

**所以 C 方案（按板块配额）只在「必须在同一个热点榜里保证每板块都有席位」时才需要。** 而这个需求本身是产品决策，不是技术必然——**如果 PM 确认读者更可能「先进板块页再看」，那C 完全不必做，A/B + `items?category=` 就够了。**

**给 Spec 的写法建议**：把 C 写成「仅当 PM 要求板块配额时才做」，并附上本节的四行成本对照表，避免将来有人凭直觉去改 `hot.ts`。

---

## 16. 每日价格快照的时间戳副作用（designer 提出，2026-10-05 复核）

> 来源：设计师在补设计附录时发现「isolated 挡住一切」有例外。本节我逐条复核了代码，**结论部分成立、部分需修正**。
> **2026-10-05 三方（我 / designer / SPEC）复核后：机制成立，可见后果收敛为「sitemap `lastmod` 失真 + 相关事件次级排序」两处。我曾断言的「徽章失真」经查为误判，已在 §16.3 撤回。**

### 16.1 设计师的核心判断：[OK] 成立

**事实链（已逐行验证）**：

1. `events/group.ts:298`：`if (opts.signalOnly || a.participation_mode !== "editorial") return groupSignal(a, source, observedAt);` → **`isolated` 确实走 `groupSignal`**。
2. `group.ts:122-133` 的 `recordSignal` 第一句就是写时间戳，**没有 `participation_mode` 条件**：
   ```ts
   const updated = await db`UPDATE stories SET latest_at = GREATEST(coalesce(latest_at, ${observedAt}), ${observedAt}),
                   first_report_at = LEAST(coalesce(first_report_at, ${observedAt}), ${observedAt}), updated_at = now()
                 WHERE id = ${storyId} AND merged_into IS NULL`;
   ```
3. `hot.ts:125` 的 `currentSignals()` 读侧**有** `s.participation_mode <> 'isolated'` 过滤 → **热度与公开面看不到快照**。
4. **读过滤拦不住写**：`latest_at` 是在写入时更新的，`currentSignals()` 只影响读。

**所以「读侧干净、写侧污染」这个判断完全成立**，且两处 SQL 的条件不对称是事实。

### 16.2 但「旧事件在最新事件列表长期置顶」—— [!] 需修正

我追了 `latest_at` 的**全部**使用点（`grep -rn "latest_at" packages/backend/src/ apps/`），只有 3 处消费它：

| 消费点 | 是否受 isolated 污染 | 说明 |
|---|---|---|
| `publication/sitemap.ts:59-60` | **会** | `ORDER BY latest_at DESC` + `lastmod: s.latest_at` |
| `publication/stories.ts:133`（`relatedStories`） | **会** | `ORDER BY st.latest_at DESC LIMIT 8` |
| `publication/stories.ts:19-25`（`storyStatusFor`） | **[NG] 不会** | 入参**不是**表列，见 §16.3 的撤回记录 |
| `events/hot.ts:173` | **不参与排序** | `hot.ts:186` 的 `latest_at` 只是 `heat` 完全相等时的第二排序键；且双门槛挡掉纯快照信号 |

**关键修正：公开时间线（首页 / 全部动态 / 分类页）不按 `stories.latest_at` 排序。**
`publication/timeline.ts:63` 的锚点是 `min(p.sort_at)`，而 `sort_at` 来自 `article.timeline_at`（`publish.ts:308`、`:321`），**与 `stories.latest_at` 无关**。而快照的 `visibility` 被 `publish.ts:277`强制为 `"withdrawn"`，根本进不了 `selectedCondition`（`scope.ts:26-28` 要求 `visibility='public'`）。

**所以「读者在最新事件列表里看到被顶到今天的旧事件」这个后果不成立** —— 时间线不受影响。

### 16.3 真实后果（2026-10-05 三方复核后收敛）

> **本节我写错过一次，修正记录见下方「已撤回的结论」。**

**[!] 后果一：sitemap `lastmod` 失真（唯一的读者可见后果）**

`sitemap.ts:59-60` 是**唯一直接读 `stories.latest_at` 的公开出口**：
```sql
SELECT public_id::text, latest_at FROM stories WHERE merged_into IS NULL AND EXISTS (
  SELECT 1 FROM facts f JOIN fact_articles fa ... WHERE f.story_id = stories.id AND ${evidenceCondition()} AND ${listedCondition(at)})
ORDER BY latest_at DESC NULLS LAST, id DESC LIMIT 500
```

**失真机制（2026-10-05 补充，完整定论见 §17）**：快照只能挂到**已有 editorial 证据的 story** 上（`recallPool()` 只收已分析报道，`recall.ts:46-56`），这类 story 本身有真实 `latest_at`，**而快照每天把它推到今天 → `lastmod` 就写今天**。`docs/deploy.md:125` 记录了 sitemap 有 5 分钟重建期限，所以失真持续传导。

> 设计师曾主张「sitemap 不失真，因为 `evidenceCondition()` 含 `participation_mode`」。**该理由不成立**——`evidenceCondition()`（`scope.ts:55-58`）里没有 `participation_mode`，真正挡住 isolated 的是 `listedCondition()` 的两道门。详见 §17。

**[!] 后果二：`relatedStories` 次级排序（轻微）**

`stories.ts:133` 的 `ORDER BY st.latest_at DESC LIMIT 8` 直接用该列。影响面小（只是同事件的相关事件排序），但同样不准确。

**后果三：热点榜排序 ——[!] 不成立**

我曾写「热度平局时被快照影响」。**不成立**：`hot.ts:186` 是
```ts
rows.sort((a, b) => Number(b.heat) - Number(a.heat) || (b.latest_at?.getTime() ?? 0) - (a.latest_at?.getTime() ?? 0));
```
`latest_at` **只在 `heat` 完全相等时**才参与比较（第二排序键）。且 `hot.ts:185` 的 `MIN_PARTICIMANTS >= 2` 与 `editorial_participants >= 1` 双门槛，配合 `currentSignals()` 的 `participation_mode <> 'isolated'`，**纯快照信号进不了热度**。所以对热点榜**无影响**。

**总影响面**：sitemap `lastmod`（SEO 层）+ `relatedStories` 次级排序。**均无读者可见的内容失真** → 修复优先级 **P2**（理由与方案见 §17.3）。

#### 已撤回的结论（我写错了，设计师追对了）

**我曾断言「事件状态徽章永远停在『持续更新』」，这是错的。**

错因：我读 `stories.ts:19-25` 的 `storyStatusFor(latestAt, ...)` 时，**把入参 `latestAt` 当成了 `stories.latest_at` 那一列**。实测 `stories.ts:160-161`：

```ts
const latest = text.latest ?? latestReport;   // ← 不是 s.latest_at
const latestAt = latest.at;
status: storyStatusFor(latestAt, now.getTime()),
```

`latestAt` 来自 `storyTexts()`（`story-text.ts:33-39` 的 LATERAL）或 `latestReport`（`stories.ts:81`），**两者都基于 `listedCondition(now)`**。

**而 isolated 在 `listedCondition` 的两道条件上都不满足**：

| 条件 | isolated 的值 | 是否通过 |
|---|---|---|
| `p.visibility = 'public'`（`scope.ts:17`） | `'withdrawn'`（`publish.ts:277`） | [NG] |
| `p.eligible`（`scope.ts:17`） | `false`——`isPoolEligible` 要求 `participationMode === 'editorial'`（`rules.ts:25`） | [NG] |

**所以 `storyStatusFor` 拿到的 age 是干净的，`story.tsx:228` 的徽章不会失真。** 这正是「事件时间只读可见证据的时间」这条设计原则在框架里的实现。

> **教训**：读代码时不能只看函数名与参数名（`latestAt` 很容易被当成表列 `latest_at`），**必须追到数据的实际来源**。这是我这次的判断失误，感谢设计师纠正。

### 16.4 同意设计师的最小改动方案

在 `recordSignal`（`group.ts:122`）里对 `isolated` 源跳过 `UPDATE stories`、只保留 `INSERT story_signals`：

```ts
export async function recordSignal(db: Tx, storyId: number, articleId: string, source: { id: string; participation_mode?: string; signal_group_id: string | null }, kind, observedAt: Date) {
  // Isolated material (price snapshots) is evidence only: it must not refresh the story's
  // timestamps, or a settled event shows "持续更新" forever and its sitemap lastmod never ages.
  if (source.participation_mode !== "isolated") {
    const updated = await db`UPDATE stories SET latest_at = GREATEST(...), first_report_at = LEAST(...), updated_at = now()
      WHERE id = ${storyId} AND merged_into IS NULL`;
    if (!updated.count) throw new Error("Grouping target changed; retry against the current story");
  }
  await db`INSERT INTO story_signals (...) ON CONFLICT (story_id, article_id) DO NOTHING`;
}
```

**我同意的三点理由**（与设计师判断一致）：

1. **不动热度算法**：`SIGNAL_MIN_COSINE`（`group.ts:43` = 0.72）/ `SIGNAL_AUTO_COSINE`（`:44` = 0.92）全部不变。
2. **不改 schema、不加表**。
3. **比在 `groupSignal` 入口短路更精准**：短路会连带影响 `recordDecision`（`group.ts:137-140`）的 verdict 记录，而 `groupSignal` 末尾的 `write(null, "signal-unmatched", [])` 明确要区分「已判定为不相关」与「从未判定」。入口短路会把两者混同。

**[!] 但改动点比设计师建议的多两处（我要补充，实测得来）**：

`recordSignal` 的第三个参数 `source` 当前类型是 `{ id: string; signal_group_id: string | null }`（`group.ts:123`）——**没有 `participation_mode`**。而**准确统计调用点是 3 处，不是 1 处**：

```bash
$ grep -rn "recordSignal" packages/backend/src/ tests/ | grep -v "export async function recordSignal"
packages/backend/src/events/corrections.ts:70:  await recordSignal(tx, target.story_id, id, source!, "editorial", article.at);
packages/backend/src/events/group.ts:454:        await recordSignal(tx, story, articleId, source, "editorial", observedAt);
packages/backend/src/events/group.ts:563:        if (target) await recordSignal(tx, target.storyId, a.id, source, "signal", observedAt);
```

**两处需要注意**：

1. **`group.ts:454` 是 `editorial` 分支**，`group.ts:563` 才是 `signal` 分支（即 `groupSignal` 内部）。只有 563 这条路径会走isolated 源，但改参数时 454 也要跟着改（否则签名不一致）。
2. **`corrections.ts:70` 是设计师没提到的第三个调用点**（后台「把资料移到某事实下」的人工纠错）。它的问题更大：
   ```ts
   const [source] = await tx<{ id: string; signal_group_id: string | null }[]>`
     SELECT id, signal_group_id FROM sources WHERE id = ${article.source_id}`;
   await recordSignal(tx, target.story_id, id, source!, "editorial", article.at);
   ```
   **它的 `source` 是现查 SQL 且只 SELECT 两个字段**，不含 `participation_mode`。若采用「改签名传 `participation_mode`」的方案，**这条 SQL 也要加字段**（否则该字段为 `undefined`，`!== "isolated"` 成立 → 行为不变，**但这意味着人工纠错路径没被保护**）。

**所以实际改动量是「1 个 if + 3 处调用点 + 1 条 SELECT + 1 个类型定义」**，估**0.3 人日**（不是「一处 if」）。

**我建议的方案（比改 `source` 类型更省）**：既然 `isolated` 只可能走 `groupSignal`（`group.ts:298`），而 `groupSignal(a, source, observedAt)` 拿到的 `source` 是**完整 source 行**，那就在 `groupSignal` 内先算好布尔值，只给 `recordSignal` 加一个**可选末位参数**：

```ts
export async function recordSignal(db: Tx, storyId: number, articleId: string,
  source: { id: string; signal_group_id: string | null }, kind: "editorial" | "signal",
  observedAt: Date, touchStory = true)          // ← 新增，默认 true = 现有行为不变
```

- `group.ts:563` 传 `source.participation_mode !== "isolated"`
- `group.ts:454` 与 `corrections.ts:70` **不传**（走默认 `true`，行为完全不变，**零风险**）

**这样改动的净效果：1 个可选参数 + 1 处调用点传参 + 1 个 if。`corrections.ts` 完全不用碰**（人工纠错本来就该刷新时间戳）。**冲突面最小，且不改变任何现有调用的行为。**

**[!] 决策点（需要你拍板）**：这属于**改框架核心代码**（`packages/backend/src/events/group.ts`），与我此前 ADR-001/006 的「不改 `hot.ts`/不改归组语义」原则同类。**我倾向做**——因为它修的是「读者看到虚假活跃度」，在金融站的失信代价高于维护成本（只改 1 个if + 1 个参数，冲突面极小）。但**需要你明确批准这个例外**，并决定走「改签名」还是「加可选布尔参数」。

### 16.5 设计师提供的另外两条信息（我已核对，均成立）

**1. `title` 不能含价格——完全同意，且这是我自己 Spec 里的约束，落地时要守住**

`title` 参与 `contentHash`（`materials.ts:121-123`），价格每日变 → `content_hash` 变 → 走 `reviseMaterial()`（`materials.ts:247-256`）→ **整条分析管道重跑 + 归组作废**。所以：

- `title` 只含**品种 + 日期**（每日只变日期 → 仍会变，但**每天只一次**，可接受）
- 价格、涨跌幅、`updatedAt` **全部只进 `raw` JSONB**（`json-list.ts:194` 的 `raw` 字段不进 `contentHash`）

**注意一个残留成本**：即使 `title` 只有日期，`content_hash` 仍**每天变一次** → 每天仍会 `reviseMaterial` 一次 → 每天重跑一次管道。**4 个品种 × 每天 = 4 次/天 ≈ 0.07元/月**，可忽略。**但若快照是每品种一条、4 个品种各一条，那 4 条都会修订。** 若想更省，可让 `title` **完全不含日期**（如 `[XAU] 黄金价格快照`）——这样 `content_hash` 永不变，`article_revisions` 只有 1 行，**但 `articles.title` 会一直显示首次日期**。**取舍留给 PM/设计定。**

**2. `gold-api` 无涨跌幅字段——已核对，且单位提醒很重要**

设计师实测 `https://api.gold-api.com/price/XAU` 只返回 `price` / `updatedAt` / `currency` / `name` / `symbol`，**无 `previousClose` / `changePct` / `open` / `high` / `low`**。→ 涨跌幅须自算。

**关于「查 `articles` 表同 symbol 最近 2 条快照自算」**：**[OK] 可行，且零新增信源零新表**，但**前提是 `symbol` 能被查到**。而 `articles` 表**没有 `symbol` 列**（`0001_core.sql:60-88`）——它会落在 `raw` JSONB 里。→ **实施要点：查询必须写 `WHERE raw->>'symbol' = 'XAU'`，且要 `ORDER BY discovered_at DESC`；而 `raw` JSONB 无索引，数据量小时（快照 4 条/天 × 一年 ≈ 1460 行）全表扫可接受，不需要加 GIN 索引。**

**[!] 单位提醒（设计师提的这点很重要，我要强调它的技术落法）**：`HG`（铜）返回**美元/磅**，XAU/XAG/XPT/XPD 是**美元/盎司**。这不是显示问题，而是**数据模型问题**：

- 快照的 `raw` JSONB 里**必须存 `unit` 字段**（`"USD/oz"` / `"USD/lb"`），否则下游（行情带tile、摘要、`modules/quotes`）无从判断
- 建议 `raw` 结构：`{ symbol, name, price, unit, updatedAt, source: "gold-api" }`
- **摘要层必须带单位**（这与我在 §4.1 定的「数字三件套：数值+单位+基准」规则直接一致）——**单位缺失是金融内容最容易被系统化误读的地方**

---

## 17. sitemap 争议的最终定论（2026-10-05 四方复核）

设计师主张「sitemap `lastmod` 不会失真，因为 `evidenceCondition()` 含 `participation_mode = 'editorial'`」。**结论正确，但理由错误。** 我实测了 `evidenceCondition()` 的实现：

```ts
// publication/scope.ts:55-58 —— 实际实现
export function evidenceCondition() {
  return sql`fa.role <> 'mention' AND NOT ${compositeCondition()}`;
}
// compositeCondition()（:40-42）只是 analyses.output->>'scope' = 'composite'
```

**`evidenceCondition()` 里没有任何 `participation_mode` 条件。** 真正挡住 isolated 的是 `listedCondition()`（`:15-18`），而 sitemap 的 `EXISTS` 里**两个条件都有**：

```ts
// sitemap.ts:56-59
WHERE f.story_id = stories.id AND ${evidenceCondition()} AND ${listedCondition(at)}
```

| 条件 | isolated 的值 | 结果 |
|---|---|---|
| `evidenceCondition()` | 只查 role/composite，**无 participation_mode** | 放行 |
| `listedCondition()` 的 `p.visibility = 'public'` | `'withdrawn'`（`publish.ts:277`） | **[NG] 挡住** |
| `listedCondition()` 的 `p.eligible` | `false`（`isPoolEligible` 要求 `editorial`，`rules.ts:25`） | **[NG] 挡住** |

**所以 sitemap 确实不会失真，但机制是 `listedCondition` 的两道门，不是 `evidenceCondition`。** 记下来是因为「理由错误但结论正确」比「理由错误且结论错误」更容易被后来者误推。

### 17.1 但有一个前提必须说清，否则结论会被误用

**「sitemap 不失真」成立的前提是：快照所挂的那个 story 本身有 editorial 证据。**

这在本场景**恒成立**，我追了链路：`groupSignal` 只在 embedding 召回命中时才写 `story_signals`（`group.ts:543`），而召回池 `recallPool()`（`recall.ts:46-56`）只收 `fa.role IN ('primary','report')` 的**已分析报道**。**没有任何 editorial 事实的 story 无法被召回，快照也就挂不上去。**

**推论（重要）**：
- **只有 editorial 证据的 story** → 它有真实的 `latest_at`（来自真实报道），**污染幅度 = 快照把 `latest_at` 推到今天**，而 `lastmod` 就会写今天。**这确实是失真！**
- **isolated-only 的 story** → 根本不存在（挂不上去）

**所以我与设计师的分歧点其实是：他默认了「story 只有快照证据」，而实际是「story 有真实报道 + 被快照续命」。后者下 `lastmod` 依然会失真。**

**净结论修正**：sitemap 失真**成立**，但机制是「story 有真实 editorial 证据 + 快照改写 `latest_at`」，**不是**「story 只有快照证据」。我原来的表述「旧事件在 sitemap 里持续置顶」在这个前提下是对的。

### 17.2 三方同型误判的共同教训

这一轮里三个人各犯过一次**同型**误判：

| 人 | 误判 | 根因 |
|---|---|---|
| 设计师（原稿） | 「旧事件在最新事件列表置顶」 | 只看 `latest_at` 被读，没追排序键实际是 `sort_at` |
| 我 | 「徽章永远停在持续更新」 | 只看函数名/参数名 `latestAt`，没追它来自可见证据重算 |
| 设计师（复核） | 「sitemap不失真，因`evidenceCondition` 含 participation_mode」 | 只读 SQL 时看了 `ORDER BY`，没逐层读 `WHERE` 里的两个条件 |

**共同根因：读代码时只看了名字与局部，没有追到数据的实际来源与完整的过滤链。**

**这正是「规格即契约」里「存在性核验」的反面案例** —— 不是幻觉依赖，而是**「看到了就以为看全了」**。落到实践：**任何「某字段会被某出口消费」的判断，必须同时核对该出口的排序键、WHERE 条件、JOIN 来源三处**，缺一不可。

### 17.3 关于「是否仍值得修」——我采纳设计师的降级

设计师主张降为 P2，理由是「用一个假设性的未来需求去动并发保护路径，不成立」。**我同意**，并补充一条我自己的依据：

**`touchStory` 方案有 bug，设计师已撤回对它的背书 —— 这是对的。** 我上轮提`touchStory` 时虽已指出要保留 `throw`，但没有意识到**若实现时真的跳过了整个 UPDATE，锁就没了**。只有 `CASE WHEN` 写法（UPDATE 与 `throw` 一行不动）才安全。**成本从 0.2 修正回 0.3 人日。**

**采纳 P2 的理由**：
1. 唯一确定的后果是 sitemap `lastmod`（SEO 层，**无读者可见影响**）
2. `relatedStories` 次级排序（`stories.ts:133`）影响轻微
3. 修复要动**框架并发保护路径**，而收益是 SEO 层的 `lastmod` 准确性
4. **风险收益比不合适** → 降为 P2，与 SPEC §9.3 的降级一致

**但保留修复方案在文档里**（`CASE WHEN` 写法），若将来给快照加了任何可见出口，或sitemap 失真被 SEO 侧反馈为问题，再按方案执行。

---

## 18. 读侧改法优于写侧改法（2026-10-05 最终方案，替代 §16.4/§17.3）

设计师提出一个更省事的方案，我核实后**采纳**。§16.4 与 §17.3 的 `CASE WHEN` 写侧改法**降为备选**。

### 18.1 方案对比

| | 写侧改法（§16.4，`CASE WHEN`） | **读侧改法（设计师方案，采纳）** |
|---|---|---|
| 改哪里 | `events/group.ts:122-126` `recordSignal` | `publication/sitemap.ts:60` 的 `lastmod` 取值 |
| 动什么 | **所有信号共用的核心函数**（`groupSignal` 走它、`group` 走它、`corrections.ts` 走它） | 单个查询的取值表达式 |
| 并发风险 | 需保住 `AND merged_into IS NULL` + `throw`（改错即静默写废弃 story） | **零**（不碰写路径） |
| 成本 | 0.3 人日 | **0.1 人日** |
| 副作用面 | 改错会影响 editorial 归组与人工纠错 | 只影响 sitemap 的 `lastmod` |

**采纳理由**：`latest_at` 这个列的语义污染是「写侧问题」，但**唯一确定的可观察后果只在读侧**。在读侧修，等于用最小的改动消除唯一的可见后果，不碰风险最高的核心函数。**这符合「不过度设计」—— 不因为数据语义不纯粹就动并发保护路径。**

### 18.2 读侧改法有现成范式可抄（关键）

`publication/hot.ts:34-40` **已经在做一模一样的事**：

```ts
JOIN LATERAL (
  SELECT max(coalesce(p.published_at, p.discovered_at)) AS at
  FROM facts f JOIN fact_articles fa ON fa.fact_id = f.id JOIN publications p ON p.article_id = fa.article_id
  WHERE f.story_id = st.id AND ${evidenceCondition()} AND ${listedCondition(now)}
) latest ON true
```

**即「取可见证据的最大时间」，而不是读 `stories.latest_at` 列。** 所以这个改法不是新发明，是把 `hot.ts` 已有的正确做法搬到 `sitemap.ts` —— **一致性更好、评审成本更低**。

对应 `sitemap.ts:56-60` 的改法（**已按设计师意见修正 `ORDER BY` 写法**）：

```ts
// 现在
SELECT public_id::text, latest_at FROM stories WHERE merged_into IS NULL AND EXISTS (...)
ORDER BY latest_at DESC NULLS LAST, id DESC LIMIT 500

// 改为
SELECT st.public_id::text,
       coalesce(vis.latest_at, st.latest_at) AS latest_eff
FROM stories st
LEFT JOIN LATERAL (
  SELECT max(coalesce(p.published_at, p.discovered_at)) AS latest_at
  FROM facts f JOIN fact_articles fa ON fa.fact_id = f.id JOIN publications p ON p.article_id = fa.article_id
  WHERE f.story_id = st.id AND ${evidenceCondition()} AND ${listedCondition(at)}
) vis ON true
WHERE st.merged_into IS NULL AND EXISTS (...不变...)
ORDER BY latest_eff DESC NULLS LAST, st.id DESC LIMIT 500
```

**[!] `ORDER BY` 用别名而非位置序号（设计师纠正，我采纳）**：我原写法是 `ORDER BY 4 DESC`。**位置序号会因 select 列表变更而静默错位** —— 将来有人在前面插一列，`4` 就指向别的东西，**且不报错**。改用别名 `latest_eff` 后，编译器/评审都能看出意图。代价是 select 列表多一列别名，无实质成本。

#### [!] 兜底不是可选的谨慎，是必需的（框架注释自证）

我原本把 `coalesce` 兜底写成「唯一回归风险的防护」。设计师指出**框架自己在 `stories.ts:157` 就承认了这个场景**：

```ts
// Historical stories without listed evidence retain their latest readable report.
const latest = text.latest ?? latestReport;
```

**注释明确承认「存在没有 listed evidence 的历史 story」，并用 `?? latestReport` 兜底。** 所以 `LEFT JOIN LATERAL` 返回 NULL 是**框架预期内的情况**，不是理论风险。

两种写法的失败模式对比：

| 写法 | 最坏情况 |
|---|---|
| 裸写 `vis.latest_at` | **回归**：这类 story 从 sitemap 消失。**比 `lastmod` 失真严重得多** —— 失真只是数据不准，消失是页面进不了搜索引擎 |
| `coalesce(vis.latest_at, st.latest_at)` | 退回当前行为（失真），**不会比现在更差** |

**这个性质是它可以安全上线的关键：最坏情况退回到失真，不引入新的可见问题。**

#### [OK] `LEFT` + `coalesce` 有双重先例

我核对了框架全部 3 处 LATERAL：

| 位置 | join 类型 | 场景 | 兜底 |
|---|---|---|---|
| `publication/hot.ts:36` | `JOIN LATERAL`（INNER） | 外层已有 `evidenceCondition`+`listedCondition` 硬过滤，LATERAL 必然有行 | 不需要 |
| `publication/story-text.ts:33` | **`LEFT JOIN LATERAL`** | 历史 story 可能无 listed evidence | `?? latestReport`（TS） |
| **本方案（sitemap）** | **`LEFT JOIN LATERAL`** | 同上 | `coalesce(..., st.latest_at)`（SQL） |

**本方案 = `story-text.ts` 的模式，连兜底策略都等价**（一个 SQL `coalesce`、一个 TS `??`）。**范式现成 + join 类型有先例 + 兜底有先例。**

**注意 `relatedStories`（`stories.ts:133`）的次级排序不改**：它是同事件的相关事件排序，影响轻微，改它要动 `story_links` 查询、收益不抵成本。**留作已知瑕疵。**

### 18.3 核实：`latest_at` 的全部读点（写侧改法其实不必要）

我又全量查了一遍（`grep -rn "latest_at" packages/backend/src/`），**读侧只有两处需要修**：

| 读点 | 处理 |
|---|---|
| `sitemap.ts:60` | **本次修**（`lastmod`） |
| `stories.ts:133`（`relatedStories` 排序） | 不改（次级、影响轻微） |
| `hot.ts:186` | 不影响（仅 `heat` 相等时的第二键） |
| `hot.ts:245` | 写入 `HotEntry.latestAt` 快照值，但公开读层 `publication/hot.ts:49` **会用 LATERAL 重算覆盖**它（`:49` 的 `latestAt: report.latest_at`），**故公开面安全** |
| `publication/hot.ts:33` | 字段名叫 `latest_at`，但来自 LATERAL，**不是表列** |

**结论：`stories.latest_at` 这个被污染的列值，在公开面上只剩 sitemap 一处真影响。** 这进一步支持「只修读侧」。

### 18.4 最终 P2 理由（采纳设计师的两条，不依赖假设性未来需求）

1. **`lastmod` 是抓取优先级，不是排名因素**。sitemap 的 `lastmod` 影响搜索引擎的抓取频率，**不影响页面排名**（排名取决于内容质量与外链）。所以后果确实不严重。
2. **修它必须动所有信号共用的核心函数**（若走写侧）。`recordSignal` 被 `groupSignal`、editorial 归组、`corrections.ts:70` 三处共用，为一个 SEO 层的取值准确性去动它，风险收益比不合适。

**所以：P2，不阻塞 Phase 3。** 若将来 SEO 侧反馈 sitemap 抓取异常，或给快照加了任何可见出口，再按 §18.2 执行读侧改法（0.1 人日）。

### 18.5 两条判据（均来自本轮实测失误）

**判据一（关于「某条件能否挡住 X」）**（设计师提议，已采纳进 SPEC §9.3.1）：

> **验证「某条件能否挡住 X」时，必须先确认「存在满足全部其他条件的样本」。**

本项最隐蔽的误判就来自漏掉这步：假设了「只有 isolated 证据的 story」，而**这样的 story 压根不存在**（`recallPool()` 收不到，见 §17.1）。**如果没有那个不存在的样本，推理链看起来是自洽的。**

**判据二（关于「哪个方案更好」）**（我在追问设计师时逼出来的，它把主观判断变成了可验证依据）：

> **「框架里已经这么做了」永远比「我觉得这样更安全」有说服力。**

我给「读侧改法」的第一版理由是「并发风险更低」——**主观判断**。设计师追问后找到了 `publication/hot.ts:34-40` 已经在用同一个 LATERAL 模式，**理由升级为可验证的事实**。

**这条比判据一更通用**：它适用于所有技术选型与方案取舍——**先去找「框架里已有的正确做法」，找到它，方案就从「我觉得」变成「一致性」；找不到，再退回主观判断并明确标注这是判断。**
