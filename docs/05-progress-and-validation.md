# PULSE 进度、验证与学习记录

> 2026-09-09 实现（执行 agent）：把 [14 方向](14-personal-worlds-direction.md) 认可的 [潮汐群岛视觉稿](../outputs/pulse-tidal-islands.html) 迁入正式前端，并落地“岛屿与在场”后端地基。**前端**：`static/world.js` 改为潮汐群岛引擎（sea/land/air 三层画布 + WebGL 粒子海面 + DOM 岛标签与纸页标签），新增 `static/islands.js`（与后端一致的岛屿数据 + 确定性几何缓存），`static/pure.js` 换成潮汐透视并新增岛屿几何纯函数，`app.js`/`index.html`/`style.css`/`tokens.css`/`i18n.js`/`articles.js` 全部重写为潮汐外壳。**后端**：`main.go` 新增权威岛屿列表（`Island`/`Islands()`/`resolveIsland`）、`Session` 收敛为单一 `WX/WY`+`Island`、cursor 升到 v=3 且岛归属由服务端重算、新增 `presence` 广播、welcome 带 `islands`、`/healthz` 报真实岛数。验证：Node 32/32、Go 8/8（含真实 WS 集成）、`go vet` 通过、浏览器 8 项通过（真实服务端 + 双窗口真实访客）。**未提交、未推送、未部署。**
>
> 同轮修掉两个既有缺陷：`TestSlowConsumerKicked` 在无限速广播下会同时踢掉健康连接（限速后连跑 16 次稳定）；前端缩放锚定只修正一帧导致 36 世界单位漂移（改为每帧修正，实测 0.0035）。

> 2026-09-09 方向记录：[14 自己的小世界，真实的相遇](14-personal-worlds-direction.md)。用户认可潮汐群岛 HTML 的整体画面，并明确以个人小世界中的真实相遇为核心；文章陈列尚未确认。今晚只新增方向文档、更新入口并核对 HTML 文件存在；没有修改产品代码或重新运行程序测试。下一步的自定义物件、双人拜访和共同变化仍是建议，未实现、未验证；等待用户下次继续。

> 2026-09-08 实现：[13 粒子纵深](13-particle-depth-direction.md) §9 记录。方向原型以独立文件交付（outputs/pulse-depth-demo.html；check-depth.cjs 11 项浏览器检查通过：纵深比例 camD 34→16 近点 2.02×/远点 1.44×，命中互逆、锚定、连续返回、静止缓存、阅读流全部通过）。后经用户批准，在 `static/world.js` 绘制层实施“最小三维化”（z 入尺度 pageFactor + 三层纸叠 + 小丘 groundRaise，见 §9.1），产品检查 7/7、缓存回归、Node 18/18 均通过；app.js/Go/协议未动，未提交、未部署。

> 2026-09-08 最新纠偏：[13 粒子纵深复盘与建议](13-particle-depth-direction.md)。用户在 DeepSeek 会话末尾已否定 v4 横版，要求简单粒子与空间感。本轮只核对会话、截图、源码并更新文档；旧 v4 报告不能覆盖后续粒子云的未收尾改动。

> 2026-09-08 后续：[12 横版多层岛](12-floating-isles-stele-forest.md) 为当前方向：v1 纸碑、v2 第一人称、v3 电影浮岛均被用户打回，用户拍板"不要 3D，2D 但要纵深（参考游戏手法）"；v4 原型已交付（多层视差 + 三层台地 + 雾/落影/瀑布，10 项浏览器检查通过）。**未改产品代码**，未提交、推送或部署；是否迁移待用户对画面的验收。

> 2026-09-08 后续：[文章岛](11-publication-islands.md) 直接改正式前端，用多层书页替换庭院。仅更新产品页面与相关验证，不更新独立 Demo。实现、页面验证与用户满意度分别记录；未推送或部署。

> 2026-09-08：[抽象空间与性能修订](10-abstract-space-and-performance.md) 基于 `9c94b8d` 修改正式前端，并同步独立 Demo。粒子庭院有实现；四个投影测试、前端浏览器交互与缓存回归有验证。用户独立复写状态未改变；本轮没有真实多人或生产验证。

> 2026-09-07 新增 UI 体验修订：[09 粒子地表世界](09-particle-world-experience.md)。核对产品 HEAD 为 `3f2b9d9`；本轮只新增独立 HTML 与验证、交接材料，未改生产 UI/后端。曲面漫游、连续下降、示例阅读有实现和浏览器验证；真实世界、房屋编辑和多人空间坐标尚未由此交付，用户独立掌握状态也未更新。下方 `4946e28` 是路线重排时的历史快照，不能替代当前源码。

## 1. 当前快照

- 核对日期：2026-09-09；源码 HEAD：`9c94b8d`（工作区有未提交改动，见下）。
- 当前方向：[14 自己的小世界，真实的相遇](14-personal-worlds-direction.md)；视觉基准为潮汐群岛 HTML，已迁入正式前端。
- 下一步（建议，未开始）：确定“朋友到岛上后的第一个共同动作”，再核对实时通信与坐标能力，做一次最小双人拜访。
- 历史：功能包 A/B 已实现并部署；[功能包 A/B 的定义](07-ai-assisted-roadmap.md#5-接下来的功能包)保留为记录，不再顺序推进。
- 本轮不提交、不推送、不部署（push 到 main 会触发 `deploy.yml` 自动部署）。

## 2. 实现证据

### 已有且不必重做

- 潮汐群岛前端（2026-09-09）：`static/world.js` 三层画布（WebGL 海面 / 陆地与纸页 / 浪沫·漂尘·实时层）、DOM 岛标签与纸页标签、拖动/滚轮/双指/键盘手势；`static/islands.js` 岛屿数据与确定性几何；`static/pure.js` 潮汐投影 + 岛屿几何纯函数。
- 后端岛屿与在场（2026-09-09）：`main.go` 的 `Island`/`Islands()`/`islandByID`/`islandContains`/`resolveIsland`；`Session` 只有一套世界坐标 `WX/WY` + `Island`；cursor v=3 由服务端重算岛归属并广播 `presence`；welcome 带 `islands`；`/healthz` 报真实岛数。
- `static/app.js` 的 `samplePosition/hermite/tangentAt` 保留并继续消费服务端世界坐标；`appendPositionSample` 的 1 秒/32 条双上限不变。
- `4946e28` 的发送预算（dirty/OPEN/64 KiB bufferedAmount）与 welcome 清 pending 仍有效；连接预算 128、15s ping/45s 读超时、慢消费者回收策略未改。
- main.go 仍有真实 presence/cursor/metrics、Hub 快照、容量 64 的发送队列与现有写超时。

### 尚未实现或需要后续验收

- pulse 完整事件链已实现（功能包 A）：必填字段存在性校验（指针解码）、读上限 4KiB、令牌桶限频（2/s 均值、4 突发）已落地；连接总预算与 welcome/心跳/慢消费者回收仍缺。
- 已验证（2026-09-07，本地 127.0.0.1:8090）：双 WS 客户端各收一次脉冲；缺 x / 越界 / 缺 clientEventId 不广播；连发 8 个仅 5 个通过（令牌桶）；浏览器点击出现扩散环。
- 练习证据：validatePulse 行为测试（零坐标合法、缺字段非法）待用户完成，入口 main_test.go。
- ~~welcome 写失败处理、writer 失败唤醒 reader、ping/pong、慢消费者退出策略与前端旧连接回调隔离~~（功能包 B 已实现：defer 单一注销、写失败联动关闭、15s ping/45s 读超时、缓冲满断开慢消费者、generation 重连隔离、连接预算 128、/healthz。集成测试覆盖慢消费者回收；45s 读超时未做真实等待验证）。
- Go 行为测试、快照 DTO 边界测试、CI 中的行为测试执行。
- 真实 Host Radar、岛屿布置/文章共享存储、作者权限和 GitHub 博客导入。
- 当前插值的生产函数回归与真实网络对照。本轮不证明全输入无过冲，也不保证冻结切线后所有相邻段速度连续。
- 岛屿上的共同动作（种下/浇水一类的双人互动）、访客权限、刷新后仍在的布置：**未实现**。
- WebGL 上下文丢失后的 Canvas 2D 回退、真实手机触控与双指手势、低端设备帧耗时：**未验证**。

独立 World Demo 与潮汐群岛 HTML 仍是原型；不能把它们的本机存储、示例文章和演示邻居记成生产多人世界。

## 3. 2026-09-09 本轮验证

- `node --test work/pure.test.mjs work/l3b.test.mjs work/l3c.test.mjs work/world.test.mjs work/tidal.test.mjs`：**32/32** 通过（含潮汐投影互逆、高度放大快于地面、近裁剪返回 null、岛屿几何确定性、岛参数与 `main.go` 数值一致）。
- `node --check` 六个前端模块：语法通过。
- `go test ./... -count=1`：**8/8** 通过（3 个既有 + 5 个新增：岛屿确定性/归属/容差、cursor 岛归属权威、presence 广播的 WS 集成）。`go vet ./...`：无诊断；`gofmt -l` 无输出。
- `go test -race ./...`：**未验证**——本机缺 CGO/C 编译器（`-race requires cgo`；设 `CGO_ENABLED=1` 后 `gcc not found`）。需在带 CGO 的 CI 执行。
- 浏览器验收 `node work/check-tidal-ui.cjs http://127.0.0.1:8090`（真实 `go run .` + 真实 Edge 无头）：**8/8 通过**，报告 `work/tidal-ui-validation.json`：三岛与 WebGL 海面（394857 点）、远景点纸页不误开阅读、静止陆地层零重绘、滚轮靠近 + 锚定（漂移 0.0035 世界单位）、靠近→纸页命中→阅读→回到海上、主题与语言持久化、390px 窄屏、双窗口真实访客（在线表与光标广播）。截图存档 `docs/design/tidal-*.png`。
- 修掉两个既有缺陷并复测：`TestSlowConsumerKicked` 无限速广播会同时踢掉健康连接（限速后连跑 16 次稳定）；前端缩放锚定只修正一帧造成 36 世界单位漂移（改为每帧修正）。
- 未验证：真实多人跨机器、真实手机、长时间帧率、WebGL 丢失回退、生产部署。

现有测试的具体限制：L3b 中“1000 条快速样本”使用相同时间戳，主要验证覆盖；L3c 单测只验证 canSend 决策，不证明 welcome 清 pending、真实 send 次数或旧回调隔离。潮汐几何测试用固定视口参数，不代表所有窗口比例下的构图。

本轮文档检查：12 份 Markdown 的本地引用及围栏结构检查通过，31 个本地链接（含引用锚点）有效；`git diff --check` 通过。未使用浏览器做 Markdown 渲染检查。历史 2026-09-05 的检查不能当成本轮结果。

## 4. 常用检查命令

在仓库根目录的 PowerShell 7 中：

```powershell
git status --short
node --check static/app.js
node --check static/world.js
node --check static/islands.js
node --check static/pure.js
node --test work/pure.test.mjs work/l3b.test.mjs work/l3c.test.mjs work/world.test.mjs work/tidal.test.mjs
go test ./...
go vet ./...
git diff --check
```

前端浏览器验收（需要真实服务端；潮汐版界面）：

```powershell
go run .                                   # 另开一个窗口
node work/check-tidal-ui.cjs http://127.0.0.1:8090
node work/shot-tidal-product.cjs http://127.0.0.1:8090   # 截图存档
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

- **L1：** 有实现；本轮仅源码/语法验证；独立迁移未测。
- **L2：** 有实现与带修正记录的练习；历史实验能运行；当前生产插值回归未补齐；本轮独立复写未测。
- **L3：** 有实现，相关测试通过；由多个 agent 协助推进，具体逐函数作者不作推断；真实页面链路和独立迁移待确认。
- **潮汐群岛前端与岛屿在场：** 本轮由 AI 完成实现与验证；用户尚未练习其中任何函数，独立复写状态**未测**。

用户说“弄好了”是有效进展反馈；验收记录同时保留证据层级。未知不等于不会，不因为能力记录尚缺而要求重做已经交付的所有代码。

## 6. 下一轮留给执行 agent

当前方向见 [14 自己的小世界](14-personal-worlds-direction.md)。下一步先和用户确定“朋友到岛上后的第一个共同动作”，再核对实时通信与坐标能力，做一次最小双人拜访（主人布置 → 朋友到访 → 双方看见彼此 → 一个共同变化 → 刷新后仍在）。

本轮 AI/用户分工与练习点（留给下一次收尾补记）：AI 完成前端移植、后端岛屿与在场、测试与文档；**尚未给用户布置练习**。建议的练习入口是 `static/pure.js` 的 `resolveIsland`/`islandContains`：给定世界坐标判断归属，反例是“两岛之间的点应归更近的一座、海上返回 null”。
