# Five 文档中心

## 当前基线

- 产品版本：V2.3（公开网页市场验证版）
- 更新日期：2026-07-30
- 当前结论：P0 技术启动评审有条件通过；接口已经冻结，可以开始工程骨架和公开读取功能，后台写功能仍需先确认登录方案
- 产品规范源：[product/prd.md](product/prd.md)
- 接口规范源：[api/openapi.yaml](api/openapi.yaml)

服务器、域名、对象存储和 CDN 尚未确认，不阻止本地开发，但阻止公开上线。

## 文档权威顺序

发生表述差异时，按以下顺序处理：

1. [产品需求文档](product/prd.md)：产品范围、业务规则和验收标准的事实源；
2. [OpenAPI 契约](api/openapi.yaml)：请求、响应、字段、状态枚举和错误码的事实源；
3. [已接受 ADR](architecture/adr/README.md)：解释关键决策及其工程影响；
4. [领域词汇表](domain/glossary.md)：统一业务术语，不独立改变产品范围；
5. [P0 设计修订说明](design/p0-design-brief.md)：把 PRD 转换为设计交付约束；
6. `reviews/`：评审过程与处理记录，仅用于追溯，不作为实现规范。

DOCX 是 Markdown 规范源的同步导出件，不得单独修改后成为另一套需求。

## 快速导航

| 文档 | 状态 | 用途 |
|---|---|---|
| [PRD V2.3](product/prd.md) | Current | 产品、设计、研发、测试共同基线 |
| [OpenAPI 契约](api/openapi.yaml) | Frozen | 网页、后台和后端共同使用的字段、状态和错误码 |
| [接口人话说明](api/README.md) | Current | 用普通语言解释接口、版本保护和未决边界 |
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
- P0 内容：公共每日五行、大吉/次吉/平/较差/不利五档、穿搭方案、每日 2 张必备图片和最多 1 张可选图片、推算依据、分享海报和设置帮助；
- P0 后台：一名维护者操作，大师在系统外确认并留下依据；
- 未来方向必须在网页验证后重新立项，不作为当前接口或页面预留。

P0 不包含微信小程序、App、底部固定 Tab、历史浏览、登录、出生信息、个人五行、生肖、收藏、主动提醒、商品、吉祥物、拍照试搭或无效占位入口。

## 维护规则

1. 产品范围、业务规则或验收变化，先修改 `product/prd.md`。
2. 接口字段、状态枚举、错误码或示例变化，先修改 `api/openapi.yaml`，再同步 PRD 和实现。
3. 新增不可轻易回退的技术或产品技术决策时，新增 ADR，不静默改写已接受 ADR。
4. 新增或改变核心术语时，同步修改 `domain/glossary.md`。
5. 设计稿必须满足 `design/p0-design-brief.md`，探索原型不自动成为开发基线。
6. 每次修改 PRD 后重新生成并渲染检查 DOCX。
7. 不提交 `.DS_Store`、Office 临时文件、构建缓存或含本机绝对路径的脚本。

待确认事项集中在 PRD 第 24 章；发布门槛集中在第 25 章。
