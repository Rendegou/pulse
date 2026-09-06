# PULSE 进度、验证与学习记录

## 1. 当前快照

- 核对日期：2026-09-07；源码 HEAD：`4946e28`。
- 文档修改前 `git status --short` 无变更；Git 提示用户级 ignore 文件权限不足，但仓库状态与日志命令正常返回。
- 本次只更新文档与 AGENTS.md，不修改产品代码，不提交、推送或部署。
- 当前下一步：[功能包 A：点击脉冲](07-ai-assisted-roadmap.md#5-接下来的功能包)。旧 L0–L10 是课程库，不再顺序通关。

## 2. 实现证据

### 已有且不必重做

- `static/app.js / draw` 已消费选定的 `p.x/p.y`；远程插值接线已完成。
- `aa76676`、`ef559c4`：Hermite、按时间差计算切线、转折归零，以及 `s.playing` 缓存当前段切线。仍使用接收时间和 120ms 延迟；不是发送时间映射或自适应缓冲。
- `928aa4c`：`work/retrieval-l2.mjs` 有 lerp/sampleAt 练习及返回类型、终点边界的修正记录；本轮没有观察闭卷过程。
- `730d99b`：`static/pure.js` 中 normalizePointer 被 mousemove 消费；HTML 已为 ES module。
- `c18e728`：appendPositionSample 保留 1 秒/32 条双上限，末项同时间戳覆盖；cursor 同时更新 last-known 位置。时间裁剪发生在追加时，不是静止后由定时器自动清空。
- `4946e28`：发送前检查 dirty、OPEN、64 KiB bufferedAmount；welcome 清 pending。它是发送预算保护，不等于完整的重连隔离或服务端限流。
- main.go 仍有真实 presence/cursor/metrics、Hub 快照、容量 64 的发送队列与现有写超时。

### 尚未实现或需要后续验收

- pulse 完整事件链、必填字段存在性校验、读上限、应用级限频和连接预算。
- welcome 写失败处理、writer 失败唤醒 reader、ping/pong、慢消费者退出策略与前端旧连接回调隔离。
- Go 行为测试、快照 DTO 边界测试、CI 中的行为测试执行。
- 真实 Host Radar、房屋/文章共享存储、作者权限和 GitHub 博客导入。
- 当前插值的生产函数回归与真实网络对照。本轮不证明全输入无过冲，也不保证冻结切线后所有相邻段速度连续。

独立 World Demo 仍是原型；不能把它的本机存储、示例文章和演示邻居记成生产多人世界。

## 3. 2026-09-07 本轮验证

- `node --test work/pure.test.mjs work/l3b.test.mjs work/l3c.test.mjs`：18/18 通过，实际导入 static/pure.js。
- `node --check static/app.js`、`node --check static/pure.js`：语法通过。
- `node work/interpolation-lab.mjs`：运行成功，展示旧 Catmull–Rom 与实验 Hermite 的数值比较。脚本含复制算法及历史注释，不是当前 samplePosition/playing 的回归测试。
- `go test ./...`：默认 Go 缓存目录首次访问被拒；将 GOCACHE 临时设为系统 TEMP 下的 pulse-plan-audit-go-cache 后成功，结果 `[no test files]`。没有 Go 行为覆盖。
- `go vet ./...`：在同一临时缓存设置下通过，无诊断。
- 浏览器双窗口、真实 WS 集成、race detector、压测、Linux sensor、公网服务和部署结果：本轮未验证。

现有测试的具体限制：L3b 中“1000 条快速样本”使用相同时间戳，主要验证覆盖；另一条“两个上限同时作用”用不同时间戳实际验证数量裁剪。L3c 单测只验证 canSend 决策，不证明 welcome 清 pending、真实 send 次数或旧回调隔离。AI 在对应功能包补链路用例，不要求用户为此重写全部脚手架。

本轮文档检查：12 份 Markdown 的本地引用及围栏结构检查通过，31 个本地链接（含引用锚点）有效；`git diff --check` 通过。未使用浏览器做 Markdown 渲染检查。历史 2026-09-05 的检查不能当成本轮结果。

## 4. 常用检查命令

在仓库根目录的 PowerShell 7 中：

```powershell
git status --short
node --check static/app.js
node --check static/pure.js
node --test work/pure.test.mjs work/l3b.test.mjs work/l3c.test.mjs
go test ./...
go vet ./...
git diff --check
```

若默认 Go 构建缓存因本机权限不可写，可仅对当前 shell 设置：

```powershell
$env:GOCACHE = Join-Path $env:TEMP 'pulse-plan-audit-go-cache'
go test ./...
go vet ./...
```

插值实验可单独运行 `node work/interpolation-lab.mjs`，但不能替代产品测试。未来增加测试后按实际文件更新命令；不运行不存在的 `static/interpolation.test.mjs`。

并发改动在支持的工具链运行 `go test -race ./...`，记录实际触达路径；Windows 缺 CGO/C 编译器时记录阻塞，再在具备工具链的 CI 验证。不得把未运行记成通过。

## 5. 产品与能力分别记录

- **L1：** 读懂待本轮确认；有实现；本轮仅源码/语法验证；独立迁移未测。
- **L2：** 有实现与带修正记录的练习；历史实验能运行；当前生产插值回归未补齐；本轮独立复写未测。
- **L3：** 有实现，18 项相关测试通过；由另一个 agent 协助推进，具体逐函数作者不作推断；真实页面链路和独立迁移待确认。
- **A/B/C/D：** 计划阶段。本轮没有开始实现。

用户说“弄好了”是有效进展反馈；验收记录同时保留证据层级。未知不等于不会，不因为能力记录尚缺而要求重做已经交付的所有代码。

## 6. 下一轮留给执行 agent

当前包 A。先核对最新源码，避免别的 agent 已完成后重复实现。用户练习只留一个校验反例；AI 完成剩余功能和检查。包完成后在此新增：源码版本、行为、检查、AI/用户分工、学习证据、唯一下一步。

推荐后续 A → B → C-World → D；Host Radar 保留支线。原因与交接提示见 [新路线](07-ai-assisted-roadmap.md)。
