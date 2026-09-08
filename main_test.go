package main

import (
	"encoding/json"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// TestValidatePulse 覆盖校验边界：零坐标合法（零值≠缺失），
// 缺字段 / 显式 null / 越界都非法。
func TestValidatePulse(t *testing.T) {
	// check 从一段 JSON 构造输入并返回校验结果。
	// 测试的重点正是"JSON 解码后字段还在不在"，所以必须从 JSON 造输入，
	// 不能直接 new 一个 pulseMsg。
	check := func(input string) error {
		var m pulseMsg
		if err := json.Unmarshal([]byte(input), &m); err != nil {
			t.Fatalf("测试输入本身不合法: %v", err)
		}
		_, _, err := validatePulse(m)
		return err
	}

	// 合法：{x:0, y:0} 是真实坐标，不能被误判成"没传"
	if err := check(`{"type":"pulse","v":2,"clientEventId":"c0","wx":0,"wy":0}`); err != nil {
		t.Errorf("零坐标应合法, 得到 %v", err)
	}

	// 非法三条：期望被拒绝（err != nil 是正确行为），放行才是失败
	if err := check(`{"type":"pulse","v":2,"clientEventId":"c0","wy":0}`); err == nil {
		t.Errorf("缺 x 字段应被拒绝, 但被放行了")
	}

	if err := check(`{"type":"pulse","v":2,"clientEventId":"c0","wx":null,"wy":0}`); err == nil {
		t.Errorf("x 显式为 null 应被拒绝, 但被放行了")
	}

	if err := check(`{"type":"pulse","v":2,"clientEventId":"c0","wx":1e8,"wy":0}`); err == nil {
		t.Errorf("wx 超出世界范围(1e8)应被拒绝, 但被放行了")
	}

}

// TestAllowPulse 令牌桶行为：满桶 4 次全过、第 5 次拒、时间回充后再过。
// 用注入的时间驱动，不做真实 sleep。
func TestAllowPulse(t *testing.T) {
	base := time.Now()
	s := &Session{pulseTokens: 4, pulseLast: base}

	for i := 0; i < 4; i++ {
		if !s.allowPulse(base) {
			t.Fatalf("满桶第 %d 次应通过", i+1)
		}
	}
	if s.allowPulse(base) {
		t.Fatal("第 5 次（同一时刻）应被拒绝")
	}
	// 1 秒后回充 2 个令牌（2/s）：能再过 2 次，第 3 次又拒
	if !s.allowPulse(base.Add(time.Second)) || !s.allowPulse(base.Add(time.Second)) {
		t.Fatal("回充后应能再连续通过 2 次")
	}
	if s.allowPulse(base.Add(time.Second)) {
		t.Fatal("回充的 2 个用完后应再拒")
	}
}

// TestSlowConsumerKicked 集成测试（本地随机端口，真实 WS 握手）：
// 慢消费者（从不读取）的缓冲被灌满后，服务端应关闭它的连接并回收；
// 健康消费者在同一段时间里持续收到消息，且没有被踢掉。
//
// 判定不依赖"某一瞬间 hub.Count() 恰好等于 1"：广播洪泛时两个连接都可能短暂
// 处于注销中，那一瞬间读数会抖。这里改成看两条连接各自的实际结局。
func TestSlowConsumerKicked(t *testing.T) {
	hub := NewHub()
	srv := httptest.NewServer(wsHandler{hub})
	defer srv.Close()
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"

	// 慢消费者：握手成功后永远不再读
	slow, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer slow.Close()

	// 健康消费者：持续读，统计读到的消息数；记录读循环的结局
	fast, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer fast.Close()
	var fastReads atomic.Int64
	fastAlive := make(chan struct{}) // 关闭表示读循环正常结束（未被服务端断开）
	go func() {
		defer close(fastAlive)
		_ = fast.SetReadDeadline(time.Now().Add(20 * time.Second))
		for {
			if _, _, err := fast.ReadMessage(); err != nil {
				return
			}
			fastReads.Add(1)
		}
	}()

	// 洪泛广播：1KB/条。循环里带节流——不限速时广播速率会超过健康消费者的读速，
	// 两条连接的写缓冲都会打满，测不出"只踢慢消费者"这件事。
	// 洪泛广播：1KB/条，每条之间留 1ms——慢消费者 64 格的发送缓冲很快填满，
	// 而健康消费者能持续读走，因此只有慢的那条会被判定并回收。
	// 完全不限速时两条连接的缓冲都会打满，测不出"只踢慢消费者"这件事。
	big := strings.Repeat("x", 1024)
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) && hub.Count() > 1 {
		hub.Broadcast(map[string]string{"type": "flood", "data": big})
		time.Sleep(time.Millisecond)
	}

	// 给注销路径一点时间落地，再断言两条连接的最终结局
	waitUntil(t, 3*time.Second, func() bool { return hub.Count() <= 1 })
	if hub.Count() != 1 {
		t.Fatalf("慢消费者应被回收、健康连接应留下, 当前在线 %d", hub.Count())
	}
	if fastReads.Load() == 0 {
		t.Fatal("健康消费者应持续收到消息")
	}
	select {
	case <-fastAlive:
		t.Fatal("健康消费者不应被服务端断开")
	default:
	}
}

// waitUntil 在超时前轮询条件，避免测试依赖固定 sleep 的时长。
// cond 为真立即返回；超时则让测试失败并给出当前状态。
func waitUntil(t *testing.T, timeout time.Duration, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// TestIslandsDeterministic 验证权威岛列表的确定性与拷贝语义：
// 两次调用内容必须一致；调用方改返回值不能污染内部定义（否则某次序列化就能改掉世界几何）。
func TestIslandsDeterministic(t *testing.T) {
	first := Islands()
	second := Islands()
	if len(first) != 3 {
		t.Fatalf("权威岛列表应固定为 3 座, 得到 %d", len(first))
	}
	if !reflect.DeepEqual(first, second) {
		t.Fatalf("两次 Islands() 应完全一致:\n%+v\n%+v", first, second)
	}

	// 改动第一次拿到的切片（含元素字段与整元素替换）：下一次调用必须还是原值
	first[0].ID = "tampered"
	first[0].X = 99999
	first[1] = Island{ID: "junk"}
	third := Islands()
	if !reflect.DeepEqual(third, second) {
		t.Fatalf("修改返回值污染了内部定义:\n%+v\n%+v", third, second)
	}
}

// TestResolveIsland 验证岛归属的权威判定：岛心命中自己、远点算在海上、
// 两岛之间的点归更近的一座。坐标单位是世界单位，与前端 islands 数组同一坐标系。
func TestResolveIsland(t *testing.T) {
	// 三座岛的中心坐标各自命中自己
	centers := []struct {
		id string
		x  float64
		y  float64
	}{
		{"origin", 0, 0},
		{"rain", -1060, -640},
		{"letter", 1030, -490},
	}
	for _, c := range centers {
		if got := resolveIsland(c.x, c.y); got != c.id {
			t.Errorf("(%v,%v) 是 %s 岛中心, 应判定为 %s, 得到 %q", c.x, c.y, c.id, c.id, got)
		}
	}

	// 远离所有岛：连 1.15 容差都够不到 → 在海上
	if got := resolveIsland(5000, 5000); got != "" {
		t.Errorf("远离所有岛的坐标应判定为在海上, 得到 %q", got)
	}

	// 相邻两岛之间：origin(0,0) 与 rain(-1060,-640) 中心连线上、靠 origin 一侧的点
	// (-205.5,-124)。对 origin 的归一化距离约 1.10（在岸线容差内），
	// 对 rain 约 6.24（够不到），所以它必须归更近的 origin。
	if got := resolveIsland(-205.5, -124); got != "origin" {
		t.Errorf("两岛连线靠 origin 一侧的点应归 origin, 得到 %q", got)
	}
	// 把"更近"钉死：同一坐标在 origin 容差内、在 rain 容差外，且对 origin 的归一化距离更小。
	origin, ok := islandByID("origin")
	if !ok {
		t.Fatal("权威列表缺少 origin 岛")
	}
	rain, ok := islandByID("rain")
	if !ok {
		t.Fatal("权威列表缺少 rain 岛")
	}
	if !islandContains(origin, -205.5, -124) || islandContains(rain, -205.5, -124) {
		t.Error("测试点应落在 origin 容差内、rain 容差外")
	}
	if islandNormDist(origin, -205.5, -124) >= islandNormDist(rain, -205.5, -124) {
		t.Error("测试点对 origin 的归一化距离应小于对 rain 的")
	}
	if _, ok := islandByID("atlantis"); ok {
		t.Error("未知 id 必须返回 false")
	}

	// 两岛中心的精确中点 (-530,-320)：两岛中心距约 1238 世界单位，而两个 1.15 容差椭圆
	// 的长半轴之和约 486，所以它们根本不重叠——中点在海上，不能被硬塞给任何一座岛。
	// "多座岛同时命中取最近" 的分支在当前三座岛的数值下不可达，这里只钉住几何事实。
	if got := resolveIsland(-530, -320); got != "" {
		t.Errorf("两岛中点超出双方容差应判定为在海上, 得到 %q", got)
	}
}

// TestIslandContains 验证岸线容差边界：归一化椭圆距离 1.14 命中、1.16 不命中。
// 用合成岛（不依赖权威列表的数值），并覆盖 Y 轴压扁与非法岛定义两种边界。
func TestIslandContains(t *testing.T) {
	isl := Island{ID: "unit", R: 100, SY: 1}
	if !islandContains(isl, 114, 0) {
		t.Error("归一化距离 1.14 应命中（含岸边浅滩容差）")
	}
	if islandContains(isl, 116, 0) {
		t.Error("归一化距离 1.16 应不命中")
	}

	// SY 参与 Y 轴判定：R=100、SY=0.5 时 y=57 的归一化距离是 1.14，y=58 是 1.16
	flat := Island{ID: "flat", R: 100, SY: 0.5}
	if !islandContains(flat, 0, 57) {
		t.Error("压扁岛上归一化距离 1.14 应命中")
	}
	if islandContains(flat, 0, 58) {
		t.Error("压扁岛上归一化距离 1.16 应不命中")
	}

	// 非法岛定义（R/SY 非正）不能靠除零结果混过判定
	if islandContains(Island{ID: "bad", R: 0, SY: 1}, 0, 0) {
		t.Error("R=0 的非法岛定义应一律不命中")
	}
}

// TestCursorIslandAuthority 验证服务端不信任客户端自报的 island：
// 自报 letter 但坐标在 origin 岛中心时，权威判定必须是 origin；
// 不存在的岛名与旧版本 v=2 整条拒绝。
func TestCursorIslandAuthority(t *testing.T) {
	// decode 从 JSON 构造 cursorMsg——校验的前提正是"JSON 解码后字段还在不在"
	decode := func(input string) cursorMsg {
		t.Helper()
		var m cursorMsg
		if err := json.Unmarshal([]byte(input), &m); err != nil {
			t.Fatalf("测试输入本身不合法: %v", err)
		}
		return m
	}

	// 自报 letter，坐标是 origin 岛中心：消息本身合法，但归属由服务端按坐标重算
	wx, wy, err := validateCursor(decode(`{"type":"cursor","v":3,"wx":0,"wy":0,"island":"letter"}`))
	if err != nil {
		t.Fatalf("合法的 v=3 上报应通过校验, 得到 %v", err)
	}
	if got := resolveIsland(wx, wy); got != "origin" {
		t.Errorf("服务端应以坐标判定为 origin, 得到 %q", got)
	}

	// 不存在的岛名：整条消息拒绝（丢弃而不是杀连接）
	if _, _, err := validateCursor(decode(`{"type":"cursor","v":3,"wx":0,"wy":0,"island":"atlantis"}`)); err == nil {
		t.Error("不存在的 island 应被拒绝, 但被放行了")
	}

	// v=2 是旧的屏幕归一化语义，与新世界坐标不能并存
	if _, _, err := validateCursor(decode(`{"type":"cursor","v":2,"wx":0,"wy":0}`)); err == nil {
		t.Error("v=2 应被拒绝, 但被放行了")
	}

	// 在海上可以不传 island（省略与空字符串等价）
	if _, _, err := validateCursor(decode(`{"type":"cursor","v":3,"wx":5000,"wy":5000}`)); err != nil {
		t.Errorf("省略 island（在海上）应通过校验, 得到 %v", err)
	}
}

// TestPresenceBroadcast 集成测试（本地随机端口，真实 WS 握手）：
// 客户端 A 的岛归属真正变化时旁观者 B 收到一次 presence（island 从 origin 变为 rain），
// 同一岛内继续移动不再产生 presence。全程用带超时的读循环，不用 sleep 猜时序。
func TestPresenceBroadcast(t *testing.T) {
	hub := NewHub()
	srv := httptest.NewServer(wsHandler{hub})
	defer srv.Close()
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"

	// B 先连上作为旁观者：它只读不发 cursor，所以不会有自己的 presence
	b, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	var welcome welcomeMsg
	if err := b.ReadJSON(&welcome); err != nil {
		t.Fatalf("读取 welcome 失败: %v", err)
	}
	if len(welcome.Islands) != 3 {
		t.Fatalf("welcome 应带 3 座权威岛, 得到 %d", len(welcome.Islands))
	}

	// A 连上：B 从 join 广播里学到 A 的会话 id 和出生岛归属
	a, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()

	_ = b.SetReadDeadline(time.Now().Add(10 * time.Second))
	var aID, spawnIsland string
	for aID == "" {
		_, data, err := b.ReadMessage()
		if err != nil {
			t.Fatalf("等待 A 的 join 广播失败: %v", err)
		}
		var head msgHead
		if json.Unmarshal(data, &head) != nil || head.Type != "join" {
			continue // welcome 之后还有各条 join，只认 join 类型
		}
		var jm joinMsg
		if err := json.Unmarshal(data, &jm); err != nil {
			t.Fatalf("join 广播无法解析: %v", err)
		}
		if jm.Session.ID == welcome.You {
			continue // B 自己的 join
		}
		// 顺带核对 join 的 session 真的带上了新协议字段（字段名就是协议，不能改名）
		var shape struct {
			Session map[string]json.RawMessage `json:"session"`
		}
		if err := json.Unmarshal(data, &shape); err != nil {
			t.Fatalf("join 广播无法解析: %v", err)
		}
		for _, key := range []string{"island", "wx", "wy"} {
			if _, ok := shape.Session[key]; !ok {
				t.Errorf("join 的 session 缺少字段 %q", key)
			}
		}
		aID, spawnIsland = jm.Session.ID, jm.Session.Island
	}

	// send 用 A 的连接上报一个世界坐标；island 是故意填的客户端自报值（服务端不该信）
	send := func(wx, wy float64, island string) {
		t.Helper()
		if err := a.WriteJSON(cursorMsg{Type: "cursor", V: 3, WX: &wx, WY: &wy, Island: island}); err != nil {
			t.Fatalf("A 上报光标失败: %v", err)
		}
	}

	// nextPresence 一直读到属于 A 的下一条 presence，返回它的岛归属；
	// cursor 等其他消息跳过，10 秒读超时即失败。
	nextPresence := func() string {
		t.Helper()
		_ = b.SetReadDeadline(time.Now().Add(10 * time.Second))
		for {
			_, data, err := b.ReadMessage()
			if err != nil {
				t.Fatalf("等待 A 的 presence 失败: %v", err)
			}
			var head msgHead
			if json.Unmarshal(data, &head) != nil || head.Type != "presence" {
				continue
			}
			var pm presenceMsg
			if err := json.Unmarshal(data, &pm); err != nil {
				t.Fatalf("presence 无法解析: %v", err)
			}
			if pm.ID != aID {
				continue
			}
			if pm.At <= 0 {
				t.Errorf("presence 的 at 应是服务端毫秒时间戳, 得到 %d", pm.At)
			}
			return pm.Island
		}
	}

	// 出生在岛上时，先漂到海上制造一次确定的归属变化；
	// 出生本来就在海上（island==""）则这一步不会产生 presence，跳过即可。
	if spawnIsland != "" {
		send(5000, 5000, "")
		if got := nextPresence(); got != "" {
			t.Fatalf("漂到海上应广播 island 为空字符串, 得到 %q", got)
		}
	}

	// A 自报 letter，坐标却是 origin 岛中心：广播出去的必须是服务端判定的 origin
	send(0, 0, "letter")
	if got := nextPresence(); got != "origin" {
		t.Fatalf("origin 岛中心应广播 island=origin（不信自报的 letter）, 得到 %q", got)
	}

	// 移到 rain 岛中心：自报 origin，权威判定仍是 rain
	send(-1060, -640, "origin")
	if got := nextPresence(); got != "rain" {
		t.Fatalf("rain 岛中心应广播 island=rain, 得到 %q", got)
	}

	// 同一座岛内再移动一次，然后才离开 rain。
	// 下一条 presence 必须是 letter：若同岛内移动也广播，这里会先读到 rain。
	// 顺序由单条连接的收发次序保证，不依赖任何计时。
	send(-1100, -700, "rain")
	send(1030, -490, "rain")
	if got := nextPresence(); got != "letter" {
		t.Fatalf("同岛内移动不应再广播 presence；下一条应是 letter, 得到 %q", got)
	}
}
