# Five 后台桌面 Phase 1 上下文包扫描记录

> 日期：2026-08-07（Asia/Shanghai）
>
> 分支：`main`
>
> HEAD：`31e482aa41d70265a6fd6c60c4fd11bf32ed274a`

## 快照范围

- 当前真实工作区高度脏，快照包含本任务相关的已跟踪修改与未跟踪源码，不是仅基于 HEAD 的干净 worktree；
- 使用白名单纳入 198 个源码、测试、配置和事实源文件；
- 纳入 4 张已人工查看的参考图：当前后台日期详情、当前公开用户端、已确认桌面原型、大师在原型上的无个人信息标注；
- 未纳入大师微信聊天截图、头像、姓名和语音转写，反馈已改写为无个人信息的工程要求。

## 明确排除

- `.git`、`node_modules`、`.next`、构建产物、缓存、coverage、Playwright 状态和日志；
- `.env`、`.env.*`，包括 `.env.example`；
- 数据库、备份、业务数据、生成资产目录和运行日志；
- Cookie、浏览器配置、会话状态、SSH 配置；
- PEM、私钥、证书、Token、API Key 和其他凭据；
- 与本轮前端重构和用户端展示调整无关的源码。

## 扫描与人工分类

对待打包目录执行了：

1. 高风险文件名和扩展名检查；
2. 私钥头检查；
3. OpenAI、GitHub、AWS、Slack、Bearer 与 JWT 常见 Token 形态检查；
4. 带用户名和密码的数据库 URL 检查；
5. 邮箱、手机号、IPv4 和凭据命名检查；
6. 四张参考图人工查看。

结果：

- 未发现私钥、证书、真实 Token、API Key、数据库地址、手机号或真实账号密码；
- `admin-credentials.ts` 只包含用户名格式和密码长度校验，不包含凭据；
- `user:secret@cdn.five.test` 是验证拒绝 credentialed URL 的测试 fixture；
- `198.51.100.x` 属于文档保留测试网段，用于代理头测试；
- `must-not-leak` 是验证错误响应不得泄露密码字段的测试 fixture；
- 四张参考图不包含登录信息、Cookie、真实用户信息或服务器地址。

## 限制

该扫描用于降低误传风险，不能证明绝对不存在秘密。上传前仍需核对最终 `SOURCE_FILELIST.txt`、`FILELIST.txt`、`MANIFEST.sha256`、ZIP 大小和 SHA-256。

## 最终归档回执

- 文件：`five-admin-desktop-phase1-context-main-31e482a-20260807-v6.zip`；
- 大小：`2,861,214 bytes`；
- SHA-256：`5cbe649e821d8d739fc310c9f1566938346a0bc248e70bd822f8c31975bba6de`；
- 归档内 manifest 已逐项通过 `shasum -a 256 -c MANIFEST.sha256`。
