// canSend 的行为测试：node --test work/l3c.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { canSend, SEND_BUDGET_BYTES } from "../static/pure.js";

test("有新坐标且连接健康 → 发", () => {
  assert.equal(canSend(true, true, 0), true);
});

test("没有新坐标（dirty=false）→ 不发", () => {
  assert.equal(canSend(false, true, 0), false);
});

test("连接未 OPEN → 不发", () => {
  assert.equal(canSend(true, false, 0), false);
});

test("待发字节达到预算 → 丢帧不发", () => {
  assert.equal(canSend(true, true, SEND_BUDGET_BYTES), false);
});

test("待发字节预算内 → 发", () => {
  assert.equal(canSend(true, true, SEND_BUDGET_BYTES - 1), true);
});
