# Five 文档中心

## 当前基线

- 产品版本：V2.3（公开网页市场验证版）
- 更新日期：2026-07-26
- 当前结论：P0 技术启动评审有条件通过；接口字段和后台登录方案冻结后可开始功能开发
- 规范源：[product/prd.md](product/prd.md)

服务器、域名、对象存储和 CDN 尚未确认，不阻止本地开发，但阻止公开上线。

## 文档权威顺序

发生表述差异时，按以下顺序处理：

1. [产品需求文档](product/prd.md)：产品范围、业务规则、API 契约和验收标准的唯一事实源；
2. [已接受 ADR](architecture/adr/README.md)：解释关键决策及其工程影响；
3. [领域词汇表](domain/glossary.md)：统一业务术语，不独立改变产品范围；
4. [P0 设计修订说明](design/p0-design-brief.md)：把 PRD 转换为设计交付约束；
5. `reviews/`：评审过程与处理记录，仅用于追溯，不作为实现规范。

DOCX 是 Markdown 规范源的同步导出件，不得单独修改后成为另一套需求。

## 快速导航

| 文档 | 状态 | 用途 |
|---|---|---|
| [PRD V2.3](product/prd.md) | Current | 产品、设计、研发、测试共同基线 |
| [PRD V2.3 DOCX](exports/five-prd-v2.3.docx) | Export | 阅读与外部交付 |
| [领域词汇表](domain/glossary.md) | Current | 统一时间、版本、内容和渠道术语 |
| [ADR 索引](architecture/adr/README.md) | Accepted | 关键架构与产品技术决策 |
| [P0 设计修订说明](design/p0-design-brief.md) | Current | 首页、导航、页面和状态设计约束 |
| [UI Prototype V2 图集](design/references/prototype-v2/README.md) | Reference | GPT 探索原型留档，非开发基线 |
| [Fable5 评审处理记录](reviews/2026-07-23-fable5-review-resolution.md) | Historical | 记录采纳、修正和不采纳项 |
| [P0 技术启动评审](reviews/2026-07-26-p0-technical-startup-review.md) | Current review | 记录网页验证版技术决定和未解除阻塞 |
| [变更记录](CHANGELOG.md) | Current | 文档版本变化 |

## 范围摘要

- P0 客户端：手机优先的响应式公开网页，通过微信群普通链接访问，无需登录；
- P0 内容：公共每日五行、大吉/次吉/平/注意、穿搭方案、每日 2 张必备图片和最多 1 张可选图片、推算依据、分享海报和设置帮助；
- P0 后台：一名维护者操作，大师在系统外确认并留下依据；
- 未来方向必须在网页验证后重新立项，不作为当前接口或页面预留。

P0 不包含微信小程序、App、底部固定 Tab、历史浏览、登录、出生信息、个人五行、生肖、收藏、主动提醒、商品、吉祥物、拍照试搭或无效占位入口。

## 维护规则

1. 产品范围、规则、接口或验收变化，先修改 `product/prd.md`。
2. 新增不可轻易回退的技术或产品技术决策时，新增 ADR，不静默改写已接受 ADR。
3. 新增或改变核心术语时，同步修改 `domain/glossary.md`。
4. 设计稿必须满足 `design/p0-design-brief.md`，探索原型不自动成为开发基线。
5. 每次修改 PRD 后重新生成并渲染检查 DOCX。
6. 不提交 `.DS_Store`、Office 临时文件、构建缓存或含本机绝对路径的脚本。

待确认事项集中在 PRD 第 24 章；发布门槛集中在第 25 章。
