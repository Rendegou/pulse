// world.js — 潮汐群岛世界引擎：相机、投影、粒子海面、岛屿、纸页、DOM 标签、输入手势。
//
// 三层画布各司其职，共用同一套世界坐标与投影（pure.js 的 projectCalc）：
// - sea：海面粒子，优先 WebGL 点集（一次绘制调用约 39 万点），WebGL 不可用时退回 Canvas 2D。
// - land：岛屿地形与纸页，只在镜头/主题/语言变化时重绘（静止时零重绘）。
// - air：贴岸浪沫、漂尘与实时层（真实访客指针、点击脉冲），每帧绘制。
//
// 数据边界：岛的参数来自 islands.js（与后端一致），文章文本由 app.js 注入；
// 本模块不碰网络，真实访客与脉冲由 app.js 通过 setOverlay 注入。

import { projectCalc, unprojectCalc, clamp, smoothstep, tidalTilt, pointInQuad } from "./pure.js";
import { ISLANDS, buildIslandGeometry, islandPoint, articleOnIsland } from "./islands.js";

// ---------- 可调审美参数 ----------

const TUNE = {
  dMin: 270,             // 最近镜头距离（世界单位）
  dMax: 2500,            // 最远镜头距离
  dNear: 455,            // 靠近岛屿时的落位距离
  dNearMobile: 390,      // 窄屏落位距离（更近，避免岛缩成小点）
  dOverview: 1150,       // 远景距离
  dOverviewMobile: 850,
  followMs: 150,         // 飞行/靠近的跟随时间常数（毫秒）：约 0.5 秒收敛
  directMs: 45,          // 直接操控的跟随时间常数：拖动要跟手
  nearThreshold: 680,    // 进入“靠近”状态的距离阈值
  labelFade: [690, 540], // 纸页标签淡入的距离区间
  waterInterval: 31,     // 海面重绘间隔（约 32fps；静止时完全跳过）
  waterGrid: 300,        // 海面点阵纵向半径（点数 = (2nx+1)×(2ny+1)）
};

// ---------- 模块状态 ----------

// camera 是镜头当前位置；target 是阻尼跟随目标（拖动/缩放/飞行都只改 target）。
const camera = { x: 0, y: -60, d: TUNE.dOverview };
const target = { x: 0, y: -60, d: TUNE.dOverview };

// state 是世界引擎运行状态。
const state = {
  selected: 0,       // 选中的岛索引（附近列表与标签共用）
  near: false,       // 是否处于“靠近”状态（镜头距离阈值）
  hover: -1,         // 悬停的纸页索引（-1 表示无）
  raf: 0,
  time: 0,           // 海浪相位（秒）；reduced-motion 时停止推进
  dirty: true,       // 陆地层与标签需要重绘
  moving: false,     // 镜头是否仍在跟随目标
  lastTime: 0,
  lastSea: 0,
  frameMs: 0,        // 最近一帧渲染耗时（EWMA 平滑）
  scenePaints: 0,    // 陆地层重绘次数（验收用）
  seaPoints: 0,      // 最近一帧海面点数
  hits: [],          // 本帧纸页命中四边形 [{index, points}]
  islands: [],       // 岛数据（启动时构建几何）
  labels: [],        // 岛标签 DOM
  articleLabels: [], // 纸页标签 DOM
};

let seaCanvas, landCanvas, airCanvas, sc, lc, ac, gl;
let W = 0, H = 0, F = 1, dpr = 1;
let waterProgram = null, waterUniforms = null, waterCount = 0, waterBuffer = null;
let palette = null;              // 由 app.js 注入的主题调色板
let publicationText = { lang: "zh-CN", titles: [], summaries: [], readLabel: "" };
let overlay = null;              // app.js 的实时层回调 (ctx, now, helpers)
let labelHost = null;            // 标签容器 DOM
let handlers = {};               // app.js 注入的回调
let motionReduced = false;
let gesture = new Map();
let zoomAnchor = null;
let dragMoved = false, down = null;

// ---------- 对外装配 ----------

// initWorld 绑定三块画布、构建岛屿几何并启动渲染循环。
// 参数：{ sea, land, air, labelHost } 是 DOM 节点；callbacks 由 app.js 提供：
// { onIslandSelect(index), onBookPick(articleIndex), onGroundPulse(wx, wy),
//   onCameraMove(camera), onNearChange(near), isReading(), overlayActive(),
//   isModalOpen(), getReservedRect() }
export function initWorld(nodes, callbacks = {}) {
  seaCanvas = nodes.sea;
  landCanvas = nodes.land;
  airCanvas = nodes.air;
  labelHost = nodes.labelHost;
  handlers = callbacks;
  gl = seaCanvas.getContext("webgl", { alpha: false, antialias: false, powerPreference: "low-power" });
  sc = gl || seaCanvas.getContext("2d");
  lc = landCanvas.getContext("2d");
  ac = airCanvas.getContext("2d");
  motionReduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", (e) => {
    motionReduced = e.matches;
    state.dirty = true;
    wake();
  });

  // 岛屿几何只在启动时构建一次；之后镜头变化只重新投影缓存的世界坐标。
  state.islands = ISLANDS.map((isl) => buildIslandGeometry({ ...isl }));
  buildLabels();

  if (innerWidth < 580) camera.d = target.d = TUNE.dOverviewMobile;
  resize();
  window.addEventListener("resize", resize);
  bindGestures();
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      cancelAnimationFrame(state.raf);
      state.raf = 0;
    } else {
      state.lastTime = 0;
      state.dirty = true;
      wake();
    }
  });
  wake();
}

// setPalette 注入主题调色板（切换主题时由 app.js 再调一次）。
// p 需要包含 bg/sea/foam/shore/land/contour/solid/paper/ink/gold/shadow；
// sea/foam/shore/land/contour 是 [r,g,b] 数组，其余是 CSS 颜色串。
export function setPalette(p) {
  palette = p;
  state.dirty = true;
  state.lastSea = 0;
  wake();
}

// setPublicationText 注入当前语言的示例文章标题/摘要/阅读标签。
// 语言变化让陆地层与标签失效，但不改变文章身份与岛的位置。
export function setPublicationText(content) {
  publicationText = { ...content, titles: [...content.titles], summaries: [...content.summaries] };
  updateArticleLabels();
  state.dirty = true;
  wake();
}

// setOverlay 注册每帧的实时层绘制（真实访客指针、点击脉冲）。
// fn(ctx, now, helpers)：helpers 提供 project（世界→屏幕，可能返回 null）与 W/H。
export function setOverlay(fn) {
  overlay = fn;
  wake();
}

// getStats 返回性能与诊断统计（状态抽屉与浏览器验收使用）。
export function getStats() {
  return {
    frameMs: state.frameMs,
    scenePaints: state.scenePaints,
    seaPoints: state.seaPoints,
    waterRenderer: gl ? "webgl" : "canvas2d",
    islands: state.islands.length,
    d: camera.d,
    near: state.near,
  };
}

// getCamera 返回镜头快照（只读拷贝）。zoom 是相对远景的放大倍数，仅用于读数显示。
export function getCamera() {
  return { x: camera.x, y: camera.y, d: camera.d, zoom: TUNE.dOverview / camera.d };
}

// screenToWorld 把屏幕点反解为海平面世界坐标（光标上报与拖动锚定共用）。
export function screenToWorld(x, y) {
  return unprojectCalc(view(), x, y);
}

// getSelected 返回当前选中的岛索引。
export function getSelected() {
  return state.selected;
}

// getNearState 返回是否处于靠近状态（app.js 用它决定提示文案与标签形态）。
export function getNearState() {
  return state.near;
}

// wake 请求下一帧；只保持一个动画请求，页面隐藏时不启动后台帧。
export function wake() {
  if (!state.raf && !document.hidden) state.raf = requestAnimationFrame(frame);
}

// ---------- 相机动作 ----------

// selectIsland 选中一座岛（不移动镜头）；越界索引被忽略。
// 选中立即刷新标签与附近列表，随后由调用方决定是否 approach。
export function selectIsland(index) {
  if (!Number.isInteger(index) || index < 0 || index >= state.islands.length) return;
  state.selected = index;
  state.dirty = true;
  handlers.onIslandSelect && handlers.onIslandSelect(index);
  wake();
}

// approach 连续靠近选中的岛：镜头对准岛心并推进到落位距离。
// 不切换场景、不重建几何；中途拖动或滚轮会立刻接管。
export function approach(index = state.selected) {
  if (!Number.isInteger(index) || index < 0 || index >= state.islands.length) return;
  const isl = state.islands[index];
  state.selected = index;
  target.x = isl.x;
  target.y = isl.y + 10;
  target.d = innerWidth < 580 ? TUNE.dNearMobile : TUNE.dNear;
  zoomAnchor = null;
  state.dirty = true;
  wake();
}

// returnAbove 从近景退回远景；同样只改目标，可被任何输入打断。
export function returnAbove() {
  const isl = state.islands[state.selected];
  target.x = isl.x;
  target.y = isl.y - 60;
  target.d = innerWidth < 580 ? TUNE.dOverviewMobile : TUNE.dOverview;
  zoomAnchor = null;
  wake();
}

// flyTo 把镜头送到指定世界坐标与距离（地址旅行、归处按钮使用）。
// to = {x, y, d}；再次调用替换旧目标，没有排队。
export function flyTo(to) {
  target.x = to.x;
  target.y = to.y;
  if (Number.isFinite(to.d)) target.d = clamp(to.d, TUNE.dMin, TUNE.dMax);
  zoomAnchor = null;
  wake();
}

// zoomAt 保持指针下的海面点不动进行缩放；factor > 1 表示拉远。
// 返回 false 表示已经到边界（镜头距离没有变化）。
export function zoomAt(factor, x = W * 0.57, y = H * 0.55) {
  const before = target.d;
  target.d = clamp(target.d * factor, TUNE.dMin, TUNE.dMax);
  if (target.d === before && camera.d === before) return false;
  zoomAnchor = { x, y, world: unprojectCalc(view(), x, y) };
  wake();
  return true;
}

// stopCamera 在直接操控开始时接管当前画面，不跳到尚未完成的目标。
function stopCamera() {
  target.x = camera.x;
  target.y = camera.y;
  target.d = camera.d;
  zoomAnchor = null;
}

// ---------- 视图 ----------

// view 把当前镜头与画布尺寸打包给纯函数投影。
function view() {
  return { cx: camera.x, cy: camera.y, d: camera.d, W, H, F };
}

// project 用当前镜头投影世界坐标；返回 null 表示越过近裁剪，调用方必须跳过。
function project(x, y, z = 0) {
  return projectCalc(view(), x, y, z);
}

// projectIslandPoint 投影岛内局部坐标（含离地高度 z）。
function projectIslandPoint(isl, x, y, z = 0) {
  const p = islandPoint(isl, x, y, z);
  return project(p.x, p.y, p.z);
}

// rgba 生成带透明度的颜色串（调色板里的海/沫/岸是 [r,g,b] 数组）。
function rgba(rgb, a) {
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${clamp(a, 0, 1)})`;
}

// ---------- 渲染循环 ----------

// frame 是唯一的 rAF 入口：推进镜头、按需重绘三层、定位 DOM 标签。
// 静止且没有实时层活动时不再请求下一帧，把 CPU 让出去。
function frame(now) {
  state.raf = 0;
  if (document.hidden) return;
  const dt = Math.min(48, now - (state.lastTime || now));
  state.lastTime = now;
  const start = performance.now();

  advance(dt);

  const reading = isReading();
  if (!motionReduced && !reading) state.time += dt * 0.001;

  const seaDue = state.dirty || !state.lastSea ||
    (!motionReduced && !reading && now - state.lastSea > TUNE.waterInterval);
  if (seaDue) {
    drawSea(state.time);
    state.lastSea = now;
  }
  if (state.dirty) {
    drawLand();
    updateNearState();
    positionLabels();
    state.dirty = false;
  }
  drawAir(state.time);
  if (overlay) overlay(ac, now, { project, W, H });

  const cost = performance.now() - start;
  state.frameMs = state.frameMs ? state.frameMs * 0.9 + cost * 0.1 : cost;

  // 镜头在动、实时层有活动、或海浪还在流动时继续请求下一帧
  if (state.moving || overlayActive() || (!motionReduced && !reading)) wake();
}

// advance 用阻尼把 camera 拉向 target；拖动/缩放/飞行共用同一套跟随。
// 到达后精确对齐，保证静止时陆地层命中缓存、不产生浮点尾巴重绘。
function advance(dt) {
  const k = motionReduced ? 1 : 1 - Math.exp(-dt / (state.moving ? TUNE.followMs : TUNE.directMs));
  const dx = target.x - camera.x, dy = target.y - camera.y, dd = target.d - camera.d;
  state.moving = Math.abs(dx) > 0.025 || Math.abs(dy) > 0.025 || Math.abs(dd) > 0.025;
  if (state.moving) {
    camera.d += dd * k;
    camera.x += dx * k;
    camera.y += dy * k;
    // 缩放锚定：镜头距离每帧都在变，锚点修正必须每帧重算（只做一次会留下可见漂移）。
    // 修正量同时吸收进 target，避免跟随逻辑把镜头再拉回去。
    if (zoomAnchor) {
      const after = unprojectCalc(view(), zoomAnchor.x, zoomAnchor.y);
      const corrX = zoomAnchor.world.x - after.x;
      const corrY = zoomAnchor.world.y - after.y;
      camera.x += corrX;
      camera.y += corrY;
      target.x += corrX;
      target.y += corrY;
    }
    state.dirty = true;
  } else {
    camera.x = target.x;
    camera.y = target.y;
    camera.d = target.d;
    zoomAnchor = null;
  }
  handlers.onCameraMove && handlers.onCameraMove(getCamera());
}

// isReading 报告是否正在阅读或查看帮助：此时暂停海浪推进并停止动画请求。
function isReading() {
  return handlers.isReading ? handlers.isReading() : false;
}

// overlayActive 报告实时层是否有活动（脉冲存活或有人移动）；由 app.js 决定。
function overlayActive() {
  return handlers.overlayActive ? handlers.overlayActive() : false;
}

// ---------- 海面 ----------

// drawSea 绘制海面：WebGL 点集优先，不可用时退回 Canvas 2D 点阵。
function drawSea(t) {
  if (!palette) return;
  if (gl) drawWaterGPU(t);
  else drawWaterCPU(t);
}

// shader 编译本文件内的着色器；失败立即抛出，不用无效程序继续绘制。
function shader(type, source) {
  const s = gl.createShader(type);
  gl.shaderSource(s, source);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

// initWater 建立海面点集的 GPU 资源：一次 bufferData 上传嵌套网格，之后只改 uniform。
// 顶点着色器与 pure.projectCalc 使用同一公式，保证海面与岛屿/访客对齐。
function initWater() {
  if (waterProgram) {
    gl.deleteProgram(waterProgram);
    gl.deleteBuffer(waterBuffer);
  }
  const vs = shader(gl.VERTEX_SHADER, `
    attribute vec2 grid;
    uniform vec2 origin;
    uniform vec3 cam;
    uniform vec2 viewport;
    uniform vec3 waterColor;
    uniform vec3 foamColor;
    uniform float stepSize, detail, time, focal, dpr, tilt;
    varying vec4 color;
    void main() {
      vec2 ij = grid + origin;
      vec2 p = ij * stepSize;
      float n = fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
      p += (n - .5) * 1.6;
      float wave = sin(p.x * .009 + p.y * .019 + sin(p.x * .002) * 2.2 - time * .55);
      float crest = pow(max(0., wave), 5.);
      float h = sin(p.x * .011 + p.y * .008 - time * .55) * 7. + sin(p.y * .019 - p.x * .004 - time * .4) * 4.;
      vec2 rel = p - cam.xy;
      h -= dot(rel, rel) / 13500.;
      float dep = cam.z - rel.y * sin(tilt) - h * cos(tilt);
      float scale = focal / max(dep, 45.);
      vec2 screen = vec2(viewport.x * .57, viewport.y * .55) + vec2(rel.x, rel.y * cos(tilt) - h * sin(tilt)) * scale;
      gl_Position = vec4(screen.x / viewport.x * 2. - 1., 1. - screen.y / viewport.y * 2., 0., 1.);
      gl_PointSize = clamp(scale * (1.2 + crest * .8), .8, 2.6) * dpr;
      float fine = step(.5, mod(abs(ij.x), 2.) + mod(abs(ij.y), 2.));
      float opacity = mix(1., detail, fine) * (.10 + crest * .55 + n * .065) * clamp(cam.z / dep, .12, 1.25);
      if (dep < 45.) opacity = 0.;
      color = vec4(mix(waterColor, foamColor, crest * .8), opacity);
    }
  `);
  const fs = shader(gl.FRAGMENT_SHADER, `
    precision mediump float;
    varying vec4 color;
    void main() {
      float r = length(gl_PointCoord - .5);
      gl_FragColor = vec4(color.rgb, color.a * (1. - smoothstep(.20, .5, r)));
    }
  `);
  waterProgram = gl.createProgram();
  gl.attachShader(waterProgram, vs);
  gl.attachShader(waterProgram, fs);
  gl.linkProgram(waterProgram);
  if (!gl.getProgramParameter(waterProgram, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(waterProgram));
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  gl.useProgram(waterProgram);
  // 嵌套网格：纵向 ±ny，横向按视口宽高比扩展；细节层靠 detail uniform 渐显，不重建缓冲。
  const coords = [];
  const ny = TUNE.waterGrid;
  const nx = Math.min(460, Math.ceil(Math.max(W / H, 1) * 205));
  for (let y = -ny; y <= ny; y++) {
    for (let x = -nx; x <= nx; x++) coords.push(x, y);
  }
  waterCount = coords.length / 2;
  waterBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, waterBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(coords), gl.STATIC_DRAW);
  const attr = gl.getAttribLocation(waterProgram, "grid");
  gl.enableVertexAttribArray(attr);
  gl.vertexAttribPointer(attr, 2, gl.FLOAT, false, 0, 0);
  waterUniforms = {};
  for (const name of ["origin", "cam", "viewport", "waterColor", "foamColor", "stepSize", "detail", "time", "focal", "dpr", "tilt"]) {
    waterUniforms[name] = gl.getUniformLocation(waterProgram, name);
  }
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
}

// drawWaterGPU 用嵌套网格的倍率切换细节：镜头穿过倍率边界时点不会整片换位置。
// 每次只更新 uniform 并提交一次 drawArrays，不在 CPU 上逐点投影。
function drawWaterGPU(t) {
  if (!waterProgram || gl.isContextLost()) return;
  const u = waterUniforms;
  const coarse = 8 * 2 ** Math.ceil(Math.log2(camera.d / 700));
  const step = coarse / 2;
  const upper = 700 * coarse / 8;
  const detail = 1 - smoothstep(upper / 2, upper, camera.d);
  const bg = hexToRgb(palette.bg);
  gl.clearColor(bg[0] / 255, bg[1] / 255, bg[2] / 255, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(waterProgram);
  gl.uniform2f(u.origin, Math.floor(camera.x / step / 16) * 16, Math.floor(camera.y / step / 16) * 16);
  gl.uniform3f(u.cam, camera.x, camera.y, camera.d);
  gl.uniform2f(u.viewport, W, H);
  gl.uniform3f(u.waterColor, palette.sea[0] / 255, palette.sea[1] / 255, palette.sea[2] / 255);
  gl.uniform3f(u.foamColor, palette.foam[0] / 255, palette.foam[1] / 255, palette.foam[2] / 255);
  gl.uniform1f(u.stepSize, step);
  gl.uniform1f(u.detail, detail);
  gl.uniform1f(u.time, t);
  gl.uniform1f(u.focal, F);
  gl.uniform1f(u.dpr, dpr);
  gl.uniform1f(u.tilt, tidalTilt(camera.d));
  gl.drawArrays(gl.POINTS, 0, waterCount);
  state.seaPoints = waterCount;
}

// drawWaterCPU 是 WebGL 不可用时的退路：三层网格交叉淡化，用 fillRect 画点。
// 细节权重与 GPU 版本同一公式，因此两条路径的疏密一致，只是没有波峰高光。
function drawWaterCPU(t) {
  sc.fillStyle = palette.bg;
  sc.fillRect(0, 0, W, H);
  const b = sc.createRadialGradient(W * 0.59, H * 0.45, 0, W * 0.56, H * 0.52, Math.max(W, H) * 0.75);
  b.addColorStop(0, rgba(palette.sea, 0.11));
  b.addColorStop(1, rgba(palette.sea, 0));
  sc.fillStyle = b;
  sc.fillRect(0, 0, W, H);
  const extent = Math.min(3900, camera.d * 2.5);
  let count = 0;
  for (let level = 0; level < 3; level++) {
    const step = 38 / 2 ** level;
    const detail = level === 0 ? 1
      : level === 1 ? 1 - smoothstep(650, 1150, camera.d)
        : 1 - smoothstep(310, 680, camera.d);
    if (detail < 0.005) continue;
    const unit = 4 / 2 ** level;
    const x0 = Math.floor((camera.x - extent) / step), x1 = Math.ceil((camera.x + extent) / step);
    const y0 = Math.floor((camera.y - extent) / step), y1 = Math.ceil((camera.y + extent) / step);
    for (let iy = y0; iy <= y1; iy++) {
      for (let ix = x0; ix <= x1; ix++) {
        if (level > 0 && ix % 2 === 0 && iy % 2 === 0) continue;
        const n = fractHash(ix * unit, iy * unit, 19);
        const x = ix * step + (n - 0.5) * 3;
        const y = iy * step + (fractHash(ix * unit, iy * unit, 7) - 0.5) * 3;
        const z = seaHeight(x, y, t);
        const p = project(x, y, z);
        if (!p || p.x < 0 || p.x > W || p.y < 0 || p.y > H) continue;
        const wave = Math.sin(x * 0.010 + y * 0.018 - t * 0.65 + Math.sin(x * 0.003) * 1.8);
        const crest = Math.pow(Math.max(0, wave), 6);
        const fog = clamp(camera.d / p.d, 0.12, 1.2);
        const a = (0.12 + crest * 0.60 + n * 0.055) * fog * detail;
        sc.fillStyle = rgba(crest > 0.45 ? palette.foam : palette.sea, a);
        const size = clamp(p.s * (1.05 + crest * 0.9), 0.7, 2.25);
        sc.fillRect(p.x, p.y, size, size);
        count++;
      }
    }
  }
  // 少量长波线把离散点组织成水面；远近共用同一波场坐标。
  for (let row = -12; row <= 12; row++) {
    const base = Math.floor(camera.y / 150) * 150 + row * 150;
    sc.beginPath();
    let open = false;
    for (let j = -65; j <= 65; j++) {
      const x = camera.x + j * extent / 65;
      const y = base + Math.sin(x * 0.004 + t * 0.22 + row) * 34;
      const p = project(x, y, seaHeight(x, y, t));
      if (!p) { open = false; continue; }
      if (!open) { sc.moveTo(p.x, p.y); open = true; } else sc.lineTo(p.x, p.y);
    }
    sc.strokeStyle = rgba(palette.sea, 0.09);
    sc.lineWidth = 0.65;
    sc.stroke();
  }
  state.seaPoints = count;
}

// seaHeight 返回海面高度：两个不同方向/波长的正弦叠加（世界单位）。
function seaHeight(x, y, t) {
  return Math.sin(x * 0.011 + y * 0.008 - t * 0.55) * 7 +
    Math.sin(y * 0.019 - x * 0.004 - t * 0.4) * 4;
}

// ---------- 陆地（岛屿 + 纸页） ----------

// drawLand 重绘陆地层：按深度从远到近画岛，并重新登记纸页命中四边形。
// 只在 state.dirty 时调用；静止时陆地层直接复用，零重绘。
function drawLand() {
  lc.clearRect(0, 0, W, H);
  state.hits.length = 0;
  const order = state.islands.map((isl, i) => ({ i, d: project(isl.x, isl.y, 28)?.d ?? 0 }));
  order.sort((a, b) => b.d - a.d);
  for (const { i } of order) drawIsland(state.islands[i], i);
  state.scenePaints++;
}

// drawIsland 绘制一座岛：底色 → 等高线 → 粒子地形 → （选中且靠近时）文章路径与纸页。
// 岛完全在屏幕外时直接跳过，不为看不见的几何付出代价。
function drawIsland(isl, index) {
  const center = project(isl.x, isl.y, 28);
  if (!center) return;
  const margin = isl.r * center.s + 100;
  if (center.x < -margin || center.x > W + margin || center.y < -margin || center.y > H + margin) return;

  const alpha = clamp(center.s * 0.9, 0.15, 1);
  lc.save();

  // 岛体底色：最外层等高线围成的多边形
  polygon(lc, isl.rings[isl.rings.length - 1], palette.solid);

  // 等高线：外侧靠岸偏亮，内侧极淡
  for (let i = 0; i < isl.rings.length; i++) {
    const a = i / isl.rings.length;
    const color = a > 0.87 ? palette.shore : palette.contour;
    drawLine(lc, isl.rings[i], rgba(color, (a > 0.87 ? 0.43 : 0.15) * alpha), a > 0.95 ? 1 : 0.6, true);
  }

  // 粒子地形：三分之一定频绘制，其余按镜头距离渐显，避免远处糊成一片
  for (let i = 0; i < isl.points.length; i++) {
    const pt = isl.points[i];
    const lod = i % 3 === 0 ? 1 : smoothstep(0.22, 0.58, center.s);
    if (lod < 0.01) continue;
    const p = project(pt.x, pt.y, pt.z);
    if (!p || p.x < -3 || p.x > W + 3 || p.y < -3 || p.y > H + 3) continue;
    const coast = pt.r > 0.87;
    const light = 0.22 + pt.n * 0.42 + (pt.z / 80) * 0.2;
    const size = clamp((coast ? 0.95 : 0.75) * p.s, 0.6, 2.2);
    lc.fillStyle = rgba(coast ? palette.shore : palette.land, light * alpha * lod * (pt.r > 1 ? 0.45 : 1));
    lc.fillRect(p.x, p.y, size, size);
  }

  // 只有选中的岛、且已经靠近，才画文章路径与纸页
  const close = 1 - smoothstep(610, 1050, camera.d);
  const article = articleOnIsland(isl);
  if (index === state.selected && article >= 0) {
    drawArticlePath(isl, close);
    drawBook(isl, article, 0.45 + 0.55 * close);
  }
  lc.restore();
}

// drawArticlePath 用一条点状路径把纸页和岸线连起来；只在近景出现，保持克制。
function drawArticlePath(isl, close) {
  const b = bookSlot();
  for (let k = 0; k < 34; k++) {
    const q = k / 33;
    const p = projectIslandPoint(isl, b.x, b.y + q * 78, 2);
    if (!p) continue;
    const size = clamp(p.s * 0.65, 0.6, 1.4);
    lc.fillStyle = rgba(palette.shore, 0.18 * close);
    lc.fillRect(p.x, p.y, size, size);
  }
}

// bookSlot 返回岛上纸页的布局（局部坐标 + 离地高度 + 尺寸）。
// 每座岛一张纸页，对应它自己的文章；位置固定，缩放不会重新排版。
function bookSlot() {
  return { x: -20, y: -35, z: 24, angle: -0.22, w: 27, h: 36 };
}

// bookWorld 返回纸页局部顶点在世界坐标中的位置（含岛屿自转与地形高度）。
function bookWorld(isl, b, x, y, z = 0) {
  const c = Math.cos(b.angle), sn = Math.sin(b.angle);
  return islandPoint(isl, b.x + x * c - y * sn, b.y + x * sn + y * c, b.z + z);
}

// drawBook 绘制纸页：接地影子 → 背面厚度 → 纸面 → 折角与排版线，并登记命中四边形。
// 命中用真实四边形，不用大圆形，避免点到旁边的地形也打开文章。
function drawBook(isl, article, alpha) {
  if (alpha < 0.01) return;
  const b = bookSlot();
  lc.save();
  lc.globalAlpha = alpha;
  const w = b.w / 2, h = b.h / 2;
  const corners = [[-w, -h], [w, -h], [w, h], [-w, h]];
  const pts = [], back = [], shadow = [];
  for (const [x, y] of corners) {
    pts.push(bookWorld(isl, b, x, y));
    back.push(bookWorld(isl, b, x + 1.6, y + 2.6, -2.4));
    const sp = bookWorld(isl, b, x + 8, y + 12);
    const ground = islandPoint(isl, b.x + 8, b.y + 12);
    shadow.push({ x: sp.x, y: sp.y, z: ground.z + 1 });
  }
  lc.globalAlpha = alpha * 0.34;
  polygon(lc, shadow, palette.shadow);
  lc.globalAlpha = alpha;
  polygon(lc, back, rgba(palette.land, 0.55), rgba(palette.foam, 0.26));
  const quad = polygon(lc, pts, palette.paper, rgba(palette.foam, 0.8));
  if (quad) state.hits.push({ index: article, points: quad });

  // 折角
  polygon(lc, [
    bookWorld(isl, b, w - 7, -h),
    bookWorld(isl, b, w, -h + 7),
    bookWorld(isl, b, w - 7, -h + 7),
  ], rgba(palette.land, 0.42));

  // 近景足够大时写真实文本，否则用排版线示意
  const scale = project(isl.x, isl.y, 28)?.s ?? 0;
  if (scale > 1.2) {
    drawPageText(b, pts, alpha, article);
  } else {
    drawLine(lc, [bookWorld(isl, b, -w + 5, -h + 8, 0.1), bookWorld(isl, b, -w + 13, -h + 8, 0.1)], palette.gold, 1.5);
    for (let j = 0; j < 5; j++) {
      const len = j === 4 ? 9 : 16;
      drawLine(lc, [
        bookWorld(isl, b, -w + 5, -h + 14 + j * 3, 0.1),
        bookWorld(isl, b, -w + 5 + len, -h + 14 + j * 3, 0.1),
      ], palette.ink, 0.65);
    }
  }
  lc.restore();
}

// drawPageText 在纸页平面上写标题与摘要：用四边形两条边构成仿射变换，再裁剪到纸面。
// article 是文章索引（不是岛索引），保证纸页上的文字与点击打开的是同一篇；
// 字号按世界单位缩放，因此靠近时自然变大。
function drawPageText(b, pts, alpha, article) {
  const title = publicationText.titles[article] || "";
  if (!title) return;
  const a = pts[0], right = pts[1], down = pts[3];
  lc.save();
  lc.transform((right.x - a.x) / b.w, (right.y - a.y) / b.w, (down.x - a.x) / b.h, (down.y - a.y) / b.h, a.x, a.y);
  lc.beginPath();
  lc.rect(0, 0, b.w, b.h);
  lc.clip();
  lc.globalAlpha = alpha;
  lc.fillStyle = palette.ink;
  lc.font = '500 3.4px Georgia,"Songti SC",SimSun,serif';
  const bottom = wrapText(title, 4.5, 13, b.w - 9, 4.4, 3);
  lc.fillStyle = rgba(palette.ink, 0.62);
  lc.font = '2px "Segoe UI","Microsoft YaHei",sans-serif';
  wrapText(publicationText.summaries[article] || "", 4.5, bottom + 5, b.w - 9, 3.1, 3);
  lc.fillStyle = palette.gold;
  lc.font = '2px "Segoe UI","Microsoft YaHei",sans-serif';
  lc.fillText(publicationText.readLabel, 4.5, b.h - 4);
  lc.restore();
}

// wrapText 按当前字体测量换行，最多 maxLines 行；返回最后一行基线供纵向排版。
// 中文逐字、英文按词切分；最后一行截断带省略号，不让文字溢出纸面。
function wrapText(text, x, y, width, lineHeight, maxLines) {
  const words = publicationText.lang === "en" ? text.split(/(\s+)/) : Array.from(text);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (line && lc.measureText(line + word).width > width) { lines.push(line); line = word.trimStart(); }
    else line += word;
  }
  if (line) lines.push(line);
  for (let i = 0; i < Math.min(lines.length, maxLines); i++) {
    let value = lines[i];
    if (i === maxLines - 1 && lines.length > maxLines) {
      while (value && lc.measureText(value + "…").width > width) value = value.slice(0, -1);
      value += "…";
    }
    lc.fillText(value, x, y + i * lineHeight);
  }
  return y + (Math.min(lines.length, maxLines) - 1) * lineHeight;
}

// drawLine 按世界坐标绘制折线；遇到近裁剪点就断开，不画跨屏尖刺。
function drawLine(ctx, points, color, width = 1, closed = false) {
  ctx.beginPath();
  let open = false;
  for (const p of points) {
    const q = project(p.x, p.y, p.z);
    if (!q) { open = false; continue; }
    if (!open) { ctx.moveTo(q.x, q.y); open = true; } else ctx.lineTo(q.x, q.y);
  }
  if (closed) ctx.closePath();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

// polygon 按世界坐标绘制多边形（所有顶点可见时才画），返回屏幕顶点供命中使用。
function polygon(ctx, points, fill, stroke, width = 0.7) {
  const q = [];
  for (const p of points) {
    const v = project(p.x, p.y, p.z);
    if (!v) return null;
    q.push(v);
  }
  ctx.beginPath();
  q.forEach((p, i) => { if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }
  return q;
}

// ---------- 空气层（浪沫 / 漂尘 / 悬停提示） ----------

// drawAir 每帧重绘：贴岸进退浪沫、岛上漂尘与悬停提示。
// 全部使用与陆地相同的投影，因此浪沫贴着岸线、漂尘随高度自然放大。
// app.js 的实时层在这之后叠加到同一块画布上。
function drawAir(t) {
  ac.clearRect(0, 0, W, H);
  if (!palette) return;
  for (const isl of state.islands) {
    const c = project(isl.x, isl.y, 0);
    if (!c) continue;
    const margin = isl.r * c.s + 120;
    if (c.x < -margin || c.x > W + margin || c.y < -margin || c.y > H + margin) continue;
    const visible = clamp(c.s, 0.1, 1);
    // 三层浪沫沿半径推进，形成“潮汐”节律
    for (let ring = 0; ring < 3; ring++) {
      const phase = (t * 0.055 + ring / 3) % 1;
      const r = 1.02 + (1 - phase) * 0.37;
      const a = Math.sin(phase * Math.PI) * 0.30 * visible;
      for (let j = 0; j < 210; j++) {
        const ang = (j / 210) * Math.PI * 2;
        const n = fractHash(j, ring, isl.seed);
        const radius = isl.r * boundaryAt(isl, ang) * r;
        const wx = isl.x + Math.cos(ang) * radius;
        const wy = isl.y + Math.sin(ang) * radius * isl.sy;
        const p = project(wx, wy, seaHeight(wx, wy, t));
        if (!p || p.x < -3 || p.x > W + 3 || p.y < -3 || p.y > H + 3) continue;
        ac.fillStyle = rgba(palette.foam, a * (0.45 + n * 0.55));
        const size = clamp(p.s * (0.5 + n * 0.5), 0.5, 2);
        ac.fillRect(p.x, p.y, size, size);
      }
    }
    // 漂尘：贴在岛上空，高度不同→靠近时大小与速度自然不同
    for (let j = 0; j < 32; j++) {
      const n = fractHash(j, 7, isl.seed);
      const ang = n * Math.PI * 2;
      const r = isl.r * (0.6 + fractHash(j, 2, isl.seed) * 0.65);
      const x = Math.cos(ang) * r, y = Math.sin(ang) * r * isl.sy;
      const z = 55 + fractHash(j, 6, isl.seed) * 95 + Math.sin(t * 0.4 + j) * 4;
      const p = projectIslandPoint(isl, x, y, z);
      if (!p || p.x < 0 || p.x > W || p.y < 0 || p.y > H) continue;
      ac.fillStyle = rgba(palette.shore, (0.08 + 0.12 * n) * visible);
      ac.beginPath();
      ac.arc(p.x, p.y, clamp(p.s * (0.5 + n * 0.7), 0.5, 2.3), 0, Math.PI * 2);
      ac.fill();
    }
  }
  // 悬停纸页时在纸面上画一圈提示环
  if (state.hover >= 0) {
    const isl = state.islands[state.selected];
    const b = bookSlot();
    const p = projectIslandPoint(isl, b.x, b.y, b.z);
    if (p) {
      ac.strokeStyle = rgba(palette.shore, 0.5);
      ac.lineWidth = 0.7;
      ac.beginPath();
      ac.ellipse(p.x, p.y + 10 * p.s, 24 * p.s, 15 * p.s, 0, 0, Math.PI * 2);
      ac.stroke();
    }
  }
}

// boundaryAt 取岛岸线在角度 a 处的半径倍率（与 pure.islandBoundary 同一公式）。
function boundaryAt(isl, a) {
  return 1 + 0.11 * Math.sin(3 * a + isl.seed) + 0.065 * Math.cos(5 * a - isl.seed * 0.3) + 0.04 * Math.sin(2 * a + isl.seed);
}

// ---------- DOM 标签 ----------

// buildLabels 为每座岛和每张纸页创建可点击、可键盘访问的标签。
// 标签位置每帧跟随投影；岛标签只在远景显示，纸页标签只在近景显示。
function buildLabels() {
  if (!labelHost) return;
  state.labels = [];
  state.articleLabels = [];
  state.islands.forEach((isl, i) => {
    const b = document.createElement("button");
    b.className = "island-label";
    b.innerHTML = '<span class="name"></span><span class="sub"></span>';
    // 点标签 = 选中并靠近这座岛；与附近列表是等价入口。
    b.addEventListener("click", () => { selectIsland(i); approach(i); });
    labelHost.appendChild(b);
    state.labels.push(b);

    const article = articleOnIsland(isl);
    if (article < 0) return;
    const a = document.createElement("button");
    a.className = "article-label";
    a.innerHTML = '<span class="meta"></span><span class="name"></span><span class="more"></span>';
    // 点纸页标签 = 打开这篇文章（等价于点画布上的纸页）。
    a.addEventListener("click", () => handlers.onBookPick && handlers.onBookPick(article));
    labelHost.appendChild(a);
    state.articleLabels.push(a);
  });
}

// updateArticleLabels 把当前语言的示例文章标题写进纸页标签。
// 只改文本，不改位置；语言切换不改变文章身份。
function updateArticleLabels() {
  state.articleLabels.forEach((el, i) => {
    el.querySelector(".name").textContent = publicationText.titles[i] || "";
    el.querySelector(".more").textContent = publicationText.readLabel || "";
  });
}

// updateNearState 在跨越距离阈值时通知 app.js（文案与附近列表形态随之切换）。
function updateNearState() {
  const next = camera.d < TUNE.nearThreshold;
  if (next === state.near) return;
  state.near = next;
  handlers.onNearChange && handlers.onNearChange(next);
}

// positionLabels 把 DOM 标签放到与画布同一投影的屏幕位置。
// 屏幕外、被左侧文字区遮挡或状态不匹配的标签直接隐藏；附近列表始终保留可访问入口。
function positionLabels() {
  if (!labelHost) return;
  const reserved = handlers.getReservedRect ? handlers.getReservedRect() : null;
  state.islands.forEach((isl, i) => {
    const p = projectIslandPoint(isl, 0, isl.r * isl.sy + 28, 5);
    const el = state.labels[i];
    const collision = p && reserved && p.x - 80 < reserved.right + 15 &&
      p.y - 35 < reserved.bottom + 20 && p.y + 35 > reserved.top - 10;
    const show = !!p && p.x > 70 && p.x < W - 70 && p.y > 110 && p.y < H - 100 &&
      !collision && !(i === state.selected && state.near);
    el.hidden = !show;
    if (show) {
      el.style.left = p.x + "px";
      el.style.top = (p.y + 23) + "px";
      el.style.opacity = clamp(p.s * 1.3, 0.4, 1);
    }
  });
  const isl = state.islands[state.selected];
  const b = bookSlot();
  const article = articleOnIsland(isl);
  state.articleLabels.forEach((el, i) => {
    const p = article >= 0 && article === i ? projectIslandPoint(isl, b.x, b.y, b.z) : null;
    el.hidden = !state.near || !p || p.x < 230 || p.x > W - 50 || p.y < 115 || p.y > H - 115;
    if (!el.hidden) {
      el.style.transform = "translate(calc(-100% - 14px), -50%)";
      el.style.left = p.x + "px";
      el.style.top = (p.y + 4) + "px";
      el.style.opacity = 1 - smoothstep(TUNE.labelFade[1], TUNE.labelFade[0], camera.d);
    }
  });
}

// ---------- 输入手势 ----------

// bindGestures 挂接指针与滚轮：单指拖动海面、双指缩放、滚轮推进镜头、点击命中。
// 指针捕获保证拖出画布后仍能收到释放事件；取消手势不产生点击副作用。
function bindGestures() {
  const surface = landCanvas;
  surface.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    stopCamera();
    gesture.set(e.pointerId, { x: e.clientX, y: e.clientY });
    down = { x: e.clientX, y: e.clientY };
    dragMoved = gesture.size > 1;
    surface.setPointerCapture(e.pointerId);
    surface.classList.add("dragging");
  });
  surface.addEventListener("pointermove", (e) => {
    if (!gesture.has(e.pointerId)) {
      const next = pickBook(e.clientX, e.clientY);
      if (next !== state.hover) { state.hover = next; state.lastSea = 0; wake(); }
      surface.style.cursor = next >= 0 || pickIsland(e.clientX, e.clientY) >= 0 ? "pointer" : "grab";
      return;
    }
    const old = gesture.get(e.pointerId);
    const before = gesture.size === 2 ? pinchPair() : null;
    gesture.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gesture.size === 2) {
      const after = pinchPair();
      target.d = clamp(camera.d * before.d / after.d, TUNE.dMin, TUNE.dMax);
      zoomAnchor = { x: after.x, y: after.y, world: unprojectCalc(view(), before.x, before.y) };
      dragMoved = true;
      wake();
      return;
    }
    // 单指：把按下时抓住的海面点拖到当前指针位置
    const a = unprojectCalc(view(), old.x, old.y);
    const b = unprojectCalc(view(), e.clientX, e.clientY);
    camera.x += a.x - b.x;
    camera.y += a.y - b.y;
    target.x = camera.x;
    target.y = camera.y;
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) dragMoved = true;
    state.dirty = true;
    wake();
  });
  // finishPointer 只把“没有拖动”的释放当作点击；取消不打开文章也不选岛。
  const finishPointer = (e, cancelled) => {
    if (!gesture.has(e.pointerId)) return;
    gesture.delete(e.pointerId);
    if (!gesture.size) {
      surface.classList.remove("dragging");
      if (!dragMoved && !cancelled) {
        const book = pickBook(e.clientX, e.clientY);
        if (book >= 0) handlers.onBookPick && handlers.onBookPick(book);
        else {
          const island = pickIsland(e.clientX, e.clientY);
          if (island >= 0) { selectIsland(island); approach(island); }
          else {
            // 空地点击：世界坐标脉冲（打招呼）
            const w = unprojectCalc(view(), e.clientX, e.clientY);
            handlers.onGroundPulse && handlers.onGroundPulse(w.x, w.y);
          }
        }
      }
      down = null;
    } else dragMoved = true;
  };
  surface.addEventListener("pointerup", (e) => finishPointer(e, false));
  surface.addEventListener("pointercancel", (e) => finishPointer(e, true));
  surface.addEventListener("wheel", (e) => {
    e.preventDefault();
    const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? H : 1);
    zoomAt(Math.exp(clamp(delta, -180, 180) * 0.0014), e.clientX, e.clientY);
  }, { passive: false });
  // 键盘：方向键平移、+/− 缩放、Esc 回到海上（方向与拖动地表一致）
  window.addEventListener("keydown", (e) => {
    if (handlers.isModalOpen && handlers.isModalOpen()) return;
    if (e.key === "Escape") { returnAbove(); return; }
    if (e.key === "+" || e.key === "=") { zoomAt(0.8); e.preventDefault(); }
    else if (e.key === "-") { zoomAt(1.25); e.preventDefault(); }
    else if (e.key.startsWith("Arrow")) {
      e.preventDefault();
      stopCamera();
      const step = camera.d * 0.07;
      if (e.key === "ArrowLeft") camera.x -= step;
      if (e.key === "ArrowRight") camera.x += step;
      if (e.key === "ArrowUp") camera.y -= step;
      if (e.key === "ArrowDown") camera.y += step;
      target.x = camera.x;
      target.y = camera.y;
      state.dirty = true;
      wake();
    }
  });
  window.addEventListener("blur", () => {
    gesture.clear();
    surface.classList.remove("dragging");
  });
}

// pinchPair 返回双指的中点与距离（用于连续缩放）。
function pinchPair() {
  const p = [...gesture.values()];
  return {
    x: (p[0].x + p[1].x) / 2,
    y: (p[0].y + p[1].y) / 2,
    d: Math.max(1, Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y)),
  };
}

// pickBook 命中纸页：只有镜头已经靠近才开启阅读（远景入口是岛标签与附近列表），
// 取最后绘制的（最上层）纸页。
function pickBook(x, y) {
  if (!state.near) return -1;
  for (let i = state.hits.length - 1; i >= 0; i--) {
    if (pointInQuad(x, y, state.hits[i].points)) return state.hits[i].index;
  }
  return -1;
}

// pickIsland 命中岛屿：用椭圆包围范围判定，取归一化距离最近的一座。
function pickIsland(x, y) {
  let found = -1, best = Infinity;
  for (let i = 0; i < state.islands.length; i++) {
    const isl = state.islands[i];
    const p = project(isl.x, isl.y, 25);
    if (!p) continue;
    const d = Math.hypot((x - p.x) / (isl.r * p.s), (y - p.y) / (isl.r * isl.sy * p.s));
    if (d < 1.15 && d < best) { best = d; found = i; }
  }
  return found;
}

// ---------- 尺寸与颜色工具 ----------

// resize 让三块画布匹配视口与像素密度；镜头位置与锚点保持不变。
function resize() {
  W = innerWidth;
  H = innerHeight;
  F = Math.min(H * 1.10, W * 1.3);
  dpr = Math.min(devicePixelRatio || 1, 1.7);
  for (const [canvas, ctx] of [[seaCanvas, gl ? null : sc], [landCanvas, lc], [airCanvas, ac]]) {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  if (gl) {
    gl.viewport(0, 0, seaCanvas.width, seaCanvas.height);
    initWater();
  }
  state.dirty = true;
  state.lastSea = 0;
  wake();
}

// hexToRgb 把 "#rrggbb" 转成 [r,g,b]；格式异常时返回黑色，不抛异常打断渲染。
function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!m) return [0, 0, 0];
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

// fractHash 是 Canvas 2D 海面与浪沫专用的稳定散列（输入是连续坐标，先取整再散列）。
function fractHash(x, y, s) {
  let n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

// 暴露只读诊断快照：供控制台与浏览器验收核对真实镜头、渲染计数与命中状态。
Object.defineProperty(window, "PULSE_WORLD", {
  get() {
    return {
      camera: getCamera(),
      stats: getStats(),
      selected: state.selected,
      near: state.near,
      hits: state.hits.length,
      project: (x, y, z = 0) => project(x, y, z),
      unproject: (x, y) => screenToWorld(x, y),
      islandScreen: (index) => {
        const isl = state.islands[index];
        return isl ? projectIslandPoint(isl, 0, 0, 20) : null;
      },
      bookScreen: (index) => {
        const isl = state.islands[index];
        if (!isl) return null;
        const b = bookSlot();
        return projectIslandPoint(isl, b.x, b.y, b.z);
      },
      snapshot: () => ({
        camera: getCamera(),
        selected: state.selected,
        near: state.near,
        moving: state.moving,
        dirty: state.dirty,
        scenePaints: state.scenePaints,
        seaPoints: state.seaPoints,
        waterRenderer: gl ? "webgl" : "canvas2d",
        hits: state.hits.length,
        islands: state.islands.length,
      }),
    };
  },
});
