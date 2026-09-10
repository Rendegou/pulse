package main

import (
	"math"
)

// ---------- 世界地标（岛屿） ----------

// Island 是服务端权威的世界地标（个人空间）。
// 位置/半径/朝向/种子决定岛屿的确定性形状，客户端必须用同一组参数生成几何。
type Island struct {
	ID     string  `json:"id"`   // 稳定 id，如 "origin" / "rain" / "letter"
	Name   string  `json:"name"` // 示例名称（前端按语言本地化，这里保留原文）
	X      float64 `json:"x"`    // 世界坐标中心
	Y      float64 `json:"y"`
	R      float64 `json:"r"`      // 岛半径（世界单位）
	SY     float64 `json:"sy"`     // 俯视压扁系数
	Rot    float64 `json:"rot"`    // 岛屿自转角（弧度）
	Seed   int     `json:"seed"`   // 确定性粒子/岸线种子
	Sample bool    `json:"sample"` // true=示例岛（前端必须标注示例）
}

// islands 是唯一权威的固定三座岛。
// 位置取自视觉稿 outputs/pulse-tidal-islands.html 第 55 行；半径在概念稿
// （242/181/212）基础上放大到约 1.65 倍——用户反馈“花相对岛太大”，
// 把岛本身做大、植物保持原有尺寸。改这里必须同步改 frontend/src/engine/islands.js，
// 否则前后端几何会错位（work/tidal.test.mjs 会比对两边数值）。
var islands = []Island{
	{ID: "origin", Name: "你的原点", X: 0, Y: 0, R: 400, SY: 0.74, Rot: -0.35, Seed: 4, Sample: true},
	{ID: "rain", Name: "雨后手记", X: -1060, Y: -640, R: 300, SY: 0.70, Rot: 0.4, Seed: 12, Sample: true},
	{ID: "letter", Name: "远山来信", X: 1030, Y: -490, R: 350, SY: 0.76, Rot: -0.7, Seed: 21, Sample: true},
}

// islandShoreTolerance 是岸线判定容差：归一化椭圆距离 ≤ 该值视为在岛上（含岸边浅滩）。
// 与前端岸线绘制的容差是同一个数，改这里要同步前端。
const islandShoreTolerance = 1.15

// Islands 返回权威岛列表的拷贝，供 welcome 与 /healthz 使用。
// 返回值归调用方所有：调用方修改它不会影响内部定义，内部也不会再改已返回的切片。
func Islands() []Island {
	out := make([]Island, len(islands))
	copy(out, islands)
	return out
}

// islandByID 按稳定 id 查一座岛。
// 未知 id 返回零值与 false；不读时钟、不访问网络、不改状态。
func islandByID(id string) (Island, bool) {
	for _, isl := range islands {
		if isl.ID == id {
			return isl, true
		}
	}
	return Island{}, false
}

// islandNormDist 返回世界点到岛屿中心的归一化椭圆距离（1.0 即岸线本身）。
// 岛的 R/SY 非正视为非法定义，返回 +Inf 而不是除零后的 NaN/Inf，
// 让调用方的比较逻辑无需特判；不修改输入。
func islandNormDist(isl Island, x, y float64) float64 {
	if isl.R <= 0 || isl.SY <= 0 {
		return math.Inf(1)
	}
	return math.Hypot((x-isl.X)/isl.R, (y-isl.Y)/(isl.R*isl.SY))
}

// islandContains 判定一个世界点是否落在该岛的岸线包围内（椭圆近似 + 浅滩容差）。
// 只做几何判断，不改任何状态；R/SY 非法的岛定义一律返回 false。
func islandContains(isl Island, x, y float64) bool {
	return islandNormDist(isl, x, y) <= islandShoreTolerance
}

// resolveIsland 返回世界坐标命中的岛 id，都不命中返回 ""（在海上）。
// 多座岛同时命中时取归一化距离最近的一座；坐标非法（NaN）时返回 ""。
// 这是服务端对岛归属的唯一权威判定，客户端自报的 island 只用于日志对账。
func resolveIsland(x, y float64) string {
	if math.IsNaN(x) || math.IsNaN(y) {
		return ""
	}
	bestID, bestDist := "", math.Inf(1)
	for _, isl := range islands {
		d := islandNormDist(isl, x, y)
		if d > islandShoreTolerance || d >= bestDist {
			continue
		}
		bestID, bestDist = isl.ID, d
	}
	return bestID
}
