// 潮汐群岛投影与岛屿几何的行为测试：node work/tidal.test.mjs
// 覆盖三件事：投影互逆（拖动/锚定/指针的基础）、高度确实放大、
// 岛参数与后端 islands.go 完全一致（前后端几何不能错位）。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  projectCalc,
  unprojectCalc,
  pointInQuad,
  tidalTilt,
  islandTerrainHeight,
  islandContains,
  resolveIsland,
} from "../frontend/src/engine/pure.js";
import { ISLANDS, buildIslandGeometry, islandIndex } from "../frontend/src/engine/islands.js";

// view 是一组固定的镜头参数：1440×900、焦距由窗口推导（与 world.js 同规则）。
const view = { cx: 0, cy: 0, d: 1150, W: 1440, H: 900, F: Math.min(900 * 1.1, 1440 * 1.3) };

test("海面投影互逆：屏幕→世界→屏幕（5 个镜头距离 × 5 个点）", () => {
  let maxError = 0;
  for (const d of [270, 455, 850, 1150, 2500]) {
    const v = { ...view, d };
    for (const [sx, sy] of [[720, 495], [400, 250], [1100, 250], [400, 700], [1100, 700]]) {
      const w = unprojectCalc(v, sx, sy);
      assert.ok(Number.isFinite(w.x) && Number.isFinite(w.y), `距离 ${d} 处反解应为有限数`);
      const back = projectCalc(v, w.x, w.y, 0);
      assert.ok(back, `距离 ${d} 处应能重新投影`);
      maxError = Math.max(maxError, Math.hypot(back.x - sx, back.y - sy));
    }
  }
  assert.ok(maxError < 0.2, `锚定误差应小于 0.2px，实际 ${maxError}`);
});

test("世界坐标投影互逆：世界→屏幕→世界（可见范围内）", () => {
  for (const [wx, wy] of [[0, 0], [300, -200], [-1060, -640], [1030, -490]]) {
    const p = projectCalc(view, wx, wy, 0);
    assert.ok(p, `(${wx},${wy}) 应在近裁剪之内`);
    const back = unprojectCalc(view, p.x, p.y);
    assert.ok(Math.hypot(back.x - wx, back.y - wy) < 1, `(${wx},${wy}) 往返偏差过大`);
  }
});

test("高度进入投影：同一世界点抬高后更靠近镜头、尺度更大", () => {
  const ground = projectCalc(view, 80, 0, 0);
  const high = projectCalc(view, 80, 0, 100);
  assert.ok(high.s > ground.s, "抬高后尺度应更大");
  // 靠近时高处的相对放大应快于地面：深度运动比平面运动更敏感
  const near = { ...view, d: 455 };
  const groundGain = projectCalc(near, 80, 0, 0).s / ground.s;
  const highGain = projectCalc(near, 80, 0, 100).s / high.s;
  assert.ok(highGain > groundGain, `高处放大应更快：${highGain} vs ${groundGain}`);
});

test("近裁剪：越过镜头的点返回 null，调用方必须处理", () => {
  // 高度把点推向镜头：抬得足够高时会越过近裁剪，投影返回 null
  assert.ok(projectCalc(view, view.cx, view.cy, 0), "地面点应可见");
  assert.equal(projectCalc(view, view.cx, view.cy, 3000), null, "越过镜头的高度应被裁掉");
  // 同一个高度在更远处会重新进入视野（曲率把远处压远），说明裁剪取决于深度而非高度本身
  assert.ok(projectCalc(view, view.cx, view.cy + 20000, 3000), "同一高度在更远处应重新可见");
});

test("倾角随镜头靠近而抬高，且有界", () => {
  const far = tidalTilt(2500);
  const near = tidalTilt(270);
  assert.ok(far >= 0.36 && far <= 0.37, `远景应接近俯视，实际 ${far}`);
  assert.ok(near > far && near <= 0.75, `近景应更陡，实际 ${near}`);
});

test("pointInQuad：四边形内外判定", () => {
  const quad = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }];
  assert.equal(pointInQuad(10, 10, quad), true);
  assert.equal(pointInQuad(30, 10, quad), false);
  assert.equal(pointInQuad(-1, 10, quad), false);
});

test("岛参数与后端 islands.go 的 Islands() 完全一致（前后端几何不能错位）", () => {
  // 按数值比对而不是比字符串：Go 写 0.70、JS 写 0.7 是同一个数。
  // 名称由后端维护，这里只比几何参数，避免中英文名称互相绑定。
  const source = fs.readFileSync(new URL("../islands.go", import.meta.url), "utf8");
  const keys = ["X", "Y", "R", "SY", "Rot", "Seed"];
  for (const isl of ISLANDS) {
    const row = new RegExp(`\\{ID:\\s*"${isl.id}",[^}]*\\}`).exec(source);
    assert.ok(row, `islands.go 应定义岛屿 ${isl.id}`);
    const values = keys.map((k) => {
      const m = new RegExp(`${k}:\\s*(-?[\\d.]+)`).exec(row[0]);
      assert.ok(m, `islands.go 的 ${isl.id} 应包含字段 ${k}`);
      return Number(m[1]);
    });
    const expected = [isl.x, isl.y, isl.r, isl.sy, isl.rot, isl.seed];
    assert.deepEqual(values, expected, `${isl.id} 的几何参数应与 islands.js 一致`);
  }
});

test("岛几何确定性：同一参数两次构建得到相同点数与首点", () => {
  const isl = ISLANDS[0];
  const a = buildIslandGeometry({ ...isl });
  const b = buildIslandGeometry({ ...isl });
  assert.equal(a.points.length, b.points.length);
  assert.deepEqual(a.points[0], b.points[0]);
  assert.equal(a.rings.length, 23);
});

test("地形高度：岸边低、岛心高，且不含时间项（静止不变）", () => {
  const isl = ISLANDS[0];
  const center = islandTerrainHeight(isl, 0, 0);
  const edge = islandTerrainHeight(isl, isl.r * 0.98, 0);
  assert.ok(center > edge, `岛心(${center}) 应高于岸边(${edge})`);
  assert.ok(center <= 90 && edge >= 0, "高度应落在有界范围");
});

test("岛归属判定：中心命中自己、远处归海上、最近者优先", () => {
  const list = ISLANDS.map((i) => ({ ...i }));
  for (const isl of list) {
    assert.equal(resolveIsland(list, isl.x, isl.y), isl.id, "岛心应命中自己");
  }
  assert.equal(resolveIsland(list, 5000, 5000), null, "远处应在海上");
  assert.equal(islandContains(list[0], list[0].x, list[0].y), true);
  assert.equal(islandContains(list[0], list[0].x + list[0].r * 1.2, list[0].y), false);
});

test("岛索引映射：服务端用岛 id 标识植物，前端必须能反查下标", () => {
  ISLANDS.forEach((isl, i) => {
    assert.equal(islandIndex(isl.id), i, `${isl.id} 的下标应为 ${i}`);
  });
  assert.equal(islandIndex("no-such-island"), -1, "未知 id 返回 -1");
});

test("植物比例：整株高度不超过最小岛直径的 10%（用户反馈花相对岛太大）", () => {
  // 与 world.js 的 TUNE.plant 一致：茎 34 + 每级 7，开花时最高 55。
  const maxPlantHeight = 34 + 3 * 7;
  for (const isl of ISLANDS) {
    const ratio = maxPlantHeight / (2 * isl.r);
    assert.ok(ratio < 0.1, `${isl.id} 的植物比例 ${ratio.toFixed(3)} 应小于 10%`);
  }
});
