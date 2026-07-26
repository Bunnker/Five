# Issue Tracker：GitHub

本仓库的 Issue 和 PRD 均存放在 GitHub Issues 中。所有操作统一使用 `gh` CLI。

## 操作约定

- **创建 Issue**：`gh issue create --title "..." --body "..."`。多行正文使用 heredoc。
- **读取 Issue**：运行 `gh issue view <编号> --comments`，同时读取标签，并按需用 `jq` 过滤评论。
- **列出 Issue**：运行 `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`，并根据需要添加 `--label` 和 `--state` 筛选条件。
- **评论 Issue**：`gh issue comment <编号> --body "..."`
- **添加或移除标签**：`gh issue edit <编号> --add-label "..."` / `--remove-label "..."`
- **关闭 Issue**：`gh issue close <编号> --comment "..."`

通过 `git remote -v` 判断目标仓库。在仓库目录内运行时，`gh` 会自动完成识别。

## 是否将 Pull Request 作为待处理请求来源

**PRs as a request surface: no.**

如需把外部 PR 当成功能请求处理，可在未来将该值改为 `yes`。

启用后，PR 与 Issue 使用相同的状态和标签，并通过对应的 `gh pr` 命令操作：

- **读取 PR**：使用 `gh pr view <编号> --comments`；使用 `gh pr diff <编号>` 查看改动。
- **列出待处理的外部 PR**：使用 `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments`，保留外部贡献者提交的 PR，排除仓库所有者、成员和协作者。
- **评论、添加标签或关闭**：使用 `gh pr comment`、`gh pr edit --add-label`、`gh pr edit --remove-label` 和 `gh pr close`。

GitHub 的 Issue 和 PR 共用同一套编号。遇到 `#42` 这类引用时，先运行 `gh pr view 42`；如果不是 PR，再运行 `gh issue view 42`。

## 当技能要求“发布到 Issue Tracker”时

创建一个 GitHub Issue。

## 当技能要求“读取相关工单”时

运行 `gh issue view <编号> --comments`。

## Wayfinding 操作

`/wayfinder` 使用一个主 Issue 作为地图（map），并使用其子 Issue 作为具体任务。

- **地图**：一个带有 `wayfinder:map` 标签的 Issue，用于记录 Notes、Decisions-so-far 和 Fog。
- **子任务**：通过 GitHub Sub-issues 功能关联到地图。如果仓库未启用 Sub-issues，则在地图正文中使用任务列表关联，并在子任务顶部加入 `Part of #<地图编号>`。
- **阻塞关系**：优先使用 GitHub 原生 Issue Dependencies。如果不可用，则在子任务顶部加入 `Blocked by: #<编号>`。
- **下一项任务**：按照地图中的顺序，选择第一个仍处于打开状态、没有阻塞且尚未分配的子任务。
- **认领任务**：运行 `gh issue edit <编号> --add-assignee @me`。
- **完成任务**：发布结果评论，关闭子任务，并在地图的 Decisions-so-far 中加入相关上下文链接。
