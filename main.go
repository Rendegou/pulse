// PULSE — 最小真实骨架。
//
// 页面上的每个点都是一个真实的 WebSocket 长连接：
// 开两个标签页就是两个点，关掉一个，另一个看着它消散。
// 底部指标来自 Go 进程的真实内存。不模拟任何东西。
//
// 子命令：无。单文件，故意保持很小，方便通读。
package main

import (
	"bufio"
	"context"
	"crypto/rand"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"math"
	"net"
	"net/http"
	"os"
	"runtime"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

//go:embed static
var staticFS embed.FS

// ---------- Session ----------

// Session 是一个站内访客的真实长连接。没有用户表、没有数据库：
// 断线即消散。
type Session struct {
	ID   string  `json:"id"`
	X    float64 `json:"x"` // 出生位置，0..1 归一化坐标
	Y    float64 `json:"y"`
	Join int64   `json:"join"` // unix 毫秒

	send chan []byte // 有界发送缓冲：满了说明是慢消费者，由 Broadcast 断开整条连接

	conn *websocket.Conn // 当前连接；写失败/心跳超时/慢消费都通过关闭它来终结会话

	// 脉冲限频令牌桶（只允许 readPump 在 hub.mu 下访问）：
	// 平均 2 次/秒，上限 4（突发），防止客户端无限扩散事件。
	pulseTokens float64
	pulseLast   time.Time
}

// ---------- Hub ----------

// Hub 维护全部在线 Session，负责 join/leave/metrics 广播。
type Hub struct {
	mu       sync.RWMutex
	sessions map[*Session]bool
	dropped  atomic.Uint64 // 因慢消费被丢弃的消息数
	eventSeq atomic.Uint64 // 脉冲事件的单调序号（eventId 来源）
}

// NewHub 创建一个空的在线连接表。
func NewHub() *Hub {
	return &Hub{sessions: make(map[*Session]bool)}
}

// Count 返回当前在线连接数。
func (h *Hub) Count() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.sessions)
}

// Broadcast 把一条消息发给所有连接。
// 发送缓冲满 = 慢消费者：不再静默丢消息（漏掉 join/leave 会让对方状态永久失真），
// 而是关闭该连接，让它重连后通过 welcome 快照重建一致状态。
func (h *Hub) Broadcast(v any) {
	data, err := json.Marshal(v)
	if err != nil {
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for s := range h.sessions {
		select {
		case s.send <- data:
		default:
			h.dropped.Add(1)
			// 异步关闭：Broadcast 持读锁，不在锁内做阻塞 IO
			go func(c *websocket.Conn) { _ = c.Close() }(s.conn)
		}
	}
}

// Snapshot 返回当前在线列表的值拷贝（给新连接的 welcome 用）。
// 必须是拷贝而不是指针：调用方会在锁外序列化这些 Session，
// 而 cursor 更新随时在写它们的 X/Y——拷贝回来，锁外读才安全。
func (h *Hub) Snapshot() []Session {
	h.mu.RLock()
	defer h.mu.RUnlock()
	out := make([]Session, 0, len(h.sessions))
	for s := range h.sessions {
		out = append(out, *s)
	}
	return out
}

// ---------- 消息 ----------

// 服务端 → 浏览器的消息。数据面先用 JSON（文档 Phase 2 之前允许），
// 二进制协议是后面的手写课程。
type welcomeMsg struct {
	Type     string    `json:"type"`
	You      string    `json:"you"`
	Sessions []Session `json:"sessions"`
}
type joinMsg struct {
	Type    string  `json:"type"`
	Session Session `json:"session"`
}
type leaveMsg struct {
	Type string `json:"type"`
	ID   string `json:"id"`
}
type metricsMsg struct {
	Type         string  `json:"type"`
	Conns        int     `json:"conns"`
	HeapMB       float64 `json:"heap_mb"`       // Go heap 实际占用
	SysMB        float64 `json:"sys_mb"`        // Go 向 OS 申请总量
	Dropped      uint64  `json:"dropped"`       // 慢消费丢弃数
	SensorOnline bool    `json:"sensor_online"` // Host Radar sensor 是否在线
}

// cursorMsg 是浏览器 → 服务端的光标上报（20Hz 采样）。
// v=2 起 WX/WY 是连续平面世界坐标（不再是屏幕归一化 0..1）；
// 旧版 x/y 字段的语义在 v2 中明确废弃，协议变化以 v 字段为准。
type cursorMsg struct {
	Type string   `json:"type"`
	V    int      `json:"v"`
	WX   *float64 `json:"wx"`
	WY   *float64 `json:"wy"`
}

// cursorDeltaMsg 是服务端广播给其他人的光标增量。
// cursorDeltaMsg 是服务端广播的光标增量（v=2：世界坐标）。
type cursorDeltaMsg struct {
	Type string  `json:"type"`
	V    int     `json:"v"`
	ID   string  `json:"id"`
	WX   float64 `json:"wx"`
	WY   float64 `json:"wy"`
}

// msgHead 只取消息的 type 字段，用于按类型白名单分发到各自的解析结构。
type msgHead struct {
	Type string `json:"type"`
}

// pulseMsg 是浏览器 → 服务端的点击脉冲请求。
// X/Y 用指针类型：Go 的 float64 零值无法区分"没传 x"和"传了 0"，
// 指针为 nil 即"字段不存在"——这是必填校验的前提。
type pulseMsg struct {
	Type          string   `json:"type"`
	V             int      `json:"v"`
	ClientEventID string   `json:"clientEventId"`
	WX            *float64 `json:"wx"`
	WY            *float64 `json:"wy"`
}

// pulseBroadcastMsg 是服务端校验通过后广播的脉冲事件。
// eventId 由服务端生成（单调递增），身份 ID 取自当前连接的 Session，
// 不信任客户端自报的身份。
type pulseBroadcastMsg struct {
	Type          string  `json:"type"`
	EventID       string  `json:"eventId"`
	ClientEventID string  `json:"clientEventId"` // 原样回传，供点击方对账
	ID            string  `json:"id"`
	V             int     `json:"v"`
	WX            float64 `json:"wx"`
	WY            float64 `json:"wy"`
	At            int64   `json:"at"`
}

// validatePulse 校验一条脉冲请求，返回规范化后的坐标。
// 规则：clientEventId 存在且 ≤64 字符；x/y 必须存在（nil 即"没传"）、
// 有限、且在 [0,1]——注意 {x:0,y:0} 是合法输入，零值不是缺失。
// 任何一项不满足都返回 error；调用方丢弃该消息，不杀连接。
func validatePulse(m pulseMsg) (float64, float64, error) {
	if m.Type != "pulse" {
		return 0, 0, errors.New("类型不是 pulse")
	}
	if m.ClientEventID == "" || len(m.ClientEventID) > 64 {
		return 0, 0, errors.New("clientEventId 缺失或超长")
	}
	if m.V != 2 {
		return 0, 0, errors.New("协议版本不支持（需要 v=2）")
	}
	if m.WX == nil || m.WY == nil {
		return 0, 0, errors.New("缺少坐标字段")
	}
	x, y := *m.WX, *m.WY
	if math.IsNaN(x) || math.IsNaN(y) || math.IsInf(x, 0) || math.IsInf(y, 0) {
		return 0, 0, errors.New("坐标必须是有限数")
	}
	// 世界坐标有界但不限 [0,1]：连续平面世界，防御性上限 1e7
	if math.Abs(x) > 1e7 || math.Abs(y) > 1e7 {
		return 0, 0, errors.New("坐标超出世界范围")
	}
	return x, y, nil
}

// allowPulse 按令牌桶检查并扣减一次脉冲额度：平均 2 次/秒回充，上限 4。
// 调用方必须持有 hub.mu（与 Session 其他字段的保护一致）。
func (s *Session) allowPulse(now time.Time) bool {
	s.pulseTokens = math.Min(4, s.pulseTokens+now.Sub(s.pulseLast).Seconds()*2)
	s.pulseLast = now
	if s.pulseTokens < 1 {
		return false
	}
	s.pulseTokens--
	return true
}

// ---------- Host Radar：sensor 接入 ----------

// hostEventMsg 是广播给浏览器的主机事件（白名单字段，不含原始 IP/payload）。
// mode 只有两种：live（来自真实 sensor）/ fixture（开发注入）——前端必须区分显示。
type hostEventMsg struct {
	Type            string `json:"type"` // 恒为 host_event
	Schema          int    `json:"schema"`
	Mode            string `json:"mode"`
	EventID         string `json:"eventId"`
	SourceID        string `json:"sourceId"`
	ObservedAtMs    int64  `json:"observedAtMs"`
	Transport       string `json:"transport"`
	DestinationPort int    `json:"destinationPort"`
	Kind            string `json:"kind"`
	Count           int    `json:"count"`
}

// sensorEvent 是 sensor → 网关的白名单事件格式（不含 eventId，由网关分配）。
// kind 为 heartbeat 时是存活心跳，不广播。
type sensorEvent struct {
	Kind            string `json:"kind"`
	SensorID        string `json:"sensorId"`
	SourceID        string `json:"sourceId"`
	ObservedAtMs    int64  `json:"observedAtMs"`
	Transport       string `json:"transport"`
	DestinationPort int    `json:"destinationPort"`
	Count           int    `json:"count"`
}

// validateSensorEvent 校验 sensor 上报的字段。
// 初版只接受 tcp_syn（没观测到握手就不许写 established）；端口 0..65535；
// sourceId 1..64 字符；count 缺省视为 1；transport 缺省视为 tcp。
func validateSensorEvent(ev *sensorEvent) error {
	if ev.Kind != "tcp_syn" {
		return errors.New("kind 不在白名单（初版只收 tcp_syn）")
	}
	if ev.DestinationPort < 0 || ev.DestinationPort > 65535 {
		return errors.New("端口越界")
	}
	if len(ev.SourceID) == 0 || len(ev.SourceID) > 64 {
		return errors.New("sourceId 缺失或超长")
	}
	if ev.ObservedAtMs <= 0 {
		return errors.New("observedAtMs 非法")
	}
	if ev.Count < 0 {
		return errors.New("count 非法")
	}
	if ev.Count == 0 {
		ev.Count = 1
	}
	if ev.Transport == "" {
		ev.Transport = "tcp"
	}
	if ev.Transport != "tcp" && ev.Transport != "udp" {
		return errors.New("transport 不在白名单")
	}
	return nil
}

// sensorLastSeen 是最近一次收到 sensor 心跳/事件的时刻（unix 毫秒，0=从未连接）。
// sensor 定期心跳；超 10 秒无心跳视为离线——"无事件"不等于离线。
var sensorLastSeen atomic.Int64

// sensorOnline 报告 sensor 当前是否在线（10 秒心跳窗口）。
func sensorOnline() bool {
	last := sensorLastSeen.Load()
	return last > 0 && time.Now().UnixMilli()-last < 10_000
}

// hostRadar 全局限频：平均 100 事件/秒回充，上限 100。
// 捕获点再能产，公开 feed 也不能超过这个速率。
var hostBucket = struct {
	sync.Mutex
	tokens float64
	last   time.Time
}{tokens: 100, last: time.Now()}

// hostRateAllow 按令牌桶检查一次 host 事件的公开额度。
func hostRateAllow(now time.Time) bool {
	hostBucket.Lock()
	defer hostBucket.Unlock()
	hostBucket.tokens = math.Min(100, hostBucket.tokens+now.Sub(hostBucket.last).Seconds()*100)
	hostBucket.last = now
	if hostBucket.tokens < 1 {
		return false
	}
	hostBucket.tokens--
	return true
}

// sensorSockPath 是 sensor 与网关之间的 Unix socket 路径。
const sensorSockPath = "/tmp/pulse-sensor.sock"

// listenSensor 在 Linux 上监听 sensor 的 Unix socket 连接（其他平台直接跳过：
// sensor 是 Linux 专属组件，没有它 Host Radar 就不显示 live 数据，也不伪造）。
func listenSensor(hub *Hub) {
	if runtime.GOOS != "linux" {
		return
	}
	_ = os.Remove(sensorSockPath) // 清掉上次退出残留的 socket 文件
	lc := net.ListenConfig{}
	l, err := lc.Listen(context.Background(), "unix", sensorSockPath)
	if err != nil {
		log.Printf("sensor 监听失败（%v），Host Radar 不工作", err)
		return
	}
	log.Printf("sensor 通道监听 %s", sensorSockPath)
	for {
		conn, err := l.Accept()
		if err != nil {
			return
		}
		go readSensorConn(hub, conn)
	}
}

// readSensorConn 读一条 sensor 连接的事件流（JSON 行）。
// 心跳只刷新在线标记；事件校验 + 全局限频后以 mode=live 广播。
func readSensorConn(hub *Hub, conn net.Conn) {
	defer conn.Close()
	log.Printf("sensor 已连接")
	sc := bufio.NewScanner(conn)
	sc.Buffer(make([]byte, 0, 64*1024), 64*1024) // 单行上限 64 KiB
	for sc.Scan() {
		var ev sensorEvent
		if err := json.Unmarshal(sc.Bytes(), &ev); err != nil {
			continue
		}
		if ev.Kind == "heartbeat" {
			sensorLastSeen.Store(time.Now().UnixMilli())
			continue
		}
		if err := validateSensorEvent(&ev); err != nil {
			continue
		}
		sensorLastSeen.Store(time.Now().UnixMilli())
		if !hostRateAllow(time.Now()) {
			continue // 超频丢弃：宁可少报，不拖垮广播
		}
		hub.Broadcast(hostEventMsg{
			Type:            "host_event",
			Schema:          1,
			Mode:            "live",
			EventID:         fmt.Sprintf("h%d", hub.eventSeq.Add(1)),
			SourceID:        ev.SourceID,
			ObservedAtMs:    ev.ObservedAtMs,
			Transport:       ev.Transport,
			DestinationPort: ev.DestinationPort,
			Kind:            ev.Kind,
			Count:           ev.Count,
		})
	}
	log.Printf("sensor 断开")
}

// ---------- 主流程 ----------

var upgrader = websocket.Upgrader{} // 默认校验 Origin==Host

// startedAt 是进程启动时刻，供 /healthz 报告 uptime。
var startedAt = time.Now()

// main 装配 Hub、周期指标广播和 HTTP 路由，监听本地回环地址。
func main() {
	log.SetFlags(log.LstdFlags | log.Lmicroseconds)
	hub := NewHub()

	// 每 2 秒广播一次真实进程指标（PULSE 的“服务器身体状态”）
	go func() {
		for range time.Tick(2 * time.Second) {
			var m runtime.MemStats
			runtime.ReadMemStats(&m)
			hub.Broadcast(metricsMsg{
				Type:         "metrics",
				Conns:        hub.Count(),
				HeapMB:       float64(m.Alloc) / 1048576,
				SysMB:        float64(m.Sys) / 1048576,
				Dropped:      hub.dropped.Load(),
				SensorOnline: sensorOnline(),
			})
		}
	}()

	go listenSensor(hub)

	// PULSE_DEV=1 时才开启 fixture 注入口：开发/验收用，
	// 事件强制 mode=fixture，绝不能被标记成 live。生产环境不设置该变量。
	if os.Getenv("PULSE_DEV") == "1" {
		http.HandleFunc("/dev/host-event", func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost {
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}
			var ev sensorEvent
			if err := json.NewDecoder(r.Body).Decode(&ev); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			if err := validateSensorEvent(&ev); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			hub.Broadcast(hostEventMsg{
				Type: "host_event", Schema: 1, Mode: "fixture",
				EventID:         fmt.Sprintf("h%d", hub.eventSeq.Add(1)),
				SourceID:        ev.SourceID,
				ObservedAtMs:    ev.ObservedAtMs,
				Transport:       ev.Transport,
				DestinationPort: ev.DestinationPort,
				Kind:            ev.Kind,
				Count:           ev.Count,
			})
			w.WriteHeader(http.StatusNoContent)
		})
		log.Printf("PULSE_DEV=1：/dev/host-event fixture 注入口已开启（仅开发用）")
	}

	http.Handle("/ws", wsHandler{hub})
	// 健康检查：供部署脚本和巡检确认进程活着、在收连接
	http.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		fmt.Fprintf(w, `{"status":"ok","conns":%d,"uptime_s":%d}`,
			hub.Count(), int64(time.Since(startedAt).Seconds()))
	})
	// 静态文件禁缓存：开发期改完刷新就生效，不被旧 app.js 拖住
	http.Handle("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		http.FileServerFS(sub(staticFS)).ServeHTTP(w, r)
	}))

	addr := "127.0.0.1:8090"
	log.Printf("PULSE 骨架监听 http://%s （打开两个标签页试试）", addr)
	log.Fatal(http.ListenAndServe(addr, nil))
}

// sub 把内嵌的 static 目录降成文件系统根，使 "/app.js" 而非 "/static/app.js" 可访问。
func sub(f embed.FS) fs.FS {
	sub, err := fs.Sub(f, "static")
	if err != nil {
		log.Fatal(err)
	}
	return sub
}

type wsHandler struct{ hub *Hub }

// maxConns 是全站同时在线的连接预算。超额拒绝升级——宁可拒连，不无界建立。
const maxConns = 128

// ServeHTTP 走完一条 WebSocket 连接的完整生命周期：
// 预算检查 → 升级 → 登记 → welcome → 广播 join → 读写泵+心跳 → 统一注销。
// 注销只有一个 owner（本函数的 defer）：任何失败路径（读/写/心跳/被踢）
// 最终都回到这里，"删表 → 关 send → 关连接 → 广播 leave"只发生一次。
func (h wsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.hub.Count() >= maxConns {
		http.Error(w, "服务器繁忙", http.StatusServiceUnavailable)
		return
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	s := &Session{
		ID:   "visitor-" + shortID(),
		X:    0.2 + 0.6*float64(randByte())/255, // 出生在场景区间内
		Y:    0.25 + 0.5*float64(randByte())/255,
		Join: time.Now().UnixMilli(),
		send: make(chan []byte, 64),
		conn: conn,
		// 脉冲令牌桶：初始满桶（4），允许新访客一次小爆发
		pulseTokens: 4,
		pulseLast:   time.Now(),
	}

	h.hub.mu.Lock()
	h.hub.sessions[s] = true
	h.hub.mu.Unlock()

	defer func() {
		h.hub.mu.Lock()
		delete(h.hub.sessions, s)
		h.hub.mu.Unlock()
		close(s.send)
		_ = conn.Close()
		h.hub.Broadcast(leaveMsg{Type: "leave", ID: s.ID})
		log.Printf("leave %s（在线 %d）", s.ID, h.hub.Count())
	}()

	// 先告诉新连接“你是谁、都有谁在线”，再向大家广播你的到来。
	// welcome 写失败不能继续：直接返回，defer 完成清理。
	if err := conn.WriteJSON(welcomeMsg{Type: "welcome", You: s.ID, Sessions: h.hub.Snapshot()}); err != nil {
		return
	}
	h.hub.Broadcast(joinMsg{Type: "join", Session: *s})
	log.Printf("join  %s（在线 %d）", s.ID, h.hub.Count())

	// 心跳：每 15s 发 ping；45s 没收到 pong，读超时自动断开（见 readPump）。
	stopPing := make(chan struct{})
	defer close(stopPing)
	go pingLoop(conn, stopPing)

	go writePump(conn, s)
	readPump(conn, s, h.hub) // 阻塞直到断开
}

// pingLoop 每 15 秒向这条连接发一个 WebSocket ping。
// WriteControl 与 writePump 的普通写并发安全（gorilla 契约允许）。
// 对端是浏览器时会自动回 pong；不回的僵尸连接由读超时负责清理。
func pingLoop(conn *websocket.Conn, stop <-chan struct{}) {
	t := time.NewTicker(15 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-t.C:
			_ = conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(5*time.Second))
		case <-stop:
			return
		}
	}
}

// readPump 持续读这条连接的消息，直到断开（ReadMessage 报错即返回）。
// 单条消息上限 4 KiB；45 秒读超时，收到 pong 续约（配合 pingLoop 清僵尸连接）。
// 类型白名单分发，畸形/未知消息只跳过（continue），不杀连接——
// 一条坏消息不该拖死整条线。
func readPump(conn *websocket.Conn, s *Session, hub *Hub) {
	conn.SetReadLimit(4096) // 协议消息都很小，超限的连接会被 gorilla 断开
	_ = conn.SetReadDeadline(time.Now().Add(45 * time.Second))
	conn.SetPongHandler(func(string) error {
		// 收到 pong 说明对端活着：续约读超时
		return conn.SetReadDeadline(time.Now().Add(45 * time.Second))
	})
	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			return
		}
		var head msgHead
		if err := json.Unmarshal(data, &head); err != nil {
			continue
		}

		switch head.Type {
		case "cursor":
			var msg cursorMsg
			if err := json.Unmarshal(data, &msg); err != nil {
				continue
			}
			// v2 世界坐标：必须带版本号、字段存在、有限、世界范围内
			if msg.V != 2 || msg.WX == nil || msg.WY == nil {
				continue
			}
			wx, wy := *msg.WX, *msg.WY
			if math.IsNaN(wx) || math.IsNaN(wy) || math.IsInf(wx, 0) || math.IsInf(wy, 0) {
				continue
			}
			if math.Abs(wx) > 1e7 || math.Abs(wy) > 1e7 {
				continue
			}

			// 改坐标必须持锁：Snapshot 和广播都在别处读这些字段
			hub.mu.Lock()
			s.X, s.Y = wx, wy
			hub.mu.Unlock()

			hub.Broadcast(cursorDeltaMsg{Type: "cursor", V: 2, ID: s.ID, WX: wx, WY: wy})

		case "pulse":
			var pm pulseMsg
			if err := json.Unmarshal(data, &pm); err != nil {
				continue
			}
			x, y, err := validatePulse(pm)
			if err != nil {
				continue
			}

			// 令牌桶限频在锁内完成（桶字段的约定保护区）
			hub.mu.Lock()
			ok := s.allowPulse(time.Now())
			hub.mu.Unlock()
			if !ok {
				continue // 超限丢弃：事件不被扩散，客户端得不到回放权
			}

			// 广播给所有人（含点击方）：第一版不做本地预播，
			// 点击方也用这条回声播放，clientEventId 供以后对账
			hub.Broadcast(pulseBroadcastMsg{
				Type:          "pulse",
				EventID:       fmt.Sprintf("e%d", hub.eventSeq.Add(1)),
				ClientEventID: pm.ClientEventID,
				ID:            s.ID,
				V:             2,
				WX:            x,
				WY:            y,
				At:            time.Now().UnixMilli(),
			})
		default:
			continue // 白名单外的类型一律忽略
		}
	}
}

// writePump 把这个 Session 发送缓冲里的消息逐条写进 WebSocket。
// 缓冲被 close（统一注销）时 for-range 结束，goroutine 退出。
// 写失败时主动关闭连接：唤醒阻塞中的 readPump，让整个生命周期走向统一注销点。
func writePump(conn *websocket.Conn, s *Session) {
	for data := range s.send {
		_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
		if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
			_ = conn.Close() // 写失败联动关闭：不让 reader 永远傻等
			return
		}
	}
}

// shortID 生成 4 位十六进制后缀（2 字节随机）。
// 只有 6 万种取值，骨架阶段够用；真人多时碰撞是课程里要处理的问题。
func shortID() string {
	b := make([]byte, 2)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// randByte 返回一个加密随机字节，用于让出生位置在场景区间内散开。
func randByte() byte {
	b := make([]byte, 1)
	_, _ = rand.Read(b)
	return b[0]
}
