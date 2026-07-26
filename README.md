# Five

Five 是一个手机优先的每日五行穿搭参考网页。P0 聚焦一个明确任务：用户点开微信群里的普通链接后，能在十秒内知道今天的大吉、次吉、平和需要“注意”的颜色。

## 当前状态

- 产品基线：PRD V2.3
- 发布形态：响应式公开网页；暂不开发微信小程序和 App
- 当前阶段：P0 接口已经冻结，本地工程已经可以启动；下一步按 GitHub ticket 实现公开读取功能
- 文档语言：中文

开发判断以 Markdown PRD、OpenAPI 和 GitHub ticket 为准；Word 文件只是方便阅读的导出件。

## 本地启动

需要先安装：

- Node.js 24.14.1
- pnpm 10.33.0
- Docker Desktop

首次启动：

```bash
pnpm install
pnpm dev
```

`pnpm dev` 会自动完成以下事情：

1. 没有本地配置时，从 `.env.example` 生成只用于本机的 `.env`；
2. 启动 PostgreSQL；
3. 执行尚未运行的数据库迁移；
4. 同时启动网页、HTTP 服务和后台 Worker。

启动成功后可以访问：

- 网页：<http://localhost:3000>
- 后端进程存活检查：<http://localhost:3100/health/live>
- 后端和数据库就绪检查：<http://localhost:3100/health/ready>

按 `Ctrl+C` 停止网页、HTTP 服务和 Worker。PostgreSQL 会保留本地数据；不再使用时运行 `pnpm infra:down` 停止它。

## 开发自检

```bash
# 检查接口契约、代码格式、代码规则、严格类型和基础测试
pnpm check

# 完整构建并真实启动网页、HTTP、Worker 和 PostgreSQL
pnpm smoke
```

`pnpm smoke` 通过，表示这四部分在本机能够一起工作，不表示产品功能已经完成，也不表示已经可以公开部署。

## 工程结构

```text
apps/
  web/               Next.js 网页
  backend/           NestJS 后端；HTTP 和 Worker 是两个独立进程
packages/
  api-contract/      从 OpenAPI 自动生成的 TypeScript 类型
docs/                PRD、接口契约、领域词汇和架构决策
compose.yaml         本地 PostgreSQL
```

## 文档入口

完整文档索引、权威顺序和维护规则见 [docs/README.md](docs/README.md)。

主要入口：

- [产品需求文档](docs/product/prd.md)
- [OpenAPI 接口契约](docs/api/openapi.yaml)
- [接口人话说明](docs/api/README.md)
- [领域词汇表](docs/domain/glossary.md)
- [架构决策记录](docs/architecture/adr/README.md)
- [P0 设计修订说明](docs/design/p0-design-brief.md)

## 说明

本仓库暂未声明开源许可证。
