# 生产批次安全导入

`production-batch:import` 只通过冻结的 Admin HTTP API 校验确定性算法并分槽上传两张必备模特图。它不连接 PostgreSQL、不修改数据库表、不调用生图接口，也不会调用普通草稿 `submit`。

## 安全边界

- 默认批次必须恰好覆盖连续 30 天，并且算法逐日与当前 `DeterministicDraftGenerator` 完全一致；
- `MANIFEST.sha256` 中的每个文件都会回算 SHA-256，算法、日期映射、搭配库、上传计划和 PNG 的日期、五行、槽位、尺寸与 SHA 必须互相一致；
- 图片只接受 `required_primary`、`required_alternative` 各一张，二者字节必须不同；任何已选择的 `optional` 候选都会阻止接管、阶段验收或 Worker 完成验收，版本视觉快照也必须恰好只有两个必备 look；
- 登录账号、密码只从进程环境读取，不进入参数、账本或日志；会话 Cookie 和 CSRF 只保存在内存中，结束时主动注销；
- 每次上传先读取强 ETag，携带 `If-Match`、CSRF 和计划中的唯一 `Idempotency-Key`，上传后必须重新读取最新 ETag；
- `ensureProduction` 是创建操作，当前 OpenAPI 没有 `If-Match` 参数，因此使用唯一幂等键，并在调用前后重新读取日级状态；
- 已有 ActiveVersion 或任意内容版本一律只读跳过并单独计数，不覆盖、不打开订正；
- 只允许接管严格可证明属于同日自动 production 的未提交草稿：production 状态必须为 `generating` 或 `awaiting_review`、`draftId` 必须是当日唯一可编辑草稿、预览来源必须为 `draft`、不得存在版本或 ActiveVersion，且算法和文案逐字段等于批次；账本永久记录 `adopted_existing_production`；
- production 状态异常、存在额外草稿/开放订正、算法不一致，或已选图片的 SHA / 上传 metadata 任一字段与批次不一致时，默认只读跳过并记录原因；即使 SHA 相同，也必须逐字段匹配 altText、生成来源、模型、提示词版本、生成时间、重现引用、来源/权利引用和 AI 标识状态；
- 只有这些明确的领域不变量冲突才会永久记为 `skipped_existing`；网络中断、Admin 5xx、响应解析失败等临时错误会直接失败并保留可重跑状态；错误消息中的 `draftId`、`contentVersion` 和图片资产 ID 会以路径模板替代；
- 账本与批次 MANIFEST 哈希绑定，每个远端写步骤前后原子落盘。相同账本可安全重跑；不同批次不能复用同一个账本。

## 为什么导入时必须停止 Worker

`POST /admin/api/v1/daily-content-productions` 会同时创建两个自动图片任务。为保证本批次只使用已准备的本地图片、不会调用付费生图，必须先停止 `backend-worker`，并在命令环境中显式设置 `FIVE_BATCH_IMPORT_WORKER_STOPPED=1`。这个变量只是操作员确认；脚本无法替你停止远端进程。

Admin 的普通 `POST /daily-content-drafts/{draftId}/submit` 只会创建 `in_review` 版本，而且不会物化自动视觉模块；导入器严禁调用它。导入器只把每一天推进到 `images_verified`。随后仍保持常驻 Worker 停止，并用“未配置图片 provider 的一次性 Worker”运行现有 `ContentAutoPublicationWorker`。该 Worker 通过 `submitAutomaticProductionDraft` 物化视觉模块、创建 `approved` 版本，再按既有规则排期或发布。

一次性 Worker 必须显式设置 `FIVE_IMAGE_OPENAI_API_KEY=''`。当前实现会让图片 Worker 在 claim 任务前返回 `not_configured`，因此不会领取队列任务或发起付费请求；自动发布 Worker 仍可运行。没有完成逐日回读前，不得启动常驻 Worker。

## 运行步骤

1. 备份 PostgreSQL、图片存储和部署配置。
2. 停止生产 `backend-worker`，确认容器或进程已经退出。
3. 保持 HTTP 服务在线；确认 Admin API 的代码版本与批次使用的 OpenAPI 一致。
4. 在本地终端设置环境变量。不要把密码写进命令历史：

   ```sh
   export FIVE_ADMIN_API_BASE_URL='https://你的正式域名'
   export FIVE_ADMIN_ORIGIN='https://你的正式域名'
   export FIVE_ADMIN_USERNAME='admin'
   read -s FIVE_ADMIN_PASSWORD
   export FIVE_ADMIN_PASSWORD
   export FIVE_BATCH_IMPORT_WORKER_STOPPED=1
   ```

5. 使用批次目录之外的绝对账本路径执行：

   ```sh
   pnpm production-batch:import -- \
     /absolute/path/to/production-batch \
     /absolute/path/to/import-ledgers/five-30-day-ledger.json
   ```

6. 第一阶段只接受 `failed: 0`，并核对 `imagesVerified`、`skippedExistingVersions` 和其他 `skippedExisting`。跳过不等于本批次覆盖成功；每个非版本类跳过都必须人工查明。
7. 当目标的新日期全部达到 `images_verified` 后，在服务器发布目录以一次性模式运行现有 Worker（实际命令按部署运行方式选择其一）：

   ```sh
   FIVE_IMAGE_OPENAI_API_KEY='' WORKER_ONCE=1 pnpm --filter @five/backend start:worker
   # 若服务器直接运行已构建产物：
   FIVE_IMAGE_OPENAI_API_KEY='' WORKER_ONCE=1 node apps/backend/dist/main-worker.js
   ```

8. 检查这次日志中 `contentImageProductionWorker` 必须为 `not_configured`，`contentAutoPublicationWorker` 必须完成目标日的 `submitted/scheduled/published` 处理，且不得出现图片供应商请求。任何任务失败都停止，不启动常驻 Worker。
9. 用完全相同的批次与账本再次运行 `production-batch:import`。它会把能唯一关联到原 production、日期、算法和图片 SHA 的版本记录为 `worker_finalized`；不会重新上传。只有 `failed: 0` 且预期新日期全部计入 `workerFinalized` 后才继续。
10. 后台逐日确认版本、必备图片 `2/2`、排期/发布时间，再启动常驻 Worker；随后验证 18:00 生效、`/today` 和图片 URL。
11. 清理当前终端中的敏感环境与停服确认标记：

   ```sh
   unset FIVE_ADMIN_PASSWORD FIVE_ADMIN_USERNAME FIVE_BATCH_IMPORT_WORKER_STOPPED
   ```

## 账本恢复

- `ensuring`：创建意图已落盘；重跑会复用上传计划中的相同幂等键，并核对返回的 `draftId`；
- `adopted_existing_production`：严格验证后的既有未提交自动 production；其来源也会持久保存在 `productionOwnership`；
- `production_owned`：只允许继续同一批次创建的同一个草稿；发现其他草稿或版本立即停止；
- `images_verified`：两张必备图已经按 SHA 和上传 metadata 全字段回读；此状态不会调用普通 submit。若一次性 Worker 尚未运行，重跑仅再次验证；
- `worker_finalized`：一次性 Worker 已创建唯一的 `approved`、`scheduled` 或 `published` 版本。重跑会继续核对日期、算法，以及两张图的 SHA 和上传 metadata；
- `skipped_existing`：永久保持只读跳过，避免后续重跑接管已有内容；`skipReason=existing_version` 会单独计入 `skippedExistingVersions`。

账本不包含密码、Cookie 或 CSRF，但包含内部草稿与内容版本 ID，应按运维记录保存，不对公网提供。
