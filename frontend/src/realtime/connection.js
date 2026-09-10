import { SEND_BUDGET_BYTES } from '../engine/pure.js';

// createConnection 管理一个可销毁的连接及重连定时器；旧连接的任何回调都不得修改新会话。
// Socket/clock 可注入用于受控故障测试，业务消息不在此解释。
export function createConnection({ url, onMessage, onStatus, Socket = WebSocket, clock = globalThis }) {
  let socket = null, timer = null, retry = 0, disposed = false;
  // connect 显式启动；在已有连接时无副作用，销毁后无法再次启动。
  function connect() {
    if (disposed || socket) return;
    onStatus('connecting');
    const current = new Socket(url);
    socket = current;
    // 每条回调均确认所有权；关闭中的旧连接不能送入陈旧 welcome。
    current.onopen = () => {
      if (disposed || socket !== current) return;
      retry = 0;
      onStatus('connected');
    };
    current.onmessage = (message) => {
      if (disposed || socket !== current) return;
      let event;
      try { event = JSON.parse(message.data); } catch { return; }
      if (event && typeof event === 'object') onMessage(event);
    };
    current.onclose = () => {
      if (disposed || socket !== current) return;
      socket = null;
      onStatus('reconnecting');
      timer = clock.setTimeout(connect, Math.min(5000, 300 * 2 ** retry++));
    };
  }
  // send 在非 OPEN 或缓冲过载时拒绝，调用者必须保留 dirty 或显示未确认。
  function send(message) {
    if (disposed || !socket || socket.readyState !== 1 || socket.bufferedAmount >= SEND_BUDGET_BYTES) return false;
    try { socket.send(JSON.stringify(message)); return true; } catch { return false; }
  }
  // dispose 先撤销所有权再关闭，避免 close 事件重新安排连接。
  function dispose() {
    if (disposed) return;
    disposed = true;
    clock.clearTimeout(timer);
    const old = socket;
    socket = null;
    old?.close();
  }
  return { connect, send, dispose };
}
