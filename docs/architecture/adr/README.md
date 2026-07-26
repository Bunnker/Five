# Architecture Decision Records

本目录记录 Five 已经接受或仍在讨论的关键产品技术决策。

## 状态

- `Proposed`：建议方案，尚未成为开发基线；
- `Accepted`：已经确认，开发与评审必须遵守；
- `Superseded`：已被后续 ADR 替代，文件仍保留用于追溯；
- `Rejected`：未采用。

## 规则

1. 已接受的 ADR 不原地改写核心结论；需要改变时新增 ADR，并把旧 ADR 标记为 `Superseded`。
2. PRD 定义产品范围和验收，ADR 解释不可轻易回退的设计决策。
3. 若 ADR 与当前 PRD 冲突，以较新的明确决策为准，并在同一变更中修正文档。

## 索引

- [ADR-0001：H5 与微信小程序共享一个内容域](0001-h5-and-wechat-mini-share-one-content-domain.md)
- [ADR-0002：先得到命理日，再计算标准干支日](0002-fortune-date-before-standard-ganzhi-day.md)
- [ADR-0003：不可变内容载荷、追加事件与派生海报](0003-immutable-content-payload-and-derived-posters.md)
- [ADR-0004：请求上下文与边缘缓存边界](0004-request-context-and-edge-cache-boundaries.md)
- [ADR-0005：P0 首页、导航与负向档交互](0005-p0-navigation-and-negative-tier-actions.md)
- [ADR-0006：素材来源与 AI 标识](0006-asset-sources-and-ai-labeling.md)
- [ADR-0007：P0 双端采用 Taro、React 与 TypeScript](0007-taro-react-for-p0-clients.md)
- [ADR-0008：后端采用 TypeScript 模块化单体与 PostgreSQL](0008-typescript-modular-monolith-and-postgresql.md)
- [ADR-0009：P0 采用匿名网页完成市场验证](0009-web-first-anonymous-market-validation.md)
- [ADR-0010：网页端采用 Next.js、React 与 TypeScript](0010-nextjs-for-web-client.md)
- [ADR-0011：首版由一人维护并保留大师核对记录](0011-single-operator-with-external-master-review.md)
- [ADR-0012：用固定日期答案表阻止错误结果上线](0012-fixed-calendar-answer-table-and-release-gate.md)
- [ADR-0013：首批图片在外部生成并人工检查后上传](0013-external-ai-images-with-manual-review.md)
- [ADR-0014：公开保留吉档名称并用配饰给出平衡建议](0014-public-tier-labels-and-accessory-balance-advice.md)
- [ADR-0015：单人维护版使用八个清晰的内容状态](0015-single-operator-content-states.md)
- [ADR-0016：提前批量生成每日图片，Codex 为主、中转为备用](0016-offline-image-batches-with-codex-and-relay-fallback.md)
- [ADR-0017：OpenAPI 是网页、后台和后端接口的唯一事实源](0017-openapi-as-interface-source-of-truth.md)
- [ADR-0018：使用最小 pnpm 工作区和版本化数据库迁移](0018-minimal-pnpm-workspace-and-versioned-migrations.md)
