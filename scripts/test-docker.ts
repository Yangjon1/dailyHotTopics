// 在 Docker 里跑后端测试，且跑的是【工作区的代码】。
//
// 为什么需要这个脚本（2026-10-06）：
// 1. `docker compose exec` 跑的是**镜像内的代码**，不是工作区的。改完文件不重建就测，测的是旧代码。
// 2. 容器的 `env_file: .env` 会注入真实密钥。`tests/setup.ts` 的 `embeddingsStub()` 现在同时桩
//    DASHSCOPE_* 与 EMBEDDING_*，所以这一条已经防住；但若新增供应商配置项，要记得一起桩掉。
//
// 用法：
//   node --env-file=.env scripts/test-docker.ts            # 跑全部
//   node --env-file=.env scripts/test-docker.ts analyze     # 只跑名字含 analyze 的
//
// 前提：`docker compose ps` 里 db 在跑（脚本自己会检查）。

import { existsSync, readFileSync } from "node:fs";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");

function envValue(key: string): string {
  const file = path.join(REPO, ".env");
  if (!existsSync(file)) {
    console.error("找不到 .env，无法读取 POSTGRES_PASSWORD");
    process.exit(1);
  }
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z_]+)\s*=\s*(.*)$/.exec(line.trim());
    if (m && m[1] === key) return m[2]!.trim();
  }
  console.error(`.env 里没有 ${key}`);
  process.exit(1);
}

const password = envValue("POSTGRES_PASSWORD");
const network = "aihot_default";
const image = "aihot-app";

// 网络名可能随项目目录名变，从 compose 里问出来
let resolvedNetwork = network;
try {
  const out = execFileSync("docker", ["compose", "config", "--format", "json"], { cwd: REPO, encoding: "utf8" });
  const parsed = JSON.parse(out) as { name?: string };
  if (parsed.name) resolvedNetwork = `${parsed.name}_default`;
} catch {
  // compose 不可用时退回默认名
}

const filter = process.argv[2];
const pattern = filter ? `tests/*${filter}*.test.ts` : "tests/*.test.ts";

console.log(`网络 ${resolvedNetwork}｜镜像 ${image}｜匹配 ${pattern}`);
if (filter) console.log(`（已按「${filter}」过滤。要跑全部请去掉参数。）`);

// 源码目录挂载：镜像里的代码是 build 时的快照，不挂载测的就不是工作区。
const mount = ["tests", "industry", "site", "packages", "apps", "scripts", "database"]
  .map((dir) => `-v ${path.win32.resolve(REPO, dir)}:/app/${dir}`)
  .join(" ");

// ⚠️ 已知缺口：Dockerfile:24 的 `npm prune --omit=dev` 会把只在测试里用到的 devDependency
// 从镜像里剪掉（实测是 @modelcontextprotocol/client，被 tests/mcp.test.ts 与
// tests/outlet-invariants.test.ts 引用）。那两个文件在镜像内**零失败通过**——文件级崩溃不计入
// fail 统计，所以数字看起来比实际干净。
//
// 试过挂载补齐，两种方式都不通：整份 node_modules 会覆盖镜像里 @aihot/* 的 workspace 符号链接
// （相对路径，指向 Windows 盘），导致 @aihot/contracts 解析失败；只挂该包则报 invalid mode。
// 需要 `npm i -D` 装进镜像，或在有 git 与完整依赖的环境里跑这两个文件。

// 跑之前清掉上一次残留的 per-file 测试库。
//
// 为什么必须清：`tests/databases.ts:64` 的库名是 `${name}_f${process.pid}_${suffix}`，**含 pid**，
// 所以同一个文件重跑会得到不同库名，而 `globalSetup` 的 `dropCopies` 按固定模式匹配**清不掉它们**。
// 残留累积到 `CREATE DATABASE` 撞名（42P04），文件级崩溃又不计入 fail —— 于是数字会飘。
//
// 实测代价（2026-10-06）：不清库时 `tests/publication.test.ts` 59 个用例里红 19 个；清库后 59/59 全绿。
// 这类失败看起来像「契约变更引起的」，会让人去改本来正确的测试。**任何 fail 数在清库后才可信。**
// 逐个 DROP 不用 DO/$$ —— 那样需要 shell 转义，经 spawnSync 传参会丢。
// 先查库名再删，与 `docker compose exec db psql -Atc "select ..."` 的输出对齐。
function runDocker(args: string[]): Promise<{ code: number; out: string }> {
  // 不用 spawnSync：Windows 上它对 docker 常返回 EBUSY（忙），会静默失败。异步 spawn 没有这问题。
  return new Promise((resolve) => {
    const child = spawn("docker", args, { cwd: REPO });
    let out = "";
    child.stdout?.on("data", (d) => (out += String(d)));
    child.stderr?.on("data", (d) => (out += String(d)));
    child.on("error", () => resolve({ code: -1, out: "spawn failed" }));
    child.on("close", (code) => resolve({ code: code ?? -1, out }));
  });
}

async function dropLeftovers(): Promise<void> {
  const listed = await runDocker([
    "compose", "exec", "-T", "db", "psql", "-U", "aihot", "-d", "postgres", "-Atc",
    "SELECT datname FROM pg_database WHERE datname LIKE 'aihot%' AND datname <> 'aihot' AND datname <> 'aihot_test'",
  ]);
  if (listed.code !== 0) {
    console.warn("⚠️ 查残留库失败，仍继续跑 —— 但 fail 数可能不可信（残留库会造成假失败）");
    console.warn(listed.out.trim());
    return;
  }
  const names = listed.out.split(/\r?\n/).map((x) => x.trim()).filter((x) => x && !x.startsWith("postgres"));
  if (names.length === 0) {
    console.log("无残留测试库");
    return;
  }
  for (const name of names) {
    const dropped = await runDocker([
      "compose", "exec", "-T", "db", "psql", "-U", "aihot", "-d", "postgres", "-c",
      `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`,
    ]);
    if (dropped.code !== 0) console.warn(`  清理 ${name} 失败：${dropped.out.trim()}`);
  }
  console.log(`已清理 ${names.length} 个残留测试库`);
}

await dropLeftovers();

const args = [
  "run", "--rm", "--user", "root",
  "--network", resolvedNetwork,
  "-e", `DATABASE_URL=postgres://aihot:${password}@db:5432/aihot_test`,
  ...mount.split(" "),
  image,
  "sh", "-lc",
  `cd /app && { [ -d /tmp/mcp ] && ln -sfn /tmp/mcp node_modules/@modelcontextprotocol; true; } && node --test-global-setup=tests/databases.ts --import ./tests/databases.ts --test --test-concurrency=6 --test-timeout=120000 "${pattern}"`,
];

const result = spawnSync("docker", args, { stdio: "inherit", cwd: REPO });
process.exit(result.status ?? 1);
