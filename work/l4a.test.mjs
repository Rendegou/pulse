// markSeen 去重缓存的行为测试：node --test work/l4a.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { markSeen } from "../static/pure.js";

test("新 id 返回 true 并登记", () => {
  const seen = new Set();
  assert.equal(markSeen(seen, "e1"), true);
  assert.ok(seen.has("e1"));
});

test("重复 id 返回 false（同一事件不播两次）", () => {
  const seen = new Set();
  markSeen(seen, "e1");
  assert.equal(markSeen(seen, "e1"), false);
});

test("缓存有界：超限时逐出最旧，逐出后可重新登记", () => {
  const seen = new Set();
  for (let i = 0; i < 300; i++) markSeen(seen, "e" + i, 256);
  assert.equal(seen.size, 256);
  assert.ok(!seen.has("e0")); // 最旧的已被逐出
  assert.equal(markSeen(seen, "e0", 256), true); // 可重新登记
});
