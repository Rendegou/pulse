// ratePerSecond 的行为测试：node --test work/rate.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { ratePerSecond } from "../static/pure.js";

test("10 秒窗口内 5 条 → 0.5/s", () => {
  const now = 10_000;
  const times = [1000, 3000, 5000, 7000, 9000];
  assert.equal(ratePerSecond(times, now, 10_000), 0.5);
});

test("窗口外的旧事件不计入", () => {
  const now = 10_000;
  // 窗口 5 秒 → 只有 t≥5000 的计入
  const times = [1, 2, 9500];
  assert.equal(ratePerSecond(times, now, 5_000), 0.2);
});

test("空序列 → 0", () => {
  assert.equal(ratePerSecond([], 10_000, 10_000), 0);
});
