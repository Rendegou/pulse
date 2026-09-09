"use strict";

/* PULSE 产品前端 · 装配层（潮汐群岛 + 岛上花园）。
 *
 * 职责：WebSocket 连接、真实访客与花园状态、偏好/i18n、HUD 控件、照料面板、诊断抽屉。
 * 世界渲染与输入手势在 world.js；岛屿数据在 islands.js；纯计算在 pure.js；文案在 i18n.js。
 *
 * 数据真实性：访客、指针、浇水与植物生长都来自真实 /ws 连接（v3 世界坐标 + 服务端权威
 * 花园快照）；岛屿与植物是标注清楚的示例内容；fixture 主机事件只出现在诊断抽屉。
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
import { ISLANDS } from "./islands.js";

const $ = (id) => document.getElementById(id);

// ---------- 状态 ----------

// sessions 是在线连接表：id -> {id, island, wx, wy, buf, bornAt, deadAt, playing}
const state = { you: null, sessions: new Map() };

// pulses 是活动中的脉冲效果（世界坐标）：{wx, wy, bornAt, mine}，600ms 生命，最多 64 个。
const pulses = [];
const seenPulses = new Set();
const seenHost = new Set();
let pulseSeq = 0;
let waterSeq = 0;

// watering 是本地照料动作状态：busy 表示已发出但未收到服务端确认；
// nextAt 是本地冷却结束时刻（服务端还有自己的冷却，本地只是提前禁用按钮）；
// timer 是“未确认”超时，coolTimer 是冷却结束时刷新按钮的定时器。
const watering = { busy: false, nextAt: 0, timer: 0, coolTimer: 0 };

// pending 记录自己最近一次指针的世界坐标与所在岛；dirty 表示有未发送的新位置。
const pending = { x: 0, y: 0, island: "", dirty: false };

// hostTimes/portTimes 记录主机事件到达时刻，速率是客户端自己数的实测值。
const hostTimes = [];
const portTimes = new Map();

// feedRecords 是结构化事件记录（有界 20 条）：存数据不存文字，切语言整流重绘。
const feedRecords = [];

// ---------- 偏好 → 世界调色板 ----------

// refreshPalette 从 CSS 变量读一次主题颜色并注入世界引擎（不逐帧读）。
// 带 -rgb 的变量拆成 [r,g,b] 数组：Canvas 需要自己合成透明度。
function refreshPalette() {
  const cs = getComputedStyle(document.documentElement);
  const get = (k) => cs.getPropertyValue(k).trim();
  const rgb = (k) => get(k).split(",").map((n) => Number(n.trim()));
  world.setPalette({
    bg: get("--bg"),
    sea: rgb("--world-sea-rgb"),
    foam: rgb("--world-foam-rgb"),
    shore: rgb("--world-shore-rgb"),
    land: rgb("--world-land-rgb"),
    contour: rgb("--world-contour-rgb"),
    solid: get("--world-solid"),
    paper: get("--world-paper"),
    ink: get("--world-ink"),
    gold: get("--gold"),
    shadow: get("--shadow"),
  });
}

initPreferences();
refreshPalette();

onPreferenceChange(() => {
  refreshPalette();
  updateText();
});

// ---------- 界面文案 ----------

// updateText 全面刷新静态与动态界面；切换语言不改花园状态或岛的位置。
function updateText() {
  const lang = getPrefs().lang;

  document.documentElement.lang = lang;
  document.title = "PULSE · " + t(lang, "edition");
  $("edition").textContent = t(lang, "edition");
  $("eyebrow").textContent = t(lang, "eyebrow");
  $("headline").textContent = t(lang, "headline");
  $("description").textContent = t(lang, "description");
  $("nearby-title").textContent = t(lang, "nearby");
  $("fixture").textContent = t(lang, "demo");
  $("help").textContent = t(lang, "help");
  $("help-title").textContent = t(lang, "helpTitle");
  $("limit-copy").textContent = t(lang, "limits");
  $("status-btn").textContent = t(lang, "statusOpen");
  $("address").placeholder = t(lang, "address");
  $("system-theme").textContent = t(lang, "themeFollowSystem");
  $("theme").textContent = themeButtonLabel();
  $("locale").textContent = lang === "zh-CN" ? "EN" : "中文";
  $("feed-title").textContent = t(lang, "feedTitle");
  $("ports-title").textContent = t(lang, "portsLive");
  $("origin").textContent = t(lang, "home");
  $("minus").setAttribute("aria-label", t(lang, "zoomOut"));
  $("plus").setAttribute("aria-label", t(lang, "zoomIn"));
  $("land").setAttribute("aria-label", t(lang, "worldLabel"));
  $("ws-label").textContent = connectionLabel();
  $("care").setAttribute("aria-label", t(lang, "careLabel"));
  $("visit").textContent = t(lang, "visit");

  // 帮助文本按段落渲染，避免拼 HTML
  const copy = $("help-copy");
  copy.replaceChildren();
  for (const paragraph of tArr(lang, "helpCopy")) {
    const p = document.createElement("p");
    p.textContent = paragraph;
    copy.appendChild(p);
  }

  renderNearby();
  updateModeText();
  updatePlantLabel(world.getSelected());
  updateReadout();
  renderFeed();
}

// themeButtonLabel 显示当前主题偏好（system/light/dark → 对应文案）。
function themeButtonLabel() {
  const key = { system: "themeSystem", light: "themeLight", dark: "themeDark" }[getPrefs().theme];
  return t(getPrefs().lang, key);
}

// connectionLabel 按连接状态返回顶栏文字；未连接时显示“连接中”。
function connectionLabel() {
  const lang = getPrefs().lang;
  if (!ws) return t(lang, "connecting");
  if (ws.readyState === WebSocket.OPEN) return t(lang, "connected");
  if (ws.readyState === WebSocket.CONNECTING) return t(lang, "connecting");
  return t(lang, "reconnecting");
}

// updateModeText 根据“靠近/远景”切换左侧标题、说明、入口与提示文字。
// 只改文字与类名，不重建场景；岛名来自 i18n，与 islands.js 的索引一一对应。
function updateModeText() {
  const lang = getPrefs().lang;
  const near = world.getNearState();
  const names = tArr(lang, "islandNames");
  const selected = world.getSelected();
  document.body.classList.toggle("near", near);
  $("headline").textContent = near ? names[selected] : t(lang, "headline");
  $("description").textContent = near ? t(lang, "nearDesc") : t(lang, "description");
  $("approach-text").textContent = near ? t(lang, "back") : t(lang, "approach");
  $("hint").textContent = near ? t(lang, "nearHint") : t(lang, "hint");
  // 岛标签副标题显示“岛上植物”这类规模提示（示例内容）
  document.querySelectorAll(".island-label .sub").forEach((el) => {
    el.textContent = t(lang, "plantMeta");
  });
  updateCarePanel();
}

// renderNearby 重建“海的另一边”列表：三座示例岛的等价键盘入口。
function renderNearby() {
  const lang = getPrefs().lang;
  const names = tArr(lang, "islandNames");
  const host = $("nearby");
  host.querySelectorAll("button").forEach((el) => el.remove());
  ISLANDS.forEach((isl, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.island = isl.id;
    b.classList.toggle("current", i === world.getSelected());
    const name = document.createElement("span");
    name.textContent = names[i] || isl.id;
    const arrow = document.createElement("span");
    arrow.className = "arrow";
    arrow.textContent = "↗";
    b.append(name, arrow);
    // 点列表 = 选中并靠近这座岛（与画布上点岛等价）
    b.addEventListener("click", () => {
      world.selectIsland(i);
      world.approach(i);
    });
    host.appendChild(b);
  });
}

// ---------- 花园与照料 ----------

// updateCarePanel 刷新照料面板：文案随生长阶段变化，按钮在冷却/未确认/断线时禁用。
// 面板只在靠近状态出现；远景的入口是岛标签与附近列表。
function updateCarePanel() {
  const lang = getPrefs().lang;
  const near = world.getNearState();
  const garden = world.getGarden();
  const plant = garden.plants[world.getSelected()] || { care: 0, last: null };
  const stage = Math.min(3, plant.care);

  $("care").hidden = !near;
  $("care-note").textContent = tArr(lang, "careStage")[stage] || "";
  const cooling = watering.busy || performance.now() < watering.nextAt;
  $("water").textContent = cooling ? t(lang, "waiting") : t(lang, "water");
  $("water").disabled = cooling || !connectionOpen();

  // 最近照料记录：id 是临时连接号，不是注册用户；自己用“你”，别人用“来客 编号”。
  const trace = plant.last
    ? t(lang, "lastCared") + (plant.last.id === state.you ? t(lang, "you") : `${t(lang, "guest")} ${plant.last.id}`) + " · " + t(lang, "lastWatered")
    : t(lang, "lastNone");
  $("care-detail").textContent = t(lang, "careDetail") + " · " + trace;
}

// updatePlantLabel 刷新画布上的植物标签（三行：提示 / 阶段 / 动作）。
// 由 world.js 在选中岛或注入新花园快照时调用，保证标签与植物指向同一株。
function updatePlantLabel(index) {
  const lang = getPrefs().lang;
  const garden = world.getGarden();
  const plant = garden.plants[index] || { care: 0, last: null };
  world.setPlantLabelText({
    meta: t(lang, "plantMeta"),
    name: tArr(lang, "careStage")[Math.min(3, plant.care)] || "",
    more: world.getNearState() ? t(lang, "water") : t(lang, "approach"),
  });
}

// waterPlant 是画布植物、植物标签与面板按钮共用的唯一照料动作。
// 远景时先靠近；服务端确认后才改变生长阶段（本地不预先加 care）。
function waterPlant() {
  const lang = getPrefs().lang;
  if (watering.busy || performance.now() < watering.nextAt) return;
  if (!world.getNearState()) {
    world.approach(world.getSelected());
    return;
  }
  if (!connectionOpen()) {
    showToast(t(lang, "connecting"));
    return;
  }
  const plantID = ISLANDS[world.getSelected()]?.id;
  if (!plantID) return;
  watering.busy = true;
  updateCarePanel();
  ws.send(JSON.stringify({ type: "water", v: 1, plant: plantID, eventId: `w${waterSeq++}` }));
  // 超时未收到确认就解除禁用并提示：不假装照料成功
  clearTimeout(watering.timer);
  watering.timer = setTimeout(() => {
    if (!watering.busy) return;
    watering.busy = false;
    showToast(t(getPrefs().lang, "waterUnconfirmed"));
    updateCarePanel();
  }, 5000);
}

// connectionOpen 报告 WebSocket 是否处于可发送状态。
function connectionOpen() {
  return !!ws && ws.readyState === WebSocket.OPEN;
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

  ws.onopen = () => {
    retry = 0;
    dot.classList.add("on");
    $("ws-label").textContent = t(getPrefs().lang, "connected");
    updateCarePanel();
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
    $("ws-label").textContent = t(getPrefs().lang, "reconnecting");
    updateCarePanel();
    setTimeout(connect, Math.min(5000, 300 * 2 ** retry++));
  };
}

// onMessage 分发服务端事件：welcome 确定身份、在线表与花园快照；join/leave 增减在线点；
// cursor 进插值缓冲；presence 更新岛归属；pulse 进效果队列；
// plant 是花园权威快照（浇水结果）；host_event 进诊断抽屉。
function onMessage(e) {
  switch (e.type) {
    case "welcome":
      state.you = e.you;
      state.sessions.clear();
      for (const s of e.sessions) {
        state.sessions.set(s.id, { ...s, bornAt: performance.now() });
      }
      pending.dirty = false; // 重连后旧 pending 作废
      world.setGarden(e.garden, true);
      updateCarePanel();
      break;
    case "join":
      state.sessions.set(e.session.id, { ...e.session, bornAt: performance.now() });
      recordEvent("join", { id: e.session.id, island: e.session.island });
      if (e.session.id !== state.you) showToast(t(getPrefs().lang, "arrival"));
      break;
    case "leave": {
      const s = state.sessions.get(e.id);
      if (s) s.deadAt = performance.now();
      recordEvent("leave", { id: e.id });
      break;
    }
    case "cursor": {
      // 别人的光标增量（世界坐标）：进有界插值缓冲；自己的回声跳过。
      if (e.id === state.you) break;
      const s = state.sessions.get(e.id);
      if (s) {
        const now = performance.now();
        if (!s.buf) s.buf = [];
        appendPositionSample(s.buf, { t: now, x: e.wx, y: e.wy }, now);
        s.wx = e.wx; // 最后已知位置（世界坐标）
        s.wy = e.wy;
        if (e.island !== undefined) s.island = e.island;
      }
      break;
    }
    case "presence": {
      // 岛归属变化（服务端判定）：更新在线表并记一条事件，不重排场景。
      const s = state.sessions.get(e.id);
      if (s) {
        s.island = e.island;
        s.wx = e.wx;
        s.wy = e.wy;
      }
      if (e.id !== state.you) recordEvent("island", { id: e.id, island: e.island });
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
    case "plant": {
      // 花园权威快照：先应用状态，再播水滴效果与提示。
      // 只有自己发起的那次会解除“未确认”状态；别人的浇水不影响本地按钮。
      world.setGarden(e.garden);
      world.addWaterEffect(e.plantID, e.together);
      if (e.id === state.you) {
        watering.busy = false;
        clearTimeout(watering.timer);
        watering.nextAt = performance.now() + 2500;
        // 冷却结束时刷新面板，否则按钮会一直停在“水正在落下…”的禁用态
        clearTimeout(watering.coolTimer);
        watering.coolTimer = setTimeout(() => updateCarePanel(), 2600);
        showToast(e.together ? t(getPrefs().lang, "together") : t(getPrefs().lang, "thanks"));
      } else {
        showToast(`${t(getPrefs().lang, "guest")} ${e.id} ${t(getPrefs().lang, "remoteWatered")}`);
      }
      recordEvent("water", { id: e.id, plant: islandName(e.plantID), together: e.together });
      updateCarePanel();
      updatePlantLabel(world.getSelected());
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
      $("m-hostrate").textContent = ratePerSecond(hostTimes, performance.now(), 10_000).toFixed(1) + "/s";
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
  if (!buf || buf.length === 0) return { x: s.wx, y: s.wy };
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

// presenceOverlay 每帧把真实访客和脉冲画进世界（world.js 的渲染循环调用）。
// 别人的指针在世界坐标上插值后用我自己的相机投影——两端相机不同也对齐。
function presenceOverlay(ctx, now, helpers) {
  const lang = getPrefs().lang;
  for (const [id, s] of state.sessions) {
    const isYou = id === state.you;
    // 断线后系统光标接管交互，不再重复绘制旧的本地箭头。
    if (isYou && !connectionOpen()) continue;
    const p = isYou ? { x: s.wx, y: s.wy } : samplePosition(s, now - RENDER_DELAY);
    const sp = helpers.project(p.x, p.y);
    if (!sp) continue;
    // 出生/死亡动画的透明度
    let alpha = 1;
    if (s.deadAt) {
      const life = (now - s.deadAt) / 600;
      if (life >= 1) {
        state.sessions.delete(id);
        continue;
      }
      alpha = 1 - life;
    }
    ctx.globalAlpha = alpha;
    drawPointer(ctx, sp.x, sp.y, isYou ? paletteAccent() : "#79e6ff", isYou ? t(lang, "you") : id);
    ctx.globalAlpha = 1;
  }

  // 脉冲环：世界坐标投影到海面，600ms 生灭
  for (let i = pulses.length - 1; i >= 0; i--) {
    const life = (now - pulses[i].bornAt) / 600;
    if (life >= 1) {
      pulses.splice(i, 1);
      continue;
    }
    const sp = helpers.project(pulses[i].wx, pulses[i].wy);
    if (!sp) continue;
    ctx.globalAlpha = (1 - life) * 0.8;
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, (6 + life * 46) * clampScale(sp.s), 0, Math.PI * 2);
    ctx.strokeStyle = pulses[i].mine ? paletteAccent() : "#79e6ff";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

// clampScale 把投影尺度限制在合理范围，避免贴近镜头时脉冲环铺满整屏。
function clampScale(s) {
  return Math.max(0.25, Math.min(3, s || 1));
}

// paletteAccent 读取当前主题的强调色（脉冲与“你”的指针共用）。
function paletteAccent() {
  return getComputedStyle(document.documentElement).getPropertyValue("--gold").trim() || "#d7b38c";
}

// overlayActive 报告实时层是否还有活动：有存活脉冲或远端访客时需要继续出帧。
// world.js 用它决定是否保持动画循环；没有活动时页面静止、CPU 让出去。
function overlayActive() {
  if (pulses.length) return true;
  for (const [id] of state.sessions) {
    if (id !== state.you) return true;
  }
  return false;
}

// isModalOpen 报告是否有模态对话框打开（帮助页打开时暂停海浪与键盘漫游）。
function isModalOpen() {
  return $("help-dialog").open;
}

// getReservedRect 返回左侧文字区的屏幕矩形，供 world.js 隐藏与之重叠的岛标签。
function getReservedRect() {
  return $("intro").getBoundingClientRect();
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
    else if (r.kind === "island") appendParts(msg, ["k-pulse", "island"], ["b", d.id], ["", " → " + islandName(d.island)]);
    else if (r.kind === "water") appendParts(msg, ["k-pulse", "water "], ["b", d.id], ["", " " + t(lang, "evWater", { plant: d.plant })]);
    else if (r.kind === "pulse") appendParts(msg, ["k-pulse", "pulse "], ["b", d.id], ["", " " + t(lang, "evPulse", { x: d.x.toFixed(0), y: d.y.toFixed(0) })]);
    else if (r.kind === "host") appendParts(msg, ["k-host", "host  "], ["b", d.sourceId], ["", " " + t(lang, "evHost", { port: d.port, kind: d.kind }) + (d.mode === "fixture" ? t(lang, "evFixtureSuffix") : "")]);
    el.append(time, msg);
    feed.appendChild(el);
  }
}

// islandName 把服务端岛 id 换成当前语言的示例名；未知 id 原样显示（不假装认识）。
function islandName(id) {
  const index = ISLANDS.findIndex((isl) => isl.id === id);
  if (index < 0) return id || "—";
  return tArr(getPrefs().lang, "islandNames")[index] || id;
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
  // 帧耗时（EWMA）随端口条一起每秒刷新——真实渲染成本，不靠嘴说
  $("m-frame").textContent = world.getStats().frameMs.toFixed(1) + " ms";
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

// updateReadout 显示世界坐标与镜头放大倍数（相对远景），并同步缩放按钮的可用状态。
function updateReadout() {
  const cam = world.getCamera();
  const format = new Intl.NumberFormat(getPrefs().lang, { maximumFractionDigits: 0 });
  $("coordinates").textContent = format.format(cam.x) + " / " + format.format(cam.y);
  $("zoom").textContent = cam.zoom.toFixed(1) + "×";
  $("minus").disabled = cam.d >= 2400;
  $("plus").disabled = cam.d <= 280;
}

// showToast 显示操作反馈，只有一个有界定时器，新的反馈替换旧反馈。
let toastTimer = 0;
function showToast(text) {
  clearTimeout(toastTimer);
  $("toast").textContent = text;
  $("toast").classList.add("on");
  toastTimer = setTimeout(() => $("toast").classList.remove("on"), 3000);
}

// 光标上报：pointermove → 世界坐标记账，50ms 定时器 20Hz 发送。
// island 字段由客户端粗判（便于服务端日志对账），服务端会用同一坐标重新判定权威归属。
const land = $("land");
land.addEventListener("pointermove", (e) => {
  const w = world.screenToWorld(e.clientX, e.clientY);
  pending.x = w.x;
  pending.y = w.y;
  pending.island = islandAt(w.x, w.y);
  pending.dirty = true;
  const me = state.you && state.sessions.get(state.you);
  if (me) {
    me.wx = pending.x;
    me.wy = pending.y;
    me.island = pending.island;
  }
});

// islandAt 用与后端同一套椭圆判定粗算当前所在岛（只用于上报，不作为权威）。
function islandAt(x, y) {
  let best = "", bestD = Infinity;
  for (const isl of ISLANDS) {
    const d = Math.hypot((x - isl.x) / isl.r, (y - isl.y) / (isl.r * isl.sy));
    if (d <= 1.15 && d < bestD) { bestD = d; best = isl.id; }
  }
  return best;
}

setInterval(() => {
  if (!ws) return;
  if (!canSend(pending.dirty, ws.readyState === WebSocket.OPEN, ws.bufferedAmount)) return;
  ws.send(JSON.stringify({ type: "cursor", v: 3, wx: pending.x, wy: pending.y, island: pending.island }));
  pending.dirty = false;
}, 50);

// 地址跳转：字符串散列到确定的世界坐标；命中示例岛时直接落在岛上（示例语义）。
$("address-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const value = $("address").value.trim().normalize("NFC");
  if (!value) return;
  let h = 2166136261;
  for (const ch of value) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  const x = ((h >>> 0) % 10001 - 5000) * 560;
  const y = ((Math.imul(h, 2246822519) >>> 0) % 10001 - 5000) * 560;
  const hit = islandAt(x, y);
  if (hit) {
    const index = ISLANDS.findIndex((isl) => isl.id === hit);
    world.selectIsland(index);
    world.approach(index);
    showToast(islandName(hit));
  } else {
    world.flyTo({ x, y, d: 700 });
    showToast(`${Math.round(x)} / ${Math.round(y)}`);
  }
});

// 顶栏与底部控件
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
$("drawer-close").addEventListener("click", () => { $("drawer").hidden = true; });
$("brand").addEventListener("click", () => {
  world.selectIsland(0);
  world.returnAbove();
});
$("origin").addEventListener("click", () => {
  world.selectIsland(0);
  world.returnAbove();
});
$("plus").addEventListener("click", () => {
  if (!world.zoomAt(0.72)) showToast(t(getPrefs().lang, "zoomLimit"));
});
$("minus").addEventListener("click", () => world.zoomAt(1.38));
$("approach").addEventListener("click", () => {
  if (world.getNearState()) world.returnAbove();
  else world.approach(world.getSelected());
});
// 面板按钮与画布上的植物共用同一个照料动作
$("water").addEventListener("click", waterPlant);

// 帮助对话框关闭交还焦点
document.querySelectorAll("[data-close]").forEach((el) => {
  el.addEventListener("click", () => $(el.dataset.close).close());
});
$("help-dialog").addEventListener("close", () => land.focus());

// ---------- 启动 ----------

// initWorld 接管三块画布与渲染循环；回调把世界事件接到产品状态上。
world.initWorld(
  { sea: $("sea"), land, air: $("air"), labelHost: $("labels") },
  {
    // 选中岛：刷新附近列表与左侧文案，让界面始终指向当前空间
    onIslandSelect: () => {
      renderNearby();
      updateModeText();
      updatePlantLabel(world.getSelected());
    },
    // 点植物或植物标签：与面板按钮共用照料动作
    onPlantWater: waterPlant,
    // 植物标签需要按当前语言与阶段刷新
    onPlantLabel: (index) => updatePlantLabel(index),
    // 靠近/退回：切换左侧文案、面板与窄屏布局
    onNearChange: () => updateModeText(),
    // 空地点击 = 世界坐标脉冲（打招呼）；每次单独发，不走 20Hz 采样
    onGroundPulse: (wx, wy) => {
      if (!connectionOpen()) return;
      ws.send(JSON.stringify({ type: "pulse", v: 2, clientEventId: `c${pulseSeq++}`, wx, wy }));
    },
    // 相机移动：坐标读数节流到 180ms，不每帧写 DOM
    onCameraMove: (() => {
      let last = 0;
      return () => {
        const now = performance.now();
        if (now - last > 180) {
          updateReadout();
          last = now;
        }
      };
    })(),
    isReading: isModalOpen,
    isModalOpen,
    overlayActive,
    getReservedRect,
  },
);
world.setOverlay(presenceOverlay);

updateText();
connect();

// 调试句柄：module 作用域不外泄 state，显式暴露只读入口供控制台/自动化检查。
window.PULSE = { state, camera: world.getCamera, stats: world.getStats, watering };
