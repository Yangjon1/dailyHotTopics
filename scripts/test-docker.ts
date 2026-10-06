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
import { execFileSync, spawnSync } from "node:child_process";
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

const args = [
  "run", "--rm", "--user", "root",
  "--network", resolvedNetwork,
  "-e", `DATABASE_URL=postgres://aihot:${password}@db:5432/aihot_test`,
  ...mount.split(" "), ...(mcpMount ? [mcpMount] : []),
  image,
  "sh", "-lc",
  `cd /app && { [ -d /tmp/mcp ] && ln -sfn /tmp/mcp node_modules/@modelcontextprotocol; true; } && node --test-global-setup=tests/databases.ts --import ./tests/databases.ts --test --test-concurrency=6 --test-timeout=120000 "${pattern}"`,
];

const result = spawnSync("docker", args, { stdio: "inherit", cwd: REPO });
process.exit(result.status ?? 1);
