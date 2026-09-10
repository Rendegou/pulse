import test from 'node:test';
import assert from 'node:assert/strict';
import { createConnection } from '../src/realtime/connection.js';
import { createWatering } from '../src/garden/watering.js';
import { samplePosition } from '../src/realtime/interpolation.js';

// fakeClock 按确定顺序推进一次待执行定时器，不用真实等待制造竞态。
function fakeClock() {
  let sequence = 0;
  const tasks = new Map();
  return {
    // setTimeout/clearTimeout 模拟句柄所有权，供卸载断言。
    setTimeout(callback) { const id = ++sequence; tasks.set(id, callback); return id; },
    clearTimeout(id) { tasks.delete(id); },
    // runNext 先移除再运行，让回调可安全安排下一次任务。
    runNext() { const next = tasks.entries().next().value; if (next) { tasks.delete(next[0]); next[1](); } },
    get size() { return tasks.size; },
  };
}

// socketHarness 每轮测试独立记录真实装配路径创建的 socket 替身。
function socketHarness() {
  const sockets = [];
  class Socket {
    // constructor 不自动触发 open，测试可以控制连接建立与关闭顺序。
    constructor(url) { this.url = url; this.readyState = 0; this.bufferedAmount = 0; this.sent = []; sockets.push(this); }
    // send 保留解析后的协议对象，验证业务是否真的发送。
    send(message) { this.sent.push(JSON.parse(message)); }
    // close 模拟浏览器会回调 onclose；用于发现销毁时错误重连。
    close() { this.readyState = 3; this.onclose?.(); }
    // open 由测试显式执行，支持模拟旧连接延迟回调。
    open() { this.readyState = 1; this.onopen?.(); }
  }
  return { Socket, sockets };
}

// 覆盖 close → 安排重连 → 新连接 → 旧 welcome，旧连接不得覆盖当前界面。
test('重连隔离所有旧回调，销毁后没有连接或定时器残留', () => {
  const clock = fakeClock(), { Socket, sockets } = socketHarness(), messages = [], statuses = [];
  const connection = createConnection({ url: 'ws://local/ws', clock, Socket, onMessage: e => messages.push(e), onStatus: s => statuses.push(s) });
  connection.connect(); connection.connect();
  assert.equal(sockets.length, 1);
  sockets[0].open(); sockets[0].close();
  assert.equal(clock.size, 1);
  clock.runNext(); sockets[1].open();
  sockets[0].onmessage({ data: '{"type":"welcome","you":"old"}' });
  sockets[0].open(); sockets[0].close();
  assert.equal(clock.size, 0);
  sockets[1].onmessage({ data: '{"type":"welcome","you":"new"}' });
  assert.deepEqual(messages, [{ type: 'welcome', you: 'new' }]);
  connection.dispose(); connection.dispose();
  sockets[1].onmessage({ data: '{"type":"welcome","you":"late"}' });
  connection.connect();
  assert.equal(messages.length, 1); assert.equal(sockets.length, 2); assert.equal(clock.size, 0);
  assert.deepEqual(statuses, ['connecting', 'connected', 'reconnecting', 'connecting', 'connected']);
});

// 断开期间卸载必须取消尚未运行的重连，发送预算与原有 64 KiB 合同一致。
test('连接拒绝未打开和过载发送，关闭期间卸载取消重连', () => {
  const clock = fakeClock(), { Socket, sockets } = socketHarness();
  const connection = createConnection({ url: 'ws://local/ws', clock, Socket, onMessage() {}, onStatus() {} });
  connection.connect(); assert.equal(connection.send({ type: 'water' }), false);
  sockets[0].open(); sockets[0].bufferedAmount = 65536;
  assert.equal(connection.send({ type: 'water' }), false);
  sockets[0].bufferedAmount = 0; assert.equal(connection.send({ type: 'water' }), true);
  sockets[0].close(); connection.dispose(); clock.runNext();
  assert.equal(sockets.length, 1); assert.equal(clock.size, 0);
});

// waterHarness 观察状态快照和真实发出的事件；不向动作层提供修改植物的入口。
function waterHarness(send = () => true) {
  const clock = fakeClock(), notices = [], snapshots = [];
  let seq = 0;
  const water = createWatering({ clock, now: () => 100, id: () => `w${++seq}`, send, changed: s => snapshots.push(s), notify: key => notices.push(key) });
  return { water, clock, notices, snapshots, last: () => snapshots.at(-1) };
}

// G0 的保存失败应解锁可重试，未知或过期请求号不得解除另一笔请求等待。
test('浇水匹配回执，保存失败可立即重试，重复确认不延长冷却', () => {
  const { water, last, clock, notices } = waterHarness();
  assert.equal(water.request('origin'), true);
  water.result({ requestId: 'wrong', ok: true }); assert.equal(last().busy, true);
  water.result({ requestId: 'w1', ok: false, code: 'save_failed' });
  assert.equal(last().busy, false); assert.equal(last().nextAt, 0); assert.deepEqual(notices, ['saveFailed']);
  assert.equal(water.request('origin'), true);
  water.result({ requestId: 'w2', ok: true });
  assert.equal(last().nextAt, 2600); assert.equal(water.request('origin'), false);
  clock.runNext(); assert.equal(last().nextAt, 0);
  water.result({ requestId: 'w2', ok: true }); assert.equal(clock.size, 0);
  assert.equal(water.request('rain'), true);
  water.dispose(); assert.equal(clock.size, 0);
});

// plant 广播不参与动作确认；超时/断连以后旧回执也不能污染下一次请求。
test('浇水超时和重连清空关联，卸载不再通知 UI', () => {
  const { water, last, clock, notices, snapshots } = waterHarness();
  water.request('origin'); clock.runNext();
  assert.equal(last().requestId, null); assert.deepEqual(notices, ['waterUnconfirmed']);
  water.request('origin'); water.reset();
  water.result({ requestId: 'w2', ok: true }); assert.equal(last().nextAt, 0);
  water.request('origin'); const count = snapshots.length;
  water.dispose(); clock.runNext();
  assert.equal(clock.size, 0); assert.equal(snapshots.length, count); assert.equal(water.request('origin'), false);
});

// 发送失败不得留下幽灵忙状态或确认超时。
test('断连或发送背压时不进入浇水等待', () => {
  const { water, clock, snapshots, notices } = waterHarness(() => false);
  assert.equal(water.request('origin'), false); assert.equal(clock.size, 0); assert.equal(snapshots.length, 0);
  assert.deepEqual(notices, ['connecting']);
});

// 直接测试迁移后的生产插值函数：未来采样不能改变已经冻结的播放段。
test('远端插值在文件迁移后仍冻结播放段切线并保持边界回退', () => {
  const session = { wx: 9, wy: 4, buf: [{ t: 0, x: 0, y: 0 }, { t: 50, x: 5, y: 5 }, { t: 100, x: 10, y: 10 }] };
  const before = samplePosition(session, 75);
  session.buf.push({ t: 150, x: 100, y: 100 });
  assert.deepEqual(samplePosition(session, 75), before);
  assert.deepEqual(samplePosition(session, -1), { x: 0, y: 0 });
  assert.deepEqual(samplePosition(session, 200), { x: 100, y: 100 });
  assert.deepEqual(samplePosition({ wx: 9, wy: 4 }, 10), { x: 9, y: 4 });
});
