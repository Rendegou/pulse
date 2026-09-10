package main

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// TestPublicSnapshotOwnership 验证公开快照可独立修改；并发私有字段只归 readPump 所有。
// 此并发路径可由 Linux CI 的 race detector 检查，普通通过不等于本机 race 已验证。
func TestPublicSnapshotOwnership(t *testing.T) {
	hub := NewHub(newGardenForTest("", nil))
	session := &Session{ID: "sample-session", WX: 12, WY: 34, Island: "origin"}
	hub.sessions[session] = true
	snapshot := hub.Snapshot()
	snapshot[0].WX = -99
	if hub.Snapshot()[0].WX != 12 {
		t.Fatal("caller changed shared session via snapshot")
	}
	data, err := json.Marshal(snapshot[0])
	if err != nil {
		t.Fatal(err)
	}
	var shape map[string]any
	if err := json.Unmarshal(data, &shape); err != nil || len(shape) != 6 {
		t.Fatalf("public schema changed: %s, err=%v", data, err)
	}
	var done sync.WaitGroup
	done.Add(1)
	// 模拟 readPump 在不持 Hub 锁时改变自己的动作状态。
	go func() {
		defer done.Done()
		for i := 0; i < 5000; i++ {
			session.waterNext = time.Unix(int64(i), 0)
			session.waterRing = []string{"request"}
		}
	}()
	for i := 0; i < 5000; i++ {
		_ = hub.Snapshot()
	}
	done.Wait()
}

// TestConnectionBudgetAtomic 验证并发握手只占两席、失败握手归还席位、离场后可重新进入。
func TestConnectionBudgetAtomic(t *testing.T) {
	hub := NewHub(newGardenForTest("", nil))
	hub.slots = make(chan struct{}, 2)
	handler := wsHandler{hub}
	bad := httptest.NewRecorder()
	handler.ServeHTTP(bad, httptest.NewRequest("GET", "/ws", nil))
	if bad.Code != 400 || len(hub.slots) != 0 {
		t.Fatal("failed upgrade leaked a connection slot")
	}
	server := httptest.NewServer(handler)
	defer server.Close()
	url := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws"
	type result struct {
		conn *websocket.Conn
		code int
	}
	results := make(chan result, 8)
	start := make(chan struct{})
	// 所有请求一起进入；成功连接先保持打开，避免测试把先离场误当成超额接纳。
	for i := 0; i < cap(results); i++ {
		go func() {
			<-start
			conn, response, _ := websocket.DefaultDialer.Dial(url, nil)
			code := 0
			if response != nil {
				code = response.StatusCode
				if conn == nil {
					_ = response.Body.Close()
				}
			}
			results <- result{conn: conn, code: code}
		}()
	}
	close(start)
	var admitted []*websocket.Conn
	for i := 0; i < cap(results); i++ {
		select {
		case res := <-results:
			if res.conn != nil {
				admitted = append(admitted, res.conn)
				defer res.conn.Close()
			} else if res.code != 503 {
				t.Errorf("expected capacity rejection, got %d", res.code)
			}
		case <-time.After(5 * time.Second):
			t.Fatal("concurrent handshakes did not finish")
		}
	}
	if len(admitted) != 2 || len(hub.slots) != 2 {
		t.Fatalf("capacity exceeded: admitted=%d reserved=%d", len(admitted), len(hub.slots))
	}
	for _, conn := range admitted {
		_ = conn.Close()
	}
	deadline := time.Now().Add(3 * time.Second)
	for len(hub.slots) != 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if len(hub.slots) != 0 {
		t.Fatal("disconnected clients did not release slots")
	}
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatalf("released capacity cannot be reused: %v", err)
	}
	_ = conn.Close()
}

// TestResultToDepartedSession 验证迟到的点对点回应不会写入已关闭的发送队列。
func TestResultToDepartedSession(t *testing.T) {
	hub := NewHub(newGardenForTest("", nil))
	session := &Session{send: make(chan []byte, 1)}
	close(session.send)
	hub.sendTo(session, waterResultMsg{Type: "water_result", OK: true})
	if hub.dropped.Load() != 0 {
		t.Fatal("departed session should be ignored, not counted as live backpressure")
	}
}
