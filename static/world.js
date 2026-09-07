// world.js — 粒子地表世界引擎：相机、投影、地形、房屋、输入手势、渲染循环。
//
// 数据语义：连续平面世界坐标 + 局部曲面投影 + 视野内确定性生成。
// 没有真实球体/经纬度；演示房屋是确定性生成的示例，不冒充真实作者数据。
// 真实访客/脉冲由 app.js 通过 setOverlay 注入（本模块不碰网络）。

import { projectCalc, unprojectCalc } from "./pure.js";

// ---------- 可调审美参数（集中管理，docs/09 §8） ----------

const TUNE = {
  zoomMin: 0.025,      // 缩放数值保护下限（不露出"完整球体"）
  zoomMax: 14,         // 上限
  descentMs: 1700,     // 下降时长（调参起点）
  returnMs: 1350,      // 返回时长
  houseCell: 560,      // 房屋地块网格尺寸（世界单位）
  terrainDensity: 18000, // 地形粒子密度系数（面积/粒子）
  arcLife: 1800,       // 雷达弧线生命周期 ms（由 app.js 弧线使用）
};

// ---------- 模块状态 ----------

// camera 是当前镜头：x/y 是世界坐标中心，zoom 是尺度。
const camera = { x: 0, y: 0, zoom: 0.66 };

// state 是世界引擎的运行状态。
const state = {
  flight: null,        // 进行中的相机飞行 {from, to, at, ms, onDone}
  velocity: { x: 0, y: 0 }, // 拖动惯性速度（世界单位/毫秒）
  gesture: null,       // 当前手势
  pointers: new Map(), // 活跃的指针
  selected: null,      // 选中的房屋
  inside: null,        // 已进入的房屋
  returnView: null,    // 进入前的相机（用于返回）
  hits: [],            // 本帧房屋命中区
  bookHits: [],        // 本帧书本命中区
  houses: [],          // 本帧可见房屋
  lastTime: 0,
  visible: true,
  raf: 0,
  frameMs: 0,        // 最近一帧的渲染耗时（EWMA 平滑）
  terrainCount: 0,   // 最近一帧的地形粒子数
};

let canvas, ctx, W = 0, H = 0, R = 1;

// 地形离屏缓存：地形是 (相机, 尺寸, 主题) 的纯函数。
// 静止时不必每帧重算上万个粒子——重绘条件：缓存键变了 / 呼吸到期 / 正在移动。
let terrainCache = null;
let terrainCacheKey = "";
let terrainLastCompute = 0;
let palette = {};      // 由 setPalette 注入（主题相关颜色）
let overlay = null;    // app.js 的实时层回调 (ctx, now, helpers)
let onHouseSelect = null, onBookPick = null, onGroundPulse = null, onCameraMove = null;
let motionReduced = false;

// ---------- 对外装配 ----------

// initWorld 绑定画布并启动唯一渲染循环。handlers 由 app.js 提供：
// { onHouseSelect(h), onBookPick(i), onGroundPulse(wx, wy), onCameraMove(camera) }
export function initWorld(canvasEl, handlers) {
  canvas = canvasEl;
  ctx = canvas.getContext("2d");
  onHouseSelect = handlers.onHouseSelect || null;
  onBookPick = handlers.onBookPick || null;
  onGroundPulse = handlers.onGroundPulse || null;
  onCameraMove = handlers.onCameraMove || null;
  motionReduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  resize();
  window.addEventListener("resize", resize);
  bindGestures();

  document.addEventListener("visibilitychange", () => {
    state.visible = !document.hidden;
    if (!state.visible) {
      cancelAnimationFrame(state.raf);
      state.raf = 0;
    } else if (!state.raf) {
      state.lastTime = 0;
      state.raf = requestAnimationFrame(render);
    }
  });

  state.raf = requestAnimationFrame(render);
}

// setPalette 注入主题颜色（主题切换时由 app.js 再调一次）。
export function setPalette(p) {
  palette = p;
}

// setOverlay 注册每帧的实时层绘制（真实访客指针、脉冲环、雷达弧线）。
// fn(ctx, now, helpers)；helpers.project 把世界坐标投到屏幕。
export function setOverlay(fn) {
  overlay = fn;
}

// getStats 返回性能统计（调试/验收用）：frameMs 是 EWMA 平滑的帧渲染耗时。
export function getStats() {
  return { frameMs: state.frameMs, terrainCount: state.terrainCount, houses: state.houses.length };
}

// getCamera 返回当前相机快照（只读拷贝）。
export function getCamera() {
  return { ...camera };
}

// screenToWorld 把地表屏幕点反解为世界坐标（app.js 的光标上报用它）。
export function screenToWorld(x, y) {
  return unprojectCalc(view(), x, y);
}

// ---------- 相机动作 ----------

// flyTo 从当前显示值开始飞行；再次输入替换旧目标，没有排队和输入锁。
// 缩放按对数尺度插值，保证连续的下降/上升感。
export function flyTo(to, onDone, ms = 1500) {
  state.velocity = { x: 0, y: 0 };
  state.flight = {
    from: { ...camera },
    to,
    at: performance.now(),
    ms: motionReduced ? 1 : ms,
    onDone,
  };
}

// zoomAt 保持指针下的地表世界点不动进行缩放。
export function zoomAt(factor, x = W / 2, y = H * 0.53) {
  stopFlight();
  const before = unprojectCalc(view(), x, y);
  const old = camera.zoom;
  camera.zoom = clamp(camera.zoom * factor, TUNE.zoomMin, TUNE.zoomMax);
  const after = unprojectCalc(view(), x, y);
  camera.x += before.x - after.x;
  camera.y += before.y - after.y;
  // 缩得太远时自动退出室内
  if (state.inside && camera.zoom < 1.8) {
    state.inside = null;
    onHouseSelect && onHouseSelect(null);
  }
  return camera.zoom !== old;
}

// landingZoom 按窗口计算室内尺度；窄屏也完全打开屋顶。
export function landingZoom() {
  return clamp(Math.min(W / 165, H / 153), 2.4, 7);
}

// selectHouse 选中房屋（不移动相机）；传 null 取消。
export function selectHouse(h) {
  state.selected = h;
  onHouseSelect && onHouseSelect(h);
}

// enterHouse 记录上空位置并连续下降；屋顶透明度由当前镜头尺度驱动。
export function enterHouse() {
  if (!state.selected) return;
  state.returnView = { ...camera };
  const h = state.selected;
  flyTo({ x: h.x, y: h.y, zoom: landingZoom() }, () => {
    state.inside = h;
    onHouseSelect && onHouseSelect(h); // 通知 app 切到室内态
  }, TUNE.descentMs);
}

// returnAbove 回到进入前的视野；可以打断尚未完成的下降。
export function returnAbove() {
  if (!state.returnView) return;
  const dest = state.returnView;
  state.inside = null;
  state.returnView = null;
  flyTo(dest, () => {
    state.selected = null;
    onHouseSelect && onHouseSelect(null);
  }, TUNE.returnMs);
}

// getInside 返回当前进入的房屋（无则 null）。
export function getInside() {
  return state.inside;
}

// getSelected 返回当前选中的房屋（无则 null）。
export function getSelected() {
  return state.selected;
}

// houseById 按 id 取当前已知房屋（示例三件套或确定性生成）。
export function houseById(id) {
  if (id === "origin") return houseAt(0, 0);
  if (id === "rain") return houseAt(1, 0);
  if (id === "letter") return houseAt(-1, 1);
  return null;
}

// ---------- 世界生成（确定性） ----------

// hash 对整数网格与种子生成稳定的 0..1 值；用于示例内容，非身份或密码。
function hash(x, y, s = 0) {
  let n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1274126177);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

// terrain 在世界坐标上计算连续起伏；移动镜头不会重新随机化同一地点。
function terrain(x, y) {
  return Math.sin(x * 0.004 + Math.sin(y * 0.0021) * 1.4) * 0.44 +
    Math.cos(y * 0.0051 - x * 0.0014) * 0.28 +
    Math.sin((x + y) * 0.013) * 0.12;
}

// houseAt 仅由地块坐标生成示例房屋；命名、位置、朝向不随视野重采样。
export function houseAt(cx, cy) {
  if (cx === 0 && cy === 0) return { id: "origin", x: 0, y: 0, name: 0, special: true, tag: "", turn: 0 };
  if (cx === 1 && cy === 0) return { id: "rain", x: 620, y: 100, name: 1, special: true, tag: "", turn: 0 };
  if (cx === -1 && cy === 1) return { id: "letter", x: -540, y: 570, name: 2, special: true, tag: "", turn: 1 };
  if (hash(cx, cy, 1) < 0.34) return null;
  return {
    id: cx + ":" + cy,
    x: cx * 560 + (hash(cx, cy, 2) - 0.5) * 220,
    y: cy * 560 + (hash(cx, cy, 3) - 0.5) * 220,
    name: 3 + Math.floor(hash(cx, cy, 4) * 5),
    tag: Math.floor(hash(cx, cy, 5) * 999),
    turn: hash(cx, cy, 6) > 0.5 ? 1 : 0,
  };
}

// ---------- 渲染 ----------

// view 把当前相机和画布尺寸打包给纯函数投影。
function view() {
  return { cx: camera.x, cy: camera.y, zoom: camera.zoom, W, H };
}

// project 用当前相机把世界坐标投到屏幕（世界引擎内部使用）。
function project(x, y, z = 0) {
  return projectCalc(view(), x, y, z);
}

// clamp 为缩放和透明度提供有限区间，不改变世界坐标。
function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

// local 把房屋局部位置转换为世界位置；全部家具和屋顶共享一个朝向。
function local(h, x, y, z = 0) {
  return h.turn ? { x: h.x - y, y: h.y + x, z } : { x: h.x + x, y: h.y + y, z };
}

// hp 投影房屋局部坐标，避免室内物件在镜头变化后脱离地面。
function hp(h, x, y, z = 0) {
  const p = local(h, x, y, z);
  return project(p.x, p.y, p.z);
}

// polygon 绘制世界物件的屏幕多边形。
function polygon(points, stroke, fill, alpha = 1, width = 1) {
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    if (i === 0) ctx.moveTo(points[i].x, points[i].y);
    else ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// segment 画一条有界线段，样式全部来自当前主题。
function segment(a, b, color, alpha = 0.5, width = 1) {
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

// dot 使用小圆点构成地表/结构/交互节点。
function dot(p, r, color, alpha = 1) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

// dottedEdge 沿房屋边界生成稳定粒子，保证粒子附着物件而非屏幕装饰。
function dottedEdge(h, a, b, color, alpha, step = 5) {
  const n = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], (b[2] || 0) - (a[2] || 0)) / step));
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    dot(
      hp(h, a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, (a[2] || 0) + ((b[2] || 0) - (a[2] || 0)) * k),
      0.75, color, alpha,
    );
  }
}

// drawTerrainCached 是地形渲染的调度器：
// - 静止：把地形画进离屏缓存，之后每帧 drawImage 直接贴（约等于零成本）；
//   呼吸微光每 250ms 才重算一次（4Hz 的明暗脉动足够）。
// - 移动/拖动/飞行：每帧用粗粒度重算（跟手优先，细节让路）。
function drawTerrainCached(now) {
  const speed = Math.hypot(state.velocity.x, state.velocity.y) * 1000; // 世界单位/秒
  const moving = !!state.gesture || !!state.flight || speed > 50;
  const key = moving
    ? "" // 移动中不缓存：键每帧变化
    : [camera.x.toFixed(2), camera.y.toFixed(2), camera.zoom.toFixed(4), W, H, palette.bg].join("|");
  const shimmerDue = now - terrainLastCompute > 250;
  if (!terrainCache || terrainCacheKey !== key || (!moving && shimmerDue)) {
    if (!terrainCache) terrainCache = document.createElement("canvas");
    const d = Math.min(devicePixelRatio || 1, 2);
    terrainCache.width = Math.round(W * d);
    terrainCache.height = Math.round(H * d);
    const g = terrainCache.getContext("2d");
    g.setTransform(d, 0, 0, d, 0, 0);
    const realCtx = ctx; // 临时切到离屏：dot/segment 等 helper 都读模块级 ctx
    ctx = g;
    g.fillStyle = palette.bg;
    g.fillRect(0, 0, W, H);
    drawTerrain(moving ? 0 : now);
    ctx = realCtx;
    terrainCacheKey = key;
    terrainLastCompute = now;
  }
  ctx.drawImage(terrainCache, 0, 0, W, H);
}

// drawTerrain 只采样可见局部的两层粒子；LOD 按二次幂交叉淡化。
// 动态细节：拖动/飞行/惯性滚动中降为单层粗粒度、跳过辅助线、关闭呼吸——
// 把帧预算留给跟手；静止后自动恢复全细节（视觉密度不变，只是少了动态微光）。
// drawTerrain 的地形细节通过模块级 ctx 工作；
// 离屏缓存时由 drawTerrainCached 先切换 ctx 再调用（见缓存调度器注释）。
function drawTerrain(now) {
  const lo = unprojectCalc(view(), -20, -20);
  const hi = unprojectCalc(view(), W + 20, H + 20);
  const area = (hi.x - lo.x) * (hi.y - lo.y);
  const ideal = Math.max(7 / camera.zoom, 2 * Math.sqrt(area / TUNE.terrainDensity));
  const base = 2 ** Math.floor(Math.log2(ideal));
  const f = clamp(ideal / base - 1, 0, 1);
  state.terrainCount = 0;
  if (now === 0) { // now=0 是移动中粗粒度模式的约定（由 drawTerrainCached 传入）
    drawTerrainLevel(base * 2, 1, 0, lo, hi, false);
    return;
  }
  drawTerrainLevel(base, 1 - f * 0.55, now, lo, hi, true);
  drawTerrainLevel(base * 2, f * 0.7, now, lo, hi, true);
  drawGraticule(base * 6);
}

// drawTerrainLevel 根据世界格点计算确定性粒子，工作量受屏幕分辨率与 LOD 控制。
function drawTerrainLevel(step, weight, now, lo, hi, shimmerOn) {
  if (weight < 0.03) return;
  const x0 = Math.floor(lo.x / step), x1 = Math.ceil(hi.x / step);
  const y0 = Math.floor(lo.y / step), y1 = Math.ceil(hi.y / step);
  for (let gy = y0; gy <= y1; gy++) {
    for (let gx = x0; gx <= x1; gx++) {
      const rnd = hash(gx, gy, 11);
      const x = (gx + 0.2 + hash(gx, gy, 12) * 0.6) * step;
      const y = (gy + 0.2 + hash(gx, gy, 13) * 0.6) * step;
      const v = terrain(x, y);
      const p = project(x, y);
      if (p.x < -10 || p.x > W + 10 || p.y < -10 || p.y > H + 10) continue;
      const band = Math.pow(Math.max(0, Math.cos(v * 19)), 8);
      const land = v > -0.12;
      let a = (land ? 0.29 + band * 0.48 : 0.13 + band * 0.12) * weight;
      const shimmer = !shimmerOn || motionReduced ? 1 : 0.95 + 0.05 * Math.sin(now * 0.0005 + rnd * 8);
      a *= shimmer;
      dot(p, (land ? 0.85 : 0.55) + (rnd > 0.975 ? 0.55 : 0), land ? palette.land : palette.water, a);
      state.terrainCount++;
    }
  }
}

// drawGraticule 用极淡的曲线揭示地表弧度；不是有尽头的网格底板。
function drawGraticule(step) {
  const lo = unprojectCalc(view(), -120, -120);
  const hi = unprojectCalc(view(), W + 120, H + 120);
  for (let axis = 0; axis < 2; axis++) {
    const start = Math.floor((axis ? lo.y : lo.x) / step);
    const end = Math.ceil((axis ? hi.y : hi.x) / step);
    for (let n = start; n <= end && n < start + 35; n++) {
      ctx.beginPath();
      for (let k = 0; k <= 40; k++) {
        const x = axis ? lo.x + (hi.x - lo.x) * k / 40 : n * step;
        const y = axis ? n * step : lo.y + (hi.y - lo.y) * k / 40;
        const p = project(x, y);
        if (k === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = palette.contour;
      ctx.globalAlpha = 0.08;
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

// visibleHouses 保留当前视野内的确定性房屋；极远尺度改为聚落概览，避免无限枚举。
function visibleHouses() {
  const lo = unprojectCalc(view(), -100, -100);
  const hi = unprojectCalc(view(), W + 100, H + 100);
  const out = [];
  if (camera.zoom < 0.12) return out;
  const x0 = Math.floor(lo.x / 560) - 1, x1 = Math.ceil(hi.x / 560) + 1;
  const y0 = Math.floor(lo.y / 560) - 1, y1 = Math.ceil(hi.y / 560) + 1;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const h = houseAt(x, y);
      if (h) {
        const p = project(h.x, h.y);
        if (p.x > -130 && p.x < W + 130 && p.y > -130 && p.y < H + 130) out.push(h);
      }
    }
  }
  if (state.selected && !out.some((h) => h.id === state.selected.id)) out.push(state.selected);
  return out.sort((a, b) => a.y - b.y);
}

// drawDistricts 在远景显示可继续靠近的聚落点；层级坐标确定。
function drawDistricts() {
  const step = 560 * 2 ** Math.max(1, Math.ceil(Math.log2(0.15 / camera.zoom)));
  const lo = unprojectCalc(view(), -30, -30);
  const hi = unprojectCalc(view(), W + 30, H + 30);
  for (let y = Math.floor(lo.y / step); y <= Math.ceil(hi.y / step); y++) {
    for (let x = Math.floor(lo.x / step); x <= Math.ceil(hi.x / step); x++) {
      if (hash(x, y, 72) < 0.56) continue;
      const wx = (x + 0.5) * step, wy = (y + 0.5) * step;
      const p = project(wx, wy);
      dot(p, 1.8, palette.accent, 0.65);
      for (let n = 0; n < 5; n++) {
        dot({ x: p.x + (hash(x, y, n + 74) - 0.5) * 17, y: p.y + (hash(x, y, n + 85) - 0.5) * 12 }, 0.75, palette.line, 0.45);
      }
    }
  }
}

// drawHouse 从远处粒子节点逐渐显示墙线与室内；屋顶仅随当前降落目标淡出。
// LOD 门控：房屋在屏幕上太小时，直接跳过细节循环（不是只调透明度）——
// 远景帧预算实测证明"画了但看不见"是最大浪费。
function drawHouse(h, now) {
  const center = project(h.x, h.y);
  const s = center.scale;
  const active = state.selected?.id === h.id;
  const fade = active
    ? clamp((Math.log(camera.zoom) - Math.log(1.25)) / (Math.log(landingZoom()) - Math.log(1.25)), 0, 1)
    : 0;
  const a = clamp((s - 0.14) / 0.26, 0, 1);
  if (s < 0.34) {
    dot(center, active ? 3 : 2, palette.accent, 0.8);
    state.hits.push({ h, x: center.x, y: center.y, r: 16 });
    return;
  }

  const floor = [hp(h, -48, -37), hp(h, 48, -37), hp(h, 48, 37), hp(h, -48, 37)];
  polygon(floor, palette.line, palette.fill, 0.65 * a, 0.7);

  const corners = [[-48, -37], [48, -37], [48, 37], [-48, 37]];
  for (let i = 0; i < 4; i++) {
    const c = corners[i], next = corners[(i + 1) % 4];
    segment(hp(h, c[0], c[1]), hp(h, c[0], c[1], 22), palette.line, 0.45 * a);
    dottedEdge(h, [c[0], c[1], 22], [next[0], next[1], 22], palette.line, 0.65 * a);
  }
  if (fade > 0.02) drawInterior(h, fade * a);

  // 屋顶：近处才画点阵细节（LOD 门控，省远景工作量）
  const roofA = [hp(h, -52, -41, 23), hp(h, 52, -41, 23), hp(h, 52, 0, 41), hp(h, -52, 0, 41)];
  const roofB = [hp(h, -52, 0, 41), hp(h, 52, 0, 41), hp(h, 52, 41, 23), hp(h, -52, 41, 23)];
  polygon(roofA, palette.roof, palette.fill, (1 - fade) * a * 0.95, 0.7);
  polygon(roofB, palette.roof, palette.fill, (1 - fade) * a * 0.92, 0.7);
  if (s > 0.8) {
    for (let x = -48; x <= 48; x += 7) {
      for (let y = -35; y <= 35; y += 7) {
        const z = 41 - Math.abs(y) / 41 * 18;
        dot(hp(h, x, y, z), 0.65, palette.roof, (1 - fade) * a * 0.72);
      }
    }
    for (let i = 0; i < 10; i++) {
      const p = hp(h, 0, 42 + i * 6);
      dot(p, 0.8, palette.land, 0.32 * a);
    }
  }
  dottedEdge(h, [-52, 0, 41], [52, 0, 41], palette.accent, (1 - fade) * a * 0.7);

  if (active) {
    ctx.setLineDash([2, 5]);
    polygon([hp(h, -57, -45), hp(h, 57, -45), hp(h, 57, 45), hp(h, -57, 45)], palette.accent, null, 0.6, 0.7);
    ctx.setLineDash([]);
  }
  state.hits.push({ h, x: center.x, y: center.y - 10 * s, r: Math.max(16, 62 * s) });
}

// drawInterior 显示简洁书架、桌面及示例文章；所有物件共享房屋坐标。
function drawInterior(h, alpha) {
  polygon([hp(h, -40, -28, 4), hp(h, 40, -28, 4), hp(h, 40, -21, 4), hp(h, -40, -21, 4)], palette.line, null, alpha * 0.75, 0.8);
  for (let i = 0; i < 10; i++) {
    const x = -34 + i * 7;
    dottedEdge(h, [x, -26, 5], [x, -26, 15], palette.paper, alpha * 0.8, 2.5);
  }
  polygon([hp(h, -30, -2, 9), hp(h, 29, -2, 9), hp(h, 29, 25, 9), hp(h, -30, 25, 9)], palette.line, palette.fill, alpha, 0.8);
  for (const [i, x] of [[0, -22], [1, -3], [2, 16]]) {
    const points = [hp(h, x, 4, 10), hp(h, x + 10, 4, 10), hp(h, x + 10, 18, 10), hp(h, x, 18, 10)];
    polygon(points, palette.paper, null, alpha, 0.9);
    const p = hp(h, x + 5, 11, 10);
    dot(p, 1, palette.accent, alpha);
    state.bookHits.push({ index: i, x: p.x, y: p.y, r: Math.max(15, 8 * camera.zoom) });
  }
}

// render 是唯一 rAF 入口，隐藏页面时暂停；帧间 dt 有上限，避免切页后大幅跳动。
function render(now) {
  state.raf = 0;
  if (!state.visible) return;
  const start = performance.now();
  const dt = Math.min(40, now - (state.lastTime || now));
  state.lastTime = now;
  advance(now, dt);
  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, W, H);
  drawTerrainCached(now);
  state.hits = [];
  state.bookHits = [];
  if (camera.zoom < 0.12) drawDistricts();
  state.houses = visibleHouses();
  for (const h of state.houses) drawHouse(h, now);
  // 实时层（真实访客/脉冲/雷达）由 app.js 注入
  if (overlay) overlay(ctx, now, { project, W, H });
  onCameraMove && onCameraMove(getCamera());
  // 帧耗时 EWMA：供状态抽屉与验收读数
  const cost = performance.now() - start;
  state.frameMs = state.frameMs ? state.frameMs * 0.9 + cost * 0.1 : cost;
  state.raf = requestAnimationFrame(render);
}

// advance 更新可中断的镜头飞行与惯性；飞行使用对数尺度保证连续的下降感。
function advance(now, dt) {
  if (state.flight) {
    const f = state.flight;
    const k = clamp((now - f.at) / f.ms, 0, 1);
    const e = k * k * (3 - 2 * k);
    camera.x = f.from.x + (f.to.x - f.from.x) * e;
    camera.y = f.from.y + (f.to.y - f.from.y) * e;
    camera.zoom = Math.exp(Math.log(f.from.zoom) + (Math.log(f.to.zoom) - Math.log(f.from.zoom)) * e);
    if (k === 1) {
      state.flight = null;
      if (f.onDone) f.onDone();
    }
    return;
  }
  if (!state.gesture && !motionReduced) {
    camera.x += state.velocity.x * dt;
    camera.y += state.velocity.y * dt;
    const decay = Math.exp(-dt / 150);
    state.velocity.x *= decay;
    state.velocity.y *= decay;
  }
}

// stopFlight 在用户开始新操作时接管当前镜头，不回到旧动画起点。
function stopFlight() {
  state.flight = null;
  state.velocity = { x: 0, y: 0 };
}

// resize 让 Canvas 使用 CSS 尺寸并限制 DPR；曲面边界保持在视口之外。
function resize() {
  W = innerWidth;
  H = canvas.parentElement.clientHeight; // stage 高度（顶栏之下）
  R = Math.hypot(W, H) * 0.78;
  const d = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(W * d);
  canvas.height = Math.round(H * d);
  ctx.setTransform(d, 0, 0, d, 0, 0);
}

// ---------- 输入手势 ----------

// panAnchor 以按下时抓住的世界点为锚，直接跟随鼠标，含球面投影的逆变换。
function panAnchor(point, screen) {
  const now = unprojectCalc(view(), screen.x, screen.y);
  camera.x += point.x - now.x;
  camera.y += point.y - now.y;
}

// startGesture 为单指平移或双指缩放建立当前锚点；每次指针数量变化都重建。
function startGesture() {
  const p = [...state.pointers.values()];
  if (p.length === 1) {
    state.gesture = { anchor: unprojectCalc(view(), p[0].x, p[0].y), start: { ...p[0] }, moved: false, last: performance.now() };
  } else if (p.length >= 2) {
    const mid = { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
    state.gesture = { pinch: true, anchor: unprojectCalc(view(), mid.x, mid.y), distance: Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y), zoom: camera.zoom, moved: true };
  } else {
    state.gesture = null;
  }
}

// pick 先命中已打开房屋的书，再命中房屋；空地点击由 app.js 决定是否发脉冲。
function pick(x, y) {
  if (state.inside) {
    for (const b of state.bookHits) {
      if (Math.hypot(x - b.x, y - b.y) < b.r) {
        onBookPick && onBookPick(b.index);
        return;
      }
    }
  }
  const hits = [...state.hits].reverse();
  for (const h of hits) {
    if (Math.hypot(x - h.x, y - h.y) < h.r) {
      selectHouse(h.h);
      return;
    }
  }
  // 空地点击：世界坐标脉冲（打招呼）
  if (onGroundPulse) {
    const w = unprojectCalc(view(), x, y);
    onGroundPulse(w.x, w.y);
  }
}

// bindGestures 挂接指针/滚轮输入；capture 让指针离开画布后仍能可靠结束手势。
function bindGestures() {
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    stopFlight();
    canvas.setPointerCapture(e.pointerId);
    state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    startGesture();
    canvas.classList.add("drag");
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!state.pointers.has(e.pointerId)) return;
    state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = [...state.pointers.values()], g = state.gesture;
    if (!g) return;
    if (p.length >= 2) {
      const mid = { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
      camera.zoom = clamp(g.zoom * Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y) / Math.max(1, g.distance), TUNE.zoomMin, TUNE.zoomMax);
      panAnchor(g.anchor, mid);
    } else {
      const now = performance.now(), oldX = camera.x, oldY = camera.y;
      panAnchor(g.anchor, p[0]);
      const dt = Math.max(8, now - g.last);
      state.velocity = { x: (camera.x - oldX) / dt, y: (camera.y - oldY) / dt };
      g.last = now;
      g.moved ||= Math.hypot(p[0].x - g.start.x, p[0].y - g.start.y) > 5;
    }
  });
  // endPointer 区分点击与拖拽；取消手势不选中房屋，旧速度不会污染下一次拖动。
  const endPointer = (e, cancelled = false) => {
    const g = state.gesture;
    const click = !cancelled && g && !g.pinch && !g.moved;
    state.pointers.delete(e.pointerId);
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    if (click) pick(e.clientX, e.clientY);
    if (cancelled || click || g?.pinch) state.velocity = { x: 0, y: 0 };
    if (state.pointers.size) {
      startGesture();
      state.gesture.moved = true;
    } else {
      state.gesture = null;
      canvas.classList.remove("drag");
    }
  };
  canvas.addEventListener("pointerup", (e) => endPointer(e));
  canvas.addEventListener("pointercancel", (e) => endPointer(e, true));
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const d = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? H : 1);
    zoomAt(Math.exp(-clamp(d, -160, 160) * 0.002), e.clientX, e.clientY);
  }, { passive: false });
  window.addEventListener("blur", () => {
    state.pointers.clear();
    state.gesture = null;
    state.velocity = { x: 0, y: 0 };
    canvas.classList.remove("drag");
  });
}
