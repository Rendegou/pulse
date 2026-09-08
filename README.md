# PULSE

把真实 WebSocket 连接、光标移动和服务端运行指标画在同一片粒子海面上的 Go + JavaScript 项目，也是一个由你亲手推进的实时应用练习项目。

每个光标表示一条真实连接；两个标签页是两条连接，不代表两个经过认证的人。服务端暂存在线状态与所在岛，刷新或重连会重新分配身份。岛屿与文章是标注清楚的示例内容。

## 从哪里继续

先打开 [当前方向（自己的小世界）](docs/14-personal-worlds-direction.md) 和 [当前进度](docs/05-progress-and-validation.md)。视觉基准是 [潮汐群岛概念稿](outputs/pulse-tidal-islands.html)，已迁入正式前端；下一步建议是确定“朋友到岛上后的第一个共同动作”。

## 本地运行

安装与 `go.mod` 相容的 Go 工具链；当前声明为 Go 1.25。Node.js 用于 JavaScript 语法检查和已有纯函数测试，前端没有 npm 构建步骤。

```powershell
Set-Location 'D:\VenerableP\pulse'
go run .
```

浏览器打开 `http://127.0.0.1:8090`，再开第二个标签页做对照。静态文件通过 `go:embed` 编译进进程，改 JS/HTML 后需要重启 Go 进程，再刷新页面。

```powershell
$env:GOCACHE = Join-Path $env:TEMP 'pulse-go-cache'
go vet ./...
go test ./... -count=1
go test -race ./... -count=1   # 需要 CGO 与 C 编译器；没有就记录真实报错，不要记成通过
node --check static/app.js
node --check static/world.js
node --check static/islands.js
node --check static/pure.js
node --test work/pure.test.mjs work/l3b.test.mjs work/l3c.test.mjs work/world.test.mjs work/tidal.test.mjs
node work/check-tidal-ui.cjs http://127.0.0.1:8090   # 需要 go run . 正在运行
git diff --check
```

`main_test.go` 有 Go 行为测试：`validatePulse`/`validateCursor` 的字段边界、令牌桶、权威岛判定，以及慢消费者回收和 presence 广播两条真实 WebSocket 集成用例。测试通过只覆盖这些路径，不等于浏览器端和部署环境已验证。具体检查层级见 [进度与验证](docs/05-progress-and-validation.md)。

## 协作方式

AI 完成当前功能包的常规实现、接线、测试和文档；你每轮练一个核心函数或反例测试，并解释关键调用链和失败边界。说“提示”时仍采用分级提示；说“完整实现”时可直接由 AI 完成，随后用一个小改动检查理解。每个函数或方法都写中文注释，说明用途、契约和必要的副作用。

项目已有推送 `main` 后部署的工作流。本地学习和提交不等于发布；推送前要知道这会触发部署。
