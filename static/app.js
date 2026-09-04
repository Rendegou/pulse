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
let retry = 0;
function connect() {
  const ws = new WebSocket(`ws://${location.host}/ws`);
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
      for (const s of e.sessions) {
        state.sessions.set(s.id, { ...s, bornAt: performance.now() });
      }
      document.getElementById('you-label').textContent =
        `你是 ${e.you} · 移动鼠标试试（什么都不会发生——光标同步是你的课程 1）`;
      break;
    case 'join':
      state.sessions.set(e.session.id, { ...e.session, bornAt: performance.now() });
      break;
    case 'leave': {
      const s = state.sessions.get(e.id);
      if (s) s.deadAt = performance.now(); // 标记死亡，动画里消散
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

// ---------- 课程 1：光标同步 ----------
//
// 目标：移动鼠标时，你的点跟着走，其他在线的人也看见你走。
//
// 提示（先自己写，写完再对答案）：
//   1. 监听 mousemove，归一化坐标到 0..1
//   2. 20Hz 采样发送（不能每个 mousemove 都发，浏览器能到几百 Hz）
//   3. 服务端 main.go 的 readPump 里解析 {type:"cursor", x, y}，
//      更新 Session 并广播 delta
//   4. 收到别人的 delta 就更新 Map 里的位置
//
// canvas.addEventListener('mousemove', (e) => { ... 从这里开始 ... });

connect();
requestAnimationFrame(draw);
