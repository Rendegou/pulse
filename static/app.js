"use strict";

/* PULSE 骨架前端。
 *
 * 所有数据来自 /ws 的真实事件：welcome / join / leave / cursor / metrics。
 * 没有模拟数据。你的点有光环，别人的点是青色。
 * 远程点的移动经过 Hermite 插值缓冲（渲染延迟 120ms），见 samplePosition。
 *
 * 本文件是 ES module：纯函数在 static/pure.js（可单测），
 * 这里只保留状态、副作用（DOM/网络/计时器）和绘制。
 */

import {
  normalizePointer,
  appendPositionSample,
  canSend,
  markSeen,
  portPosition,
  ratePerSecond,
  RADAR_PORTS,
} from "./pure.js";
import {
  initPreferences,
  setTheme,
  setLang,
  getPrefs,
  onPreferenceChange,
} from "./preferences.js";
import { t } from "./i18n.js";

const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");

const state = {
  you: null,
  sessions: new Map(), // id -> {id, x, y, bornAt, deadAt}
  metrics: null,
};

// ---------- 偏好（主题/语言）与界面控制 ----------

// palette 是 Canvas 用的颜色缓存：换主题时从 CSS 变量读一次，
// 不逐帧 getComputedStyle（docs/08 §6）。
let palette = {};
function refreshPalette() {
  const cs = getComputedStyle(document.documentElement);
  const get = (k) => cs.getPropertyValue(k).trim();
  palette = {
    cursorLocal: get("--cursor-local"),
    cursorRemote: get("--cursor-remote"),
    pulseRing: get("--pulse-ring"),
    radarLive: get("--radar-live"),
    lineGuide: get("--line-guide"),
    textSecondary: get("--text-secondary"),
  };
}

initPreferences();
refreshPalette();

const themeBtn = document.getElementById("btn-theme");
const langBtn = document.getElementById("btn-lang");
const statusBtn = document.getElementById("btn-status");
const drawer = document.getElementById("drawer");

// 主题按钮循环：跟随系统 → 明亮 → 深色 → 跟随系统
themeBtn.onclick = () => {
  const cur = getPrefs().theme;
  setTheme(cur === "system" ? "light" : cur === "light" ? "dark" : "system");
};

// 语言按钮：中文 ⇄ English，按钮文字显示可切换到的另一种语言
langBtn.onclick = () => {
  setLang(getPrefs().lang === "zh-CN" ? "en" : "zh-CN");
};

// 运行状态抽屉开关（只显隐，不断连、不建计时器）
statusBtn.onclick = () => {
  drawer.hidden = !drawer.hidden;
};

// refreshUIText 按当前语言重绘所有界面文案（含已显示的事件记录）。
function refreshUIText() {
  const lang = getPrefs().lang;
  const themeKey = { system: "themeSystem", light: "themeLight", dark: "themeDark" }[getPrefs().theme];
  document.getElementById("space-name").textContent = t(lang, "spaceName");
  themeBtn.textContent = t(lang, "theme") + " · " + t(lang, themeKey);
  langBtn.textContent = lang === "zh-CN" ? "EN" : "中文";
  statusBtn.textContent = t(lang, "statusOpen");
  document.getElementById("feed-title").textContent = t(lang, "feedTitle");
  document.getElementById("ports-title").textContent = t(lang, "portsLive");
  if (state.you) {
    document.getElementById("you-label").textContent = t(lang, "youHint", { id: state.you });
  }
  renderFeed();
}

// 偏好变化：刷新调色板 + 全部文案；不重建连接、不新建计时器
onPreferenceChange(() => {
  refreshPalette();
  refreshUIText();
});

// ---------- WebSocket ----------

// ---------- 视图模式 ----------

// viewMode 决定画布画哪一层：system（全部）/ presence（只点）/ host（只雷达）。
let viewMode = "system";
for (const el of document.querySelectorAll(".mode")) {
  el.onclick = () => {
    document.querySelectorAll(".mode").forEach((x) => x.classList.remove("active"));
    el.classList.add("active");
    viewMode = el.dataset.mode;
    document.getElementById("kicker").textContent =
      viewMode === "system" ? "SYSTEM · REALTIME"
      : viewMode === "presence" ? "PRESENCE · LIVE SESSIONS"
      : "HOST RADAR · INBOUND PORTS";
  };
}

// ---------- 事件流 ----------

// feedRecords 是结构化事件记录（有界 20 条，最新在前）。
// 存数据不存拼好的文字：切换语言时整条流按新语言重绘。
const feedRecords = [];

// recordEvent 记录一条真实事件并重绘事件流。
// kind: join/leave/pulse/host；data 保留原始字段，格式化发生在渲染时。
function recordEvent(kind, data) {
  feedRecords.unshift({ kind, data, time: Date.now() });
  if (feedRecords.length > 20) feedRecords.pop();
  renderFeed();
}

// renderFeed 按当前语言把记录渲染成 DOM；全部 textContent，服务器数据不进 innerHTML。
function renderFeed() {
  const feed = document.getElementById("feed");
  const lang = getPrefs().lang;
  feed.textContent = "";
  for (const r of feedRecords) {
    const el = document.createElement("div");
    el.className = "event";
    const time = document.createElement("div");
    time.className = "time";
    time.textContent = new Date(r.time).toLocaleTimeString(lang, { hour12: false });
    const msg = document.createElement("div");
    msg.className = "msg";
    const d = r.data;
    // kind 决定颜色类与文案；身份/端口等原始值不翻译
    if (r.kind === "join") {
      appendParts(msg, ["k-join", "join  "], ["b", d.id], ["", " " + t(lang, "evJoin")]);
    } else if (r.kind === "leave") {
      appendParts(msg, ["k-leave", "leave "], ["b", d.id], ["", " " + t(lang, "evLeave")]);
    } else if (r.kind === "pulse") {
      appendParts(msg, ["k-pulse", "pulse "], ["b", d.id],
        ["", " " + t(lang, "evPulse", { x: d.x.toFixed(2), y: d.y.toFixed(2) })]);
    } else if (r.kind === "host") {
      appendParts(msg, ["k-host", "host  "], ["b", d.sourceId],
        ["", " " + t(lang, "evHost", { port: d.port, kind: d.kind }) +
          (d.mode === "fixture" ? t(lang, "evFixtureSuffix") : "")]);
    }
    el.append(time, msg);
    feed.appendChild(el);
  }
}

// appendParts 把 [css类, 文本] 片段安全地拼进消息节点（只走 textContent）。
function appendParts(msg, ...parts) {
  for (const [cls, text] of parts) {
    const span = document.createElement(cls === "b" ? "b" : "span");
    if (cls !== "b" && cls) span.className = cls;
    span.textContent = text;
    msg.appendChild(span);
  }
}

// ---------- 端口速率（真实事件统计） ----------

// hostTimes 是主机事件的到达时刻记录（用于算真实速率，不是服务器给的数字）。
const hostTimes = [];
const portTimes = new Map(); // port -> [t...]

// recordHostEvent 记录一次主机事件的时间戳（全局 + 按端口）。
// 只留最近 10 秒，速率窗口滚动。
function recordHostEvent(port, now) {
  hostTimes.push(now);
  if (!portTimes.has(port)) portTimes.set(port, []);
  portTimes.get(port).push(now);
  const cutoff = now - 10_000;
  while (hostTimes.length && hostTimes[0] < cutoff) hostTimes.shift();
  for (const arr of portTimes.values()) {
    while (arr.length && arr[0] < cutoff) arr.shift();
  }
}

// renderPorts 每秒重绘一次端口速率条（数值全部来自真实事件流）。
function renderPorts() {
  const now = performance.now();
  const el = document.getElementById("ports");
  el.textContent = "";
  const rates = RADAR_PORTS.map((p) => ratePerSecond(portTimes.get(p) || [], now, 10_000));
  const max = Math.max(...rates, 0.01);
  RADAR_PORTS.forEach((p, i) => {
    const row = document.createElement("div");
    row.className = "prow" + (rates[i] > 0.5 ? " hot" : "");
    const name = document.createElement("span");
    name.textContent = ":" + p;
    const bar = document.createElement("div");
    bar.className = "bar";
    const fill = document.createElement("span");
    fill.style.width = Math.max(3, (rates[i] / max) * 100) + "%";
    bar.appendChild(fill);
    const val = document.createElement("span");
    val.textContent = rates[i] > 0 ? rates[i].toFixed(1) + "/s" : "—";
    row.append(name, bar, val);
    el.appendChild(row);
  });
}
setInterval(renderPorts, 1000); // 端口条 1s 刷新一次

// connect 建立 WebSocket 并挂上断线重连（指数退避，上限 5 秒）。
// ws 是模块级变量：其他代码（比如光标上报）也要用它发送。
// 协议跟随页面：https 页面必须用 wss，否则浏览器按混合内容拦截。
// 重连 generation 隔离：sock 捕获本次连接，旧连接的 onclose 不碰新连接。
let retry = 0;
let ws = null;
function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const sock = new WebSocket(`${proto}://${location.host}/ws`);
  ws = sock;
  const dot = document.getElementById("ws-dot");
  const label = document.getElementById("ws-label");

  ws.onopen = () => {
    retry = 0;
    dot.classList.add("on");
    label.textContent = t(getPrefs().lang, "connected");
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
    if (ws !== sock) return; // 新连接已在跑，旧连接的善后不重复安排重连
    dot.classList.remove("on");
    label.textContent = t(getPrefs().lang, "reconnecting");
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
      document.getElementById("you-label").textContent = t(getPrefs().lang, "youHint", { id: e.you });
      // 重连后旧连接的 pending 作废：清掉发送标记，等新的鼠标输入再发
      pending.dirty = false;
      break;
    case "join":
      state.sessions.set(e.session.id, {
        ...e.session,
        bornAt: performance.now(),
      });
      recordEvent("join", { id: e.session.id });
      break;
    case "leave": {
      const s = state.sessions.get(e.id);
      if (s) s.deadAt = performance.now(); // 标记死亡，动画里消散
      recordEvent("leave", { id: e.id });
      break;
    }
    case "cursor": {
      // 别人的光标增量到达：进有界插值缓冲（时间+条数双上限），
      // 自己的回声跳过（本地已乐观更新，回声只会把点拽回旧位置）。
      if (e.id === state.you) break;
      const s = state.sessions.get(e.id);
      if (s) {
        const now = performance.now();
        if (!s.buf) s.buf = [];
        appendPositionSample(s.buf, { t: now, x: e.x, y: e.y }, now);
        // 同步刷新最后已知位置：缓冲被时间清空后，
        // samplePosition 的兜底停在上次真实位置，而不是瞬移回出生点
        s.x = e.x;
        s.y = e.y;
      }
      break;
    }
    case "pulse": {
      // 脉冲事件到达：eventId 去重后进效果队列（有界 64 个）。
      // 点击方也走这条路播放（第一版不做本地预播），clientEventId 留作对账依据。
      if (!markSeen(seenPulses, e.eventId)) break;
      pulses.push({ x: e.x, y: e.y, bornAt: performance.now(), mine: e.id === state.you });
      if (pulses.length > 64) pulses.shift(); // 超界丢最旧
      recordEvent("pulse", { id: e.id, x: e.x, y: e.y });
      break;
    }
    case "host_event": {
      // 主机事件：去重后生成一条来袭弧线。fixture（开发注入）也画，
      // 但画成虚线，永不伪装成 live。
      if (!markSeen(seenHost, e.eventId)) break;
      const angle = Math.random() * Math.PI * 2; // 来源出现在画布边缘的随机方向
      hostArcs.push({
        srcX: 0.5 + Math.cos(angle) * 0.48,
        srcY: 0.5 + Math.sin(angle) * 0.44,
        port: e.destinationPort,
        bornAt: performance.now(),
        mode: e.mode,
      });
      if (hostArcs.length > 32) hostArcs.shift(); // 超界丢最旧
      recordHostEvent(e.destinationPort, performance.now());
      recordEvent("host", { sourceId: e.sourceId, port: e.destinationPort, kind: e.kind, mode: e.mode });
      break;
    }
    case "metrics":
      state.metrics = e;
      document.getElementById("m-conns").textContent = e.conns;
      document.getElementById("chip-conns").textContent = e.conns;
      document.getElementById("m-heap").textContent =
        e.heap_mb.toFixed(1) + " MB";
      document.getElementById("m-sys").textContent =
        e.sys_mb.toFixed(1) + " MB";
      document.getElementById("m-dropped").textContent = e.dropped;
      // sensor 在线状态徽标：无事件不等于离线，10 秒无心跳才算离线
      // HOST EVENTS：最近 10 秒实测速率（客户端自己数，不信服务器报数）
      document.getElementById("m-hostrate").textContent =
        ratePerSecond(hostTimes, performance.now(), 10_000).toFixed(1) + "/s";
      const badge = document.getElementById("sensor-badge");
      badge.textContent = e.sensor_online ? t(getPrefs().lang, "sensorLive") : t(getPrefs().lang, "sensorOffline");
      badge.className = "sensor-badge " + (e.sensor_online ? "on" : "off");
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

  if (viewMode !== "presence") drawRadar(now);

  if (viewMode === "host") {
    requestAnimationFrame(draw);
    return; // 纯雷达视图：不画点和脉冲
  }

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
    const color = isYou ? palette.cursorLocal : palette.cursorRemote;

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

  // 脉冲效果：扩散圆环，600ms 生命周期，过期即删（事件的视觉不留痕）。
  // 自己点的脉冲用主题色，别人的用访客青色——和点的配色规则一致。
  for (let i = pulses.length - 1; i >= 0; i--) {
    const t = (now - pulses[i].bornAt) / 600;
    if (t >= 1) {
      pulses.splice(i, 1);
      continue;
    }
    ctx.globalAlpha = (1 - t) * 0.8;
    ctx.beginPath();
    ctx.arc(pulses[i].x * w, pulses[i].y * h, 6 + t * 46, 0, Math.PI * 2);
    ctx.strokeStyle = pulses[i].mine ? palette.pulseRing : palette.cursorRemote;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  requestAnimationFrame(draw);
}

// ---------- Host Radar ----------

// drawRadar 每帧绘制主机雷达层：中央服务器标记、端口环、来袭弧线。
// 来袭弧线生命周期 1.8s：边缘出现 → 光点飞向端口 → 淡出。
// fixture 事件画虚线，和 live 视觉分离（诚实标注模拟数据）。
function drawRadar(now) {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const cx = w * 0.5, cy = h * 0.52;

  // 中央服务器标记
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.arc(cx, cy, 7, 0, Math.PI * 2);
  ctx.fillStyle = palette.cursorLocal;
  ctx.fill();
  ctx.globalAlpha = 0.15;
  ctx.beginPath();
  ctx.arc(cx, cy, 16, 0, Math.PI * 2);
  ctx.strokeStyle = palette.cursorLocal;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = palette.textSecondary;
  ctx.font = '9px ui-monospace, monospace';
  ctx.textAlign = "center";
  ctx.fillText("SERVER", cx, cy + 28);

  // 端口环
  for (const port of RADAR_PORTS) {
    const p = portPosition(port);
    const x = p.x * w, y = p.y * h;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = palette.lineGuide;
    ctx.fill();
    ctx.fillStyle = palette.lineGuide;
    ctx.fillText(":" + port, x + 8, y + 3);
  }

  // 来袭弧线
  for (let i = hostArcs.length - 1; i >= 0; i--) {
    const a = hostArcs[i];
    const t = (now - a.bornAt) / 1800;
    if (t >= 1) { hostArcs.splice(i, 1); continue; }
    const target = portPosition(a.port);
    const sx = a.srcX * w, sy = a.srcY * h;
    const tx = target.x * w, ty = target.y * h;
    const color = palette.radarLive;

    // 尾迹线（从源到当前光点）
    const q = Math.min(t * 1.6, 1); // 光点先飞到位
    const px = sx + (tx - sx) * q, py = sy + (ty - sy) * q;
    ctx.globalAlpha = (1 - t) * 0.5;
    ctx.strokeStyle = color;
    ctx.setLineDash(a.mode === "fixture" ? [4, 4] : []); // fixture 虚线
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(px, py);
    ctx.stroke();
    ctx.setLineDash([]);

    // 飞行光点
    ctx.globalAlpha = 1 - t * 0.3;
    ctx.beginPath();
    ctx.arc(px, py, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
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
      const prog = (renderT - a.t) / (b.t - a.t);
      const span = b.t - a.t;

      // s.playing 缓存正在播放的段的四个切线：段一旦开始播放就冻结计算方式，
      // 新到的采样点只影响未来的段——已播出的历史不被改写。
      // 键用段起点时间戳 a.t 而不是索引 i：buf 裁剪会让索引前移，时间戳永远稳定。
      if (!s.playing || s.playing.segT !== a.t) {
        s.playing = {
          segT: a.t,
          max: tangentAt(buf, i, "x") * span,
          may: tangentAt(buf, i, "y") * span,
          mbx: tangentAt(buf, i + 1, "x") * span,
          mby: tangentAt(buf, i + 1, "y") * span,
        };
      }
      const p = s.playing;

      return {
        x: hermite(a.x, b.x, p.max, p.mbx, prog),
        y: hermite(a.y, b.y, p.may, p.mby, prog),
      };
    }
  }
  return { x: last.x, y: last.y }; // 兜底：理论上到不了
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

// pulses 是活动中的脉冲效果：{x, y, bornAt, mine}，600ms 生命周期，最多 64 个。
// seenPulses 是 eventId 去重缓存（有界 256）：同一事件绝不重复播放。
// pulseSeq 是本客户端的点击序号（clientEventId 来源，供服务端回传对账）。
const pulses = [];
const seenPulses = new Set();
let pulseSeq = 0;

// hostArcs 是 Host Radar 活动中的来袭弧线：{srcX, srcY, port, bornAt, mode}，最多 32 条。
// seenHost 是 host eventId 去重缓存；sensorOnline 由 metrics 的 sensor_online 驱动。
const hostArcs = [];
const seenHost = new Set();

// 鼠标移动时只做三件事：读 DOM（rect/坐标）→ 纯函数换算 → 记账 + 乐观更新自己的点。
// 不在这里发消息（浏览器 mousemove 能到几百 Hz，会把服务器淹了）。
canvas.addEventListener("mousemove", (e) => {
  const p = normalizePointer(e.clientX, e.clientY, canvas.getBoundingClientRect());
  if (!p) return; // 画布尺寸异常（零宽高）时丢弃本次采样
  pending.x = p.x;
  pending.y = p.y;
  pending.dirty = true;

  const me = state.you && state.sessions.get(state.you);
  if (me) {
    me.x = p.x;
    me.y = p.y;
  }
});

// 每 50ms（20Hz）上报一次最新坐标。
// canSend 拦三种情况：没有新坐标、连接不在 OPEN、待发字节超预算（慢连接丢帧不积压）。
// 光标数据是可丢弃的——这一帧没发出去，下一帧 pending 覆盖它就行。
setInterval(() => {
  if (!ws) return; // 首次连接建立前没有可发送的对象
  if (!canSend(pending.dirty, ws.readyState === WebSocket.OPEN, ws.bufferedAmount)) return;
  ws.send(JSON.stringify({ type: "cursor", x: pending.x, y: pending.y }));
  pending.dirty = false;
}, 50);

// ---------- 点击脉冲（功能包 A） ----------

// 点击发送脉冲请求。点击是事件不是状态：每次都单独发送（不走 20Hz 采样），
// 本地不预播——等服务端校验后的广播回来才画（见 onMessage 的 pulse 分支）。
canvas.addEventListener("click", (e) => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const p = normalizePointer(e.clientX, e.clientY, canvas.getBoundingClientRect());
  if (!p) return;
  ws.send(JSON.stringify({ type: "pulse", clientEventId: `c${pulseSeq++}`, x: p.x, y: p.y }));
});

connect();
requestAnimationFrame(draw);

// 调试句柄：module 作用域不外泄 state，显式暴露只读入口供控制台/自动化检查。
window.PULSE = { state };
