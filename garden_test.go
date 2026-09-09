package main

import (
	"encoding/json"
	"math"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// TestSurfaceHeight 覆盖地表高度：海上为 0，岛心明显高于岸边，且与前端公式同源。
// 这个值会写进 cursor 广播的 z 字段，让别人的指针贴着岛面。
func TestSurfaceHeight(t *testing.T) {
	if got := surfaceHeight(5000, 5000); got != 0 {
		t.Errorf("海上高度应为 0，实际 %v", got)
	}
	origin, _ := islandByID("origin")
	center := surfaceHeight(origin.X, origin.Y)
	if center < 40 {
		t.Errorf("岛心高度应明显大于 0，实际 %v", center)
	}
	// 岸边（半径 0.98 处）应低于岛心，但仍在地形范围内
	edge := surfaceHeight(origin.X+origin.R*0.98, origin.Y)
	if edge >= center {
		t.Errorf("岸边(%v) 应低于岛心(%v)", edge, center)
	}
	if edge < 0 || center > 90 {
		t.Errorf("高度应落在有界范围：edge=%v center=%v", edge, center)
	}
}

// TestSurfaceHeightMatchesFrontend 覆盖前后端地形公式一致性：
// 前端 static/pure.js 用同一组常数，改动一侧必须同步另一侧。
func TestSurfaceHeightMatchesFrontend(t *testing.T) {
	origin, _ := islandByID("origin")
	// 与 JS 端 islandTerrainHeight(isl, 0, 0) 的手算值对齐（5 + 57 + 20·exp(-…)）
	want := islandTerrainHeight(origin, 0, 0)
	if got := surfaceHeight(origin.X, origin.Y); math.Abs(got-(want+2)) > 1e-9 {
		t.Errorf("surfaceHeight 应等于地形高度 +2：got=%v want=%v", got, want+2)
	}
}

// writeFile 把测试用的原始内容写进指定路径（用于构造损坏的状态文件）。
func writeFile(path, body string) error {
	return os.WriteFile(path, []byte(body), 0o644)
}

// newWSTestServer 起一个只带 WebSocket 路由的本地测试服务器。
func newWSTestServer(t *testing.T, hub *Hub) *httptest.Server {
	t.Helper()
	return httptest.NewServer(wsHandler{hub})
}

// dialWS 连接测试服务器的 /ws，并确保连接在测试结束时关闭。
func dialWS(t *testing.T, srv *httptest.Server) *websocket.Conn {
	t.Helper()
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("连接测试服务器失败: %v", err)
	}
	return conn
}

// readUntil 读到指定类型的消息并返回其花园广播内容；其它类型（welcome/join 等）跳过。
// 超时即判定失败，测试不依赖固定 sleep。
func readUntil(t *testing.T, conn *websocket.Conn, kind string, timeout time.Duration) plantMsg {
	t.Helper()
	_ = conn.SetReadDeadline(time.Now().Add(timeout))
	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			t.Fatalf("等待 %s 消息失败: %v", kind, err)
		}
		var head msgHead
		if json.Unmarshal(data, &head) != nil || head.Type != kind {
			continue
		}
		var pm plantMsg
		if err := json.Unmarshal(data, &pm); err != nil {
			t.Fatalf("%s 消息无法解析: %v", kind, err)
		}
		return pm
	}
}

// expectNoMessage 断言在给定时长内没有消息到达（用于去重、冷却、非法输入的负向验证）。
func expectNoMessage(t *testing.T, conn *websocket.Conn, wait time.Duration) {
	t.Helper()
	_ = conn.SetReadDeadline(time.Now().Add(wait))
	if _, data, err := conn.ReadMessage(); err == nil {
		t.Fatalf("不应收到消息，实际收到: %s", string(data))
	}
}

// readResult 读到一条 water_result 并返回；其它类型跳过。超时即失败。
func readResult(t *testing.T, conn *websocket.Conn, timeout time.Duration) waterResultMsg {
	t.Helper()
	_ = conn.SetReadDeadline(time.Now().Add(timeout))
	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			t.Fatalf("等待 water_result 失败: %v", err)
		}
		var head msgHead
		if json.Unmarshal(data, &head) != nil || head.Type != "water_result" {
			continue
		}
		var rm waterResultMsg
		if err := json.Unmarshal(data, &rm); err != nil {
			t.Fatalf("water_result 无法解析: %v", err)
		}
		return rm
	}
}

// newTestGarden 让状态文件落在 t.TempDir() 下，返回花园与文件路径。
// 用环境变量而不是包级变量，保证测试之间互不污染，也不碰仓库里的真实状态文件。
func newTestGarden(t *testing.T) (*Garden, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "garden.json")
	t.Setenv("PULSE_GARDEN_STATE", path)
	g, err := NewGarden()
	if err != nil {
		t.Fatalf("测试花园初始化失败: %v", err)
	}
	return g, path
}

// TestGardenWaterPersistsAcrossRestart 覆盖：浇水后 care 前进、version 递增、
// 状态写入磁盘，新进程（新 Garden）能从同一文件恢复。
func TestGardenWaterPersistsAcrossRestart(t *testing.T) {
	g, path := newTestGarden(t)
	now := time.UnixMilli(1_700_000_000_000)

	state, together, err := g.Water("origin", "visitor-a", "", now)
	if err != nil {
		t.Fatalf("浇水应成功: %v", err)
	}
	if together {
		t.Error("首次浇水不应该是共同照料")
	}
	if state.Plants[0].Care != 1 || state.Version != 1 {
		t.Fatalf("首次浇水后应 care=1 version=1，实际 care=%d version=%d", state.Plants[0].Care, state.Version)
	}
	if state.Plants[0].Last == nil || state.Plants[0].Last.ID != "visitor-a" {
		t.Fatalf("应记录最近照料者，实际 %+v", state.Plants[0].Last)
	}
	if state.Plants[1].Care != 0 {
		t.Error("只浇了第一株，其他两株不应变化")
	}

	// 重新从磁盘加载：模拟进程重启
	reloaded, err := loadGardenState(path)
	if err != nil {
		t.Fatalf("刚写入的状态应能读回: %v", err)
	}
	if reloaded.Version != 1 || reloaded.Plants[0].Care != 1 {
		t.Fatalf("重启后应保留 care=1 version=1，实际 %+v", reloaded)
	}
}

// TestGardenCareCapAndVersion 覆盖：阶段到顶后 care 不再增加，但 version 继续前进，
// 这样界面仍知道“这次动作被接受了”。
func TestGardenCareCapAndVersion(t *testing.T) {
	g, _ := newTestGarden(t)
	base := time.UnixMilli(1_700_000_000_000)
	for i := 0; i < maxCare+2; i++ {
		state, _, err := g.Water("rain", "visitor-a", "", base.Add(time.Duration(i)*time.Second))
		if err != nil {
			t.Fatalf("第 %d 次浇水应成功: %v", i+1, err)
		}
		wantCare := i + 1
		if wantCare > maxCare {
			wantCare = maxCare
		}
		if state.Plants[1].Care != wantCare {
			t.Fatalf("第 %d 次后 care 应为 %d，实际 %d", i+1, wantCare, state.Plants[1].Care)
		}
		if state.Version != i+1 {
			t.Fatalf("第 %d 次后 version 应为 %d，实际 %d", i+1, i+1, state.Version)
		}
	}
}

// TestGardenUnknownPlant 覆盖：未知岛 id 不改状态、不递增版本。
func TestGardenUnknownPlant(t *testing.T) {
	g, _ := newTestGarden(t)
	before := g.Snapshot()
	if _, _, err := g.Water("no-such-island", "visitor-a", "", time.Now()); err == nil {
		t.Fatal("未知植物应返回错误")
	}
	after := g.Snapshot()
	if after.Version != before.Version || after.Plants[0].Care != before.Plants[0].Care {
		t.Fatalf("失败的浇水不应改变状态：before=%+v after=%+v", before, after)
	}
}

// TestGardenTogetherWindow 覆盖共同照料判定：
// 不同连接在窗口内 → true；同一连接再浇 → false；超出窗口 → false。
func TestGardenTogetherWindow(t *testing.T) {
	g, _ := newTestGarden(t)
	base := time.UnixMilli(1_700_000_000_000)

	if _, together, _ := g.Water("origin", "visitor-a", "", base); together {
		t.Error("第一捧水没有前一个照料者，不应算共同照料")
	}
	// 3 秒后另一个连接浇同一株：在 6 秒窗口内
	_, together, err := g.Water("origin", "visitor-b", "", base.Add(3*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if !together {
		t.Error("另一连接在窗口内照料同一株，应标记为共同照料")
	}
	// 同一连接再浇：即使刚浇过也不算共同照料
	_, together, err = g.Water("origin", "visitor-b", "", base.Add(4*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if together {
		t.Error("同一连接连续照料不应算共同照料")
	}
	// 另一个连接但超出窗口
	_, together, err = g.Water("origin", "visitor-a", "", base.Add(20*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if together {
		t.Error("超出共同照料窗口不应算共同照料")
	}
}

// TestGardenSnapshotIsolation 覆盖快照拷贝语义：改返回值不影响内部状态。
func TestGardenSnapshotIsolation(t *testing.T) {
	g, _ := newTestGarden(t)
	if _, _, err := g.Water("letter", "visitor-a", "", time.Now()); err != nil {
		t.Fatal(err)
	}
	snap := g.Snapshot()
	snap.Plants[2].Care = 99
	snap.Plants[2].Last.ID = "tampered"
	snap.Version = 999

	again := g.Snapshot()
	if again.Plants[2].Care != 1 || again.Version != 1 || again.Plants[2].Last.ID != "visitor-a" {
		t.Fatalf("快照被外部修改后内部状态不应变化：%+v", again)
	}
}

// TestLoadGardenStateRejectsBadShape 覆盖落盘校验：形状不对时回到初始状态，
// 不把损坏文件当成有效历史。
func TestLoadGardenStateRejectsBadShape(t *testing.T) {
	dir := t.TempDir()
	cases := map[string]string{
		"坏 JSON":     `{"version":`,
		"植物数量不对":     `{"version":1,"plants":[{"care":1}]}`,
		"care 越界":    `{"version":1,"plants":[{"care":9},{"care":0},{"care":0}]}`,
		"care 负数":    `{"version":-1,"plants":[{"care":1},{"care":0},{"care":0}]}`,
		"不是对象":       `[]`,
		"version 负数": `{"version":-1,"plants":[{"care":0},{"care":0},{"care":0}]}`,
	}
	for name, body := range cases {
		path := filepath.Join(dir, strings.ReplaceAll(name, " ", "-")+".json")
		if err := writeFile(path, body); err != nil {
			t.Fatal(err)
		}
		if _, err := loadGardenState(path); err == nil {
			t.Errorf("%s：应判定为无效状态", name)
		}
	}
}

// TestWaterMessageDedupAndCooldown 是真实 WS 集成测试：
// 同一条 water 重发只生效一次；冷却期内的新事件被忽略；非法事件整条丢弃。
func TestWaterMessageDedupAndCooldown(t *testing.T) {
	_, path := newTestGarden(t)
	hub := NewHub()
	srv := newWSTestServer(t, hub)
	defer srv.Close()

	conn := dialWS(t, srv)
	defer conn.Close()
	readUntil(t, conn, "welcome", 3*time.Second)

	sendWater := func(plant, eventID string) {
		t.Helper()
		msg, _ := json.Marshal(map[string]any{"type": "water", "v": 1, "plant": plant, "eventId": eventID})
		if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
			t.Fatal(err)
		}
	}

	// 第一次：应收到 plant 广播
	sendWater("origin", "w1")
	first := readUntil(t, conn, "plant", 3*time.Second)
	if first.Garden.Plants[0].Care != 1 {
		t.Fatalf("第一次浇水后 care 应为 1，实际 %d", first.Garden.Plants[0].Care)
	}
	if first.PlantID != "origin" || first.ID == "" {
		t.Fatalf("广播应带植物与连接身份，实际 %+v", first)
	}

	// 同一事件 id 重发：不再生长，但收到明确的幂等确认（G0 语义）
	sendWater("origin", "w1")
	dup := readResult(t, conn, 2*time.Second)
	if !dup.OK || !dup.Duplicate || dup.RequestID != "w1" {
		t.Fatalf("重复请求应返回 ok+duplicate 且回带 requestId，实际 %+v", dup)
	}

	// 冷却期内的新事件：返回 cooldown 与可重试时间
	sendWater("origin", "w2")
	cd := readResult(t, conn, 2*time.Second)
	if cd.OK || cd.Code != "cooldown" || cd.RetryAfterMs <= 0 {
		t.Fatalf("冷却期应返回 cooldown 与 retryAfterMs，实际 %+v", cd)
	}

	// 冷却期内任何动作都是 cooldown（限流先于目标校验，符合 429-before-404 惯例）
	sendWater("no-such-island", "w3")
	cdX := readResult(t, conn, 2*time.Second)
	if cdX.OK || cdX.Code != "cooldown" {
		t.Fatalf("冷却期内应返回 cooldown，实际 %+v", cdX)
	}

	// 等冷却结束（2.5s 权威下限 + 余量）再验证目标级错误
	time.Sleep(2600 * time.Millisecond)
	sendWater("no-such-island", "w3b")
	nf := readResult(t, conn, 2*time.Second)
	if nf.OK || nf.Code != "not_found" {
		t.Fatalf("未知植物应返回 not_found，实际 %+v", nf)
	}
	sendWater("origin", "")
	br := readResult(t, conn, 2*time.Second)
	if br.OK || br.Code != "bad_request" {
		t.Fatalf("空 eventId 应返回 bad_request，实际 %+v", br)
	}

	// 状态文件应停在 care=1，非法动作没有污染磁盘
	st, err := loadGardenState(path)
	if err != nil {
		t.Fatalf("状态文件应可读回: %v", err)
	}
	if st.Plants[0].Care != 1 || st.Version != 1 {
		t.Fatalf("非法动作不应改变状态，实际 care=%d version=%d", st.Plants[0].Care, st.Version)
	}
}
