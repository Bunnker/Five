# ADR-0018：使用最小 pnpm 工作区和版本化数据库迁移

- 状态：Accepted
- 日期：2026-07-26
- 补充：ADR-0008、ADR-0010、ADR-0017

## 背景

Five 的 P0 由一人维护，需要网页、HTTP、Worker 和 PostgreSQL 在本机可靠地一起运行。工程过少会让启动、检查和迁移依赖口头约定；工程工具过多又会增加学习、升级和排错成本。数据库迁移一旦形成历史，更换工具也会有持续成本。

## 决策

使用 Node.js 24.14.1、pnpm 10.33.0 和原生 pnpm workspace。工作区只包含 Next.js 网页、同一个 NestJS 后端中的 HTTP 与 Worker 入口，以及从 OpenAPI 生成的接口类型；不加入 Nx、Turborepo 或额外微服务框架。

使用 Prettier、ESLint、TypeScript 严格检查和 Vitest。根目录的 `pnpm check` 是统一检查入口。

本地 Docker Compose 只运行 PostgreSQL 17，网页、HTTP 和 Worker 直接在 Node.js 中运行。数据库迁移使用 `node-pg-migrate`，迁移文件进入版本管理；禁止用手工改表代替迁移。`pnpm dev` 负责准备数据库并启动三类进程，`pnpm smoke` 负责完整构建和联合启动验收。

## 影响

- 一个人只需要理解一套 JavaScript 工具和一组根目录命令；
- HTTP 与 Worker 共用后端代码，但仍以独立进程启动和停止；
- 数据库结构变化必须新增迁移，并在空库上按顺序验证；
- 本地 PostgreSQL 的通过结果不代表美国部署、域名、内容加速或公开网络已经验证；
- 若未来规模证明原生 workspace 不够，再通过新 ADR 评估工程编排工具。
