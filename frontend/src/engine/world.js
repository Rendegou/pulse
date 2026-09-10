// world.js — 潮汐群岛世界引擎：相机、投影、粒子海面、岛屿、植物、DOM 标签、输入手势。
//
// 三层画布各司其职，共用同一套世界坐标与投影（pure.js 的 projectCalc）：
// - sea：海面粒子，优先 WebGL 点集（一次绘制调用约 39 万点），WebGL 不可用时退回 Canvas 2D。
// - land：岛屿地形，只在镜头/主题/语言变化时重绘（静止时零重绘）。
// - air：贴岸浪沫、漂尘、植物与实时层（真实访客指针、点击脉冲、浇水效果），每帧绘制。
//
// 数据边界：岛的参数来自 islands.js（与后端一致），植物生长阶段由服务端权威给出
// （runtime.js 通过 setGarden 注入）；本模块不碰网络，真实访客与脉冲由 setOverlay 注入。

import { projectCalc, unprojectCalc, clamp, smoothstep, tidalTilt, pointInQuad } from "./pure.js";
import { ISLANDS, buildIslandGeometry, islandPoint, islandIndex, islandTerrainHeight } from "./islands.js";

// createWorld 创建独立引擎实例；由 Vue 挂载时初始化，卸载时 dispose。粒子与相机不进入响应式状态。
export function createWorld() {
let disposed = false;
const cleanups = [];
// listen 为当前引擎登记监听器，销毁时按原参数移除，防止热更新重复手势。
function listen(node, type, callback, options) {
  node.addEventListener(type, callback, options);
  cleanups.push(() => node.removeEventListener(type, callback, options));
}

// ---------- 可调审美参数 ----------

const TUNE = {
  dMin: 270,             // 最近镜头距离（世界单位）
  dMax: 2500,            // 最远镜头距离
  dNear: 570,            // 靠近岛屿时的落位距离（岛半径 400 时约占视口一半宽度）
  dNearMobile: 620,
  dOverview: 1500,       // 远景距离：三座岛都在画面内，彼此留出海面
  dOverviewMobile: 1150,
  followMs: 150,         // 飞行/靠近的跟随时间常数（毫秒）：约 0.5 秒收敛
  directMs: 45,          // 直接操控的跟随时间常数：拖动要跟手
  nearThreshold: 800,    // 进入“靠近”状态的距离阈值
  labelFade: [820, 640], // 植物标签淡入的距离区间
  waterInterval: 31,     // 海面重绘间隔（约 32fps；静止时完全跳过）
  waterGrid: 300,        // 海面点阵纵向半径（点数 = (2nx+1)×(2ny+1)）
  // 植物比例：岛半径 400/300/350，整株最高 55 世界单位，
  // 相对最小那座岛的直径也只有 9.2%——用户反馈“花相对岛太大”，
  // 所以同时把岛放大、把植物收小到“岛上的一个小花园”的量级。
  plant: {
    x: 0, y: -12,        // 岛内局部锚点（略偏岛心上方）
    stem: 34,            // 茎的基础高度（care=0）
    stemPerCare: 7,      // 每级生长增加的高度（开花时 55）
    groundRx: 22,        // 土壤点圈半径
    groundRy: 16,
  },
};

// ---------- 模块状态 ----------

// camera 是镜头当前位置；target 是阻尼跟随目标（拖动/缩放/飞行都只改 target）。
const camera = { x: 0, y: -60, d: TUNE.dOverview };
const target = { x: 0, y: -60, d: TUNE.dOverview };

// state 是世界引擎运行状态。
const state = {
  selected: 0,       // 选中的岛索引（附近列表与标签共用）
  near: false,       // 是否处于“靠近”状态（镜头距离阈值）
  hover: false,      // 是否悬停在植物上
  raf: 0,
  time: 0,           // 海浪相位（秒）；reduced-motion 时停止推进
  dirty: true,       // 陆地层与标签需要重绘
  moving: false,     // 镜头是否仍在跟随目标
  lastTime: 0,
  lastSea: 0,
  frameMs: 0,        // 最近一帧渲染耗时（EWMA 平滑）
  scenePaints: 0,    // 陆地层重绘次数（验收用）
  seaPoints: 0,      // 最近一帧海面点数
  islands: [],       // 岛数据（启动时构建几何）
  labels: [],        // 岛标签 DOM
  plantLabel: null,  // 植物标签 DOM（只跟随当前选中岛）
};

// garden 是服务端权威的花园快照：{version, plants:[{care,last}]}。
// 渲染只读它；生长动画（growth）在本地插值，不产生业务写入。
let garden = { version: 0, plants: [{ care: 0, last: null }, { care: 0, last: null }, { care: 0, last: null }] };
const growth = [0, 0, 0];     // 本地动画进度，向 plants[].care 缓动
const effects = [];           // 浇水效果（水滴与土壤光点），最多 12 条

let seaCanvas, landCanvas, airCanvas, sc, lc, ac, gl;
let W = 0, H = 0, F = 1, dpr = 1;
let waterProgram = null, waterUniforms = null, waterCount = 0, waterBuffer = null;
let palette = null;              // 由 runtime.js 注入的主题调色板
let overlay = null;              // runtime.js 的实时层回调 (ctx, now, helpers)
let labelHost = null;            // 标签容器 DOM
let handlers = {};               // runtime.js 注入的回调
let motionReduced = false;
let gesture = new Map();
let zoomAnchor = null;
let dragMoved = false, down = null;

// ---------- 对外装配 ----------

// initWorld 绑定三块画布、构建岛屿几何并启动渲染循环。
// 参数：{ sea, land, air, labelHost } 是 DOM 节点；callbacks 由 runtime.js 提供：
// { onIslandSelect(index), onPlantWater(), onPlantLabel(index), onGroundPulse(wx, wy),
//   onCameraMove(camera), onNearChange(near), isReading(), overlayActive(),
//   isModalOpen(), getReservedRect() }
function initWorld(nodes, callbacks = {}) {
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
  listen(matchMedia("(prefers-reduced-motion: reduce)"), "change", (e) => {
    motionReduced = e.matches;
    state.dirty = true;
    wake();
  });

  // 岛屿几何只在启动时构建一次；之后镜头变化只重新投影缓存的世界坐标。
  state.islands = ISLANDS.map((isl) => buildIslandGeometry({ ...isl }));
  buildLabels();

  if (innerWidth < 580) camera.d = target.d = TUNE.dOverviewMobile;
  resize();
  listen(window, "resize", resize);
  bindGestures();
  listen(document, "visibilitychange", () => {
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

// setPalette 注入主题调色板（切换主题时由 runtime.js 再调一次）。
// p 需要包含 bg/sea/foam/shore/land/contour/solid/paper/ink/gold/shadow；
// sea/foam/shore/land/contour 是 [r,g,b] 数组，其余是 CSS 颜色串。
function setPalette(p) {
  palette = p;
  state.dirty = true;
  state.lastSea = 0;
  wake();
}

// setGarden 注入服务端权威的花园快照（welcome 与每次 plant 广播都会调一次）。
// 只接受形状正确的快照：植物数量与本地岛数一致、care 在 0..3；
// 版本倒退时不覆盖（重连由 runtime.js 传 reset=true 显式重设）。
// 生长动画在这里被唤醒，但阶段值始终来自参数，不在这里自增。
function setGarden(next, reset = false) {
  if (!next || !Array.isArray(next.plants) || next.plants.length !== state.islands.length) return;
  if (!reset && Number.isInteger(garden.version) && next.version < garden.version) return;
  garden = {
    version: Number.isInteger(next.version) ? next.version : garden.version,
    plants: next.plants.map((p) => ({
      care: clamp(Number(p?.care) || 0, 0, 3),
      last: p?.last && typeof p.last === "object" ? { ...p.last } : null,
    })),
  };
  // 重连或快照回退时直接对齐动画，不让植物从错误的位置慢慢长回来
  if (reset) {
    for (let i = 0; i < growth.length; i++) growth[i] = garden.plants[i].care;
  }
  state.dirty = true;
  wake();
}

// addWaterEffect 记录一次浇水效果（水滴落下 → 土壤光点扩散）。
// together 表示这次照料与另一个连接落在同一株植物上，颜色更暖。
function addWaterEffect(islandID, together) {
  const index = islandIndex(islandID);
  if (index < 0) return;
  effects.push({ island: index, bornAt: performance.now(), together: !!together });
  if (effects.length > 12) effects.shift();
  state.lastSea = 0;
  wake();
}

// setOverlay 注册每帧的实时层绘制（真实访客指针、点击脉冲）。
// fn(ctx, now, helpers)：helpers 提供 project（世界→屏幕，可能返回 null）与 W/H。
function setOverlay(fn) {
  overlay = fn;
  wake();
}

// getStats 返回性能与诊断统计（状态抽屉与浏览器验收使用）。
function getStats() {
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
function getCamera() {
  return { x: camera.x, y: camera.y, d: camera.d, zoom: TUNE.dOverview / camera.d };
}

// screenToWorld 把屏幕点反解为海平面世界坐标（拖动锚定与光标上报共用）。
function screenToWorld(x, y) {
  return unprojectCalc(view(), x, y);
}

// screenToSurface 把屏幕点反解为“地表”世界坐标：指针落在岛上时带上地形高度，
// 落在海上就是海平面。远端相机不同也能指向同一处地表——这是别人的指针贴地的前提。
function screenToSurface(x, y) {
  const p = unprojectCalc(view(), x, y);
  const heightAt = (wx, wy) => {
    for (const isl of state.islands) {
      const dx = wx - isl.x, dy = wy - isl.y;
      const c = Math.cos(isl.rot), sn = Math.sin(isl.rot);
      const lx = dx * c + dy * sn, ly = -dx * sn + dy * c;
      if (Math.hypot(lx, ly / isl.sy) < isl.r * 0.98) {
        return islandTerrainHeight(isl, lx, ly) + 2;
      }
    }
    return 0;
  };
  for (let i = 0; i < 9; i++) {
    const z = heightAt(p.x, p.y);
    const q = project(p.x, p.y, z);
    const qx = project(p.x + 1, p.y, heightAt(p.x + 1, p.y));
    const qy = project(p.x, p.y + 1, heightAt(p.x, p.y + 1));
    if (!q || !qx || !qy) break;
    const a = qx.x - q.x, b = qy.x - q.x, c2 = qx.y - q.y, d = qy.y - q.y;
    const det = a * d - b * c2;
    if (Math.abs(det) < 1e-5) break;
    const ex = x - q.x, ey = y - q.y;
    p.x += clamp((ex * d - ey * b) / det, -400, 400);
    p.y += clamp((ey * a - ex * c2) / det, -400, 400);
  }
  return { x: p.x, y: p.y, z: heightAt(p.x, p.y) };
}

// plantSurfacePoint 返回植物锚点在世界中的位置与高度（runtime.js 的透明命中区用）。
function plantSurfacePoint(index = state.selected) {
  if (!Number.isInteger(index) || index < 0 || index >= state.islands.length) return null;
  const p = plantProject(index, 0, 0, TUNE.plant.stem * 0.75);
  return p ? { x: p.x, y: p.y, s: p.s } : null;
}

// getSelected 返回当前选中的岛索引。
function getSelected() {
  return state.selected;
}

// getNearState 返回是否处于靠近状态（runtime.js 用它决定提示文案与动作语义）。
function getNearState() {
  return state.near;
}

// setPlantHover 设置植物悬停态：在土壤圈上画一圈提示，并让面板跟随刷新。
function setPlantHover(on) {
  if (state.hover === !!on) return;
  state.hover = !!on;
  state.lastSea = 0;
  handlers.onPlantHover && handlers.onPlantHover(state.hover);
  wake();
}

// getGarden 返回花园快照的拷贝（runtime.js 用来显示最近照料者，不直接改内部状态）。
function getGarden() {
  return {
    version: garden.version,
    plants: garden.plants.map((p) => ({ care: p.care, last: p.last ? { ...p.last } : null })),
  };
}

// setPlantLabelText 写入植物标签的三行文案（由 runtime.js 按当前语言与生长阶段给出）。
function setPlantLabelText(text) {
  if (!state.plantLabel) return;
  state.plantLabel.querySelector(".meta").textContent = text.meta || "";
  state.plantLabel.querySelector(".name").textContent = text.name || "";
  state.plantLabel.querySelector(".more").textContent = text.more || "";
}

// wake 请求下一帧；只保持一个动画请求，页面隐藏时不启动后台帧。
function wake() {
  if (!disposed && !state.raf && !document.hidden) state.raf = requestAnimationFrame(frame);
}

// ---------- 相机动作 ----------

// selectIsland 选中一座岛（不移动镜头）；越界索引被忽略。
// 选中立即刷新标签与附近列表，随后由调用方决定是否 approach。
function selectIsland(index) {
  if (!Number.isInteger(index) || index < 0 || index >= state.islands.length) return;
  state.selected = index;
  state.dirty = true;
  updatePlantLabel();
  handlers.onIslandSelect && handlers.onIslandSelect(index);
  wake();
}

// approach 连续靠近选中的岛：镜头对准岛心并推进到落位距离。
// 不切换场景、不重建几何；中途拖动或滚轮会立刻接管。
function approach(index = state.selected) {
  if (!Number.isInteger(index) || index < 0 || index >= state.islands.length) return;
  const isl = state.islands[index];
  state.selected = index;
  target.x = isl.x;
  target.y = isl.y + 10;
  target.d = innerWidth < 580 ? TUNE.dNearMobile : TUNE.dNear;
  zoomAnchor = null;
  state.dirty = true;
  updatePlantLabel();
  wake();
}

// returnAbove 从近景退回远景；同样只改目标，可被任何输入打断。
function returnAbove() {
  const isl = state.islands[state.selected];
  target.x = isl.x;
  target.y = isl.y - 60;
  target.d = innerWidth < 580 ? TUNE.dOverviewMobile : TUNE.dOverview;
  zoomAnchor = null;
  wake();
}

// flyTo 把镜头送到指定世界坐标与距离（地址旅行、归处按钮使用）。
// to = {x, y, d}；再次调用替换旧目标，没有排队。
function flyTo(to) {
  target.x = to.x;
  target.y = to.y;
  if (Number.isFinite(to.d)) target.d = clamp(to.d, TUNE.dMin, TUNE.dMax);
  zoomAnchor = null;
  wake();
}

// zoomAt 保持指针下的海面点不动进行缩放；factor > 1 表示拉远。
// 返回 false 表示已经到边界（镜头距离没有变化）。
function zoomAt(factor, x = W * 0.57, y = H * 0.55) {
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

// plantWorld 把植物局部坐标（相对岛面）转成世界坐标：岛自转与地形高度都在这里吸收。
function plantWorld(index, x = 0, y = 0, z = 0) {
  const isl = state.islands[index];
  return islandPoint(isl, TUNE.plant.x + x, TUNE.plant.y + y, z);
}

// plantProject 投影植物上的一点；越过近裁剪返回 null，调用方必须跳过。
function plantProject(index, x = 0, y = 0, z = 0) {
  const p = plantWorld(index, x, y, z);
  return project(p.x, p.y, p.z);
}

// projectIslandLocal 投影岛上任意局部点（含离地高度），供漂尘与标签定位使用。
function projectIslandLocal(isl, x, y, z) {
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
  drawGarden(now);
  if (overlay) overlay(ac, now, { project, W, H });

  const cost = performance.now() - start;
  state.frameMs = state.frameMs ? state.frameMs * 0.9 + cost * 0.1 : cost;

  // 镜头在动、实时层有活动、海浪在流、植物在生长或有浇水效果时继续出帧
  if (state.moving || overlayActive() || (!motionReduced && !reading) || gardenActive()) wake();
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

// isReading 报告是否正在查看帮助或其它模态框：此时暂停海浪推进并停止动画请求。
function isReading() {
  return handlers.isReading ? handlers.isReading() : false;
}

// overlayActive 报告实时层是否有活动（脉冲存活或有人移动）；由 runtime.js 决定。
function overlayActive() {
  return handlers.overlayActive ? handlers.overlayActive() : false;
}

// gardenActive 报告花园是否还需要继续出帧：植物正在生长或有存活的水滴效果。
function gardenActive() {
  for (let i = 0; i < growth.length; i++) {
    if (Math.abs(growth[i] - garden.plants[i].care) > 0.004) return true;
  }
  return effects.length > 0;
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
      float a = p.x * .012 + p.y * .008 - time * .62;
      float b = p.y * .022 - p.x * .006 - time * .43;
      float nearDetail = 1. - smoothstep(420., 1100., cam.z);
      float h = sin(a) * 19. + sin(b) * 8. + sin(p.x * .056 + p.y * .034 - time * 1.05) * 2.8 * nearDetail;
      float crest = pow(max(0., sin(a) * .7 + sin(b) * .3), 3.);
      vec2 rel = p - cam.xy;
      h -= dot(rel, rel) / 13500.;
      float dep = cam.z - rel.y * sin(tilt) - h * cos(tilt);
      float scale = focal / max(dep, 45.);
      vec2 screen = vec2(viewport.x * .57, viewport.y * .55) + vec2(rel.x, rel.y * cos(tilt) - h * sin(tilt)) * scale;
      gl_Position = vec4(screen.x / viewport.x * 2. - 1., 1. - screen.y / viewport.y * 2., 0., 1.);
      gl_PointSize = clamp(scale * (1.2 + crest * .8), .8, 2.6) * dpr;
      float fine = step(.5, mod(abs(ij.x), 2.) + mod(abs(ij.y), 2.));
      float opacity = mix(1., detail, fine) * (.065 + crest * .38 + n * .045) * clamp(cam.z / dep, .12, 1.25);
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
        const wave = Math.sin(x * 0.012 + y * 0.008 - t * 0.62) * 0.7 +
          Math.sin(y * 0.022 - x * 0.006 - t * 0.43) * 0.3;
        const crest = Math.pow(Math.max(0, wave), 3);
        const fog = clamp(camera.d / p.d, 0.12, 1.2);
        const a = (0.065 + crest * 0.38 + n * 0.045) * fog * detail;
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

// seaHeight 返回海面高度：主涌浪、交错波与近景细浪叠加（世界单位）。
function seaHeight(x, y, t) {
  return Math.sin(x * 0.012 + y * 0.008 - t * 0.62) * 19 +
    Math.sin(y * 0.022 - x * 0.006 - t * 0.43) * 8 +
    Math.sin(x * 0.056 + y * 0.034 - t * 1.05) * 2.8 * (1 - smoothstep(420, 1100, camera.d));
}

// ---------- 陆地（岛屿） ----------

// drawLand 重绘陆地层：按深度从远到近画岛。只在 state.dirty 时调用；
// 静止时陆地层直接复用，零重绘。
// 远处的邻岛不画（概念稿的做法）：日常视角只看到自己这一片海，
// 拉远或点导航才发现邻岛——避免三座岛挤在同一屏。
function drawLand() {
  lc.clearRect(0, 0, W, H);
  const order = state.islands
    .map((isl, i) => ({ i, isl, d: project(isl.x, isl.y, 28)?.d ?? 0 }))
    .filter(({ i, isl }) => i === state.selected || Math.hypot(isl.x - camera.x, isl.y - camera.y) <= camera.d * 1.8);
  order.sort((a, b) => b.d - a.d);
  for (const { isl } of order) drawIsland(isl);
  state.scenePaints++;
}

// drawIsland 绘制一座岛：底色 → 等高线 → 粒子地形。
// 岛完全在屏幕外时直接跳过，不为看不见的几何付出代价。
function drawIsland(isl) {
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
  lc.restore();
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

// ---------- 空气层（浪沫 / 漂尘） ----------

// drawAir 每帧重绘：贴岸进退浪沫与岛上漂尘。
// 全部使用与陆地相同的投影，因此浪沫贴着岸线、漂尘随高度自然放大。
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
      const p = projectIslandLocal(isl, x, y, z);
      if (!p || p.x < 0 || p.x > W || p.y < 0 || p.y > H) continue;
      ac.fillStyle = rgba(palette.shore, (0.08 + 0.12 * n) * visible);
      ac.beginPath();
      ac.arc(p.x, p.y, clamp(p.s * (0.5 + n * 0.7), 0.5, 2.3), 0, Math.PI * 2);
      ac.fill();
    }
  }
}

// boundaryAt 取岛岸线在角度 a 处的半径倍率（与 pure.islandBoundary 同一公式）。
function boundaryAt(isl, a) {
  return 1 + 0.11 * Math.sin(3 * a + isl.seed) + 0.065 * Math.cos(5 * a - isl.seed * 0.3) + 0.04 * Math.sin(2 * a + isl.seed);
}

// ---------- 植物与浇水效果 ----------

// leafShape 用参数曲线构成有折面和中脉的叶片；顶点在世界空间计算，没有图片资源。
// index 是岛索引；base 是叶柄起点（相对植物锚点的局部坐标）；
// angle/length/width/lift 决定朝向与形状；petal=true 时用岸色画花瓣。
function leafShape(index, base, angle, length, width, lift, opacity, petal = false) {
  if (opacity <= 0.01) return;
  const edgeA = [], edgeB = [], vein = [];
  const c = Math.cos(angle), s = Math.sin(angle);
  for (let k = 0; k <= 18; k++) {
    const t = k / 18, w = Math.sin(t * Math.PI) * width;
    const x = base.x + c * t * length;
    const y = base.y + s * t * length;
    const z = base.z + Math.sin(t * Math.PI * 0.7) * lift;
    edgeA.push(plantWorld(index, x - s * w, y + c * w, z));
    edgeB.push(plantWorld(index, x + s * w, y - c * w, z - 2 * Math.sin(t * Math.PI)));
    vein.push(plantWorld(index, x, y, z + 1.5));
  }
  polygon(ac, [...edgeA, ...edgeB.reverse()], rgba(petal ? palette.shore : palette.land, opacity), rgba(palette.foam, 0.55 * opacity), 0.7);
  drawLine(ac, vein, rgba(palette.shore, 0.75 * opacity), 0.85);
  // 少量固定颗粒沿叶脉展开，让近景材质与岛屿一致；不使用每帧随机噪声。
  for (let j = 0; j < 22; j++) {
    const t = (j + 0.5) / 22;
    const w = Math.sin(t * Math.PI) * width * (fractHash(j, 3, 9) - 0.5) * 1.6;
    const p = plantProject(index, base.x + c * t * length - s * w, base.y + s * t * length + c * w, base.z + Math.sin(t * Math.PI * 0.7) * lift + 1);
    if (!p) continue;
    const size = clamp(p.s * 0.6, 0.5, 1.4);
    ac.fillStyle = rgba(palette.foam, 0.52 * opacity);
    ac.fillRect(p.x, p.y, size, size);
  }
}

// drawPlant 绘制细茎、分层叶片和花朵；只读花园状态，生长缓动不产生业务写入。
// index 是岛索引；g 是该岛的生长进度（0..3，由 growth 缓动而来）。
function drawPlant(index, g) {
  const base = plantProject(index, 0, 0, 0);
  if (!base || base.x < -220 || base.x > W + 220 || base.y < -220 || base.y > H + 240) return;
  const sway = motionReduced ? 0 : Math.sin(state.time * 0.8 + index) * 2;
  const height = TUNE.plant.stem + g * TUNE.plant.stemPerCare;

  // 土壤投影与细粒点圈，让植物落在岛面上
  const ring = [];
  for (let j = 0; j <= 64; j++) {
    const a = (j / 64) * Math.PI * 2;
    ring.push(plantWorld(index, Math.cos(a) * TUNE.plant.groundRx, Math.sin(a) * TUNE.plant.groundRy, 0.5));
  }
  polygon(ac, ring, rgba(palette.contour, 0.14), rgba(palette.shore, 0.32), 0.6);

  // 细茎：随生长轻微加高，摆动只影响顶端
  const stem = [];
  for (let k = 0; k <= 24; k++) {
    const t = k / 24;
    stem.push(plantWorld(index, Math.sin(t * 2.2) * 6 + sway * t * t, 0, height * t));
  }
  drawLine(ac, stem, rgba(palette.foam, 0.9), Math.max(1.1, base.s * 1.4));

  // 叶片：随生长逐步展开，第四片只在接近开花时出现（尺寸按植物整体比例收小）
  leafShape(index, { x: 4, y: 0, z: height * 0.44 }, 2.9, 19 + g * 3, 5.2 + g * 0.8, 8, 0.8);
  leafShape(index, { x: 4, y: 0, z: height * 0.70 }, -0.3, 17 + g * 3.4, 5.2 + g * 0.9, 12, 0.86);
  if (g > 0.2) leafShape(index, { x: 4, y: 0, z: height * 0.96 }, -2.2, 13 + g * 2.2, 4 + g * 0.6, 10, Math.min(0.8, g));
  if (g > 1.1) leafShape(index, { x: 4, y: 0, z: height * 1.18 }, 0.9, 12, 4, 7.5, Math.min(0.8, g - 1));

  // 花：g>1.25 后花瓣慢慢张开，开花后中心一个金色花蕊
  const top = plantProject(index, 4 + sway, 0, height);
  if (top && g > 1.25) {
    const opening = smoothstep(1.8, 3, g);
    for (let j = 0; j < 7; j++) {
      const angle = (j / 7) * Math.PI * 2 + 0.3;
      leafShape(index, { x: 4 + sway, y: 0, z: height }, angle, 4 + opening * 11, 2 + opening * 3.4, 7 - opening * 2.5, 0.92, true);
    }
    ac.fillStyle = palette.gold;
    ac.beginPath();
    ac.arc(top.x, top.y - 4 * top.s, Math.max(1.7, 3.2 * top.s), 0, Math.PI * 2);
    ac.fill();
  }
  if (state.hover && index === state.selected) drawLine(ac, ring, rgba(palette.shore, 0.7), 1.1);
}

// drawGarden 绘制选中岛的植物与存活的水滴效果。
// 每帧把 growth 向服务端权威 care 缓动；reduced-motion 时直接对齐（静态变化）。
function drawGarden(now) {
  if (!palette) return;
  for (let i = 0; i < garden.plants.length; i++) {
    const desired = garden.plants[i].care;
    growth[i] += motionReduced ? desired - growth[i] : (desired - growth[i]) * 0.055;
  }
  // 只画当前选中的岛：远景下其他岛不需要植物细节，也不支付这份开销
  drawPlant(state.selected, growth[state.selected]);

  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    const life = (now - e.bornAt) / 2400;
    if (life >= 1) { effects.splice(i, 1); continue; }
    if (e.island !== state.selected) continue;
    if (motionReduced) {
      const p = plantProject(e.island, 0, 0, 10);
      if (p) {
        ac.strokeStyle = palette.gold;
        ac.beginPath();
        ac.ellipse(p.x, p.y, 35 * p.s, 18 * p.s, 0, 0, Math.PI * 2);
        ac.stroke();
      }
      continue;
    }
    // 水滴按固定种子落下，随后变成向外扩散的土壤光点；每次动作最多 56 个点。
    for (let j = 0; j < 56; j++) {
      const n = fractHash(j, 5, 17);
      const a = fractHash(j, 2, 8) * Math.PI * 2;
      const q = clamp(life * 1.65 - n * 0.32, 0, 1);
      if (q === 0) continue;
      const r = q < 0.65 ? 12 + n * 19 : 18 + (q - 0.65) * 130;
      const z = q < 0.65 ? 155 * (1 - q / 0.65) + 8 : 5 + Math.sin((q - 0.65) * Math.PI) * 18;
      const p = plantProject(e.island, Math.cos(a) * r, Math.sin(a) * r, z);
      if (!p) continue;
      ac.fillStyle = rgba(e.together ? palette.shore : palette.foam, Math.sin(q * Math.PI) * 0.85);
      ac.beginPath();
      ac.ellipse(p.x, p.y, clamp(p.s * (0.6 + n), 0.6, 3), clamp(p.s * (q < 0.65 ? 3 : 1), 1, 5), 0, 0, Math.PI * 2);
      ac.fill();
    }
  }
}

// ---------- DOM 标签 ----------

// buildLabels 为每座岛创建可点击、可键盘访问的标签，并创建唯一的植物标签。
// 标签位置每帧跟随投影；岛标签只在远景显示，植物标签只在靠近当前选中岛时显示。
function buildLabels() {
  if (!labelHost) return;
  state.labels = [];
  state.islands.forEach((isl, i) => {
    const b = document.createElement("button");
    b.className = "island-label";
    b.innerHTML = '<span class="name"></span><span class="sub"></span>';
    // 点标签 = 选中并靠近这座岛；与附近列表是等价入口。
    listen(b, "click", () => { selectIsland(i); approach(i); });
    labelHost.appendChild(b);
    state.labels.push(b);
  });
  const p = document.createElement("button");
  p.className = "plant-label";
  p.innerHTML = '<span class="meta"></span><span class="name"></span><span class="more"></span>';
  // 点植物标签 = 照料这株植物（等价于点画布上的植物）。
  listen(p, "click", () => handlers.onPlantWater && handlers.onPlantWater());
  labelHost.appendChild(p);
  state.plantLabel = p;
}

// updatePlantLabel 让 runtime.js 为当前选中岛的植物刷新标签文本。
function updatePlantLabel() {
  handlers.onPlantLabel && handlers.onPlantLabel(state.selected);
}

// updateNearState 在跨越距离阈值时通知 runtime.js（文案与动作语义随之切换）。
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
    const p = projectIslandLocal(isl, 0, isl.r * isl.sy + 28, 5);
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

  const el = state.plantLabel;
  if (el) {
    const p = plantProject(state.selected, 0, 0, TUNE.plant.stem + 14);
    el.hidden = !state.near || !p || p.x < 210 || p.x > W - 60 || p.y < 120 || p.y > H - 130;
    if (!el.hidden) {
      el.style.transform = "translate(calc(-100% - 16px), -50%)";
      el.style.left = p.x + "px";
      el.style.top = p.y + "px";
      el.style.opacity = 1 - smoothstep(TUNE.labelFade[1], TUNE.labelFade[0], camera.d);
    }
  }
}

// ---------- 输入手势 ----------

// bindGestures 挂接指针与滚轮：单指拖动海面、双指缩放、滚轮推进镜头、点击命中。
// 指针捕获保证拖出画布后仍能收到释放事件；取消手势不产生点击副作用。
function bindGestures() {
  const surface = landCanvas;
  listen(surface, "pointerdown", (e) => {
    if (e.button !== 0) return;
    stopCamera();
    gesture.set(e.pointerId, { x: e.clientX, y: e.clientY });
    down = { x: e.clientX, y: e.clientY };
    dragMoved = gesture.size > 1;
    surface.setPointerCapture(e.pointerId);
    surface.classList.add("dragging");
  });
  listen(surface, "pointermove", (e) => {
    if (!gesture.has(e.pointerId)) {
      const next = pickPlant(e.clientX, e.clientY);
      if (next !== state.hover) { state.hover = next; state.lastSea = 0; wake(); }
      surface.style.cursor = next || pickIsland(e.clientX, e.clientY) >= 0 ? "pointer" : "grab";
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
  // finishPointer 只把“没有拖动”的释放当作点击；取消不触发照料也不选岛。
  const finishPointer = (e, cancelled) => {
    if (!gesture.has(e.pointerId)) return;
    gesture.delete(e.pointerId);
    if (!gesture.size) {
      surface.classList.remove("dragging");
      if (!dragMoved && !cancelled) {
        if (pickPlant(e.clientX, e.clientY)) {
          // 点植物：与按钮共用同一个照料动作；远景下由 runtime.js 决定先靠近
          handlers.onPlantWater && handlers.onPlantWater();
        } else {
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
  listen(surface, "pointerup", (e) => finishPointer(e, false));
  listen(surface, "pointercancel", (e) => finishPointer(e, true));
  listen(surface, "wheel", (e) => {
    e.preventDefault();
    const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? H : 1);
    zoomAt(Math.exp(clamp(delta, -180, 180) * 0.0014), e.clientX, e.clientY);
  }, { passive: false });
  // 键盘：方向键平移、+/− 缩放、Esc 回到海上（方向与拖动地表一致）
  listen(window, "keydown", (e) => {
    if (handlers.isModalOpen && handlers.isModalOpen()) return;
    if (e.target?.closest?.("input, textarea, select, [contenteditable=true]")) return;
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
  listen(window, "blur", () => {
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

// pickPlant 命中植物：只对当前选中的岛判定，用屏幕距离与投影尺度做椭圆近似。
// 远景点植物不构成命中，入口交给岛标签与附近列表。
function pickPlant(x, y) {
  const p = plantProject(state.selected, 0, 0, TUNE.plant.stem * 0.9);
  if (!p) return false;
  return Math.hypot(x - p.x, (y - p.y) * 0.75) < Math.max(30, 48 * p.s);
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

// fractHash 是 Canvas 2D 海面、浪沫与叶脉颗粒专用的稳定散列（输入先取整再散列）。
function fractHash(x, y, s) {
  let n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

// 暴露只读诊断快照：供控制台与浏览器验收核对真实镜头、渲染计数与花园状态。
// diagnostics 只返回可观察快照，不向组件泄露引擎内部可变状态。
function diagnostics() {
    return {
      camera: getCamera(),
      stats: getStats(),
      selected: state.selected,
      near: state.near,
      garden: getGarden(),
      growth: [...growth],
      project: (x, y, z = 0) => project(x, y, z),
      unproject: (x, y) => screenToWorld(x, y),
      islandScreen: (index) => {
        const isl = state.islands[index];
        return isl ? projectIslandLocal(isl, 0, 0, 20) : null;
      },
      plantScreen: (index = state.selected) => plantProject(index, 0, 0, TUNE.plant.stem * 0.9),
      snapshot: () => ({
        camera: getCamera(),
        selected: state.selected,
        near: state.near,
        moving: state.moving,
        hover: state.hover,
        scenePaints: state.scenePaints,
        seaPoints: state.seaPoints,
        waterRenderer: gl ? "webgl" : "canvas2d",
        islands: state.islands.length,
        gardenVersion: garden.version,
        care: garden.plants.map((p) => p.care),
        growth: [...growth],
        effects: effects.length,
      }),
    };

}

// setIslandLabels 更新引擎拥有的投影标签；Vue 只管理空容器，不重复管理其子节点。
function setIslandLabels(names, subtitle) {
  state.labels.forEach((el, i) => {
    el.querySelector('.name').textContent = names[i] || ISLANDS[i].id;
    el.querySelector('.sub').textContent = subtitle;
  });
}
// dispose 停止 RAF、解除监听并释放 GPU 资源；可重复调用，销毁后不可再次初始化。
function dispose() {
  if (disposed) return;
  disposed = true;
  cancelAnimationFrame(state.raf);
  state.raf = 0;
  for (const cleanup of cleanups.splice(0)) cleanup();
  for (const id of gesture.keys()) {
    if (landCanvas?.hasPointerCapture(id)) landCanvas.releasePointerCapture(id);
  }
  gesture.clear();
  if (gl) {
    if (waterProgram) gl.deleteProgram(waterProgram);
    if (waterBuffer) gl.deleteBuffer(waterBuffer);
  }
  labelHost?.replaceChildren();
  overlay = null;
  handlers = {};
  state.islands = [];
  state.labels = [];
}
return { initWorld, setPalette, setGarden, addWaterEffect, setOverlay, getStats, getCamera, screenToWorld, screenToSurface, plantSurfacePoint, getSelected, getNearState, setPlantHover, getGarden, setPlantLabelText, wake, selectIsland, approach, returnAbove, flyTo, zoomAt, setIslandLabels, diagnostics, dispose };
}
