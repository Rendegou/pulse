'use strict';

/* PULSE 骨架前端。
 *
 * 所有数据来自 /ws 的真实事件：welcome / join / leave / metrics。
 * 没有模拟数据。你的点有光环，别人的点是青色。
 *
 * 课程 1 的入口在文件底部（mousemove）——现在移动鼠标什么都不会发生，
 * 因为光标同步还没写。那是你要手写的第一块。
 */

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');

const state = {
  you: null,
  sessions: new Map(),  // id -> {id, x, y, bornAt, deadAt}
  metrics: null,
};

// ---------- WebSocket ----------

// connect 建立 WebSocket 并挂上断线重连（指数退避，上限 5 秒）。
// ws 是模块级变量：其他代码（比如光标上报）也要用它发送。
// 协议跟随页面：https 页面必须用 wss，否则浏览器按混合内容拦截。
let retry = 0;
let ws = null;
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  const dot = document.getElementById('ws-dot');
  const label = document.getElementById('ws-label');

  ws.onopen = () => {
    retry = 0;
    dot.classList.add('on');
    label.textContent = 'CONNECTED';
  };
  ws.onmessage = (m) => {
    let e;
    try { e = JSON.parse(m.data); } catch { return; }
    onMessage(e);
  };
  ws.onclose = () => {
    dot.classList.remove('on');
    label.textContent = 'RECONNECTING…';
    setTimeout(connect, Math.min(5000, 300 * 2 ** retry++));
  };
}

// onMessage 分发服务端事件：welcome 确定身份并载入在线表，
// join/leave 增删点，metrics 更新底部指标条。
function onMessage(e) {
  switch (e.type) {
    case 'welcome':
      state.you = e.you;
      // 重连时服务端状态可能完全不同，先清掉旧表再载入
      state.sessions.clear();
      for (const s of e.sessions) {
        state.sessions.set(s.id, { ...s, bornAt: performance.now() });
      }
      document.getElementById('you-label').textContent =
        `你是 ${e.you} · 移动鼠标——在线的人都会看到你`;
      break;
    case 'join':
      state.sessions.set(e.session.id, { ...e.session, bornAt: performance.now() });
      break;
    case 'leave': {
      const s = state.sessions.get(e.id);
      if (s) s.deadAt = performance.now(); // 标记死亡，动画里消散
      break;
    }
    case 'cursor': {
      // 别人的光标增量：改 Map 里的坐标，draw() 下一帧自然画到新位置。
      // 自己的回声跳过——本地已经乐观更新过了，回声只会把点拽回旧位置。
      if (e.id === state.you) break;
      const s = state.sessions.get(e.id);
      if (s) { s.x = e.x; s.y = e.y; }
      break;
    }
    case 'metrics':
      state.metrics = e;
      document.getElementById('m-conns').textContent = e.conns;
      document.getElementById('m-heap').textContent = e.heap_mb.toFixed(1) + ' MB';
      document.getElementById('m-sys').textContent = e.sys_mb.toFixed(1) + ' MB';
      document.getElementById('m-dropped').textContent = e.dropped;
      break;
  }
}

// ---------- 画布 ----------

// fit 把画布像素对齐到 devicePixelRatio（防止高分屏发虚），
// 返回 CSS 像素尺寸供绘制坐标使用。
function fit() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w, h };
}

// draw 是每帧渲染入口：画出所有 session 点——出生放大、死亡消散、
// 常态呼吸缩放；你的点带光环，别人的点是青色。
function draw() {
  const { w, h } = fit();
  ctx.clearRect(0, 0, w, h);

  const now = performance.now();
  const breathe = (phase) => 1 + 0.18 * Math.sin(now / 600 + phase); // 呼吸感

  for (const [id, s] of state.sessions) {
    const x = s.x * w, y = s.y * h;
    const isYou = id === state.you;

    // 出生：从 0 放大到 1（300ms）；死亡：淡出（600ms）
    let scale = Math.min(1, (now - s.bornAt) / 300);
    let alpha = 1;
    if (s.deadAt) {
      const t = (now - s.deadAt) / 600;
      if (t >= 1) { state.sessions.delete(id); continue; }
      alpha = 1 - t;
      scale *= 1 + t * 0.8; // 消散时轻微扩散
    }

    const r = (isYou ? 6 : 4) * breathe(x * 0.01) * scale;
    const color = isYou ? '#d9ff68' : '#79e6ff';

    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    // 你有一圈光环
    if (isYou) {
      ctx.globalAlpha = alpha * 0.35;
      ctx.beginPath();
      ctx.arc(x, y, r + 8 * breathe(1), 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  requestAnimationFrame(draw);
}

// ---------- 光标同步（课程 1） ----------
//
// 机制：mousemove 只记账（写 pending），全局唯一的 setInterval 每 50ms
// 把最新坐标发给服务端（20Hz 采样）。自己的点本地立即更新（乐观更新），
// 别人的移动靠服务端广播的 cursor 消息驱动（见 onMessage）。

// pending 记录最近一次鼠标位置的归一化坐标；dirty 表示"有未发送的新位置"。
const pending = { x: 0.5, y: 0.5, dirty: false };

// 鼠标移动时只做两件事：记账 + 乐观更新自己的点。
// 不在这里发消息（浏览器 mousemove 能到几百 Hz，会把服务器淹了）。
canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect(); // clientX 是视口坐标，要减画布左上角
  pending.x = (e.clientX - rect.left) / rect.width;
  pending.y = (e.clientY - rect.top) / rect.height;
  pending.dirty = true;

  const me = state.you && state.sessions.get(state.you);
  if (me) { me.x = pending.x; me.y = pending.y; }
});

// 每 50ms（20Hz）上报一次最新坐标；没动过或连接不在 OPEN 状态就不发。
// 光标数据是可丢弃的——这一帧没发出去，下一帧覆盖它就行。
setInterval(() => {
  if (!pending.dirty || !ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'cursor', x: pending.x, y: pending.y }));
  pending.dirty = false;
}, 50);

connect();
requestAnimationFrame(draw);
