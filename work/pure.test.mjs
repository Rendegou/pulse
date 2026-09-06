// normalizePointer 的行为测试：node --test work/pure.test.mjs
// 所有预期值都是先手算再断言，不从实现倒推。
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePointer } from "../static/pure.js";

const rect = { left: 100, top: 50, width: 800, height: 400 };

test("画布正中心", () => {
  assert.deepEqual(normalizePointer(500, 250, rect), { x: 0.5, y: 0.5 });
});

test("左上角原点", () => {
  assert.deepEqual(normalizePointer(100, 50, rect), { x: 0, y: 0 });
});

test("右下角为 (1,1)", () => {
  assert.deepEqual(normalizePointer(900, 450, rect), { x: 1, y: 1 });
});

test("超出右缘夹紧到 1", () => {
  assert.equal(normalizePointer(1000, 250, rect).x, 1);
});

test("超出左缘夹紧到 0", () => {
  assert.equal(normalizePointer(50, 250, rect).x, 0);
});

test("超出上缘夹紧到 0", () => {
  assert.equal(normalizePointer(500, 10, rect).y, 0);
});

test("零宽返回 null", () => {
  assert.equal(normalizePointer(500, 250, { ...rect, width: 0 }), null);
});

test("负高返回 null", () => {
  assert.equal(normalizePointer(500, 250, { ...rect, height: -1 }), null);
});
