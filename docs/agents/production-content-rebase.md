# 旧自动生产草稿的受控重算

本文只适用于 `2026-08-11` 至 `2026-09-09` 的首月生产批次。它修复旧
`DeterministicDraftGenerator` 已创建、尚未提交且从未被图片 Worker 处理过的自动草稿。
普通后台、HTTP API、日常订正和数据库手工 SQL 都不能执行这项操作。

## 安全边界

- `inspect` 只读并取得共享 maintenance advisory lock；它不能证明 HTTP 或 Worker 已停止。
- `apply` 取得同一 maintenance advisory lock 的独占锁，但该锁也不能证明服务已停止。
- `apply` 前必须由独立操作步骤停止 HTTP 和 Worker，并生成不超过 15 分钟的停机证据。
- 完整 30 日必须先完成一次只读分类：`rebase`、唯一 active/published 的 `protected`，或相关状态完全为空的 `missing`。其他状态一律阻断且零写入。
- 所有 `rebase` 日在第一笔写入前再次完成全量 preflight；随后每日期在独立 PostgreSQL 事务中原子更新两个确定性模块并追加不可变事件。
- 事件与幂等请求冻结 `sourceCreatedAt`、完整前后模块、canonical hashes、来源 tree、计划、批次和操作者原因。
- CLI 不发布内容、不选择图片、不启动 Worker，也不调用付费生图。

## 冻结的 legacy 来源

仓库事实源为：

`apps/backend/testdata/content-production/legacy-source-2026-08-11-to-2026-09-09.json`

它由 dangling tree `fabc5018212d92b10449c669104c2d58682af91d` 的七个运行文件独立恢复，
并保存完整 30 日四模块 payload。当前 `canonical-json-v1` 使用 code-unit 键序；逐日
`fortuneDate -> full modules SHA-256` 对象的 manifest 为：

`55bd913ad559c96663980213b05a3bc6fb9f45948f114756e69d01741e57d77b`

七文件内容 SHA-256 manifest 的 canonical fingerprint 为：

`84a30ccbaecc43b4109d0ed07a1b8dc461a3f9a2f9dfbc1501331a7631b03e0e`

`3f639ec2f2b6b625f0be08c6b50a092b23cd10dbc2a9481da90c47819fee997b`
是旧考古过程使用 Git blob OID 和不同拼接规则得到的不兼容聚合，只用于 provenance，
不得作为本工具的来源门禁。

生成器会从 Git tree 重新读取并校验七个文件，然后拒绝覆盖已有证据：

```bash
pnpm --filter @five/backend exec node -r ts-node/register/transpile-only \
  scripts/generate-legacy-production-source-allowlist.ts \
  --output /absolute/new-legacy-source.json
```

生成器保证解析后的 30 日 payload、逐日 canonical hash 和 manifest 可复现；JSON 排版可能因
仓库 Prettier 规范而改变原始字节。`apply` 批准的 allowlist SHA-256 必须始终针对实际传入的
那一个文件重新计算，不能沿用另一份语义相同文件的 raw SHA。

## 两阶段命令

先在具有生产数据库只读访问的受控环境生成新计划。输出文件必须不存在，CLI 以 `0600`
创建它：

```bash
pnpm production-batch:rebase -- inspect \
  --batch-root /absolute/corrected-30-day-batch \
  --legacy-allowlist /absolute/legacy-source.json \
  --plan-id five-production-rebase-2026-08-v1 \
  --plan-output /absolute/rebase-plan.json \
  --target-build-id TARGET_GIT_COMMIT
```

把 stdout 中的 `actionCounts`、30 日范围、计划 SHA-256、批次 SHA-256、来源 SHA-256
和 target build 另行核对。计划不得由同一进程自动批准。

停掉 HTTP 与 Worker 后，通过 `docker compose ps` 独立确认两个服务均未运行，再创建
`0600` 停机证据。文件只允许以下精确结构；`observedAt` 使用实际 UTC 时间：

```json
{
  "observedAt": "2026-08-11T10:00:00.000Z",
  "schemaVersion": "five-content-rebase-stop-evidence-v1",
  "services": { "http": "stopped", "worker": "stopped" },
  "source": "docker-compose-ps"
}
```

批准值必须针对三个原始文件字节分别计算，不能对解析后的 JSON 自算自批：

```bash
export FIVE_CONTENT_REBASE_ENABLED=1
export FIVE_CONTENT_REBASE_HTTP_STOPPED=1
export FIVE_CONTENT_REBASE_WORKER_STOPPED=1
export FIVE_CONTENT_REBASE_APPROVED_PLAN_SHA256=...
export FIVE_CONTENT_REBASE_APPROVED_LEGACY_ALLOWLIST_SHA256=...
export FIVE_CONTENT_REBASE_STOP_EVIDENCE_SHA256=...
export FIVE_CONTENT_REBASE_TARGET_BUILD_ID=...
export FIVE_CONTENT_REBASE_EXPECTED_REBASE_COUNT=...
export FIVE_CONTENT_REBASE_EXPECTED_PROTECTED_COUNT=...
export FIVE_CONTENT_REBASE_EXPECTED_MISSING_COUNT=...
export FIVE_CONTENT_REBASE_OPERATOR_ID=...
export FIVE_CONTENT_REBASE_REASON='受控修复旧自动生产草稿的确定性模块。'
export FIVE_CONTENT_REBASE_CONFIRMATION='REBASE five-production-rebase-2026-08-v1 2026-08-11..2026-09-09 rebase=N protected=N missing=N'

pnpm production-batch:rebase -- apply \
  --batch-root /absolute/corrected-30-day-batch \
  --legacy-allowlist /absolute/legacy-source.json \
  --plan /absolute/rebase-plan.json \
  --stop-evidence /absolute/stopped-services.json \
  --ledger /absolute/new-rebase-ledger.json
```

首次 ledger 必须使用与旧 Admin importer ledger 不同的新路径。崩溃后用相同计划、相同
幂等键和同一 ledger 路径重跑；数据库 append-only event 是最终恢复事实源。

命令结束后立即清除一次性确认，避免 shell 中的陈旧值被后续误用：

```bash
unset FIVE_CONTENT_REBASE_ENABLED FIVE_CONTENT_REBASE_HTTP_STOPPED
unset FIVE_CONTENT_REBASE_WORKER_STOPPED FIVE_CONTENT_REBASE_APPROVED_PLAN_SHA256
unset FIVE_CONTENT_REBASE_APPROVED_LEGACY_ALLOWLIST_SHA256
unset FIVE_CONTENT_REBASE_STOP_EVIDENCE_SHA256 FIVE_CONTENT_REBASE_TARGET_BUILD_ID
unset FIVE_CONTENT_REBASE_EXPECTED_REBASE_COUNT
unset FIVE_CONTENT_REBASE_EXPECTED_PROTECTED_COUNT
unset FIVE_CONTENT_REBASE_EXPECTED_MISSING_COUNT
unset FIVE_CONTENT_REBASE_OPERATOR_ID FIVE_CONTENT_REBASE_REASON
unset FIVE_CONTENT_REBASE_CONFIRMATION
```

## 后续批次导入与 Worker

重算完成后只启动 HTTP，Worker 继续保持停止。用新的 Admin importer ledger 执行
`production-batch:import`；它只会采用算法完全一致的 production、上传两张必备图并停在
`images_verified`。之后逐日回读确认 `2/2`。

运行一次自动提交前，再次确认图片生成 provider 未配置。`FIVE_IMAGE_OPENAI_API_KEY` 必须
为空，使图片 Worker 在 claim 前返回 `not_configured`；同一轮
`ContentAutoPublicationWorker` 才能走官方 automatic-production lifecycle。常驻 Worker 只在
所有版本、排期、公开读取和缓存失效回读完成后恢复。

本地测试通过不等于生产、微信或中国大陆网络验证通过。
