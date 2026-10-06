// 一次性运维脚本：把卡在 processing_state='new' 且从未入队的文章重新送进分析队列。
//
// 背景（2026-10-05）：首次运行时 LLM_API_KEY 为空，采集成功的 64 篇文章在分析阶段
// 全部 401 失败，任务被队列消耗但文章状态未推进。ops.recover 只处理「回执结果不明」
// 的情况，不会重排这类失败，因此修好凭据后需要手动重入队一次。
//
// 幂等：只处理 processing_state='new' AND processing_queued_at IS NULL 的文章，
// 重复执行不会重复入队。

import { closeDb, sql } from "@aihot/backend/db";
import { queueProcessing } from "@aihot/backend/jobs/content";

const LIMIT = Number(process.argv[2] ?? 500);

const rows = await sql<{ id: string; source_id: string }[]>`
  SELECT a.id, a.source_id FROM articles a
  JOIN sources s ON s.id = a.source_id
  WHERE a.processing_state = 'new'
    AND a.processing_queued_at IS NULL
    AND s.participation_mode = 'editorial'
  ORDER BY a.discovered_at
  LIMIT ${LIMIT}`;

if (rows.length === 0) {
  console.log("没有待重入队的文章（processing_state=new 且 processing_queued_at 为空）");
  await closeDb();
  process.exit(0);
}

console.log(`待重入队 ${rows.length} 条`);
let queued = 0;
let skipped = 0;
for (const r of rows) {
  try {
    const jobId = await queueProcessing(r.id);
    if (jobId) {
      queued += 1;
      if (queued % 10 === 0) console.log(`  已入队 ${queued}/${rows.length}`);
    } else {
      skipped += 1;
    }
  } catch (e) {
    skipped += 1;
    console.error(`  ${r.id}（${r.source_id}）入队失败：${(e as Error).message}`);
  }
}
console.log(`完成：入队 ${queued} 条，跳过 ${skipped} 条`);
await closeDb();
