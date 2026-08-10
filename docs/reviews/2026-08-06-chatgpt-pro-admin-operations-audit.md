# ChatGPT Pro：Five 后台运营重构首轮审计记录

> 日期：2026-08-06
>
> 对话：<https://chatgpt.com/c/6a73eff3-bf88-83ee-998f-d514a967f3e1>
>
> 性质：外部静态审计，不等于本地或生产验证

## 1. 提供的源码基线

- 分支：`main`
- commit：`31e482aa41d70265a6fd6c60c4fd11bf32ed274a`
- ZIP：`five-admin-rebuild-context-main-31e482a-20260806-v3.zip`
- 大小：`1,942,784 bytes`
- SHA-256：`fe72d229634617a6b2782ee6aad96760c19dbc1f71fe3d7201b1992b590e67c2`
- 快照包含任务开始时的未提交和未跟踪实现；不包含 `.git`、环境文件、数据库、私钥、Cookie、浏览器状态或其他凭据。

ChatGPT Pro 在回复中确认附件大小和 SHA-256 与任务说明一致。它明确声明没有启动 Five 服务、连接数据库、执行迁移或测试，也没有提交、推送或部署。

## 2. 外部审计确认的根因

### 2.1 图片槽位血缘丢失

图片生产任务已经持久化 `image_slot`，但自动候选上传后只在 `altText` 中留下槽位文字，`draft_image_candidates` 没有结构化槽位。冻结逻辑随后按候选数组位置猜测主图、备选图和可选图；由于任务领取顺序可能先处理 `optional`，任意两张候选又足以触发提交，因此可选图可能被错误冻结为必备图，第三个任务随后撞上不可变草稿。

### 2.2 正式自动内容仍依赖 demo 工厂

`DeterministicDraftGenerator` 仍调用 `createDemoDailyContent`。公开 `/today` 的读取链路虽然已经使用 PostgreSQL ActiveVersion，但自动写入数据库的公式 ID、搭配 ID 和部分模板仍来自 demo 工厂，不能宣称生产内容已经去除 demo。

### 2.3 普通订正没有高层闭环

当前普通编辑器仍可回传完整 `CalendarAlgorithmModule`，服务端没有形成算法字段硬只读边界。草稿页的提交动作也没有在同一次用户操作中完成“今天立即替换”或“未来按 23:00 排期”，页面承诺与服务端命令边界不一致。

## 3. 接受的外部建议

- 一级导航冻结为“今日 / 日历 / 异常”，低频和高风险能力进入“更多”。
- 18:00 只是明日内容准备 SLA；23:00 仍是唯一命理日切换和公开生效边界。
- P0 初始自动生产只创建两个必备图片任务；可选图默认为 `not_requested`，以后显式补充。
- 必备图片必须按具名槽位冻结，禁止按上传或完成顺序推断。
- 普通订正只接受语义白名单；颜色、五档顺序、日五行、日期和算法版本由服务端硬只读。
- 后台预览与公开页必须复用同一每日展示投影和组件组合。
- 普通维护者只触发高层 apply；React 不自行串联 submit、publish 和 schedule。
- P0 不扩建复杂 DAM，不重设计用户端，不在自动测试中调用付费生图。

## 4. Codex 要求修正的事项

1. 只从生产任务读取槽位不足以支持按预览位置手动上传、选择素材和重新生成。最终方案必须为草稿候选保留具名槽位关联；历史无法确定的关联保持 `null`，不得猜测。
2. 不全局删除旧 generic submit 的兼容语义。普通订正使用新的 publish-first 提交接缝，旧低层接口继续作为高级兼容能力。
3. 如果 submit 与 release 复用两个现有事务，不能声称整个 apply 是单一数据库事务。工作流用同一外部幂等键派生稳定子键；submit 成功而 release 暂时失败时保留安全 `approved` 版本，重试从同一 `contentVersion` 继续。
4. Admin Operations 接口统一使用 `overview / calendar / issues / days`，订正资源使用复数 `corrections`；保存模式由服务端根据同一次 `RequestContext` 决定，客户端不能传 `mode`。
5. 必备 `2/2` 按最终交付投影计算：必备槽位的 `deliveryStatus` 为 `active` 或 `fallback` 且 `servedCoverAssetId` 非空。生产任务完成总数不是 readiness。
6. 两张必备图互为 fallback 只能标为 P0 临时降级，并暴露可行动的重复图风险；不能虚假声称已经实现独立的安全配色卡片。
7. 不修改根 `AGENTS.md` 的稳定规则，除非存在单独说明且经过本地审查。

## 5. 下一轮外部交付要求

已要求 ChatGPT Pro 基于同一 ZIP 提供第一阶段可下载 unified patch，范围只包括：

- 设计/ADR/PRD/OpenAPI 冲突裁决；
- 默认两张必备图、具名槽位持久化和 required `2/2`；
- 正式结构化内容生成器与 demo reader 解耦；
- 迁移、契约、运行时验证和测试；
- 可在脏工作区安全检查生成契约的脚本。

Admin Operations 后端和 Web 页面留到后续补丁。收到外部补丁后必须在与 ZIP manifest 一致的隔离源码副本中验证，不能直接覆盖当前工作区。

## 6. 当前结论

首轮审计是有价值的静态建议，未被视为实现完成。最终方案以本仓库事实源、隔离测试和本地真实服务验收为准。该对话没有发生 commit、push、PR、数据库迁移或部署。

## 7. 第一阶段补丁独立验收

ChatGPT Pro 随后交付 `five-phase1-foundation.patch`：

- 大小：`1,789 bytes`；
- SHA-256：`9f8c8564536652ca9df47fe2a1a2e98d7bde09835960c69b5f75312518f26ec7`；
- 在与 ZIP manifest 一致的隔离源码根目录执行 `git apply --check`，原始结果为 `error: corrupt patch at line 18`，退出码 `128`。

附件存在裸 `@@` hunk、遗漏已声明的新文件，并原地修改了可能已经执行的 `000006` 历史迁移；同时缺少 Phase 1 明确要求的完整槽位写入与冻结链路、OpenAPI、运行时契约、就绪口径和测试。因此该补丁已拒绝，未应用到隔离源码或当前工作区。Codex 已把复现命令、错误、缺失文件和正确迁移约束反馈给 ChatGPT Pro，要求基于同一基线提供最小完整修正。

## 8. 修正循环与外部阻塞

ChatGPT Pro 的后续尝试先后把“安全 ZIP 不含 `.git`”和“它自己的旧临时目录留有半成品”误判为不可恢复阻塞。Codex 分别要求它使用两份全新 ZIP 解包目录通过 `diff -ruN` 生成补丁、用第三份干净解包目录执行 `patch --dry-run`，并明确不得复用污染的临时目录。Pro 随后确认全新基线正确，但当前 ChatGPT 回复环境丢失了文件执行与写入工具，无法继续修改文件、生成或验证 v2 补丁。

该外部工具上下文丢失属于 ChatGPT Pro 交付阻塞，不是 Five 本地源码阻塞。没有第二份外部补丁被应用，也没有把 Pro 未执行的命令描述为通过。本地实现继续在与同一 manifest 一致的隔离源码副本中按测试驱动方式推进；最终结论仍只依据 Codex 的源码审查、实际命令和本地服务验收。

## 9. 第二轮静态反驳与 Codex 裁决

ChatGPT Pro 在不访问新源码、不运行命令的前提下完成了第二轮静态反驳。该回复没有补丁或测试证据，其价值仅限于校验不变量。

接受并进入独立验收的建议：

- production 与 correction 的图片 generation 必须分别以自身 owner 为作用域维护 current job；correction 重生成不能改写 `daily_content_productions` 的 current 指针。
- freeze 只读取每个具名槽位的显式 selection。current job 只负责生成候选，不能成为与 selection 并列的第二事实源。
- 晚到的自动任务不能覆盖 `manual_upload` 或 `manual_selection`；任何改变 freeze 结果的选择都必须与 `draftRevision` 原子推进。
- required 采用有限重试并可进入稳定 `failed`；optional 默认 `not_requested`，缺失或失败不进入异常中心。
- 当前与未来的 `2/2` 必须分别从 Active/Scheduled Version 及其 `DailyImageSet` 交付投影计算，不能用 job completed 数量代替。
- 自动发布 Worker 只能枚举 `daily_content_productions` 明确拥有的草稿，普通 correction draft 永远不能被通用草稿扫描误发布。
- correction 重生成完成后只产生工作副本候选；必须显式选择并 apply，apply 前不得改变 `/today` 或未来排期投影。
- 发布后的缓存清理需要可重放、可去重的持久化副作用；仓库已有 durable purge intent，合并时应验证而不是再建第二套 outbox。

发现并接受的新协议问题：`DayCorrectionWorkingCopy` 同时包含 correction 状态和 draft 内容，若完整响应只使用 `"draft:N"`，apply 改变 correction 状态后表示已经变化但 ETag 可能不变。最终接口应使用服务端生成、客户端只作原样回传的强验证令牌；优先采用同时覆盖 `correctionRevision` 与 `draftRevision` 的单个 opaque composite ETag，并保证同一 apply 幂等键的网络重放先恢复既有结果，再做普通并发拒绝。客户端不得解析或自行构造 ETag。

未直接接受的建议：

- crash-window 的候选可能已经完成二进制与元数据持久化，但 Worker 尚未来得及把 job 标记为 completed。因此迁移证据不强制要求旧 job 已 completed；它必须能唯一证明同一 production draft、fortuneDate、slot 与 `production-job-<jobId>` 的归属，任何歧义继续保持 `null`。
- 不采用同时维护标准 Correction ETag、`Draft-ETag` 和 `If-Draft-Match` 三个头的复杂协议；单一 composite ETag 能覆盖当前 P0 并发域，接口更不容易被普通后台误用。
- 感知哈希只能识别视觉近重复，属于图片质量增强，不替代 P0 已冻结的 assetId 与 SHA-256 双重不同硬门槛。本轮记录为未实现风险，不为此引入新依赖或阻塞基础运营闭环。
- 两个必备位置最终指向同一 fallback 资产时不能显示健康 `2/2`。后台读模型应按唯一可交付资产计数并产生可行动的降级问题，直至具备互不相同的安全降级资产。

第二轮回复仍未验证本地、数据库、浏览器或生产行为；上述裁决只有在本地源码、迁移、测试与真实服务验收通过后才成立。
