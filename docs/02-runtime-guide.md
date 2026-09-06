# PULSE 运行机制：谁调用谁，数据去了哪里

本章按你问过的问题组织。每节先沿当前代码解释，再给一个无需新增大功能的验证题。代码入口按文件和函数定位，不依赖会随编辑变化的行号。

## 1. HTML 为什么能调用 JavaScript

`static/index.html` 创建 `canvas#c`、`ws-label`、`you-label` 和指标元素。文档尾部的 `<script type="module" src="/app.js">` 加载代码。由于这些元素先出现，脚本执行到 `document.getElementById('c')` 时可以找到画布。

`app.js` 最后的 `connect()` 是立即调用；`requestAnimationFrame(draw)` 是把函数交给浏览器，等待浏览器安排一次绘制回调。`draw` 末尾再次注册自己，才形成持续绘制。

这两种写法不同：`draw` 是函数值，`draw()` 是现在调用后的结果。注册回调时先确认 API 要的是哪一种。

**检查题：** HTML 中把 `id="c"` 改名却不改 JS，会在哪一步失败？先预测，再在笔记中解释；不需要为了验证破坏主程序。

## 2. mousemove 从哪里来

不是项目自己声明了一个叫 `mousemove` 的变量。浏览器的事件系统在指针发生相应动作时创建事件对象，并派发到对应元素。

```text
鼠标移动
  → 浏览器派发 MouseEvent
  → canvas 上已注册的 listener 被调用，参数 e 由浏览器提供
  → 用画布 rect 把视口坐标转为 0..1
  → 更新 pending，并立即更新自己的 session 坐标
```

`addEventListener('mousemove', handler)` 注册事件类型与函数。它不立即执行 handler。事件名拼错通常不会产生你期望的回调，所以先核对事件名称、监听目标和注册时机。

坐标手算：画布左上角 `(100,50)`、大小 `800×400`，鼠标视口位置 `(500,250)`，归一化结果为 `(0.5,0.5)`。渲染时乘当前 CSS 宽高，而不是直接拿原视口坐标给 Canvas。

浏览器事件模型依据：[MDN addEventListener](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener)。

## 3. 为什么不在 mousemove 中直接 send

现有 listener 通过 pure.js 的 normalizePointer 换算后更新 `pending` 和自己的坐标。全局唯一的 50ms interval 使用 canSend 查看 `dirty`、连接状态和 bufferedAmount 预算，只发送最新位置。多次移动可以覆盖同一个 pending，避免把过期路径一条条排队。

自己的光点直接使用本地坐标；远端只能在消息抵达后知道新位置。20Hz 是发送采样频率，`requestAnimationFrame` 是绘制调度，二者没有必要相同。

**检查题：** 50ms 内收到 12 次鼠标事件，当前代码最多发送几个 cursor？如果每次 mousemove 都新建 interval，会留下多少长期计时器？

## 4. ServeHTTP 为什么会自己运行

`main()` 调用 `http.Handle("/ws", wsHandler{hub})`，将实现了 `http.Handler` 的对象登记到默认路由器。`http.ListenAndServe` 接收请求，HTTP 库匹配路径，再调用这个对象的 `ServeHTTP(w,r)`。

```text
浏览器 new WebSocket(.../ws)
  → HTTP Upgrade 请求
  → Go HTTP server
  → 已登记的 wsHandler.ServeHTTP
  → upgrader.Upgrade
  → 当前请求专属的 conn
```

你没有写出调用语句，是因为调用者在标准库中。与浏览器事件类似，都是先注册、以后由框架调用；HTTP Handler 和 DOM listener 的具体参数、并发规则不同。

接口契约依据：[Go net/http Handler](https://pkg.go.dev/net/http#Handler)。

## 5. 怎样找到“这条连接自己的 Session”

每次 `ServeHTTP` 成功升级后都会创建一个局部 `s := &Session{...}`。这次调用拿到的 `conn` 和 `s` 被一起传给 `writePump` 和 `readPump`。因此 `readPump(conn,s,hub)` 已经持有当前连接的身份，不需要根据浏览器传来的 ID 再查一遍。

Hub 是全局共享的在线集合，Session 是其中一条连接的运行状态。两页打开同一个网址会有两个 Handler 调用、两个 conn、两个 Session。

**检查题：** 客户端伪造 `{id:'别人的ID',type:'cursor',...}`，服务端应该用哪一个身份？为什么？

## 6. &、* 与快照复制

- `Session{...}` 构造一个结构体值。
- `&Session{...}` 取得指向这个值的指针。
- `*Session` 表示“指向 Session 的指针”这一类型；对指针 `s` 使用 `*s` 是读取它指向的值。
- `s.X = ...` 通过当前指针更新对象；若别处拿到同一指针，也会观察到变化。

`Hub.Snapshot()` 在读锁内把 `*s` 复制到返回切片，当前 X/Y/Join/ID 这些字段因此形成一个当时的快照。若返回 `[]*Session`，锁释放后序列化仍会读取可被修改的对象。

但结构体复制不是无限层级的深拷贝：如果以后加入 slice/map/pointer 字段，底层内容可能仍共享。当前 `send` channel 也会随结构体复制，只是未导出、不会进入 JSON。下一步可引入只含公开字段的 `SessionView`，不要让运行时 channel 混进传输对象。

**检查题：** 取快照后修改原 Session.X，快照.X 应怎样变化？如果字段换成 `[]Position`，为什么要重新判断？

## 7. go writePump 和 channel 做了什么

`go writePump(conn,s)` 启动独立 goroutine，当前 Handler 继续执行 `readPump`。没有 `go` 时，会先阻塞在 writer 的 channel 读取中，无法进入后面的 readPump。

```text
readPump 收到 cursor
  → 校验并修改 Session
  → Hub.Broadcast 序列化一次
  → 向在线 Session 的 send channel 尝试入队
  → 各自的 writePump 从队列取字节
  → 写自己的 WebSocket
```

channel 容量 64 表示最多缓冲 64 项，不是 64 KiB。每一项的字节长度会影响内存；快照消息随连接数增长，需要同时限制连接数量和消息大小。

当前代码先同步写 welcome，再启动 writePump，避免这两处同时普通写同一连接。后续增加 ping 时仍需明确写者。Gorilla 的普通读写契约是一个并发 reader 与一个并发 writer；不要让任意 goroutine 直接 WriteJSON。依据：[Gorilla Concurrency](https://pkg.go.dev/github.com/gorilla/websocket#hdr-Concurrency)。

## 8. 互斥锁保护什么

锁保护共享的数据与不变量，而不是“这段代码很危险所以加锁”。当前 Hub 的在线 map 和 Session 坐标更新受 `hub.mu` 保护。

读锁取得快照，写锁修改集合或位置。网络 IO 不应放在持有 Hub 锁的范围内，否则一个慢连接会拖住所有人。

当前 Broadcast 在读锁内完成非阻塞入队；注销取得写锁删除成员，再关闭 channel。后续若改成“先复制 Session 指针，锁外发送”，删除/close 与 send 之间的原有同步就会失效，必须一起重新设计。

建议未来由一个注销入口负责“从集合删除一次、关闭一次、广播 leave 一次”。写失败要关闭连接以唤醒 reader；最终注销由同一个 owner 完成，不能两个 pump 都无条件 close(send)。

## 9. 插值为什么不需要改 main.go

当前方案在**接收方**为 cursor 到达打 `performance.now()` 时间戳。插值查找的 `renderT = now - 120ms` 来自同一页面同一时钟，可以相减。

发送方的 performance.now 以发送方页面为基准，不能直接拿来与接收方的数值比较。当前方案平滑的是接收时间线，不是准确还原发送时刻；网络突发仍可能影响效果，120ms 也只是初始取舍，不保证所有环境都足够。

手算：收到 A 为 `{t:1000,x:0.2,y:0.4}`，B 为 `{t:1050,x:0.8,y:0.6}`；渲染时刻 1025，比例为 0.5，结果 `(0.5,0.5)`。

时刻晚于最新样本时保持最后位置；早于最旧样本时使用第一点；无缓冲用出生/最近已知位置。不外推，因为远端停止后不能凭空继续运动。

## 10. 现在插值结果如何进入画面

2026-09-07 的实际链路为：

```text
cursor 到达 → appendPositionSample 裁剪历史 + 更新 s.x/s.y 最后已知位置
  → draw 对自己选即时 s，对远端调用 samplePosition
  → p.x/p.y 乘 CSS 尺寸 → ctx.arc
```

旧版本曾计算 p 却仍画旧坐标；该接线已完成，不再作为待办。自己的光环仍使用本地即时坐标。

当前 samplePosition 在相邻两点间执行 Hermite，tangentAt 根据邻居时间差估速，转折或平坦处归零。切线乘段时长后交给 hermite；s.playing 按段起点时间戳缓存切线，因此 samplePosition 会修改 session 的渲染状态，不是纯函数。

冻结的是当前段切线，不是把整份队列冻结。后续段仍可能用新邻居估速，不能直接宣称全局速度连续；转折归零也不等于所有单调输入都不会过冲。缓冲按追加时的时间/条数裁剪，无缓冲时回退最近已知位置。

static/pure.js 当前包含无 DOM/时钟依赖的 normalizePointer、appendPositionSample、canSend；appendPositionSample 会原地修改 buf，因此“可独立测试”不等于“所有导出都无副作用”。window.PULSE.state 也仍是可变引用，并非不可修改的只读快照。

work/interpolation-lab.mjs 包含历史算法副本，不能证明当前主程序回归通过。后续需要对真实生产入口做固定时间测试，并在两页观察结果是否被实际绘制；只测计算函数不能代替页面验证。

## 11. Go 指标不是所有内存的别名

现有 `m.Alloc` 表示当前堆对象分配字节，`m.Sys` 表示 Go runtime 从操作系统取得的内存字节口径。它们不等于进程 RSS，更不包含所有内核 socket 成本。现有除数 1048576 对应 MiB，页面使用 MB 标签应在指标课一并校准。

给每个指标写清：来源、单位、统计窗口、是否累计、归零条件。不要把 `dropped` 累计计数直接称作“每秒丢包”，也不要把 P99 网络延迟与 120ms 插值延迟混成一个数。

字段依据：[Go runtime.MemStats](https://pkg.go.dev/runtime#MemStats)。
