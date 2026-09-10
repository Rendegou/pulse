// garden.go — 岛屿花园：服务端权威的植物生长状态。
//
// 数据边界：
//   - 植物状态由服务端确认后才变化，前端不自行加 care；所有连接看到同一份快照。
//   - 只有 care（0..3 生长阶段）与 last（最近照料者）是可共享事实；
//     连接身份仍是临时的 Session id，不是注册用户。
//   - 保存成功后才发布候选状态，写失败保留旧内存；损坏或形状错误时拒绝启动并保留文件。
//     原子替换不等于已经验证断电持久性，存储保证以 G0 的验证范围为准。
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
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

// errUnknownPlant 是"植物不存在"的哨兵错误：water 分支据此返回 not_found 而不是 save_failed。
var errUnknownPlant = errors.New("未知植物")

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

// Garden 持有花园状态并负责落盘。
// 提交模型（G0 串行提交）：一次 Water 在 mu 内完成"候选快照 → 保存 → 发布"，
// 保存失败丢弃候选、内存不变；mu 只保护 Garden 自己，不持有全局 Hub 锁做磁盘 IO。
type Garden struct {
	mu        sync.Mutex
	state     GardenState
	path      string
	persister func(GardenState) error // 可注入的保存器：测试用桩控制暂停/失败
}

// gardenStatePath 返回状态文件路径：PULSE_GARDEN_STATE 可覆盖（测试用临时文件），
// 默认写在当前工作目录，与二进制同目录，重启后仍在。
func gardenStatePath() string {
	if p := os.Getenv("PULSE_GARDEN_STATE"); p != "" {
		return p
	}
	return "pulse-garden-state.json"
}

// NewGarden 创建花园并尝试从磁盘恢复。
// 文件不存在：合法的首次启动，从零开始。
// 读取错误 / 内容损坏：返回错误并保留原文件——不能静默把用户数据当成新花园（G0）。
func NewGarden() (*Garden, error) {
	g := &Garden{path: gardenStatePath(), state: freshGardenState()}
	g.persister = g.persistToFile
	st, err := loadGardenState(g.path)
	if err != nil {
		return nil, fmt.Errorf("花园状态无法恢复: %w", err)
	}
	g.state = st
	return g, nil
}

// newGardenForTest 是测试边界：注入自定义路径与保存器，跳过文件初始化。
// 生产代码不使用；NewGarden 是唯一的生产入口。
func newGardenForTest(path string, persister func(GardenState) error) *Garden {
	return &Garden{path: path, state: freshGardenState(), persister: persister}
}

// freshGardenState 返回三株未照料的植物（与三座示例岛一一对应）。
func freshGardenState() GardenState {
	return GardenState{Version: 0, Plants: []Plant{{}, {}, {}}}
}

// loadGardenState 读取并校验状态文件。
// 文件不存在时返回初始快照且 err=nil（合法首次启动）；
// 读取错误、JSON 解析失败、形状非法都返回错误——由调用方决定失败方式，绝不静默初始化。
func loadGardenState(path string) (GardenState, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return freshGardenState(), nil
		}
		return GardenState{}, err
	}
	var st GardenState
	if err := json.Unmarshal(raw, &st); err != nil {
		return GardenState{}, fmt.Errorf("状态文件不是合法 JSON: %w", err)
	}
	if len(st.Plants) != len(Islands()) || st.Version < 0 {
		return GardenState{}, errors.New("状态文件形状不符（植物数量或版本非法）")
	}
	for i := range st.Plants {
		if st.Plants[i].Care < 0 || st.Plants[i].Care > maxCare {
			return GardenState{}, errors.New("状态文件中的 care 越界")
		}
	}
	return st, nil
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

// Water 记录一次照料：串行提交（候选快照 → 保存 → 发布）。
// plantID 必须是权威岛 id；未知 id 返回错误且不改状态。
// 保存失败：候选快照被丢弃，内存与保存前完全一致（这是 G0 的核心保证）；
// 保存成功才发布新内存状态并返回快照。阶段到顶后 care 不变、version 仍递增。
//
// 并发边界：整个提交在 g.mu 内完成（含磁盘 IO），因此两个并发 Water 必然
// 一个完整提交后另一个才开始——不会出现"旧快照更晚完成替换"的版本倒退。
func (g *Garden) Water(plantID, sessionID, name string, now time.Time) (GardenState, bool, error) {
	index := -1
	for i, isl := range Islands() {
		if isl.ID == plantID {
			index = i
			break
		}
	}
	if index < 0 {
		return GardenState{}, false, errUnknownPlant
	}

	g.mu.Lock()
	defer g.mu.Unlock()

	// 候选快照：基于当前内存构建，先不发布
	candidate := cloneGardenState(g.state)
	together := candidate.Plants[index].Last != nil &&
		candidate.Plants[index].Last.ID != sessionID &&
		now.UnixMilli()-candidate.Plants[index].Last.At <= togetherWindowMs
	if candidate.Plants[index].Care < maxCare {
		candidate.Plants[index].Care++
	}
	candidate.Plants[index].Last = &PlantLast{ID: sessionID, Name: name, At: now.UnixMilli()}
	candidate.Version++

	if err := g.persister(candidate); err != nil {
		// 保存失败：候选丢弃，内存不变（defer 解锁时一切如旧）
		return GardenState{}, false, fmt.Errorf("保存失败: %w", err)
	}
	// 保存成功才发布
	g.state = candidate
	return cloneGardenState(g.state), together, nil
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

// ---------- 地表高度（与前端 frontend/src/engine/pure.js 同一套公式） ----------

// islandBoundaryAt 返回岸线在角度 a 处的半径倍率，seed 决定岛屿的不规则形状。
// 与前端 islandBoundary 保持一致：两端用同一函数，指针才会落在同一处地表。
func islandBoundaryAt(a float64, seed int) float64 {
	s := float64(seed)
	return 1 + 0.11*math.Sin(3*a+s) + 0.065*math.Cos(5*a-s*0.3) + 0.04*math.Sin(2*a+s)
}

// islandTerrainHeight 返回岛面在岛屿局部坐标 (x,y) 处的高度（海平面为 0）。
// 与前端 islandTerrainHeight 同一公式：岸边贴近海面、内侧隆起，再叠加一个小丘。
func islandTerrainHeight(isl Island, x, y float64) float64 {
	if isl.SY <= 0 || isl.R <= 0 {
		return 0
	}
	a := math.Atan2(y/isl.SY, x)
	r := math.Hypot(x, y/isl.SY) / (isl.R * islandBoundaryAt(a, isl.Seed))
	inner := math.Max(0, 1-r*r)
	return 5 + 57*math.Pow(inner, 1.6) +
		20*math.Exp(-((x+55)*(x+55)/8500+(y+40)*(y+40)/3300))
}

// surfaceHeight 返回世界坐标处的地表高度：在岛上就是地形高度，在海上就是 0。
// 只用于把指针/会话的显示高度对齐到地表；不参与岛归属判定（那是 resolveIsland 的事）。
func surfaceHeight(x, y float64) float64 {
	if math.IsNaN(x) || math.IsNaN(y) {
		return 0
	}
	for _, isl := range islands {
		dx, dy := x-isl.X, y-isl.Y
		c, sn := math.Cos(isl.Rot), math.Sin(isl.Rot)
		lx := dx*c + dy*sn
		ly := -dx*sn + dy*c
		if math.Hypot(lx, ly/isl.SY) < isl.R*0.98 {
			return islandTerrainHeight(isl, lx, ly) + 2
		}
	}
	return 0
}

// persistToFile 是默认保存器：先写临时文件再原子替换，中途失败不留下半截状态文件。
// 注意边界：原子替换只保证"不读到半截文件"，不等于断电不丢；
// 目录不存在或权限不足时返回错误（调用方按 save_failed 上报）。
func (g *Garden) persistToFile(st GardenState) error {
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
