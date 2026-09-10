package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"runtime"
	"time"
)

// startedAt 是进程启动时刻，供 /healthz 报告 uptime。
var startedAt = time.Now()

// main 装配 Hub、周期指标广播和 HTTP 路由，监听本地回环地址。
func main() {
	log.SetFlags(log.LstdFlags | log.Lmicroseconds)
	// 磁盘错误在启动边界处理；Hub 构造本身不做隐藏 IO 或 os.Exit。
	garden, err := NewGarden()
	if err != nil {
		log.Fatalf("启动失败: %v", err)
	}
	hub := NewHub(garden)

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
	// 健康检查：供部署脚本和巡检确认进程活着、在收连接、带多少座权威岛，
	// 以及花园当前的生长阶段（不暴露照料者身份，只看阶段）。
	http.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		plants := hub.garden.Snapshot().Plants
		care := make([]int, 0, len(plants))
		for _, p := range plants {
			care = append(care, p.Care)
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		fmt.Fprintf(w, `{"status":"ok","conns":%d,"islands":%d,"plants":%d,"care":%v,"uptime_s":%d}`,
			hub.Count(), len(Islands()), len(plants), care, int64(time.Since(startedAt).Seconds()))
	})
	http.Handle("/", frontendHandler())

	addr := "127.0.0.1:8090"
	if configured := os.Getenv("PULSE_ADDR"); configured != "" {
		addr = configured
	}
	log.Printf("PULSE 骨架监听 http://%s （打开两个标签页试试）", addr)
	log.Fatal(http.ListenAndServe(addr, nil))
}
