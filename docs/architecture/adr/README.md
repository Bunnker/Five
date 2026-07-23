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
