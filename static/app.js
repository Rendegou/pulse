"use strict";

/* PULSE 产品前端 · 装配层。
 *
 * 职责：WebSocket 连接、真实访客数据、偏好/i18n、HUD 控件、阅读页、诊断抽屉。
 * 世界渲染和输入手势在 world.js；纯计算在 pure.js；文案在 i18n.js。
 *
 * 数据真实性：访客/脉冲来自真实 /ws 连接（v2 世界坐标）；
 * 房屋和文章是明确标注的示例；fixture 主机事件只出现在诊断抽屉。
 */

import {
  appendPositionSample,
  canSend,
  markSeen,
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
import { t, tArr } from "./i18n.js";
import * as world from "./world.js";
import { ARTICLES } from "./articles.js";

const $ = (id) => document.getElementById(id);

// ---------- 状态 ----------

// sessions 是在线连接表：id -> {id, x, y（世界坐标，最后已知）, buf, bornAt, deadAt, playing}
const state = { you: null, sessions: new Map() };

// pulses 是活动中的脉冲效果（世界坐标）：{wx, wy, bornAt, mine}，600ms 生命，最多 64 个。
const pulses = [];
const seenPulses = new Set();
const seenHost = new Set();
let pulseSeq = 0;

// pending 记录自己最近一次指针的世界坐标；dirty 表示有未发送的新位置。
const pending = { x: 0, y: 0, dirty: false };

// hostTimes/portTimes 记录主机事件到达时刻，速率是客户端自己数的实测值。
const hostTimes = [];
const portTimes = new Map();

// feedRecords 是结构化事件记录（有界 20 条）：存数据不存文字，切语言整流重绘。
const feedRecords = [];

// ---------- 偏好 → 世界调色板 ----------

// refreshPalette 从 CSS 变量读一次主题颜色并注入世界引擎（不逐帧读）。
function refreshPalette() {
  const cs = getComputedStyle(document.documentElement);
  const get = (k) => cs.getPropertyValue(k).trim();
  world.setPalette({
    bg: get("--bg"),
    land: get("--world-land"),
    water: get("--world-water"),
    contour: get("--world-contour"),
    line: get("--world-line"),
    fill: get("--world-fill"),
    roof: get("--world-roof"),
    accent: get("--accent"),
    paper: get("--world-paper"),
    muted: get("--muted"),
  });
}

initPreferences();
refreshPalette();

onPreferenceChange(() => {
  refreshPalette();
  updateText();
});

// ---------- 界面文案 ----------

// nameOf 取示例房屋的当前语言名称（命名稳定，不随视野重采样）。
function nameOf(h) {
  const names = tArr(getPrefs().lang, "houseNames");
  return names[h.name % names.length] + (h.special ? "" : " " + h.tag);
}

// updateText 全面刷新静态与动态界面；切换语言不改文章身份或房屋位置。
function updateText() {
  const lang = getPrefs().lang;
  const inside = world.getInside();
  const selected = world.getSelected();

  document.documentElement.lang = lang;
  document.title = t(lang, "spaceName") + " · PULSE";
  $("place").textContent = inside ? nameOf(inside) : t(lang, "place");
  $("sub").textContent = inside ? t(lang, "insideDesc") : t(lang, "sub");
  $("hint").textContent = inside ? t(lang, "inHint") : t(lang, "hint");
  $("near-label").textContent = t(lang, "near");
  $("demo-label").textContent = t(lang, "demo");
  $("enter").textContent = t(lang, "enter");
  $("dismiss").textContent = t(lang, "cancel");
  $("back").textContent = t(lang, "back");
  $("origin").textContent = t(lang, "home");
  $("help").textContent = t(lang, "help");
  $("help-title").textContent = t(lang, "helpTitle");
  $("help-copy").textContent = t(lang, "helpCopy");
  $("limit-copy").textContent = t(lang, "limits");
  $("article-source").textContent = t(lang, "articleSource");
  $("status-btn").textContent = t(lang, "statusOpen");
  $("address").placeholder = t(lang, "address");
  $("system-theme").textContent = t(lang, "themeFollowSystem");
  $("theme").textContent = themeButtonLabel();
  $("locale").textContent = lang === "zh-CN" ? "EN" : "中文";
  $("feed-title").textContent = t(lang, "feedTitle");
  $("ports-title").textContent = t(lang, "portsLive");
  canvas.setAttribute("aria-label", t(lang, "worldLabel"));

  // 附近空间三个示例入口
  const fixed = [world.houseById("origin"), world.houseById("rain"), world.houseById("letter")];
  document.querySelectorAll("[data-near]").forEach((el, i) => {
    el.textContent = fixed[i] ? nameOf(fixed[i]) : "";
  });

  updateSelection();
  updateReadout();
  renderFeed();
  // 阅读页开着时按新语言重开（保留滚动位置）
  if ($("reader").open) {
    const i = Number($("reader").dataset.article);
    const top = $("reader").scrollTop;
    openArticle(i);
    $("reader").scrollTop = top;
  }
}

// themeButtonLabel 显示当前主题偏好（system/light/dark → 下一目标文字）。
function themeButtonLabel() {
  const lang = getPrefs().lang;
  const key = { system: "themeSystem", light: "themeLight", dark: "themeDark" }[getPrefs().theme];
  return t(lang, key);
}

// ---------- 选择面板与阅读 ----------

// updateSelection 刷新房屋面板：探索态（进入/取消）与室内态（书列表）分开。
function updateSelection() {
  const lang = getPrefs().lang;
  const selected = world.getSelected();
  const inside = world.getInside();
  const h = inside || selected;
  document.body.dataset.inside = String(!!inside);
  if (!h) {
    $("selection").hidden = true;
    return;
  }
  $("selection").hidden = false;
  $("house-name").textContent = nameOf(h);
  $("house-desc").textContent = inside ? t(lang, "insideDesc") : t(lang, "houseDesc");
  $("enter").hidden = !!inside;
  $("dismiss").hidden = !!inside;
  $("books").hidden = !inside;
  $("books").replaceChildren();
  if (inside) {
    ARTICLES[lang].titles.forEach((title, i) => {
      const b = document.createElement("button");
      b.textContent = title;
      b.addEventListener("click", () => openArticle(i));
      $("books").appendChild(b);
    });
  }
}

// openArticle 使用真实 DOM 和示例文章，不把正文画在 Canvas 上。
let originFocus = null;
function openArticle(i) {
  const lang = getPrefs().lang;
  originFocus = document.activeElement;
  $("article-title").textContent = ARTICLES[lang].titles[i];
  const body = $("article-body");
  body.replaceChildren();
  for (const p of ARTICLES[lang].paras[i]) {
    const el = document.createElement("p");
    el.textContent = p;
    body.appendChild(el);
  }
  $("reader").dataset.article = String(i);
  if (!$("reader").open) $("reader").showModal();
}

// ---------- WebSocket ----------

let retry = 0;
let ws = null;

// connect 建立 WebSocket 并挂上断线重连（指数退避，上限 5 秒）。
// 协议跟随页面：https 用 wss。generation 隔离：旧连接 onclose 不碰新连接。
function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const sock = new WebSocket(`${proto}://${location.host}/ws`);
  ws = sock;
  const dot = $("ws-dot");
  const label = $("ws-label");

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
    if (ws !== sock) return;
    dot.classList.remove("on");
    label.textContent = t(getPrefs().lang, "reconnecting");
    setTimeout(connect, Math.min(5000, 300 * 2 ** retry++));
  };
}

// onMessage 分发服务端事件：welcome 确定身份、join/leave 增减在线点、
// cursor 进插值缓冲（世界坐标）、pulse 进效果队列、host_event 进诊断。
function onMessage(e) {
  switch (e.type) {
    case "welcome":
      state.you = e.you;
      state.sessions.clear();
      for (const s of e.sessions) {
        state.sessions.set(s.id, { ...s, bornAt: performance.now() });
      }
      pending.dirty = false; // 重连后旧 pending 作废
      break;
    case "join":
      state.sessions.set(e.session.id, { ...e.session, bornAt: performance.now() });
      recordEvent("join", { id: e.session.id });
      break;
    case "leave": {
      const s = state.sessions.get(e.id);
      if (s) s.deadAt = performance.now();
      recordEvent("leave", { id: e.id });
      break;
    }
    case "cursor": {
      // 别人的光标增量（v2 世界坐标）：进有界插值缓冲；自己的回声跳过。
      if (e.id === state.you) break;
      const s = state.sessions.get(e.id);
      if (s) {
        const now = performance.now();
        if (!s.buf) s.buf = [];
        appendPositionSample(s.buf, { t: now, x: e.wx, y: e.wy }, now);
        s.x = e.wx; // 最后已知位置（世界坐标）
        s.y = e.wy;
      }
      break;
    }
    case "pulse": {
      // 脉冲事件：eventId 去重后入效果队列。第一版不预播，点击方也走回声。
      if (!markSeen(seenPulses, e.eventId)) break;
      pulses.push({ wx: e.wx, wy: e.wy, bornAt: performance.now(), mine: e.id === state.you });
      if (pulses.length > 64) pulses.shift();
      recordEvent("pulse", { id: e.id, x: e.wx, y: e.wy });
      break;
    }
    case "host_event": {
      if (!markSeen(seenHost, e.eventId)) break;
      recordHostEvent(e.destinationPort, performance.now());
      recordEvent("host", { sourceId: e.sourceId, port: e.destinationPort, kind: e.kind, mode: e.mode });
      break;
    }
    case "metrics": {
      $("m-conns").textContent = e.conns;
      $("chip-conns").textContent = e.conns;
      $("m-heap").textContent = e.heap_mb.toFixed(1) + " MB";
      $("m-sys").textContent = e.sys_mb.toFixed(1) + " MB";
      $("m-dropped").textContent = e.dropped;
      $("m-hostrate").textContent =
        ratePerSecond(hostTimes, performance.now(), 10_000).toFixed(1) + "/s";
      const badge = $("sensor-badge");
      badge.textContent = e.sensor_online ? t(getPrefs().lang, "sensorLive") : t(getPrefs().lang, "sensorOffline");
      badge.className = "sensor-badge " + (e.sensor_online ? "on" : "off");
      break;
    }
  }
}

// ---------- 实时层（真实访客指针 + 脉冲环） ----------

// RENDER_DELAY 是渲染比实时慢的毫秒数（20Hz 更新间隔 50ms + 抖动余量）。
const RENDER_DELAY = 120;

// samplePosition 在世界坐标上插值：从缓冲找夹住渲染时刻的相邻两点做 Hermite。
// s.buf 是按到达时刻排序的 {t, x, y} 队列（世界坐标，t 是本机接收时钟）。
function samplePosition(s, renderT) {
  const buf = s.buf;
  if (!buf || buf.length === 0) return { x: s.x, y: s.y };
  const last = buf[buf.length - 1];
  if (renderT >= last.t) return { x: last.x, y: last.y };
  const first = buf[0];
  if (renderT <= first.t) return { x: first.x, y: first.y };

  for (let i = 0; i < buf.length - 1; i++) {
    const a = buf[i], b = buf[i + 1];
    if (a.t <= renderT && renderT <= b.t) {
      const prog = (renderT - a.t) / (b.t - a.t);
      const span = b.t - a.t;
      // s.playing 冻结正在播放的段的切线：已播出的历史不被未来采样点改写。
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
  return { x: last.x, y: last.y };
}

// hermite 用两端点的位置和切线做三次插值（只管一维）。
function hermite(a, b, ma, mb, s) {
  const s2 = s * s, s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * a + (s3 - 2 * s2 + s) * ma +
    (-2 * s3 + 3 * s2) * b + (s3 - s2) * mb;
}

// tangentAt 估算 buf[idx] 处在 key 维度上的运动切线（坐标/毫秒）：
// 前后邻居割线斜率；转折/持平归零防过冲；缺邻居返回 0。
function tangentAt(buf, idx, key) {
  const prev = buf[idx - 1], next = buf[idx + 1];
  if (!prev || !next) return 0;
  const dPrev = buf[idx][key] - prev[key];
  const dNext = next[key] - buf[idx][key];
  if (dPrev * dNext <= 0) return 0;
  return (next[key] - prev[key]) / (next.t - prev.t);
}

// drawPointer 画一个指针形状（真实访客的光标）；isYou 用本地强调色。
function drawPointer(ctx, x, y, color, label) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + 4, y + 11);
  ctx.lineTo(x + 7, y + 6);
  ctx.lineTo(x + 12, y + 5);
  ctx.closePath();
  ctx.stroke();
  if (label) {
    ctx.font = '10px "Segoe UI","Microsoft YaHei",sans-serif';
    ctx.textAlign = "left";
    ctx.fillStyle = color;
    ctx.fillText(label, x + 14, y + 12);
  }
}

// presenceOverlay 每帧把真实访客和脉冲画进世界（world.js 的主循环调用）。
// 别人的指针在世界坐标上插值后用我自己的相机投影——两端相机不同也对齐。
function presenceOverlay(ctx, now, helpers) {
  const lang = getPrefs().lang;
  for (const [id, s] of state.sessions) {
    const isYou = id === state.you;
    const p = isYou ? { x: s.x, y: s.y } : samplePosition(s, now - RENDER_DELAY);
    const sp = helpers.project(p.x, p.y);
    // 出生/死亡动画的透明度
    let alpha = 1;
    if (s.deadAt) {
      const t = (now - s.deadAt) / 600;
      if (t >= 1) {
        state.sessions.delete(id);
        continue;
      }
      alpha = 1 - t;
    }
    ctx.globalAlpha = alpha;
    drawPointer(ctx, sp.x, sp.y, isYou ? "#d7b38c" : "#79e6ff", isYou ? t(lang, "you") : id);
    ctx.globalAlpha = 1;
  }

  // 脉冲环：世界坐标投影，600ms 生灭
  for (let i = pulses.length - 1; i >= 0; i--) {
    const t2 = (now - pulses[i].bornAt) / 600;
    if (t2 >= 1) {
      pulses.splice(i, 1);
      continue;
    }
    const sp = helpers.project(pulses[i].wx, pulses[i].wy);
    ctx.globalAlpha = (1 - t2) * 0.8;
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, 6 + t2 * 46, 0, Math.PI * 2);
    ctx.strokeStyle = pulses[i].mine ? "#d7b38c" : "#79e6ff";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

// ---------- 事件流与端口速率 ----------

// recordEvent 记录一条真实事件并按当前语言渲染。
function recordEvent(kind, data) {
  feedRecords.unshift({ kind, data, time: Date.now() });
  if (feedRecords.length > 20) feedRecords.pop();
  renderFeed();
}

// renderFeed 按当前语言重绘整个事件流；全部 textContent，服务器数据不进 innerHTML。
function renderFeed() {
  const feed = $("feed");
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
    if (r.kind === "join") appendParts(msg, ["k-join", "join  "], ["b", d.id], ["", " " + t(lang, "evJoin")]);
    else if (r.kind === "leave") appendParts(msg, ["k-leave", "leave "], ["b", d.id], ["", " " + t(lang, "evLeave")]);
    else if (r.kind === "pulse") appendParts(msg, ["k-pulse", "pulse "], ["b", d.id], ["", " " + t(lang, "evPulse", { x: d.x.toFixed(2), y: d.y.toFixed(2) })]);
    else if (r.kind === "host") appendParts(msg, ["k-host", "host  "], ["b", d.sourceId], ["", " " + t(lang, "evHost", { port: d.port, kind: d.kind }) + (d.mode === "fixture" ? t(lang, "evFixtureSuffix") : "")]);
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

// recordHostEvent 记录主机事件时间戳（全局 + 按端口），只留最近 10 秒。
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

// renderPorts 每秒重绘端口速率条（数值全部来自真实事件流）。
function renderPorts() {
  const now = performance.now();
  const el = $("ports");
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
setInterval(renderPorts, 1000);

// ---------- HUD 与控件 ----------

// updateReadout 显示世界坐标与尺度。
function updateReadout() {
  const cam = world.getCamera();
  const format = new Intl.NumberFormat(getPrefs().lang, { maximumFractionDigits: 0 });
  $("coordinates").textContent = "x " + format.format(cam.x) + "   /   y " + format.format(cam.y);
  $("zoom-label").textContent = (cam.zoom / 0.66).toFixed(cam.zoom < 1 ? 1 : 0) + "×";
}

// showNotice 显示操作反馈，只有一个有界定时器，新的反馈替换旧反馈。
let noticeTimer = 0;
function showNotice(text) {
  clearTimeout(noticeTimer);
  $("notice").textContent = text;
  $("notice").classList.add("on");
  noticeTimer = setTimeout(() => $("notice").classList.remove("on"), 2300);
}

// 光标上报：mousemove → 世界坐标记账，50ms 定时器 20Hz 发送。
const canvas = $("world");
canvas.addEventListener("mousemove", (e) => {
  const w = world.screenToWorld(e.clientX, e.clientY);
  pending.x = w.x;
  pending.y = w.y;
  pending.dirty = true;
  const me = state.you && state.sessions.get(state.you);
  if (me) {
    me.x = pending.x;
    me.y = pending.y;
  }
});

setInterval(() => {
  if (!ws) return;
  if (!canSend(pending.dirty, ws.readyState === WebSocket.OPEN, ws.bufferedAmount)) return;
  ws.send(JSON.stringify({ type: "cursor", v: 2, wx: pending.x, wy: pending.y }));
  pending.dirty = false;
}, 50);

// 地址跳转：字符串散列到确定的世界坐标；相同字符串回到相同位置（示例语义）。
$("address-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const value = $("address").value.trim().normalize("NFC");
  if (!value) return;
  let h = 2166136261;
  for (const ch of value) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  const x = ((h >>> 0) % 10001 - 5000) * 560;
  const y = ((Math.imul(h, 2246822519) >>> 0) % 10001 - 5000) * 560;
  world.flyTo({ x, y, zoom: 0.5 }, updateText, 1400);
});

// 主题/语言/帮助/状态按钮
$("theme").addEventListener("click", () => {
  const cur = getPrefs().theme;
  setTheme(cur === "system" ? "light" : cur === "light" ? "dark" : "system");
});
$("system-theme").addEventListener("click", () => setTheme("system"));
$("locale").addEventListener("click", () => {
  setLang(getPrefs().lang === "zh-CN" ? "en" : "zh-CN");
});
$("help").addEventListener("click", () => $("help-dialog").showModal());
$("status-btn").addEventListener("click", () => { $("drawer").hidden = !$("drawer").hidden; });

// 缩放/归处控件
$("plus").addEventListener("click", () => { if (!world.zoomAt(1.35)) showNotice(t(getPrefs().lang, "zoomLimit")); });
$("minus").addEventListener("click", () => { world.zoomAt(1 / 1.35); });
$("origin").addEventListener("click", () => {
  world.flyTo({ x: 0, y: 0, zoom: 0.66 }, updateText);
});
$("enter").addEventListener("click", () => {
  world.enterHouse();
  $("back").hidden = false;
  $("nearby").hidden = true;
});
$("back").addEventListener("click", () => {
  world.returnAbove();
  $("back").hidden = true;
  $("nearby").hidden = false;
});
$("dismiss").addEventListener("click", () => {
  world.selectHouse(null);
});

// 附近空间：飞到房屋上空并选中（第二次操作才下降）
document.querySelectorAll("[data-near]").forEach((el) => {
  el.addEventListener("click", () => {
    const h = world.houseById(el.dataset.near);
    if (!h) return;
    $("back").hidden = true;
    world.selectHouse(h);
    world.flyTo({ x: h.x, y: h.y, zoom: 0.85 }, updateText, 1200);
  });
});

// 对话框关闭交还焦点
document.querySelectorAll("[data-close]").forEach((el) => {
  el.addEventListener("click", () => $(el.dataset.close).close());
});
$("reader").addEventListener("close", () => {
  if (originFocus?.isConnected) originFocus.focus();
  else canvas.focus();
});

// 键盘漫游：方向键平移、+/− 缩放、Esc 返回/取消；文本输入和对话框时不截获。
window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement || $("reader").open || $("help-dialog").open) return;
  const cam = world.getCamera();
  const step = 75 / cam.zoom;
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
    e.preventDefault();
    world.flyTo({
      x: cam.x + (e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0),
      y: cam.y + (e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0),
      zoom: cam.zoom,
    }, null, 220);
  }
  if (e.key === "+" || e.key === "=") world.zoomAt(1.25);
  if (e.key === "-") world.zoomAt(0.8);
  if (e.key === "Escape") {
    if ($("back").hidden === false) {
      world.returnAbove();
      $("back").hidden = true;
      $("nearby").hidden = false;
    } else {
      world.selectHouse(null);
    }
  }
});

// ---------- 启动 ----------

// initWorld 接管画布与渲染循环；四个回调把世界事件接到产品状态上。
world.initWorld(canvas, {
  onHouseSelect: () => updateSelection(),
  onBookPick: (i) => openArticle(i),
  onGroundPulse: (wx, wy) => {
    // 空地点击 = 世界坐标脉冲（打招呼）；不走 20Hz 采样，事件每次单独发
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "pulse", v: 2, clientEventId: `c${pulseSeq++}`, wx, wy }));
  },
  onCameraMove: (() => {
    // 坐标读数节流到 180ms，不每帧写 DOM
    let last = 0;
    return () => {
      const now = performance.now();
      if (now - last > 180) {
        updateReadout();
        last = now;
      }
    };
  })(),
});
world.setOverlay(presenceOverlay);

updateText();
connect();

// 调试句柄：module 作用域不外泄 state，显式暴露只读入口供控制台/自动化检查。
window.PULSE = { state, camera: world.getCamera };
