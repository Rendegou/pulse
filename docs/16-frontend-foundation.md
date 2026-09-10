# PULSE 前后端地基：Vue 外壳、独立引擎、Go 服务

日期：2026-09-10。迁移前源码基线 `cb28b32`，包含已经提交的 G0 保存一致性。本文是本轮重构的维护与学习说明；产品功能顺序仍以 [07](07-ai-assisted-roadmap.md) 为准。

## 1. 这次为什么选择 Vue

原来的 HTML + JavaScript + CSS 本身没有问题。源码已经使用 ES Modules，也已经有主题 token、字典、投影纯函数和独立 world 模块。这些成果应当保留。

真正的压力在原 `static/app.js`：约 900 行同时负责网络、动作等待、远端插值、手工创建 DOM、文案刷新、诊断和全局监听。增加个人岛、编辑草稿、保存错误或权限时，每次都需要记得调用多个 update/render 函数；组件卸载也没有统一清理入口。

本轮采用 **Vue 3 + Vite + JavaScript + 现有 Go/WebSocket**。

- **Vue** 管理界面。按钮是否禁用、阶段文字、主题和语言随状态派生，模板与行为放在同一个 `.vue` 文件，接近现有 HTML 的阅读方式。
- **Vite** 是开发与构建工具，负责 `.vue` 编译、开发热更新和带哈希资源打包。它不是业务后端。
- **React** 同样可以完成本项目，但当前没有必须依赖的 React 组件或团队约束；为了这批已有 HTML 接口，Vue 是更平缓的迁移选择。
- **Next.js** 是基于 React 的应用框架，增加页面路由、服务端渲染和服务端组件等能力。当前主体是必须在浏览器运行的 Canvas/WebGL 与 WebSocket，已有 Go 后端，暂时没有引入它的实际收益。未来公开文章确实需要搜索收录、分享元信息和服务端页面时再单独评估。

框架不会自动让海浪更快。性能关键是 Vue 不接管每颗粒子、不深度代理远端缓冲、不逐帧重建 UI。Vue 官方也建议大型外部状态通过浅层响应式边界接入。[Vue 响应式边界](https://vuejs.org/guide/extras/reactivity-in-depth.html#integration-with-external-state-systems)、[Next.js 文档](https://nextjs.org/docs)、[Vite 后端集成](https://vite.dev/guide/backend-integration)。

## 2. 现在的目录与职责

```text
pulse/
├─ frontend/
│  ├─ index.html                 首屏防闪、应用挂载点
│  ├─ vite.config.js             开发代理与构建输出
│  ├─ src/
│  │  ├─ main.js                 Vue 入口
│  │  ├─ App.vue                 创建应用实例、提供上下文、挂载与卸载
│  │  ├─ components/
│  │  │  ├─ WorldCanvas.vue      三层画布及引擎标签空容器
│  │  │  ├─ WorldHud.vue         顶栏、导航、相机控件、帮助
│  │  │  ├─ GardenPanel.vue      阶段、浇水按钮、命中区、最近照料
│  │  │  └─ DiagnosticsPanel.vue 连接指标、真实事件及 fixture 标识
│  │  ├─ engine/
│  │  │  ├─ world.js            createWorld 实例、投影绘制、手势、GPU
│  │  │  ├─ islands.js          固定示例岛及几何缓存
│  │  │  └─ pure.js             现有投影/几何/缓冲/预算纯函数
│  │  ├─ realtime/
│  │  │  ├─ connection.js       建连、重连、发送预算、销毁
│  │  │  ├─ runtime.js          协议消费与场景/界面的业务装配
│  │  │  ├─ interpolation.js    保留已学过的 Hermite 与冻结切线
│  │  │  └─ presence.js         远端指针与脉冲绘制、主题缓存
│  │  ├─ garden/watering.js     请求号、等待、冷却与错误状态机
│  │  ├─ ui/                   上下文、偏好、调色板与中英字典
│  │  └─ styles/               保留原 tokens.css 与 style.css
│  └─ tests/                   连接/动作生命周期及生产插值回归
├─ static/
│  ├─ README.txt               保留 Go embed 资源目录
│  └─ dist/                    自动生成，忽略提交，禁止手改
├─ main.go                     服务装配、健康检查、指标与 HTTP 注册
├─ islands.go                  权威岛参数与归属几何
├─ hub.go                      Session、在线表、广播与队列
├─ protocol.go                 协议结构及输入校验
├─ websocket.go                升级、读写泵、心跳、动作处理
├─ sensor.go                   主机事件接入与限流
├─ garden.go                   G0 权威植物状态与串行候选落盘
├─ web.go                      内嵌前端与资源缓存策略
├─ *_test.go                   原 Go 测试与静态资源测试
├─ package.json / package-lock.json
└─ .github/workflows/deploy.yml
```

后端继续使用同一个 `package main`，本轮按真实职责拆文件，没有预先堆 controller/service/repository 空目录。现有 Hub/Session/读写泵的调用关系、锁、协议和 G0 保存语义都保留。等 G1 存储与权限真正出现模块边界，再考虑 `internal/` 包；届时根据依赖方向拆，不只按文件大小拆。

## 3. 三种状态，三种所有者

**服务端权威业务状态**：植物 care/version/last 来自 welcome 与 plant。Vue 和引擎不能擅自增加 care；将来 owner、布置、权限也遵循这条规则。

**Vue 界面状态**：`App.vue` 的浅层 view 保存选中岛、是否靠近、连接状态、低频相机快照、照料等待、诊断与提示。修改嵌套快照时整体替换，例如 `view.watering = next`；不能直接改其中字段后期待浅层响应式替你追踪。只有消费该字段的组件需要更新。

**引擎高频状态**：粒子数组、相机阻尼、RAF、GPU buffer、远端样本 Map 和逐帧插值都留在普通 JavaScript 闭包中。相机读数及命中区约每 180ms 更新一次界面；诊断每秒一次；指针发送最多 20Hz。这个频率划分沿用既有预算，不宣称本轮完成低端设备性能认证。

DOM 所有权也必须明确：Vue 拥有 canvas 元素和 `labels` 空容器；引擎拥有 labels 内部的投影标签。以后不能同时用 Vue `v-for` 和引擎 `appendChild` 管同一批子节点。

## 4. 从一次点击理解调用链

```text
GardenPanel 的点击
→ runtime.waterPlant()
→ watering.request(plantId)
→ connection.send(water)
→ Go websocket.readPump
→ Garden.Water：候选 → 保存成功 → 发布
→ water_result：关联当前请求，解除等待/进入冷却/提示错误
→ plant：更新权威快照，驱动阶段文字与生长动画
```

两条服务端下行消息职责不同。`plant` 可能来自别人，不能替本地等待中的另一笔请求确认成功。`water_result` 必须匹配当前 requestId；过期回执和重复确认不能延长冷却。网络超时只说明结果未确认，不等于服务端一定没有保存。

当前 G0 仍按连接去重，重连后持续幂等不是本轮新增能力。持久动作收据和按用户限流留在 G2。

## 5. 卸载链比“用了组件”更重要

`App.vue onBeforeUnmount → runtime.dispose()`：

1. connection 撤销当前连接所有权，再关闭 socket，并取消重连定时器。旧 open/message/close 都先确认自己仍是当前连接。
2. watering 取消确认超时与冷却回调。
3. runtime 清理 20Hz 发送、每秒指标和 Toast 定时器。
4. world 取消 RAF、移除手势/resize/可见性/减少动画订阅、释放指针捕获、删除 WebGL program/buffer 并清空标签。
5. preferences 解除系统主题订阅；Vue 自动停止组件 watch。

这使日后路由切换与热更新有明确资源边界。不要在模块顶层直接启动永久 setInterval 或 WebSocket，也不要靠刷新整个页面作为销毁方法。

## 6. 本地开发与生产构建

使用 Node 22.12+（本轮实际 22.19.0）与 Go 1.25。依赖锁定在根 package-lock.json；`.npmrc` 将项目 npm 缓存放到已忽略的 `.tools/npm-cache`，不修改系统 npm 配置。

首次安装：

```powershell
npm ci
```

开发开两个终端：

```powershell
# 终端 A：Go 业务服务，默认 127.0.0.1:8090
go run .
```

```powershell
# 终端 B：打开 Vite 输出的开发地址；改 Vue/JS/CSS 即时更新
npm run dev
```

开发请求 `/ws`、`/healthz`、未来 `/api` 由 Vite 同源代理给 Go。Go 默认 Origin 校验仍有效，不为开发关闭 Origin 检查或开启任意 CORS。

验证正式打包版本：

```powershell
npm test
npm run build
go test ./... -count=1
go vet ./...
go build -o .tools/pulse.exe .
./.tools/pulse.exe
```

`npm run build` 先生成 `static/dist`，Go 编译再把它内嵌。**构建后若 Go 进程还在跑旧二进制，必须重启才能看到新页面。** 未构建时访问 Go 首页会返回明确 503 提示，API 与 Vite 开发仍可单独启动。

支持 `PULSE_ADDR` 覆盖监听地址，默认不变；检查时可使用另一回环端口，避免占用已有开发服务。`PULSE_GARDEN_STATE` 继续指定花园数据文件。测试应使用独立路径，不能覆盖自己的游玩数据。

CI 现在依次执行 npm ci → 前端测试 → Vite 构建 → Go race 测试/vet → Linux 无 CGO 构建 → 原来的上传/重启。PR 另有独立检查工作流；本轮只修改配置，未声称远端 CI 已执行。生产只需要 Go 二进制，未新增 Node 服务。HTML 使用 no-cache，现存哈希资源使用 immutable，未知文件与未知路由仍返回 404。

如需避开已有 Go 进程，设置 PULSE_BACKEND 为另一个 Go 回环地址后启动 Vite；npm run preview 也使用同一代理。开发端口以实际打印地址为准。

## 7. 下一轮怎么扩展

- 增加中英文字：改 `frontend/src/ui/i18n.js` 两份字典，组件使用 copy/list，不在组件内拼两套硬编码 UI。
- 调颜色：先改 `styles/tokens.css`，Canvas 与 UI 共用主题；不要逐帧 getComputedStyle。
- 增加布置面板：在 components 增加有明确任务的组件；草稿与保存动作放到对应功能模块，不能让组件自己开第二条 socket。
- 增加协议：Go 的 protocol.go 定义与校验，websocket.go 消费，runtime.js 路由；有独立状态机时再拆新模块并测试。
- 稳定个人岛/邀请 URL：先做 G1 的身份和服务器动态岛数据，再接 Vue Router。当前没有提前放一个没有实际路由的 Router 或 Pinia。
- TypeScript：本轮保留熟悉的 JavaScript，避免同时重写绘制数学与语法。G1 确定动态 island/object 协议后，优先为协议与编辑草稿引入类型检查；框架迁移不等于已有完整静态类型保障。
- world.js 仍是较大的独立渲染模块。此次先改为实例化和可销毁；下一次只有相机或水面需要独立替换/测试时，再从明确接口提取，不在这次迁移中改海浪算法。

仍未实现：稳定账户/个人岛、权限、真实邀请、持久布局、跨设备恢复。这次工作是可维护性重构，不能把目录变化算成 G1 完成。

## 8. 验证与历史工具

本轮结果记录在 [05](05-progress-and-validation.md)。新的前端生命周期测试直接导入生产 connection/watering/interpolation；旧投影/预算/几何测试迁移 import 后继续执行。

旧 `work/check-garden-ui.cjs` 等浏览器脚本依赖原来的 `window.PULSE` 和公开 JS 文件路径，属于迁移前的历史工具，不能继续作为这版页面的通过证明。现在生产不暴露可变调试状态；开发模式才有 PULSE_WORLD 诊断快照。本轮浏览器检查使用真实 Go 构建页和实际控件，不用重新执行旧脚本代替验证。

## 9. 只留一个学习练习（约 20–30 分钟）

入口：`frontend/src/garden/watering.js` 的 `result()`；参照 `frontend/tests/lifecycle.test.mjs`。

任务：自己写一个测试，模拟“请求 A 超时 → 请求 B 发出 → A 的成功回执迟到 → B 仍保持等待 → B 保存失败后可重试”。在独立测试文件里写，不改空现有函数，不阻塞产品推进。

契约：只有当前 requestId 可以改变等待；超时不修改植物；保存失败清除等待并允许重试。

反例：若删掉 result 开头的 requestId 判断，迟到 A 会提前解锁 B，测试应失败。

验收：测试通过，并能指出点击、请求、回执、Vue 按钮之间的四个调用点。第一级提示：复用 fakeClock 的思路，每次 request 生成不同 id，断言每一步的 busy 和 requestId；先不要查 UI。

本轮 AI 完成实现与检查；用户读懂与独立迁移尚未验收。

## 10. 继续审查后的实际加固

用户继续要求检查架构后，本轮补了以下具体边界：

1. **公开数据与运行状态分开**：SessionView 只含 id/wx/wy/z/island/join。Hub.Snapshot 不再复制带冷却、去重、连接和原子字段的整个 Session。公开字段受 Hub 锁保护，动作字段归 readPump 独占；welcome/join 的 JSON 外形不变。
2. **连接预算先占位**：有界 slots 同时计算正在握手和在线连接，握手失败与离场都归还，避免先 Count 再登记的并发窗口突破 128 限制。
3. **构造没有隐藏 IO**：main 先 NewGarden 并处理错误，再传入 NewHub。Hub 不读磁盘、不 log.Fatal；连接测试使用临时花园，不读自己的游玩数据。
4. **慢连接回收一致**：点对点 water_result 和广播都在队列满时关闭慢连接，每个 Session 最多安排一次异步关闭。对已注销会话发结果直接忽略，避免写已关闭 channel。
5. **减少重复配置**：前端发送预算复用同一常量，岛名复用 islandIndex，诊断仅保留显示端口的时间数组，其他端口仍计入总事件速率。

新增测试覆盖公开快照隔离及并发私有状态、8 路握手争用 2 席、失败握手归还、离场后重入、已注销会话的迟到回应。本机普通测试不能代替 race；Linux CI 已配置 race，远端执行等待实际推送授权。

后续按功能触发：G1 引入独立存储接口和动态岛协议，G2 明确岛订阅/在线身份，G3 引入编辑草稿与版本冲突。服务级优雅停机、HTTP 路由装配与 sensor 生命周期仍可进一步收敛，但不为目录好看预建多个服务或通用框架。
