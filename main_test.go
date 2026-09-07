package main

import (
	"encoding/json"
	"net/http/httptest"
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
// 健康消费者持续收到消息且不受影响。
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

	// 健康消费者：持续读，统计读到的消息数
	fast, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer fast.Close()
	var fastReads atomic.Int64
	go func() {
		_ = fast.SetReadDeadline(time.Now().Add(15 * time.Second))
		for {
			if _, _, err := fast.ReadMessage(); err != nil {
				return
			}
			fastReads.Add(1)
		}
	}()

	// 洪泛广播：1KB/条，快速填满慢消费者的各级缓冲，直到它被回收
	big := strings.Repeat("x", 1024)
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) && hub.Count() != 1 {
		hub.Broadcast(map[string]string{"type": "flood", "data": big})
	}

	if hub.Count() != 1 {
		t.Fatalf("慢消费者应被回收, 当前在线 %d", hub.Count())
	}
	if fastReads.Load() == 0 {
		t.Fatal("健康消费者应持续收到消息")
	}
}
