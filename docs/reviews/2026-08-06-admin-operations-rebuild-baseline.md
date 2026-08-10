# Five 后台运营化重构基线记录

日期：2026-08-06
状态：实现前基线，尚未提交、推送或部署

## 1. 源码基线

- 分支：`main`
- HEAD：`31e482aa41d70265a6fd6c60c4fd11bf32ed274a`
- 与 `origin/main`：无提交差异
- 工作区：包含重要的未提交实现，不是干净 HEAD
- 初始状态摘要：72 个已跟踪修改、4 个已跟踪删除、44 个未跟踪文件；无暂存文件
- 保护规则：本任务不得 reset、checkout、stash、clean 或覆盖这些改动

当前事实源存在需要在设计冻结时一并处理的版本漂移：

- `docs/product/prd.md` 自述为 V2.4，但 `AGENTS.md`、`README.md` 和部分旧设计文档仍写 V2.3；
- 最新发布优先决定允许先发布后检查，但 OpenAPI 的部分说明、示例和旧评审仍保留 `in_review` 或图片人工检查硬门槛；
- 北京时间 18:00 的“明日内容准备完成”目标尚未进入稳定文档与服务端读模型；
- 现有后台缺少统一的“今日 / 明日 / 月历 / 异常”运营读模型。

## 2. 提供给 ChatGPT Pro 的脱敏快照

- 文件：`five-admin-rebuild-context-main-31e482a-20260806-v3.zip`
- 大小：1,942,784 bytes
- SHA-256：`fe72d229634617a6b2782ee6aad96760c19dbc1f71fe3d7201b1992b590e67c2`
- 文件清单：378 项
- 逐文件 manifest：378 项
- ZIP 完整性：`unzip -tq` 通过
- 快照比对：任务源码与打包时当前工作区逐文件一致

白名单内容包括：任务相关源码、测试、迁移、PRD、OpenAPI、Accepted ADR、领域词汇表、设计约束、三张脱敏后的真实页面截图、基线说明、冲突清单和代码审计提示。

明确排除：`.git`、`node_modules`、构建产物、缓存、数据库、备份、`.env*`、密钥、Token、Cookie、浏览器配置、PEM/SSH 材料、日志、运行状态和无关大型附件。

已执行防误传扫描：未发现私钥、API Token 或真实凭据；命中内容仅为测试密码 fixture、localhost 测试数据库地址、保留地址和 `user@example.com`。扫描只能降低误传风险，不构成“绝对不存在秘密”的保证。

## 3. 真实页面与数据链路证据

- 公开 `/` 从 PostgreSQL 的当前活跃已发布版本读取，不是前端硬编码 JSON；
- 当前公开页可见完整五档和真实本地模特图；
- 自动生产上游仍调用 `createDemoDailyContent`，导致公式、look 和模板版本保留 `demo-*` 标识；
- 当前后台把生产任务、草稿、版本和图片通过前端多次请求拼接，并显示 `/3`，不能表达必备 `2/2` 与可选图非阻塞语义；
- `draft_image_candidates` 未保存 `image_slot`，自动冻结按候选上传顺序猜测槽位，存在 optional/required 错配；
- 当前可视化订正仍提交完整模块，且人工订正只冻结版本，未形成“今天立即替换 / 未来 23:00 生效”的单一闭环。

真实截图文件名：

- `five-public-current-375.jpg`
- `five-admin-current-calendar.jpg`
- `five-admin-current-version-detail.jpg`

截图不包含密码、Token、Cookie 或个人联系方式。内部内容标识只用于当前源码基线核对。

## 4. 重构前自动测试基线

首次执行 `pnpm check` 在 `contract:check` 停止。OpenAPI 校验和类型生成成功；失败原因是脚本使用：

```text
git diff --exit-code -- packages/api-contract/src/generated.ts
```

该命令会把任务本来就存在的、与 OpenAPI 一致的未提交生成类型误判为“生成不同步”。打包前后的 `generated.ts` SHA-256 相同，证明这不是本次检查新产生的变化。后续需要把检查改为“生成到临时文件再比较内容”，才能在受保护的 dirty worktree 中真实执行统一门禁。

其余门禁已单独执行：

- `pnpm calendar:golden:check`：通过；366 个日期、10 个边界、3 个引用、366 个独立检查；
- `pnpm format:check`：通过；
- `pnpm lint`：通过；
- `pnpm typecheck`：通过；
- `pnpm test`：通过；API contract 27、backend 430、web 485，共 942 个测试通过；backend 另有 18 个 PostgreSQL 相关测试因未提供一次性测试库而跳过。

尚未执行：`pnpm smoke`、一次性空 PostgreSQL 的迁移与集成测试、后台关键路径 E2E、375px 视觉回归、真实生产/微信/中国大陆网络验证。`pnpm smoke` 不得直接使用现有 `.env` 业务数据库，必须在隔离源码副本和一次性空数据库中执行。

## 5. 权限与当前状态

- 未创建或修改远程 GitHub Issue；
- 未创建 commit；
- 未 push；
- 未创建 PR；
- 未迁移现有本地或生产数据库；
- 未部署或修改服务器；
- 未调用付费生图接口进行测试。

后续编码前必须先冻结后台交互规格、OpenAPI 变更和图片槽位策略；外部补丁只能先在与本快照一致的隔离副本中验收。
