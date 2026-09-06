# PULSE

把真实 WebSocket 连接、光标移动和服务端运行指标画在同一张画布上的 Go + JavaScript 项目，也是一个由你亲手推进的实时应用练习项目。

每个点表示一条连接；两个标签页是两个点，不代表两个经过认证的人。服务端暂存在线状态，刷新或重连会重新分配身份。

## 从哪里继续

先打开 [新协作路线](docs/07-ai-assisted-roadmap.md) 和 [当前进度](docs/05-progress-and-validation.md)。L1–L3 已有实现，下一包是点击脉冲与必要输入保护；之后补可靠连接，再进入固定二维博客街区。

计划于 2026-09-07 按本地提交 `4946e28` 与实际源码更新为协作计划 v2；这不表示产品达到 v2 发布标准。

## 本地运行

安装与 `go.mod` 相容的 Go 工具链；当前声明为 Go 1.25。Node.js 用于 JavaScript 语法检查和已有纯函数测试，前端没有 npm 构建步骤。

```powershell
Set-Location 'D:\VenerableP\pulse'
go run .
```

浏览器打开 `http://127.0.0.1:8090`，再开第二个标签页做对照。静态文件通过 `go:embed` 编译进进程，改 JS/HTML 后需要重启 Go 进程，再刷新页面。

```powershell
go test ./...
go vet ./...
node --check static/app.js
node --check static/pure.js
node --test work/pure.test.mjs work/l3b.test.mjs work/l3c.test.mjs
git diff --check
```

当前没有 Go 测试文件；`[no test files]` 只表示命令能运行，不能证明行为正确。具体检查层级见 [进度与验证](docs/05-progress-and-validation.md)。

## 协作方式

AI 完成当前功能包的常规实现、接线、测试和文档；你每轮练一个核心函数或反例测试，并解释关键调用链和失败边界。说“提示”时仍采用分级提示；说“完整实现”时可直接由 AI 完成，随后用一个小改动检查理解。每个函数或方法都写中文注释，说明用途、契约和必要的副作用。

项目已有推送 `main` 后部署的工作流。本地学习和提交不等于发布；推送前要知道这会触发部署。
