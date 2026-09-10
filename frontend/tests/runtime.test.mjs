import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../src/realtime/runtime.js';

// fixture 采用 protocol.go 的 plantId（小写 d）JSON 合同，专门防止 TS/JS 字段拼错导致动画被吞。
test('真实协议形状的 plant 广播同时进入阶段、指定岛水滴及诊断，但不能充当动作回执', () => {
  let dispatch, garden = { version: 0, plants: [{ care: 0 }] };
  const effects = [];
  const view = { events: [], ready: false };
  const world = {
    // 引擎替身记录消费者的输入；这个测试不宣称验证 Canvas 像素。
    setGarden(next) { garden = next; }, getGarden() { return garden; },
    getSelected() { return 0; }, getNearState() { return true; },
    setIslandLabels() {}, setPlantLabelText() {}, wake() {}, dispose() {},
    addWaterEffect(id, together) { effects.push({ id, together }); },
  };
  const runtime = createRuntime({
    world, view, getPrefs: () => ({ lang: 'zh-CN' }), url: 'ws://test/ws',
    // 捕获生产路由回调，避免为状态机测试启动无关渲染器与网络。
    createTransport({ onMessage }) { dispatch = onMessage; return { send: () => true, dispose() {} }; },
  });
  dispatch({ type: 'welcome', you: 'me', sessions: [{ id: 'me' }], garden });
  runtime.waterPlant();
  assert.equal(view.watering.busy, true);
  dispatch({ type: 'plant', plantId: 'origin', id: 'someone', together: true, garden: { version: 1, plants: [{ care: 1 }] } });
  assert.equal(view.garden.plants[0].care, 1);
  assert.deepEqual(effects, [{ id: 'origin', together: true }]);
  assert.equal(view.events[0].data.island, 'origin');
  assert.equal(view.watering.busy, true, '别人的广播不能确认自己的请求');
  dispatch({ type: 'water_result', requestId: view.watering.requestId, ok: false, code: 'save_failed' });
  assert.equal(view.watering.busy, false);
  runtime.dispose();
});
