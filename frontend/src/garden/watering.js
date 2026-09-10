// createWatering 管理一次照料请求的等待与冷却；只有 requestId 匹配的结果可以解除等待。
// 不修改植物阶段，权威状态始终由 plant/welcome 快照交给引擎；时钟可注入测试。
export function createWatering({ send, changed, notify, clock = globalThis, now = () => performance.now(), id = () => crypto.randomUUID() }) {
  let state = { busy: false, nextAt: 0, requestId: null };
  let timeout = null, cooldown = null, disposed = false;
  // publish 返回值副本，UI 不能通过改快照绕过动作状态机。
  function publish() { changed({ ...state }); }
  // reset 在断连或 welcome 时清理连接级请求，旧回执从此不再有效。
  function reset() {
    clock.clearTimeout(timeout);
    clock.clearTimeout(cooldown);
    state = { busy: false, nextAt: 0, requestId: null };
    publish();
  }
  // request 发出一次带关联号的照料；拒发不进入忙状态，超时仅报告未知而不假装失败回滚。
  function request(plant) {
    if (disposed || state.busy || now() < state.nextAt) return false;
    const requestId = id();
    if (!send({ type: 'water', v: 1, plant, eventId: requestId })) { notify('connecting'); return false; }
    state = { busy: true, nextAt: 0, requestId };
    publish();
    timeout = clock.setTimeout(() => {
      if (disposed || state.requestId !== requestId) return;
      state.busy = false;
      state.requestId = null;
      notify('waterUnconfirmed');
      publish();
    }, 5000);
    return true;
  }
  // result 仅消费当前请求的回执；重复/过期回执不能延长冷却，save_failed 可立即重试。
  function result(event) {
    if (disposed || !state.requestId || event.requestId !== state.requestId) return;
    clock.clearTimeout(timeout);
    state.busy = false;
    state.requestId = null;
    const delay = event.ok ? 2500 : event.code === 'cooldown' ? Math.max(0, event.retryAfterMs || 2500) : 0;
    state.nextAt = delay ? now() + delay : 0;
    if (!event.ok) notify(event.code === 'cooldown' ? 'cooling' : 'saveFailed');
    else if (event.duplicate) notify('duplicateWater');
    publish();
    clock.clearTimeout(cooldown);
    if (delay) cooldown = clock.setTimeout(() => { state.nextAt = 0; publish(); }, delay);
  }
  // dispose 取消自身所有异步回调，组件卸载后不再发布界面状态。
  function dispose() { disposed = true; clock.clearTimeout(timeout); clock.clearTimeout(cooldown); }
  return { request, result, reset, dispose };
}
