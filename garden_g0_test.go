package main

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
	"time"
)

// ---------- G0 复现测试：保存一致性 ----------
//
// 目标语义（docs/07 §5 G0）：
//   - 保存失败时内存状态必须与保存前完全一致（候选快照不发布）。
//   - 两个并发提交必须串行：内存版本与最后落盘版本一致且不倒退。
//   - 损坏的状态文件必须报错并保留原字节，不能静默初始化覆盖。

// newG0Garden 用可注入 persister 创建花园（测试边界：不写真实磁盘）。
// freshState 决定初始状态；persister 为 nil 时使用注入的桩。
func newG0Garden(t *testing.T, persist func(GardenState) error) *Garden {
	t.Helper()
	g := &Garden{
		path:      filepath.Join(t.TempDir(), "state.json"),
		state:     freshGardenState(),
		persister: persist,
	}
	return g
}

// TestWaterPersistFailureMustNotChangeMemory 复现问题一：
// 保存失败时，当前实现会先改内存再持久化——内存里出现一次"未确认"的生长。
// 期望：persist 返回错误时，前后 Snapshot 必须完全一致。
func TestWaterPersistFailureMustNotChangeMemory(t *testing.T) {
	boom := errors.New("磁盘写失败（注入）")
	g := newG0Garden(t, func(GardenState) error { return boom })

	before := g.Snapshot()
	_, _, err := g.Water(Islands()[0].ID, "s1", "", time.Now())
	if err == nil {
		t.Fatal("保存失败应返回错误")
	}
	after := g.Snapshot()
	if !reflect.DeepEqual(before, after) {
		t.Fatalf("保存失败后内存被改变：before=%+v after=%+v", before, after)
	}
}

// TestWaterConcurrentCommitMustNotRegress 复现问题二：
// 旧实现解锁后才 persist，两个并发提交可能让"较旧的快照更晚完成替换"，
// 磁盘版本落后于内存版本。
// 期望：串行提交——无论注入的保存器怎样交错，最终内存版本等于最后落盘版本且最大。
func TestWaterConcurrentCommitMustNotRegress(t *testing.T) {
	var mu sync.Mutex
	var persisted []GardenState
	release := make(chan struct{})
	var calls int32
	var muCalls sync.Mutex

	g := newG0Garden(t, func(st GardenState) error {
		muCalls.Lock()
		calls++
		if calls == 1 {
			muCalls.Unlock()
			<-release // 第一次保存挂起，让第二个请求先完成
		} else {
			muCalls.Unlock()
		}
		mu.Lock()
		persisted = append(persisted, st)
		mu.Unlock()
		return nil
	})

	var wg sync.WaitGroup
	wg.Add(2)
	now := time.Now()
	go func() { defer wg.Done(); _, _, _ = g.Water(Islands()[0].ID, "s1", "", now) }()
	go func() { defer wg.Done(); _, _, _ = g.Water(Islands()[0].ID, "s2", "", now) }()

	// 等两个请求都进入保存阶段（第一个已挂起）
	deadline := time.Now().Add(2 * time.Second)
	for {
		muCalls.Lock()
		n := calls
		muCalls.Unlock()
		if n >= 2 || time.Now().After(deadline) {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	close(release)
	wg.Wait()

	mem := g.Snapshot()
	mu.Lock()
	last := persisted[len(persisted)-1]
	mu.Unlock()
	if mem.Version != last.Version {
		t.Fatalf("内存版本 %d 与最后落盘版本 %d 不一致（出现版本倒退/乱序）", mem.Version, last.Version)
	}
	if mem.Version != 2 {
		t.Fatalf("两次成功提交后版本应为 2，实际 %d", mem.Version)
	}
}

// TestLoadGardenStateCorruptMustFail 复现问题三：
// 损坏的状态文件当前会被静默当成"新花园"。
// 期望：解析失败/形状非法必须报错，且原文件字节不被修改。
func TestLoadGardenStateCorruptMustFail(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "broken.json")
	garbage := []byte("{这不是合法 JSON")
	if err := writeFileForTest(path, garbage); err != nil {
		t.Fatal(err)
	}

	_, err := loadGardenState(path)
	if err == nil {
		t.Fatal("损坏文件必须报错，不能静默初始化")
	}

	raw, _ := readFileForTest(path)
	if string(raw) != string(garbage) {
		t.Fatal("损坏文件的内容被修改了")
	}
}

// TestLoadGardenStateMissingIsFresh 对照：文件不存在允许初始化（这是合法的首次启动）。
func TestLoadGardenStateMissingIsFresh(t *testing.T) {
	st, err := loadGardenState(filepath.Join(t.TempDir(), "nope.json"))
	if err != nil {
		t.Fatalf("文件不存在应允许初始化, 得到 %v", err)
	}
	if len(st.Plants) != len(Islands()) {
		t.Fatalf("初始状态应有 %d 株植物", len(Islands()))
	}
}

// 测试辅助：写/读文件。
func writeFileForTest(path string, data []byte) error {
	return os.WriteFile(path, data, 0o644)
}
func readFileForTest(path string) ([]byte, error) {
	return os.ReadFile(path)
}
