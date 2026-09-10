package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"net"
	"os"
	"runtime"
	"sync"
	"sync/atomic"
	"time"
)

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
