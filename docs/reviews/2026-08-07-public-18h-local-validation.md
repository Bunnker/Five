# Five 北京时间 18:00 公开内容切换本地验收记录

日期：2026-08-07
状态：隔离副本与当前真实工作区本地验收通过；不是生产、微信或中国大陆网络上线验收
源码基线：`main` / `31e482aa41d70265a6fd6c60c4fd11bf32ed274a`

## 1. 验收对象与边界

本轮在隔离副本 `/private/tmp/five-final-integration.BWYDfu` 验收 ADR-0028
冻结的两条独立时间轴：

- 北京时间 18:00 推进公开交付日期 `servedFortuneDate`，用户端从该时刻开始读取下一公开内容日；
- 北京时间 23:00 只推进命理 `fortuneDate` 和时辰，保留既有 366 日历黄金答案，不触发第二次公开内容切换；
- 18:00 至 22:59，`servedFortuneDate` 比 `requestContext.fortuneDate` 领先一天是预期状态；
- 命理日 `D` 的公开窗口为 `[D - 1 日 18:00, D 日 18:00)`。缺少新日安全内容时必须 fail closed，不能继续交付越过 `effectiveTo` 的旧内容。

本报告先记录基于上述源码基线和隔离环境未提交实现的本地结果。验收完成后，任务相关最小改动
已经通过逐文件上下文补丁移入当前 `main` 工作区，但仍未提交、推送或进入任何部署环境。

## 2. 实现范围

本地验收覆盖以下一致性链路：

1. 服务端在同一请求时刻生成 `requestContext` 与 `publicContentContext`，公开读取使用
   `servedFortuneDate`，命理计算继续使用 23:00 `fortuneDate`。
2. 内容窗口、排期、自动发布、缓存 TTL 与主动清理采用 18:00 边界；Worker 在精确边界排空同批到期任务，并通过独立的 30 秒唤醒保证重试不被共享周期阻塞。
3. 公开首页和 colors、basis、outfits、share、poster、help 次级页不依赖设备墙钟推进日期；已经打开的次级页到达服务端给出的 `effectiveTo` 后先隐藏旧内容，再刷新。
4. Help 反馈绑定实际交付的 `servedFortuneDate`，因此 18:00 至 23:00 不会因命理日期尚未推进而错误禁用。
5. 后台 Today、Calendar、Issues 与日期详情使用服务端公开上下文，并用
   `nextOperationalBoundaryAt - responseGeneratedAt` 的相对间隔刷新，不依赖维护者设备墙钟。
6. 既有 23:00 不可变版本通过迁移 `000016_clone_legacy_public_windows_to_18h`
   克隆到新草稿和新版本；原快照和历史记录不被原地改写。

本轮没有扩大到小程序、App、多人后台、实时生图、商品或其他非 P0 范围。

## 3. 自动化门禁

### 3.1 统一检查

最终执行 `pnpm check` 通过：

- OpenAPI lint 通过，生成的 TypeScript 契约与 `docs/api/openapi.yaml` 一致；
- 日历黄金答案通过：366 个日期、10 个边界、3 个引用和 366 个独立检查；
- Prettier、ESLint 和 API contract、backend、web 严格类型检查通过；
- API contract：29 个测试通过；
- backend：601 个测试通过，37 个需要外部 PostgreSQL 条件的测试按既有条件跳过；
- web：540 个测试通过。

这里的 PostgreSQL 跳过项由下一节的一次性数据库门禁另行覆盖，不能把普通
`pnpm check` 单独描述为数据库集成验证。

### 3.2 一次性 PostgreSQL 集成检查

最终执行 `pnpm postgres:integration:check` 通过。命令创建隔离的一次性数据库，从
`000001` 顺序迁移到 `000016`，随后完成 poster、feedback、admin security、content
lifecycle、daily image 和 content release PostgreSQL 集成检查。

`000016` 的迁移集成测试 4/4 通过，覆盖：

- 活跃和未来排期的旧 23:00 不可变版本被克隆，图片候选、具名槽位选择、图片集、大师凭证、生产所有权和生命周期指针随新身份迁移；
- 迁移等待正在提交的发布事务完成，再取得所有权快照，避免从事务中间态克隆错误版本；
- 日订正使用相同的按日期 advisory lock。迁移提交新 ActiveVersion 前，订正 baseline
  读取会等待，不会取得旧指针与新 revision 的混合状态；
- 旧排期的新 18:00 窗口已经开始时，迁移事务内立即发布克隆版本；尚未到期时创建新的
  18:00 排期任务。

为修复并发窗口，迁移先按日期排序取得与日订正一致的 advisory transaction lock，再锁定
`content_lifecycle_days` 取得原子所有权快照；候选日期在等待锁期间变化时以
`40001` fail closed，而不是迁移未加日期锁的数据。

迁移事件链也纳入验证：旧任务终止事件、新任务创建事件、发布或排期
`content_release_events`、版本状态转换、前后 ActiveVersion、排期 revision、生命周期审计以及
缓存清理 intent 均在事务内写入。已开始窗口的旧排期记录为
`scheduled_publish`，未来排期记录为 `schedule`，不会用缺少状态转换或 task 关联的伪事件代替真实迁移结果。

### 3.3 最终干净 smoke

修复外部静态审查发现的 demo 边界后，最终再次从空 PostgreSQL 卷执行
`pnpm smoke` 通过：

- 依次执行 `000001` 至 `000016`；
- `000016` PostgreSQL 迁移测试 4/4 通过；
- Next.js production build 成功；
- Web、HTTP、Worker 与 PostgreSQL 联合启动和真实请求检查通过。

最终输出原文为：

```text
Smoke check passed: web, HTTP, Worker and PostgreSQL are ready.
```

“干净”只表示该次 smoke 从空的一次性数据库卷和隔离运行状态开始，不表示真实仓库已经
清理、提交或部署。

### 3.4 真实工作区回填验证

最终把 215 个任务目标文件以逐文件上下文补丁移入真实工作区，其中 130 个原有文件在回填前
另行备份并记录 SHA-256，85 个为新文件。回填后 215/215 与隔离验收源码逐字一致，且没有删除
真实工作区中不属于任务补丁的文件。

真实工作区最终执行：

- `pnpm check` 通过，计数与隔离副本一致；
- `pnpm build` 通过，API contract、backend 和 Next.js production build 均成功；
- `git diff --check` 通过。

首次真实工作区格式检查只被未跟踪的 `.playwright-mcp` 浏览器快照阻止。该目录属于本地 QA
运行状态，已加入 `.prettierignore` 和 `.gitignore`；没有删除或改写这些快照。

没有在真实工作区运行 `pnpm smoke`，因为该命令会迁移现有本地数据库。完整 smoke 仅在前述
一次性空数据库中执行。

## 4. 一次性数据库浏览器 QA

浏览器 QA 使用 disposable PostgreSQL 数据库和测试管理员完成，未连接现有业务数据库。
实际执行并观察到：

- 测试管理员可以登录后台；
- 上传两张稳定 fixture 图片后，可保存并立即替换当前公开内容；
- 真实 `GET /api/v1/today` 返回 200，并返回：
  - `effectiveFrom = 2026-08-06T10:00:00Z`，即北京时间 2026-08-06 18:00；
  - `effectiveTo = 2026-08-07T10:00:00Z`，即北京时间 2026-08-07 18:00；
  - `servedFortuneDate = 2026-08-07`；
  - `switchBoundary = 18:00`。
- 公开首页显示完整“大吉、次吉、平、较差、不利”五档，两张图片均加载；375px
  视口没有横向滚动，主要交互控件不小于 44px；
- 图片端点返回 200 和 PNG 内容；
- colors 与 share 页面可正常进入，多行分享文案完整可见；
- 后台 Today 明确区分当前和明日，current 为 2/2，next 为 0/2，且准备截止前不会误报异常；
- Calendar 展示数据库真实状态，可选第三图缺失不产生异常；
- 日期详情复用真实用户预览；算法字段位于只读抽屉，文案订正与图片订正只显示各自对应控件。

两张图片仅为稳定测试 fixture。上述结果证明上传、选择、发布、公开交付和浏览器渲染链路可用，
不证明图片具备生产内容语义、审美质量、权利材料或正确的 AI 标识。

## 5. 生图与外部环境限制

本地环境没有配置或调用外部付费生图通道。自动测试和浏览器 QA 均未验证：

- 外部模型或中转供应商的认证、配额、超时、费用上限和故障切换；
- 真实提示词生成出的服装结构、颜色语义、品牌与肖像风险；
- 生产图片存储、CDN、权利材料和 AI 标识工作流。

因此不能把 fixture 图片链路通过表述为“外部生图已通过”或“首月生产图片已准备完成”。

本轮也没有执行：

- 正式生产服务器、正式域名、托管 PostgreSQL、对象存储、CDN、备份或恢复演练；
- 中国大陆不同网络的真实访问；
- 微信内置浏览器和真实微信群链接访问；
- 公开环境中发布、下线、恢复后 60 秒可见性的测量；
- 大师连续 30 日和特殊时间样例的书面复核。

## 6. 权限与未发生的操作

本轮先在隔离源码副本和一次性数据库中实现与验收，再把已验证的最小改动移入真实工作区：

- 未在真实仓库创建 commit；
- 未 push；
- 未创建或更新 PR；
- 未 deploy；
- 未迁移现有本地业务数据库或任何生产数据库；
- 未 reset、checkout、stash、clean、删除或覆盖真实仓库中的既有任务外改动；
- 未调用付费生图接口。

## 7. 结论

北京时间 18:00 公开内容切换与 23:00 命理 `fortuneDate` 换日已经在契约、服务端、
Worker、缓存、公开网页、后台读模型、迁移、一次性 PostgreSQL 和本地浏览器链路中形成一致实现，
并通过本报告列出的本地门禁。

当前结论是“本地工作区验收通过”，不是“允许公开试用”。生产基础设施、真实外部生图、
中国大陆网络、微信内置浏览器、60 秒缓存目标和大师书面复核仍需按 PRD 与 ADR-0028
完成后，才能形成公开测试放行结论。
