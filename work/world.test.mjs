// 投影互逆的行为测试：node --test work/world.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { projectCalc, unprojectCalc } from "../static/pure.js";

const view = { cx: 1000, cy: -500, zoom: 0.66, W: 1280, H: 800 };

test("投影→反投影回到原点（互逆，限可见地表范围）", () => {
  // 可见范围内的世界点（曲面压缩在远处不可逆，这是设计而非 bug）
  for (const [wx, wy] of [[0, 0], [620, 100], [-540, 570], [1200, -700]]) {
    const p = projectCalc(view, wx, wy);
    const back = unprojectCalc(view, p.x, p.y);
    assert.ok(Math.abs(back.x - wx) < 1e-6 && Math.abs(back.y - wy) < 1e-6,
      `(${wx},${wy}) 往返后变成 (${back.x},${back.y})`);
  }
});

test("屏幕点→世界→屏幕 互逆（拖动锚定的实际用法）", () => {
  for (const [sx, sy] of [[640, 424], [0, 0], [1279, 799], [300, 600]]) {
    const w = unprojectCalc(view, sx, sy);
    const p = projectCalc(view, w.x, w.y);
    assert.ok(Math.abs(p.x - sx) < 1e-6 && Math.abs(p.y - sy) < 1e-6,
      `屏幕(${sx},${sy}) 往返后变成 (${p.x},${p.y})`);
  }
});

test("屏幕中心对应相机中心", () => {
  const p = projectCalc(view, view.cx, view.cy);
  assert.ok(Math.abs(p.x - view.W * 0.5) < 1e-9);
  assert.ok(Math.abs(p.y - view.H * 0.53) < 1e-9);
});

test("远离中心的位置被曲面压缩（scale 变小）", () => {
  const near = projectCalc(view, view.cx, view.cy).scale;
  const far = projectCalc(view, view.cx + 5000, view.cy).scale;
  assert.ok(far < near);
});
