// PULSE — 最小真实骨架。
//
// 页面上的每个点都是一个真实的 WebSocket 长连接：
// 开两个标签页就是两个点，关掉一个，另一个看着它消散。
// 底部指标来自 Go 进程的真实内存。不模拟任何东西。
//
// 子命令：无。单文件，故意保持很小，方便通读。
package main

import (
	"crypto/rand"
	"embed"
	"encoding/hex"
	"encoding/json"
	"io/fs"
	"log"
	"net/http"
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

	send chan []byte // 有界发送缓冲：消费不动就丢，绝不让队列无限增长
}

// ---------- Hub ----------

// Hub 维护全部在线 Session，负责 join/leave/metrics 广播。
type Hub struct {
	mu       sync.RWMutex
	sessions map[*Session]bool
	dropped  atomic.Uint64 // 因慢消费被丢弃的消息数
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

// Broadcast 把一条消息发给所有连接。缓冲满就丢这条——
// 文档第 23 节：绝不能无限增长 send queue。
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
			h.dropped.Add(1) // 原子加：多个广播 goroutine 会同时走到这里
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
	Type    string  `json:"type"`
	Conns   int     `json:"conns"`
	HeapMB  float64 `json:"heap_mb"` // Go heap 实际占用
	SysMB   float64 `json:"sys_mb"`  // Go 向 OS 申请总量
	Dropped uint64  `json:"dropped"` // 慢消费丢弃数
}

// cursorMsg 是浏览器 → 服务端的光标上报（20Hz 采样后的归一化坐标）。
type cursorMsg struct {
	Type string  `json:"type"`
	X    float64 `json:"x"`
	Y    float64 `json:"y"`
}

// cursorDeltaMsg 是服务端广播给其他人的光标增量。
type cursorDeltaMsg struct {
	Type string  `json:"type"`
	ID   string  `json:"id"`
	X    float64 `json:"x"`
	Y    float64 `json:"y"`
}

// ---------- 主流程 ----------

var upgrader = websocket.Upgrader{} // 默认校验 Origin==Host

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
				Type:    "metrics",
				Conns:   hub.Count(),
				HeapMB:  float64(m.Alloc) / 1048576,
				SysMB:   float64(m.Sys) / 1048576,
				Dropped: hub.dropped.Load(),
			})
		}
	}()

	http.Handle("/ws", wsHandler{hub})
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

// ServeHTTP 走完一条 WebSocket 连接的完整生命周期：
// 升级 → 登记 Session → welcome（你是谁+谁在线）→ 广播 join →
// 读写双泵 → 断开后注销并广播 leave。
func (h wsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
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
	}

	h.hub.mu.Lock()
	h.hub.sessions[s] = true
	h.hub.mu.Unlock()

	// 先告诉新连接“你是谁、都有谁在线”，再向大家广播你的到来
	_ = conn.WriteJSON(welcomeMsg{Type: "welcome", You: s.ID, Sessions: h.hub.Snapshot()})
	h.hub.Broadcast(joinMsg{Type: "join", Session: *s})
	log.Printf("join  %s（在线 %d）", s.ID, h.hub.Count())

	go writePump(conn, s)
	readPump(conn, s, h.hub) // 阻塞直到断开

	h.hub.mu.Lock()
	delete(h.hub.sessions, s)
	h.hub.mu.Unlock()
	close(s.send)
	_ = conn.Close()

	h.hub.Broadcast(leaveMsg{Type: "leave", ID: s.ID})
	log.Printf("leave %s（在线 %d）", s.ID, h.hub.Count())
}

// readPump 持续读这条连接的消息，直到断开（ReadMessage 报错即返回）。
// {type:"cursor"} → 更新本连接 Session 的坐标并广播增量给所有人。
// 畸形消息只跳过（continue），不杀连接——一条坏消息不该拖死整条线。
func readPump(conn *websocket.Conn, s *Session, hub *Hub) {
	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			return
		}
		var msg cursorMsg
		if err := json.Unmarshal(data, &msg); err != nil {
			continue
		}
		if msg.Type != "cursor" {
			continue
		}
		// 坐标约定为 0..1 归一化，越界的一律丢弃（防异常客户端）
		if msg.X < 0 || msg.X > 1 || msg.Y < 0 || msg.Y > 1 {
			continue
		}

		// 改坐标必须持锁：Snapshot 和广播都在别处读这些字段
		hub.mu.Lock()
		s.X, s.Y = msg.X, msg.Y
		hub.mu.Unlock()

		hub.Broadcast(cursorDeltaMsg{Type: "cursor", ID: s.ID, X: s.X, Y: s.Y})
	}
}

// writePump 把这个 Session 发送缓冲里的消息逐条写进 WebSocket。
// 缓冲被 close（连接断开）时 for-range 结束，goroutine 退出。
func writePump(conn *websocket.Conn, s *Session) {
	for data := range s.send {
		_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
		if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
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
