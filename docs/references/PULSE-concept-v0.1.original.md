# PULSE

> **See the server breathe.**  
> 一个把“实时在线用户 + 整台服务器的公网访问活动 + 高并发性能”直接变成视觉体验的个人网站。

**版本**：v0.1 概念与技术设计  
**目标机器**：Linux / 2C4G / 单机  
**核心目标**：访客一进站就能看到“此刻真的有人、程序或扫描器正在碰这台服务器”，同时把高并发、低内存、低延迟本身做成产品的一部分。

---

## 1. PULSE 到底是什么

PULSE 不是后台监控面板，也不是聊天室。

它同时展示两种“生命”。

### 1.1 Site Presence：站内实时存在感

有人真正打开你的网站后，会产生一个匿名 Session，例如：

```text
visitor-a91f
```

这个 Session 在页面里会有一个实时节点，可以同步：

- connect / disconnect
- 当前页面
- focus / blur
- idle / active
- 低频采样后的 cursor
- click / scroll pulse

不需要账号，也不保存输入内容。

前端看到的不是：

```text
在线人数：17
```

而是：

```text
           ●
      ·          ●

  ·        YOU ◎       ·

       ●          ·
```

每个点都代表一个真实长连接。

### 1.2 Host Radar：整台主机的公网活动

PULSE 不只观察 80/443。

如果公网 IP 上有流量打到：

```text
22
80
443
3000
5432
8080
...
```

Host Sensor 会把它转成实时事件。

例如：

```text
203.0.113.x
      │
      ├────────▶ :443   established
      ├────────▶ :22    syn attempt
      └────────▶ :3306  refused / no service
```

即使这个来源从未打开 PULSE 网页，它仍然可以出现在 Host Radar 中。

因此 PULSE 展示的是：

> 这个网站里的访客 + 这台服务器此刻在公网中被怎样“触碰”。

---

## 2. 第一次打开应该是什么感觉

访客进入：

```text
https://yourdomain.com
```

先看到：

```text
CONNECTING...
CONNECTED

session visitor-8f31
```

自己的点从中央出现。

随后发现周围还有其他在线 Session。

页面角落：

```text
LIVE
──────────────────────
Humans            12
Synthetic      10,000
Host events/s    3,218

SERVER
2C / 4G

RSS             216 MB
CPU              23 %
P99             11.4 ms
```

突然左侧有一道线闪过：

```text
scanner-7d2a ─────▶ :22
```

再一条：

```text
crawler-18af ─────▶ :443
```

再一条：

```text
198.51.100.x ─────▶ :8080
```

正式版本中这些不是预制动画，而是来自真实网络/内核事件。

---

# 3. 三种视图

## 3.1 PRESENCE

只看访问 PULSE 网站的人。

每一个 Session 是一个点：

```text
connect       点出生
disconnect    点消散
cursor        轨迹
click         pulse
route change  从一个页面区域移动到另一个区域
idle          亮度下降
focus         恢复
```

## 3.2 HOST RADAR

观察整台主机。

中央是 Server：

```text
                    :22
                     ○

          :8080 ○   ◎   ○ :443
                  SERVER

                 ○ :3000
```

公网来源从外围出现：

```text
source
  │
  └──────────────▶ port
```

事件可以区分：

```text
SYN attempt
Established
Rejected
UDP
HTTP
WebSocket
```

允许公开显示：

- 匿名 source id
- 被访问端口
- TCP/UDP
- SYN / Established / Closed / Refused 等状态
- 粗粒度事件时间
- 可选的粗粒度国家/地区统计

默认禁止公开：

- 完整公网 IP
- Cookie
- Authorization
- Query 参数
- Request Body
- SSH 用户名
- 数据包 Payload

PULSE 是网络可视化，不是把访客隐私挂到墙上。

## 3.3 SYSTEM

把两个世界叠起来：

```text
Internet
   │
   │ TCP :443
   ▼
Gateway
   │
   ├──────── WebSocket ─────── visitor-a91f
   ├──────── WebSocket ─────── visitor-92bc
   └──────── HTTP ──────────── visitor-18ef

scanner-7d2a ───▶ :22
bot-ff21     ───▶ :8080
```

这是最终最“牛逼”的视图。

---

# 4. 高并发直接变成视觉效果

PULSE 提供：

```text
STRESS
```

Synthetic 必须明确标记，绝不能伪装成真人：

```text
REAL       ●
SYNTHETIC  ·
```

点击：

```text
10K
```

页面开始出现 10,000 个 synthetic sessions。

再点：

```text
50K
```

前端逐渐变成大型密度场。

同时指标实时变化：

```text
Connections
12 → 50,012

RSS
216 MB → 684 MB

Memory / conn
9.3 KB

Event rate
3.2K/s → 181K/s

P99
11.4 ms → 24.1 ms
```

所以“2C4G 能扛多少”不是 README 中一句话，而是访客能亲眼看到的东西。

---

# 5. 核心优化目标

```text
Concurrent Connections   ↑
Events / Second          ↑
Fanout / Second          ↑

Memory / Connection      ↓
CPU / Event              ↓
Allocations / Event      ↓
P99 Event Latency        ↓
Dropped Critical Events  = 0
```

---

# 6. 总体架构

```text
                              Browser
                                 │
                    ┌────────────┴────────────┐
                    │                         │
               Presence WS              Live Data WS
                    │                         │
                    └────────────┬────────────┘
                                 ▼
                       ┌──────────────────┐
                       │    Go Gateway    │
                       │ session/protocol │
                       │ backpressure     │
                       └────────┬─────────┘
                                │
          ┌─────────────────────┼──────────────────────┐
          ▼                     ▼                      ▼
  Presence Engine         Event Engine            Metric Engine
                                ▲
                                │ Unix Socket / Ring
                         ┌──────┴───────┐
                         │ Host Sensor  │
                         └──────┬───────┘
                                │
                         Linux networking
                                │
                  22 / 80 / 443 / 8080 / ...
```

---

# 7. Host Sensor 为什么单独进程

公开 Web Server 不应该以 root 权限运行。

建议：

```text
pulse-gateway
```

以普通低权限用户运行。

另外：

```text
pulse-sensor
```

只负责读取内核/网络事件。

Sensor 通过 Unix Domain Socket 向 Gateway 输出已经清洗、匿名化、结构化的事件。

---

# 8. Host Sensor 实现路线

## Phase A：先跑起来

第一版可以从低层 packet capture 开始，例如：

```text
AF_PACKET / libpcap 类方案
```

只观察必要的包头：

```text
TCP SYN
TCP FIN/RST
UDP metadata
```

不保存 payload。

由五元组：

```text
src ip
src port
dst ip
dst port
protocol
```

构造短生命期 Flow。

优点：

- 实现快
- 可以看到访问“没有服务监听”的端口
- 能捕捉扫描行为

## Phase B：eBPF

正式版本迁移到 eBPF。

### Packet / Attempt

如果需要看到：

> 有人碰了一个根本没人监听的端口

传感点必须靠近 ingress：

```text
XDP / TC ingress
```

只提取：

```text
timestamp
src/dst
port
protocol
TCP flags
packet length
```

### Socket / Connection State

如果需要知道：

```text
SYN_RECV
ESTABLISHED
FIN_WAIT
CLOSE
RESET
```

则使用 socket/TCP 状态相关 hook/tracepoint。

Event Engine 再把：

```text
packet attempt
+
socket state
```

合成：

```text
ConnectionAttempt
ConnectionEstablished
ConnectionClosed
ConnectionRejected
```

---

# 9. IP 隐私

完整公网 IP 不应该直接显示给其他访客。

服务器内部可短暂使用真实 IP 做 Flow 聚合，但公开前：

```text
raw ip
   ↓
HMAC(server secret, ip + time bucket)
   ↓
visitor-a91f
```

建议每日轮换 salt。

同一来源当天可以形成连续轨迹，但第二天无法稳定追踪。

---

# 10. Presence Engine

站内 Session 不需要用户表。

```text
Session {
    id
    connection
    page
    x
    y
    activity
    lastSeen
}
```

Session ID 是临时随机 ID。

断线后 TTL 到期即结束。

不需要：

```text
User
Password
Profile
ORM
```

---

# 11. Cursor 与 Activity 同步

浏览器原始鼠标事件可能数百 Hz，不能全部上传：

```text
mousemove × N
     ↓
sample 20Hz
     ↓
quantize
     ↓
delta encode
```

屏幕坐标可以量化为：

```text
uint16 x
uint16 y
```

而不是 JSON float。

---

# 12. AOI / Interest Management

如果有 50,000 Sessions，每人 20Hz，绝不能全广播。

分层：

```text
附近 100 人
    ↓
完整实时轨迹

同一页面 2,000 人
    ↓
降低频率 / 聚合

其他页面 40,000 人
    ↓
密度场 / aggregate counters
```

服务端发送：

```text
SESSION_DELTA
AREA_AGGREGATE
```

而不是永远发送每个人。

---

# 13. WebSocket Server

首版后端：

```text
Go
```

先用 Go runtime 的标准网络模型建立 baseline，不一开始重写 epoll。

路线：

```text
naive Go
   ↓
benchmark
   ↓
profile
   ↓
找到真实瓶颈
   ↓
逐层替换
```

可能优化：

```text
per-connection buffer
        ↓
shared slab / buffer pool

string session id
        ↓
uint32 / uint64

JSON
        ↓
binary protocol

individual timer
        ↓
timing wheel

object event
        ↓
packed struct / SoA

unbounded send queue
        ↓
bounded queue + drop policy
```

---

# 14. Binary Protocol

实时 Data Plane 不使用 JSON。

基础帧：

```text
┌─────────┬─────────┬─────────┬────────────┐
│ version │ type    │ flags   │ payloadLen │
│ 1 byte  │ 1 byte  │ 2 byte  │ 4 byte     │
└─────────┴─────────┴─────────┴────────────┘
```

消息：

```text
SESSION_JOIN
SESSION_LEAVE
SESSION_DELTA
HOST_EVENT
HOST_EVENT_BATCH
AREA_AGGREGATE
METRIC_BATCH
STRESS_STATE
```

高频事件使用 batch，而不是一事件一帧。

---

# 15. Event Engine

```text
Producer
   ↓
bounded ring
   ↓
normalize
   ↓
classify
   ↓
aggregate
   ↓
fanout
```

所有 queue 都必须有上限。

优先级：

```text
P0  critical state / established / closed
P1  port attempt / session join / route
P2  cursor / activity / flow stats
P3  high-frequency visual packet
```

压力出现时：

```text
P3 sample
P2 coalesce
P1 preserve
P0 never intentionally drop
```

---

# 16. 前端架构

```text
TypeScript
Vite
React（只做 UI Shell）
```

实时绘制：

```text
Prototype: Canvas 2D
Production: WebGPU + WGSL
```

React 只负责：

```text
toolbar
mode switch
details panel
settings
metrics
```

以下数据不能进 React State：

```text
50k session positions
100k events
particle trails
host pulses
timeline hot data
```

---

# 17. 浏览器线程模型

```text
                  Main Thread
                      │
             input / lightweight UI
                      │
       ┌──────────────┼──────────────┐
       ▼              ▼              ▼
 Protocol Worker  Event Worker   Render path
       │              │
       └──────┬───────┘
              ▼
       SharedArrayBuffer
              │
              ▼
          GPU Buffers
```

核心原则：

> 主线程不是事件处理器。

---

# 18. GPU 数据布局

高频热对象不使用大量 JS class：

```text
positionX: Float32Array
positionY: Float32Array
velocityX: Float32Array
velocityY: Float32Array
state: Uint32Array
type:  Uint8Array
```

即 SoA。

批量上传 GPU。

---

# 19. Host Radar 视觉分类

```text
Human browser      明亮实体
Known crawler      小型稳定轨迹
Unknown bot        普通事件
Scanner-like       快速多端口 burst
Synthetic          空心/虚线实体
```

Scanner 分类只用可解释规则，例如：

```text
同一匿名来源
+ 短时间命中多个 destination ports
+ SYN dominant
```

不要宣称“这是黑客”。

---

# 20. Ports Live

```text
PORTS — LIVE
────────────────────────────

443  ███████████████   328/s
80   ████               81/s
22   ██                 23/s
8080 █                  11/s
3000 ▏                   2/s
3306 ▏                   1/s
```

点击某端口可以只看该端口的实时事件。

---

# 21. Ghost 历史

```text
● LIVE
◌ GHOST
```

最近 15 分钟/1 小时/24 小时可重放匿名轨迹。

必须永远明确区分：

```text
LIVE
HISTORY
SYNTHETIC
```

不伪造在线人数。

---

# 22. Stress Engine

压测程序独立：

```text
pulse-loadgen
```

可以模拟：

```text
connections
cursor activity
route change
join/leave churn
slow consumer
burst fanout
```

例如：

```text
pulse-loadgen   --connections 50000   --event-rate 10   --slow-percent 1
```

正式 benchmark 最好从另一台机器发压，否则测到的是 Server + Load Generator 总负载。

---

# 23. Slow Consumer

每连接必须有 send budget，例如：

```text
64 KB
```

超过后：

```text
cursor deltas
→ coalesce

visual packets
→ drop

critical state
→ preserve

严重落后
→ disconnect
```

绝不能无限增长 send queue。

---

# 24. 2C4G 性能目标

以下是工程挑战目标，不是承诺。

## v0.1

```text
5k WebSocket connections
5k events/s
RSS < 500 MB
```

## v0.5

```text
25k connections
50k internal events/s
RSS < 1 GB
P99 realtime delivery < 100ms + RTT
```

## v1 Challenge

```text
50k–100k idle/light connections
high fanout / high event rate
explicit backpressure
```

重点记录：

```text
App memory / connection
Kernel memory / connection
CPU / 10k sessions
events/s/core
fanout/s/core
P99
GC
allocations/event
```

只看 Go RSS 不完整，Linux socket 也会占 kernel memory。

---

# 25. Benchmark 页面

公开真实 benchmark：

```text
MACHINE
2 vCPU / 4 GB

LIVE
Real sessions           14
Synthetic           25,000
Host event rate       3.8k/s

PROCESS
RSS                    612 MB
Heap                   351 MB

EFFICIENCY
App bytes/session      9.2 KB

LATENCY
P50                     8.1ms
P95                    17.4ms
P99                    29.2ms
```

并明确标记 Synthetic。

---

# 26. 持久化

PULSE 是实时系统，不把所有 Event INSERT 数据库。

```text
最近 15min raw-ish anonymous events
→ memory ring

最近 24h
→ time bucket aggregate

长期
→ benchmark result / daily aggregate
```

冷数据可用 SQLite。

实时热路径不依赖 ORM/数据库。

---

# 27. 技术栈定稿

## Backend

```text
Go
Linux
WebSocket Binary
Unix Domain Socket
pprof
runtime/metrics
```

## Host Sensor

首版：

```text
AF_PACKET / packet-header capture
```

后期：

```text
eBPF
XDP / TC ingress
socket/TCP state hooks
BPF ring buffer
```

## Frontend

```text
TypeScript
Vite
React — UI shell only
Canvas 2D — prototype
WebGPU + WGSL — production
Web Worker
SharedArrayBuffer
```

## Storage

```text
bounded in-memory ring
SQLite for cold aggregates / benchmarks
```

## Deploy

```text
Linux
systemd
Caddy / Nginx
```

---

# 28. 安全边界

Host Sensor 是高权限组件。

必须：

- Gateway 不以 root 运行
- Sensor 与 Gateway 分进程
- Sensor 只输出白名单字段
- 默认不捕获 Payload
- 默认不长期记录完整 IP
- 不公开 SSH/数据库敏感信息
- Host Event public feed 强限频
- Stress 只有管理员能触发
- loadgen 只允许压 PULSE 自身或显式配置的本机服务

---

# 29. 开发路线

## Phase 0：视觉原型

先用模拟事件验证：

- 页面是否一眼“活着”
- Host Radar 是否比普通 Dashboard 有冲击力
- Port scan burst 是否好看
- 10K/50K synthetic 是否有视觉冲击
- 信息是否太乱

如果 Demo 看起来都不想继续看，立即停。

## Phase 1：整台服务器真的活起来

只实现：

```text
Host Sensor
→ TCP SYN
→ destination port
→ anonymous source id
→ Gateway
→ Browser
```

成功标准：

另一台机器：

```bash
curl server:8080
```

即使 8080 没服务，PULSE 页面也立即出现：

```text
visitor-xxxx ───▶ :8080
```

再：

```bash
ssh server
```

看到：

```text
visitor-yyyy ───▶ :22
```

## Phase 2：Site Presence

加入：

```text
WebSocket session
join / leave
cursor
click
route
idle
```

## Phase 3：Event Engine

替换为：

```text
bounded ring
batch
binary protocol
aggregation
backpressure
priority
```

## Phase 4：WebGPU

目标：

```text
50k visible entities
100k event particles
60 FPS
```

## Phase 5：eBPF

加入：

```text
connection state
retransmit
flow lifetime
socket metrics
```

Host Radar 从“谁在敲端口”升级成：

> 这台服务器上的真实网络连接正在怎样活着。

## Phase 6：极限性能

正式挑战：

```text
C10K
C50K
C100K
```

研究：

```text
memory / connection
socket memory
Go GC
buffer pool
timing wheel
event sharding
fanout
slow consumers
binary encoding
syscall count
epoll behavior
```

---

# 30. 最终首页应该传达什么

不是：

> Welcome to my personal website.

而是：

```text
PULSE

This is happening right now.

14 humans
3,812 network events / sec
25,000 synthetic connections

running on
2 CPU / 4 GB RAM
```

下面就是整个“活着的服务器”。

如果有人扫端口，他会出现。

如果有人进入网站，他自己会出现。

如果另一个真实用户在线，双方能看到彼此的匿名活动。

如果你把服务器压到 50K 长连接，整个空间会真的变密。

所以 PULSE 的核心不是：

> “监控我的服务器。”

而是：

> **把一台服务器此刻正在经历的一切，变成任何人打开网页都能感受到的实时空间。**
