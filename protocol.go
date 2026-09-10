package main

import (
	"errors"
	"math"
	"time"
)

// ---------- 消息 ----------

// 服务端 → 浏览器的消息。数据面先用 JSON（文档 Phase 2 之前允许），
// 二进制协议是后面的手写课程。
type welcomeMsg struct {
	Type     string        `json:"type"`
	You      string        `json:"you"`
	Islands  []Island      `json:"islands"` // 权威岛列表：客户端用它生成几何，不允许自造岛
	Garden   GardenState   `json:"garden"`  // 花园快照：新连接据此重建生长状态
	Sessions []SessionView `json:"sessions"`
}
type joinMsg struct {
	Type    string      `json:"type"`
	Session SessionView `json:"session"`
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

// cursorMsg 是浏览器 → 服务端的光标上报（约 20Hz 采样）。
// v=3 起：wx/wy 是连续平面的世界坐标，island 是客户端自报的所在岛（"" 或省略=在海上）。
// 自报的 island 只是对账线索：广播出去的归属一律由服务端 resolveIsland 重新判定。
type cursorMsg struct {
	Type   string   `json:"type"`
	V      int      `json:"v"`
	WX     *float64 `json:"wx"`
	WY     *float64 `json:"wy"`
	Island string   `json:"island"`
}

// cursorDeltaMsg 是服务端广播给其他人的光标增量（v=3：世界坐标 + 服务端判定的岛）。
// Z 是服务端按地表算出的高度：指针落在岛上时贴着地形，落在海上为 0。
type cursorDeltaMsg struct {
	Type   string  `json:"type"`
	V      int     `json:"v"`
	ID     string  `json:"id"`
	WX     float64 `json:"wx"`
	WY     float64 `json:"wy"`
	Z      float64 `json:"z"`
	Island string  `json:"island"`
}

// presenceMsg 是一条连接的岛归属真正发生变化时的一次广播。
// at 是服务端 unix 毫秒；同一座岛内的连续移动不发这个类型，避免 20Hz 刷屏。
type presenceMsg struct {
	Type   string  `json:"type"`
	ID     string  `json:"id"`
	Island string  `json:"island"`
	WX     float64 `json:"wx"`
	WY     float64 `json:"wy"`
	At     int64   `json:"at"`
}

// msgHead 只取消息的 type 字段，用于按类型白名单分发到各自的解析结构。
type msgHead struct {
	Type string `json:"type"`
}

// waterMsg 是浏览器 → 服务端的照料请求（给岛上的植物浇水）。
// Plant 是权威岛 id；EventID 供服务端去重，避免同一次点击因重发被计两次。
// 版本 v 保留给后续动作扩展；当前只接受 v=1。
type waterMsg struct {
	Type    string `json:"type"`
	V       int    `json:"v"`
	Plant   string `json:"plant"`
	EventID string `json:"eventId"`
}

// waterResultMsg 是服务端只发给请求方的动作结果（G0：一次"已保存"必须可信）。
// requestId 回带客户端的 eventId：前端只有匹配当前请求的结果才能解除等待。
// ok=false 时 code 区分 not_found/cooldown/save_failed/bad_request；
// 重复提交一个已成功的 eventID 返回 ok=true + duplicate，不再生长但明确确认。
type waterResultMsg struct {
	Type         string `json:"type"` // 恒为 water_result
	OK           bool   `json:"ok"`
	RequestID    string `json:"requestId"`
	Code         string `json:"code,omitempty"`
	RetryAfterMs int64  `json:"retryAfterMs,omitempty"`
	Duplicate    bool   `json:"duplicate,omitempty"`
}

// plantMsg 是服务端 → 浏览器的花园广播：完整快照 + 本次变化的归属信息。
// Together 表示这次照料落在 togetherWindowMs 窗口内、且由另一个连接完成。
// 客户端只接受不倒退的 Version；welcome 里的 garden 可以显式重设。
type plantMsg struct {
	Type     string      `json:"type"`
	PlantID  string      `json:"plantId"`
	ID       string      `json:"id"` // 本次照料的连接 id
	Name     string      `json:"name"`
	Together bool        `json:"together"`
	Garden   GardenState `json:"garden"`
	At       int64       `json:"at"`
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

// validateCursor 校验一条光标上报，返回规范化后的世界坐标。
// 规则：type=cursor；v 必须为 3；wx/wy 必须存在（nil 即"没传"，0 是合法坐标）、
// 有限、|值| ≤ 1e7；island 非空时必须能在权威列表里找到。
// 任何一项不满足都返回 error，调用方丢弃整条消息但不杀连接。
// 注意：本函数不返回 island——客户端自报值不参与判定，权威归属由 resolveIsland 重算。
func validateCursor(m cursorMsg) (float64, float64, error) {
	if m.Type != "cursor" {
		return 0, 0, errors.New("类型不是 cursor")
	}
	if m.V != 3 {
		return 0, 0, errors.New("协议版本不支持（需要 v=3）")
	}
	if m.WX == nil || m.WY == nil {
		return 0, 0, errors.New("缺少坐标字段")
	}
	x, y := *m.WX, *m.WY
	if math.IsNaN(x) || math.IsNaN(y) || math.IsInf(x, 0) || math.IsInf(y, 0) {
		return 0, 0, errors.New("坐标必须是有限数")
	}
	if math.Abs(x) > 1e7 || math.Abs(y) > 1e7 {
		return 0, 0, errors.New("坐标超出世界范围")
	}
	if m.Island != "" {
		if _, ok := islandByID(m.Island); !ok {
			return 0, 0, errors.New("island 不在权威列表")
		}
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
