"use strict";

/* PULSE 骨架前端。
 *
 * 所有数据来自 /ws 的真实事件：welcome / join / leave / cursor / metrics。
 * 没有模拟数据。你的点有光环，别人的点是青色。
 * 远程点的移动经过 Hermite 插值缓冲（渲染延迟 120ms），见 samplePosition。
 */

const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");

const state = {
  you: null,
  sessions: new Map(), // id -> {id, x, y, bornAt, deadAt}
  metrics: null,
};

// ---------- WebSocket ----------

// connect 建立 WebSocket 并挂上断线重连（指数退避，上限 5 秒）。
// ws 是模块级变量：其他代码（比如光标上报）也要用它发送。
// 协议跟随页面：https 页面必须用 wss，否则浏览器按混合内容拦截。
let retry = 0;
let ws = null;
function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  const dot = document.getElementById("ws-dot");
  const label = document.getElementById("ws-label");

  ws.onopen = () => {
    retry = 0;
    dot.classList.add("on");
    label.textContent = "CONNECTED";
  };
  ws.onmessage = (m) => {
    let e;
    try {
      e = JSON.parse(m.data);
    } catch {
      return;
    }
    onMessage(e);
  };
  ws.onclose = () => {
    dot.classList.remove("on");
    label.textContent = "RECONNECTING…";
    setTimeout(connect, Math.min(5000, 300 * 2 ** retry++));
  };
}

// onMessage 分发服务端事件：welcome 确定身份并载入在线表，
// join/leave 增删点，metrics 更新底部指标条。
function onMessage(e) {
  switch (e.type) {
    case "welcome":
      state.you = e.you;
      // 重连时服务端状态可能完全不同，先清掉旧表再载入
      state.sessions.clear();
      for (const s of e.sessions) {
        state.sessions.set(s.id, { ...s, bornAt: performance.now() });
      }
      document.getElementById("you-label").textContent =
        `你是 ${e.you} · 移动鼠标——在线的人都会看到你`;
      break;
    case "join":
      state.sessions.set(e.session.id, {
        ...e.session,
        bornAt: performance.now(),
      });
      break;
    case "leave": {
      const s = state.sessions.get(e.id);
      if (s) s.deadAt = performance.now(); // 标记死亡，动画里消散
      break;
    }
    case "cursor": {
      // 别人的光标增量到达。自己的回声跳过（本地已乐观更新）。
      if (e.id === state.you) break;
      const s = state.sessions.get(e.id);
      if (s) {
        //往s.buf推入新点
        if (!s.buf) s.buf = [];
        s.buf.push({ t: performance.now(), x: e.x, y: e.y });
        // 顺手删掉 1 秒前的旧点，别让队列无限长
        const cutoff = performance.now() - 1000;
        while (s.buf.length > 0 && s.buf[0].t < cutoff) {
          s.buf.shift();
        }
      }
      // TODO(方案C 接线①): 把上面"直接改坐标"换成往 s.buf 推入
      //   { t: performance.now(), x: e.x, y: e.y }
      // （没有 buf 就先建数组；顺手删掉 1 秒前的旧点，别让队列无限长）
      break;
    }
    case "metrics":
      state.metrics = e;
      document.getElementById("m-conns").textContent = e.conns;
      document.getElementById("m-heap").textContent =
        e.heap_mb.toFixed(1) + " MB";
      document.getElementById("m-sys").textContent =
        e.sys_mb.toFixed(1) + " MB";
      document.getElementById("m-dropped").textContent = e.dropped;
      break;
  }
}

// ---------- 画布 ----------

// fit 把画布像素对齐到 devicePixelRatio（防止高分屏发虚），
// 返回 CSS 像素尺寸供绘制坐标使用。
function fit() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = canvas.clientWidth,
    h = canvas.clientHeight;
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
    const isYou = id === state.you;
    const x = s.x * w,
      y = s.y * h;
    // 选位置：自己的点用即时坐标（零延迟手感），别人的点用插值缓冲里的平滑位置
    const p = isYou ? s : samplePosition(s, now - RENDER_DELAY);
    // 出生：从 0 放大到 1（300ms）；死亡：淡出（600ms）
    let scale = Math.min(1, (now - s.bornAt) / 300);
    let alpha = 1;
    if (s.deadAt) {
      const t = (now - s.deadAt) / 600;
      if (t >= 1) {
        state.sessions.delete(id);
        continue;
      }
      alpha = 1 - t;
      scale *= 1 + t * 0.8; // 消散时轻微扩散
    }

    const r = (isYou ? 6 : 4) * breathe(x * 0.01) * scale;
    const color = isYou ? "#d9ff68" : "#79e6ff";

    // 绘制：p 是选中的归一化位置，乘画布尺寸换算成像素后再画
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, r, 0, Math.PI * 2);
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

// ---------- 插值缓冲（方案 C） ----------

// RENDER_DELAY 是渲染比实时慢的毫秒数。20Hz 更新间隔 = 50ms；
// 延迟必须 ≥ 1 个间隔，再留网络抖动余量，取 120ms。
const RENDER_DELAY = 120;

// samplePosition 计算一个远程 session 在"渲染时刻"（now − RENDER_DELAY）
// 应该画在哪：在缓冲队列里找到夹住渲染时刻的相邻两点，做 Hermite 插值。
// s.buf 是按到达时刻排序的 {t, x, y} 队列（t 是本机收到时的 performance.now()）。
function samplePosition(s, renderT) {
  const buf = s.buf;
  if (!buf || buf.length === 0) return { x: s.x, y: s.y }; // 还没收到过：出生位置

  // 渲染时刻比最新的点还新（对方停下了）：停在最后已知位置，不外推
  const last = buf[buf.length - 1];
  if (renderT >= last.t) return { x: last.x, y: last.y };

  // 渲染时刻比最老的点还旧（缓冲刚建立）：用第一个点
  const first = buf[0];
  if (renderT <= first.t) return { x: first.x, y: first.y };

  // 找夹住 renderT 的相邻两项（队列很短，线性扫就够）
  for (let i = 0; i < buf.length - 1; i++) {
    const a = buf[i],
      b = buf[i + 1];
    if (a.t <= renderT && renderT <= b.t) {
      const s = (renderT - a.t) / (b.t - a.t);
      return {
        x: hermiteSegment(buf, i, s, "x"),
        y: hermiteSegment(buf, i, s, "y"),
      };
    }
  }
  return { x: last.x, y: last.y }; // 兜底：理论上到不了
}

// hermiteSegment 在 buf[i]→buf[i+1] 段上求 s∈[0,1] 处的平滑位置。
// key 指定维度（"x"/"y"），调用方两个维度各调一次。
function hermiteSegment(buf, i, s, key) {
  const a = buf[i],
    b = buf[i + 1];
  const span = b.t - a.t; // 切线是"坐标/毫秒"，乘段长换算成段内位移
  const ma = tangentAt(buf, i, key) * span;
  const mb = tangentAt(buf, i + 1, key) * span;
  return hermite(a[key], b[key], ma, mb, s);
}

// hermite 用两端点的位置和切线做三次插值（只管一维）。
// a、b 是端点位置；ma、mb 是端点切线对应的段内位移；s∈[0,1] 是段内进度。
// 四个基函数分别是：a 位置权重、a 切线权重、b 位置权重、b 切线权重。
function hermite(a, b, ma, mb, s) {
  const s2 = s * s,
    s3 = s2 * s;
  return (
    (2 * s3 - 3 * s2 + 1) * a +
    (s3 - 2 * s2 + s) * ma +
    (-2 * s3 + 3 * s2) * b +
    (s3 - s2) * mb
  );
}

// tangentAt 估算 buf[idx] 处在 key 维度上的运动切线（坐标/毫秒）：
// 取前后邻居的割线斜率，因此相邻两段共享一致的交界速度；
// 转折或持平处（相邻两段方向不一致）归零防过冲；
// 缓冲头尾缺邻居时返回 0，等价于"从静止出发 / 平滑停下"。
function tangentAt(buf, idx, key) {
  const prev = buf[idx - 1],
    next = buf[idx + 1];
  if (!prev || !next) return 0;
  const dPrev = buf[idx][key] - prev[key]; // 前一段方向
  const dNext = next[key] - buf[idx][key]; // 后一段方向
  if (dPrev * dNext <= 0) return 0; // 转折点：先停再走
  return (next[key] - prev[key]) / (next.t - prev.t);
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
canvas.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect(); // clientX 是视口坐标，要减画布左上角
  pending.x = (e.clientX - rect.left) / rect.width;
  pending.y = (e.clientY - rect.top) / rect.height;
  pending.dirty = true;

  const me = state.you && state.sessions.get(state.you);
  if (me) {
    me.x = pending.x;
    me.y = pending.y;
  }
});

// 每 50ms（20Hz）上报一次最新坐标；没动过或连接不在 OPEN 状态就不发。
// 光标数据是可丢弃的——这一帧没发出去，下一帧覆盖它就行。
setInterval(() => {
  if (!pending.dirty || !ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "cursor", x: pending.x, y: pending.y }));
  pending.dirty = false;
}, 50);

connect();
requestAnimationFrame(draw);
