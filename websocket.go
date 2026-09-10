package main

import (
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{} // 默认校验 Origin==Host

type wsHandler struct{ hub *Hub }

// maxConns 是全站同时在线的连接预算。超额拒绝升级——宁可拒连，不无界建立。
const maxConns = 128

// ServeHTTP 走完一条 WebSocket 连接的完整生命周期：
// 预算检查 → 升级 → 登记 → welcome → 广播 join → 读写泵+心跳 → 统一注销。
// 注销只有一个 owner（本函数的 defer）：任何失败路径（读/写/心跳/被踢）
// 最终都回到这里，"删表 → 关 send → 关连接 → 广播 leave"只发生一次。
func (h wsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 升级前原子占位，握手失败与正常离场都由同一个 defer 归还预算。
	select {
	case h.hub.slots <- struct{}{}:
		defer func() { <-h.hub.slots }()
	default:
		http.Error(w, "服务器繁忙", http.StatusServiceUnavailable)
		return
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	s := &Session{
		ID:   "visitor-" + shortID(),
		Join: time.Now().UnixMilli(),
		send: make(chan []byte, 64),
		conn: conn,
		// 脉冲令牌桶：初始满桶（4），允许新访客一次小爆发
		pulseTokens: 4,
		pulseLast:   time.Now(),
		// 照料事件去重表：只保留最近 64 个事件 id，超出后按插入顺序淘汰
		waterSeen: make(map[string]bool),
	}
	// 出生位置用加密随机数散落在世界范围内，再按权威判定写归属与地表高度：
	// 出生在岛上就带岛并贴着地形，出生在海上就是 "" 且高度为 0。
	s.WX, s.WY = spawnWorldPos()
	s.Island = resolveIsland(s.WX, s.WY)
	s.Z = surfaceHeight(s.WX, s.WY)

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

	// 先告诉新连接“你是谁、都有谁在线、花园现在什么样”，再向大家广播你的到来。
	// welcome 写失败不能继续：直接返回，defer 完成清理。
	if err := conn.WriteJSON(welcomeMsg{
		Type: "welcome", You: s.ID, Islands: Islands(),
		Garden: h.hub.garden.Snapshot(), Sessions: h.hub.Snapshot(),
	}); err != nil {
		return
	}
	h.hub.mu.RLock()
	joined := s.publicView()
	h.hub.mu.RUnlock()
	h.hub.Broadcast(joinMsg{Type: "join", Session: joined})
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
			wx, wy, err := validateCursor(msg)
			if err != nil {
				continue // 版本/坐标/岛名不合法：整条丢弃，连接照常
			}
			// 服务端权威判定：不信任客户端自报的 island；高度也由服务端按地形算出，
			// 这样别人的指针会贴着岛面，而不是浮在海平面上。
			isl := resolveIsland(wx, wy)
			z := surfaceHeight(wx, wy)

			// 坐标、高度与岛归属必须一起改，且在锁内：Snapshot 和归属比较都在别处读这些字段
			hub.mu.Lock()
			prevIsland := s.Island
			s.WX, s.WY, s.Z, s.Island = wx, wy, z, isl
			// 自报值与权威值不一致时记日志（同一个错误值只记一次，20Hz 不刷屏）
			logMismatch := msg.Island != isl && s.lastLoggedMismatch != msg.Island
			if logMismatch {
				s.lastLoggedMismatch = msg.Island
			}
			hub.mu.Unlock()

			if logMismatch {
				log.Printf("cursor %s 自报 island=%q，服务端判定 %q（以服务端为准）", s.ID, msg.Island, isl)
			}
			hub.Broadcast(cursorDeltaMsg{Type: "cursor", V: 3, ID: s.ID, WX: wx, WY: wy, Z: z, Island: isl})

			// 只有归属真的变化才广播 presence：同一岛内移动不刷屏
			if isl != prevIsland {
				hub.Broadcast(presenceMsg{
					Type: "presence", ID: s.ID, Island: isl, WX: wx, WY: wy, At: time.Now().UnixMilli(),
				})
			}

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

		case "water":
			var wm waterMsg
			if err := json.Unmarshal(data, &wm); err != nil {
				hub.sendTo(s, waterResultMsg{Type: "water_result", OK: false, Code: "bad_request"})
				continue
			}
			now := time.Now()
			// 协议不合法：明确拒绝（客户端能区分是协议错而不是网络丢包）
			if wm.V != 1 || wm.EventID == "" || len(wm.EventID) > 64 || wm.Plant == "" {
				hub.sendTo(s, waterResultMsg{Type: "water_result", OK: false, RequestID: wm.EventID, Code: "bad_request"})
				continue
			}
			// 重复提交一个已成功的请求：不再生长，但明确确认（幂等回应）
			if s.waterSeen[wm.EventID] {
				hub.sendTo(s, waterResultMsg{Type: "water_result", OK: true, RequestID: wm.EventID, Duplicate: true})
				continue
			}
			// 冷却中：告诉客户端多久后可重试
			if now.Before(s.waterNext) {
				hub.sendTo(s, waterResultMsg{Type: "water_result", OK: false, RequestID: wm.EventID,
					Code: "cooldown", RetryAfterMs: time.Until(s.waterNext).Milliseconds()})
				continue
			}

			state, together, err := hub.garden.Water(wm.Plant, s.ID, "", now)
			if err != nil {
				// 保存失败或未知植物：内存未变，冷却/去重都不记账，客户端可立即重试
				code := "save_failed"
				if errors.Is(err, errUnknownPlant) {
					code = "not_found"
				}
				log.Printf("water 失败 code=%s requestId=%s session=%s err=%v", code, wm.EventID, s.ID, err)
				hub.sendTo(s, waterResultMsg{Type: "water_result", OK: false, RequestID: wm.EventID, Code: code})
				continue
			}

			// 动作被成功接受后才记账冷却与去重（失败不占额度）
			s.waterNext = now.Add(waterCooldown)
			markWaterSeen(s, wm.EventID)
			hub.sendTo(s, waterResultMsg{Type: "water_result", OK: true, RequestID: wm.EventID})
			hub.Broadcast(plantMsg{
				Type: "plant", PlantID: wm.Plant, ID: s.ID, Together: together,
				Garden: state, At: now.UnixMilli(),
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

// randFloat64 返回 [0,1) 的加密随机浮点数（取 8 字节随机数的高 53 位，避免精度溢出）。
// 用于出生位置散布：不依赖 math/rand 的全局种子，多实例之间也不会撞同一串序列。
func randFloat64() float64 {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return float64(binary.BigEndian.Uint64(b[:])>>11) / float64(uint64(1)<<53)
}

// spawnWorldPos 返回一个出生世界坐标：以 origin 岛为中心的 ±1200 世界单位方形内。
// 纯随机、无状态；调用方负责用 resolveIsland 判定该点的岛归属。
func spawnWorldPos() (float64, float64) {
	return (randFloat64()*2 - 1) * 1200, (randFloat64()*2 - 1) * 1200
}
