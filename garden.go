// garden.go — 岛屿花园：服务端权威的植物生长状态。
//
// 数据边界：
//   - 植物状态由服务端确认后才变化，前端不自行加 care；所有连接看到同一份快照。
//   - 只有 care（0..3 生长阶段）与 last（最近照料者）是可共享事实；
//     连接身份仍是临时的 Session id，不是注册用户。
//   - 状态落盘是“尽量保存”，不是强一致存储：写失败会如实返回错误，调用方据此
//     决定是否广播成功；进程重启后重新读回，损坏或形状不对则回到初始状态。
package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// maxCare 是生长阶段上限：0 未照料 → 1 叶片舒展 → 2 花苞 → 3 开花。
// 到顶后仍可浇水（动作有回应、last 会更新），但不再增加阶段。
const maxCare = 3

// togetherWindowMs 是“共同照料”的时间窗：两个不同连接在此窗口内照料同一株植物，
// 服务端把这次变化标记为 together，前端据此给出额外的共同光点。
const togetherWindowMs = 6000

// waterCooldown 是每连接浇水冷却：比前端略短，服务端是权威下限。
const waterCooldown = 2500 * time.Millisecond

// PlantLast 记录一株植物最近一次被谁照料。
// At 是服务端 unix 毫秒；ID/Name 来自当时的 Session，用于界面显示“最近照料”。
type PlantLast struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	At   int64  `json:"at"`
}

// Plant 是一株示例植物的可共享状态。Care 只会前进到 maxCare，不会枯萎。
type Plant struct {
	Care int        `json:"care"`
	Last *PlantLast `json:"last"`
}

// GardenState 是 welcome 与 plant 广播共用的完整快照。
// Version 单调递增：客户端只接受不倒退的快照，重连时可由 welcome 显式重设。
type GardenState struct {
	Version int     `json:"version"`
	Plants  []Plant `json:"plants"`
}

// Garden 持有花园状态并负责落盘。所有读写都在 mu 下进行；
// 落盘发生在锁外，避免磁盘 IO 拖住广播路径。
type Garden struct {
	mu    sync.Mutex
	state GardenState
	path  string
}

// gardenStatePath 返回状态文件路径：PULSE_GARDEN_STATE 可覆盖（测试用临时文件），
// 默认写在当前工作目录，与二进制同目录，重启后仍在。
func gardenStatePath() string {
	if p := os.Getenv("PULSE_GARDEN_STATE"); p != "" {
		return p
	}
	return "pulse-garden-state.json"
}

// NewGarden 创建花园并尝试从磁盘恢复；文件不存在或内容不合法时从零开始。
// 恢复失败不阻止服务启动：示例花园可以重新长起来，但不假装恢复成功。
func NewGarden() *Garden {
	g := &Garden{path: gardenStatePath(), state: freshGardenState()}
	if loaded, ok := loadGardenState(g.path); ok {
		g.state = loaded
	}
	return g
}

// freshGardenState 返回三株未照料的植物（与三座示例岛一一对应）。
func freshGardenState() GardenState {
	return GardenState{Version: 0, Plants: []Plant{{}, {}, {}}}
}

// loadGardenState 读取并校验状态文件。
// 只接受形状正确的快照：三株植物、care 在 0..maxCare；否则返回 false 走初始状态。
func loadGardenState(path string) (GardenState, bool) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return GardenState{}, false
	}
	var st GardenState
	if err := json.Unmarshal(raw, &st); err != nil {
		return GardenState{}, false
	}
	if len(st.Plants) != len(Islands()) || st.Version < 0 {
		return GardenState{}, false
	}
	for i := range st.Plants {
		if st.Plants[i].Care < 0 || st.Plants[i].Care > maxCare {
			return GardenState{}, false
		}
	}
	return st, true
}

// Snapshot 返回当前花园快照的深拷贝：调用方可以自由序列化或修改，不会影响内部状态。
func (g *Garden) Snapshot() GardenState {
	g.mu.Lock()
	defer g.mu.Unlock()
	return cloneGardenState(g.state)
}

// cloneGardenState 复制植物切片与其中的 Last 指针，避免共享可变对象。
func cloneGardenState(st GardenState) GardenState {
	out := GardenState{Version: st.Version, Plants: make([]Plant, len(st.Plants))}
	for i, p := range st.Plants {
		out.Plants[i] = Plant{Care: p.Care}
		if p.Last != nil {
			last := *p.Last
			out.Plants[i].Last = &last
		}
	}
	return out
}

// Water 记录一次照料并返回新快照与“是否与他人共同照料”。
// plantID 必须是权威岛 id；未知 id 返回错误且不改状态。
// 阶段到顶后 care 不变、version 仍递增，让界面知道这次动作被接受了。
// 落盘失败只返回错误，内存状态与快照仍然有效——调用方可以选择不广播。
func (g *Garden) Water(plantID, sessionID, name string, now time.Time) (GardenState, bool, error) {
	index := -1
	for i, isl := range Islands() {
		if isl.ID == plantID {
			index = i
			break
		}
	}
	if index < 0 {
		return GardenState{}, false, errors.New("未知植物")
	}

	g.mu.Lock()
	p := &g.state.Plants[index]
	together := p.Last != nil && p.Last.ID != sessionID && now.UnixMilli()-p.Last.At <= togetherWindowMs
	if p.Care < maxCare {
		p.Care++
	}
	p.Last = &PlantLast{ID: sessionID, Name: name, At: now.UnixMilli()}
	g.state.Version++
	snapshot := cloneGardenState(g.state)
	g.mu.Unlock()

	if err := g.persist(snapshot); err != nil {
		return snapshot, together, err
	}
	return snapshot, together, nil
}

// waterSeenMax 是每连接保留的照料事件 id 上限：超出后按插入顺序淘汰最旧的。
// 只防同一动作被重复计一次，不需要记住全部历史。
const waterSeenMax = 64

// markWaterSeen 记录一个已处理的照料事件 id，并维持上限。
// 只在 readPump 的单条连接里调用，不需要加锁。
func markWaterSeen(s *Session, eventID string) {
	if s.waterSeen == nil {
		s.waterSeen = make(map[string]bool)
	}
	if !s.waterSeen[eventID] {
		s.waterSeen[eventID] = true
		s.waterRing = append(s.waterRing, eventID)
	}
	for len(s.waterRing) > waterSeenMax {
		delete(s.waterSeen, s.waterRing[0])
		s.waterRing = s.waterRing[1:]
	}
}

// persist 先写临时文件再原子替换：中途失败不会留下半截状态文件。
// 目录不存在或权限不足时返回错误，由调用方决定是否降级为“只在内存中生效”。
func (g *Garden) persist(st GardenState) error {
	data, err := json.MarshalIndent(st, "", "  ")
	if err != nil {
		return err
	}
	dir := filepath.Dir(g.path)
	tmp, err := os.CreateTemp(dir, ".garden-*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName) // 成功替换后这次删除是空操作
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpName, g.path)
}
