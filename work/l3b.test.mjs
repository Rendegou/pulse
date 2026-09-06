// appendPositionSample 的行为测试：node --test work/l3b.test.mjs
// 验收口径来自课程卡：1000 条样本后 ≤32 条；停止后位置保留（由调用方配合）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendPositionSample } from "../static/pure.js";

test("按时间升序追加", () => {
  const buf = [];
  appendPositionSample(buf, { t: 100, x: 0.1 }, 100);
  appendPositionSample(buf, { t: 200, x: 0.2 }, 200);
  assert.equal(buf.length, 2);
  assert.equal(buf[1].x, 0.2);
});

test("相同时间戳保留后到的一个", () => {
  const buf = [];
  appendPositionSample(buf, { t: 100, x: 0.1 }, 100);
  appendPositionSample(buf, { t: 100, x: 0.9 }, 100);
  assert.equal(buf.length, 1);
  assert.equal(buf[0].x, 0.9);
});

test("超过 1 秒的旧样本被时间上限清掉", () => {
  const buf = [];
  appendPositionSample(buf, { t: 0, x: 0 }, 0);
  appendPositionSample(buf, { t: 500, x: 0.5 }, 500);
  appendPositionSample(buf, { t: 1200, x: 0.9 }, 1200);
  assert.deepEqual(
    buf.map((s) => s.t),
    [500, 1200], // t=0 距 now=1200 已 1200ms > 1000ms
  );
});

test("1000 条快速样本后不超过 32 条", () => {
  const buf = [];
  for (let i = 0; i < 1000; i++) {
    // 同一毫秒内灌入（时间裁剪不生效，逼条数上限出手）
    appendPositionSample(buf, { t: 1000, x: i / 1000 }, 1000);
  }
  assert.ok(buf.length <= 32);
  assert.equal(buf[buf.length - 1].x, 0.999); // 最新的一定在
});

test("两个上限同时作用", () => {
  const buf = [];
  for (let i = 0; i < 100; i++) {
    appendPositionSample(buf, { t: i * 10, x: i }, i * 10);
  }
  // now=990，cutoff=-10 → 时间全保留；条数砍到 32，留下最新的
  assert.equal(buf.length, 32);
  assert.equal(buf[0].x, 68);
  assert.equal(buf[31].x, 99);
});
