# PULSE

可以漫游、靠近和共同照料植物的粒子海面。Vue 3 管理界面，独立 Canvas/WebGL 引擎绘制世界，Go/WebSocket 同步真实连接与权威植物状态。

当前三座岛是示例内容，连接编号不是稳定用户；个人岛、所有权与真实邀请尚未实现。

## 开始开发

使用 Go 1.25、Node 22.12+；本轮实际验证 Node 22.19.0。首次安装依赖：

```powershell
npm ci
```

两个终端分别运行：

```powershell
go run .
```

```powershell
npm run dev
```

打开 Vite 打印的地址。前端源码在 frontend/src，支持热更新；Go 默认监听 127.0.0.1:8090，Vite 同源代理 WebSocket/API。

PULSE_ADDR 可覆盖 Go 监听地址；PULSE_BACKEND 可覆盖 Vite 代理目标。PULSE_GARDEN_STATE 指定花园数据路径，验收时使用独立文件。

## 检查正式构建

```powershell
npm test
npm run build
go test ./... -count=1
go vet ./...
go build -o .tools/pulse.exe .
./.tools/pulse.exe
```

构建生成 static/dist，随后由 Go 内嵌进二进制；产物不提交、不手改。改前端后必须重新构建并重启 Go，或使用 Vite 开发服务。未构建时 Go 首页返回明确 503 提示，业务 API 仍可启动。

生产仍只运行 Go 二进制，Node 仅参与开发与 CI 构建。推送 main 会自动部署，本轮未提交、推送或部署。

## 文档与协作

- [架构、调用链、运行方式与学习练习](docs/16-frontend-foundation.md)
- [当前功能路线与其他 agent 提示词](docs/07-ai-assisted-roadmap.md)
- [进度与验证证据](docs/05-progress-and-validation.md)
- [全部文档入口](docs/README.md)

AI 完成功能包，你每轮练一个核心边界；实现、验证与独立理解分别记录。保留已有中文函数注释和手写成果，不以引入框架替代产品功能。
