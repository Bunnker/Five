# ChatGPT Pro：18:00 公开内容切换最终静态复核

日期：2026-08-07
对话：<https://chatgpt.com/c/6a73eff3-bf88-83ee-998f-d514a967f3e1>
源码基线：`main` / `31e482aa41d70265a6fd6c60c4fd11bf32ed274a`

## 1. 复核材料

第一次静态审查使用：

- `five-admin-rebuild-context-main-31e482a-20260807-v4.zip`
- 1,279,326 bytes
- SHA-256：`e20317c4b8b004cfdabb114539b21a8041a72b2bb3e0902326c3a1100bbb22dc`

修正后最终复审使用：

- `five-admin-rebuild-context-main-31e482a-20260807-v5.zip`
- 1,279,618 bytes
- SHA-256：`87b687c6eb3bda26b9d976ac98c95b8a24c3aca3628c7d7c3053ea911784476f`
- 472 个常规文件；FILELIST 472/472、manifest 471/471、`unzip -t` 均通过；扫描未留未分类命中。

两个包均采用显式白名单，排除了 `.env*`、私钥、证书、Cookie、浏览器状态、数据库、日志、构建产物、依赖、媒体附件和真实业务数据。扫描是防误传措施，不代表对任何源码包作出绝对无秘密保证。

## 2. 第一次审查提出的问题

ChatGPT Pro 对 v4 给出“不可合并”，列出三个 P1：

1. demo reader 可能进入公开 `/today` 并破坏 18:00 fail-closed；
2. 18:00 `servedFortuneDate` 与 23:00 `fortuneDate` 缺少单一上下文，可能重复推进；
3. 后台 required `2/2` 可能按图片任务完成数，而不是不可变版本的交付投影统计。

这些结论没有被直接采纳。Codex 逐项检查源码、状态序列和测试，并并行执行独立复核。

## 3. 独立复核与修正

### 3.1 demo 边界：确认一个更精确的真实缺陷并修复

严格 `NODE_ENV=production` 时原实现已经禁用 demo。真实缺陷是：当 `NODE_ENV` 缺失或拼错、`FIVE_DEMO_CONTENT=1` 且 PostgreSQL pool 已注入时，demo 分支优先于 pool，可能把数据库故障掩盖成 demo 200。

先新增真实 `TodayModule`、故障数据库 pool 和缺失运行模式的 HTTP 回归。修复前该用例稳定得到 200；随后把 demo 限制为以下三个条件同时满足：

- 没有数据库 pool；
- `NODE_ENV === "development"`；
- `FIVE_DEMO_CONTENT === "1"`。

有 pool 时始终使用 PostgreSQL reader；其他无 pool 状态使用 `NoPublishedContentReader` 并 fail closed。修改文件：

- `apps/backend/src/today/today.module.ts`
- `apps/backend/src/today/today.http.test.ts`

### 3.2 双时间轴：初始 P1 为误报

现有实现从一次 `RequestContext` 派生 `PublicContentContext`。边界测试已经同时断言：

| 北京时间 | `fortuneDate` | `servedFortuneDate` |
|---|---|---|
| 17:59 | D | D |
| 18:00 | D | D+1 |
| 22:59 | D | D+1 |
| 23:00 | D+1 | D+1 |
| 23:59 | D+1 | D+1 |
| 00:00 | D+1 | D+1 |

Release wakeup 只按 18:00 公开窗口计算；23:00 仅刷新命理请求上下文。Worker 的 PostgreSQL claim、lease 和 revision fence 防止并发唤醒重复发布。没有发现可执行的二次推进路径，因此未修改代码。

### 3.3 required `2/2`：初始 P1 为误报

运营读模型先选择当前 Active 或未来 Scheduled/Approved 不可变版本投影，再由 `DailyImageSet` 的 `deliveryStatus` 与 `servedCoverAssetId` 计算 `modelReadyCount` 和 `deliverySafeCount`，并按唯一资产去重。

`scheduled_ready` 还要求 Scheduled 状态、完整精确窗口、非空预览及两种计数均为 2。图片 job 只在不就绪后用于解释生成失败原因，不参与用户可交付计数。Release preflight 同样读取不可变版本、图片集和下线状态，不读取 job 完成数。因此未修改代码。

## 4. ChatGPT Pro 最终结论

ChatGPT Pro 核对 v5 SHA-256 和上述代码后：

- 确认 demo 修复完整并撤销 P1-1；
- 确认 P1-2 没有可执行缺陷并撤销；
- 确认 required `2/2` 使用交付投影并撤销 P1-3；
- 最终结论改为“可合并，未发现阻塞性 P0/P1”。

该结论仅为外部静态审查。ChatGPT Pro 明确说明它没有执行本地 `pnpm check`、PostgreSQL integration、smoke 或浏览器 QA。

## 5. 修正后的本地验证

Codex 在隔离副本重新执行：

- `pnpm check`：API contract 29、backend 601、web 540；格式、ESLint、strict typecheck 和 366 日历检查通过；
- `pnpm postgres:integration:check`：一次性 PostgreSQL 的所有集成组通过；迁移 000016 为 4/4；
- 从空卷执行 `pnpm smoke`：迁移 000001 至 000016、生产构建、Web、HTTP、Worker 和 PostgreSQL 联合检查通过；
- 最终一次性 Docker 项目及其卷已删除。

## 6. 真实工作区集成

最终把 215 个任务目标文件以逐文件上下文补丁移入真实 `main` 工作区。130 个已存在文件在回填
前单独备份并记录哈希，85 个新文件逐一添加；回填后 215/215 与隔离验收源码一致。随后在真实
工作区执行 `pnpm check`、`pnpm build` 和 `git diff --check`，均通过。

真实工作区的现有数据库没有迁移，因此未在该目录运行会执行迁移的 `pnpm smoke`。当前变更仍为
本地未提交状态，没有 commit、push、PR 或部署。

## 7. 非阻塞残余风险

1. 两个必备槽位若都降级到同一安全资产，需要明确显示 degraded issue；
2. SHA-256 只能识别完全相同文件，不能识别裁切、压缩或视觉近重复；
3. demo fixture 的生产隔离回归测试必须长期保留。

以上不是生产放行结论。真实外部生图、正式服务器、CDN、备份恢复、中国大陆网络、微信内置浏览器和大师书面复核仍未执行。
