// 投影互逆与构图约定的行为测试：node --test work/world.test.mjs
// 投影已改为潮汐群岛透视（pure.js 的 projectCalc），这里锁定可见范围内的可逆性。
import { test } from "node:test";
import assert from "node:assert/strict";
import { projectCalc, unprojectCalc } from "../frontend/src/engine/pure.js";

// view 是一组固定的镜头参数：1440×900、远景距离，焦距由窗口推导（与 world.js 同规则）。
const view = { cx: 1000, cy: -500, d: 1150, W: 1440, H: 900, F: Math.min(900 * 1.1, 1440 * 1.3) };

test("投影→反投影回到原点（互逆，限可见地表范围）", () => {
  // 可见范围内的世界点（越过近裁剪的点返回 null，这是设计而非 bug）
  for (const [wx, wy] of [[1000, -500], [1300, -700], [700, -300], [1600, -900]]) {
    const p = projectCalc(view, wx, wy);
    assert.ok(p, `(${wx},${wy}) 应在可见范围内`);
    const back = unprojectCalc(view, p.x, p.y);
    assert.ok(Math.abs(back.x - wx) < 1 && Math.abs(back.y - wy) < 1,
      `(${wx},${wy}) 往返后变成 (${back.x},${back.y})`);
  }
});

test("屏幕点→世界→屏幕 互逆（拖动锚定的实际用法）", () => {
  for (const [sx, sy] of [[720, 495], [0, 0], [1439, 899], [300, 600]]) {
    const w = unprojectCalc(view, sx, sy);
    const p = projectCalc(view, w.x, w.y);
    assert.ok(p, `屏幕(${sx},${sy}) 反解后应能重新投影`);
    assert.ok(Math.abs(p.x - sx) < 0.2 && Math.abs(p.y - sy) < 0.2,
      `屏幕(${sx},${sy}) 往返后变成 (${p.x},${p.y})`);
  }
});

test("镜头中心的地面点投在屏幕 57% × 42% 处（构图约定）", () => {
  const p = projectCalc(view, view.cx, view.cy);
  assert.ok(Math.abs(p.x - view.W * 0.57) < 1e-9, "横向应以 57% 为轴");
  assert.ok(Math.abs(p.y - view.H * 0.42) < 1e-6, "纵向应以 42% 为基准高度");
});

test("远离中心的位置被曲面压远（深度变大、尺度变小）", () => {
  const near = projectCalc(view, view.cx, view.cy);
  const far = projectCalc(view, view.cx, view.cy - 3000);
  assert.ok(far === null || far.s < near.s, "远处的尺度应更小（或已越过近裁剪）");
});
