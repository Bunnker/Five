# ADR-0003：不可变内容载荷、追加事件与派生海报

- 状态：Accepted
- 日期：2026-07-23

## 背景

每日内容需要审核、排期、发布、撤回和回滚，同时还会按平台与渠道生成不同海报。若直接修改已审核内容或让海报反向覆盖内容版本，将失去审计与安全回滚能力。

## 决策

Five 在草稿提交时冻结 `ContentSnapshotPayload` 并生成 `contentVersion`。模块审核、排期、发布、撤回、回滚和失败记录以追加事件保存，由 `fortuneDate` 级 `ContentLifecycleProjection` 与 `lifecycleRevision` 提供并发安全的当前状态；任何编辑过模块的人不得审核同一模块。

`posterTemplateVersion` 属于内容快照并参与审核。按 `sourcePlatform + targetPlatform + channelId` 生成的 `posterInstanceId` 是派生制品，只记录 `sourceContentVersion`，不反向修改内容快照。

## 影响

- 提交审核后的载荷不得原地修改；
- 发布和回滚必须使用并发保护与幂等键；
- 单个海报任务失败不阻断基础内容发布；
- 历史海报保留来源版本，入口解析到当前安全版本；
- 审计事件只能追加，不能由后台用户覆盖。
