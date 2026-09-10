package main

import (
	"encoding/json"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

// ---------- Session ----------

// Session 是一个站内访客的真实长连接。没有用户表、没有数据库：
// 断线即消散。
//
// 坐标只有一套：WX/WY 是连续平面的世界坐标（不是屏幕归一化 0..1）。
// 旧协议的 x/y 出生字段已删除，v=2 的光标上报也不再接受——
// 旧语义与新语义不能并存，否则同一个 Session 会有两套互相矛盾的坐标。
type Session struct {
	ID     string  `json:"id"`
	WX     float64 `json:"wx"` // 最近已知世界坐标
	WY     float64 `json:"wy"`
	Z      float64 `json:"z"`      // 服务端算出的地表高度：指针/会话贴地显示用
	Island string  `json:"island"` // 服务端判定的所在岛 id；空字符串=在海上
	Join   int64   `json:"join"`   // unix 毫秒

	send chan []byte // 有界发送缓冲：满了说明是慢消费者，由 Broadcast 断开整条连接

	conn    *websocket.Conn // 当前连接；写失败/心跳超时/慢消费都通过关闭它来终结会话
	closing atomic.Bool     // 慢消费回收最多安排一次，避免每条广播都创建关闭协程

	// 脉冲限频令牌桶（只允许 readPump 在 hub.mu 下访问）：
	// 平均 2 次/秒，上限 4（突发），防止客户端无限扩散事件。
	pulseTokens float64
	pulseLast   time.Time

	// lastLoggedMismatch 记录最近一次已写日志的"客户端自报岛"，只用于日志去重：
	// 20Hz 上报里同一个错误值不该刷屏。同样在 hub.mu 下访问，不参与 JSON 序列化。
	lastLoggedMismatch string

	// 照料限频与去重（只在 readPump 中访问，不需要额外锁）：
	// waterNext 是下一次允许浇水的最早时刻；waterSeen 是最近 64 次事件 id。
	waterNext time.Time
	waterSeen map[string]bool
	waterRing []string
}

// ---------- Hub ----------

// Hub 维护全部在线 Session，负责 join/leave/metrics 广播。
type Hub struct {
	mu       sync.RWMutex
	sessions map[*Session]bool
	dropped  atomic.Uint64 // 因慢消费被丢弃的消息数
	eventSeq atomic.Uint64 // 脉冲事件的单调序号（eventId 来源）
	garden   *Garden       // 服务端权威的植物状态（落盘、去重、共同照料判定）
	slots    chan struct{} // 原子预留正在握手和在线的连接，handler 退出时归还
}

// NewHub 装配已加载的花园，不读磁盘或终止进程；调用者负责先处理 NewGarden 的错误。
func NewHub(garden *Garden) *Hub {
	return &Hub{sessions: make(map[*Session]bool), garden: garden, slots: make(chan struct{}, maxConns)}
}

// Count 返回当前在线连接数。
func (h *Hub) Count() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.sessions)
}

// sendTo 只把一条消息发给指定连接（动作结果等点对点回应）。
// 与 Broadcast 共用慢连接回收策略；不能静默丢掉 water_result 后让连接继续假装正常。
func (h *Hub) sendTo(s *Session, v any) {
	data, err := json.Marshal(v)
	if err != nil {
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	if !h.sessions[s] {
		return // 已注销连接的 send 可能关闭，不再写入
	}
	select {
	case s.send <- data:
	default:
		h.dropped.Add(1)
		s.disconnectSlow()
	}
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
			s.disconnectSlow()
		}
	}
}

// disconnectSlow 每个会话只安排一次异步关闭，不在 Hub 锁内做 IO。
// nil conn 只出现在隔离的单元测试中；实际会话在登记前已经握手完成。
func (s *Session) disconnectSlow() {
	if s.conn != nil && s.closing.CompareAndSwap(false, true) {
		go func() { _ = s.conn.Close() }()
	}
}

// SessionView 是网络公开数据，不携带 socket/channel/限流/去重等运行状态。
// 只复制被 hub.mu 保护的字段，避免与 readPump 独占的水动作字段并发读写。
type SessionView struct {
	ID     string  `json:"id"`
	WX     float64 `json:"wx"`
	WY     float64 `json:"wy"`
	Z      float64 `json:"z"`
	Island string  `json:"island"`
	Join   int64   `json:"join"`
}

// publicView 只返回公开值；登记后的 Session 必须在 hub.mu 读锁或写锁内调用。
func (s *Session) publicView() SessionView {
	return SessionView{ID: s.ID, WX: s.WX, WY: s.WY, Z: s.Z, Island: s.Island, Join: s.Join}
}

// Snapshot 在读锁内复制公开字段，返回的值可在锁外编码，不共享运行状态。
func (h *Hub) Snapshot() []SessionView {
	h.mu.RLock()
	defer h.mu.RUnlock()
	out := make([]SessionView, 0, len(h.sessions))
	for s := range h.sessions {
		out = append(out, s.publicView())
	}
	return out
}
