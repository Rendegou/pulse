package main

import (
	"encoding/json"
	"testing"
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
	if err := check(`{"type":"pulse","clientEventId":"c0","x":0,"y":0}`); err != nil {
		t.Errorf("零坐标应合法, 得到 %v", err)
	}

	// 非法三条：期望被拒绝（err != nil 是正确行为），放行才是失败
	if err := check(`{"type":"pulse","clientEventId":"c0","y":0}`); err == nil {
		t.Errorf("缺 x 字段应被拒绝, 但被放行了")
	}

	if err := check(`{"type":"pulse","clientEventId":"c0","x":null,"y":0}`); err == nil {
		t.Errorf("x 显式为 null 应被拒绝, 但被放行了")
	}

	if err := check(`{"type":"pulse","clientEventId":"c0","x":-0.1,"y":0}`); err == nil {
		t.Errorf("x 为 -0.1 应被拒绝, 但被放行了")
	}

}
