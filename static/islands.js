// islands.js — 岛屿数据与几何缓存。
//
// 数据来源与权威边界：
// - 岛的 id/位置/半径/压扁/朝向/种子必须与后端 `main.go` 的 `Islands()` 一致，
//   后端才是权威；这里只是同一份参数的客户端镜像（缺失时页面仍可离线渲染示例岛）。
// - 岛的粒子、岸线轮廓是 (seed, 参数) 的确定性函数，只在启动时构建一次并缓存；
//   镜头移动只重新投影已缓存的世界坐标，不重新随机生成。
// - 文章挂在岛上，是示例内容（articles.js），不代表真实博客导入。

import {
  islandBoundary,
  islandLocalToWorld,
  islandTerrainHeight,
} from "./pure.js";

// ISLANDS 是示例个人空间（三座示例岛）。article 为 null 表示这座岛没有文章入口。
// 参数与后端保持一致；名称走 i18n，不用这里的 name 直接显示。
export const ISLANDS = [
  { id: "origin", name: "origin", x: 0, y: 0, r: 242, sy: 0.74, rot: -0.35, seed: 4, article: 0 },
  { id: "rain", name: "rain", x: -1060, y: -640, r: 181, sy: 0.70, rot: 0.4, seed: 12, article: 1 },
  { id: "letter", name: "letter", x: 1030, y: -490, r: 212, sy: 0.76, rot: -0.7, seed: 21, article: 2 },
];

// islandById 按 id 取岛；未知 id 返回 null（后端可能发来本地还没有的岛）。
export function islandById(id) {
  return ISLANDS.find((i) => i.id === id) || null;
}

// buildIslandGeometry 生成一座岛的静态几何并写回该岛对象（只调用一次）。
// 产出两部分：
// - points：岛面粒子，世界坐标 + 归一化半径 r + 随机亮度 n；岸线外侧逐渐稀疏。
// - rings：23 层等高线，用于岸线描边和近景轮廓。
// 原地修改 isl 并返回它；重复调用会重建（调用方负责只调一次）。
export function buildIslandGeometry(isl) {
  const points = [];
  const step = 3.7;
  for (let y = -isl.r; y < isl.r; y += step) {
    for (let x = -isl.r * 1.25; x < isl.r * 1.25; x += step) {
      const a = Math.atan2(y / isl.sy, x);
      const r = Math.hypot(x, y / isl.sy) / (isl.r * islandBoundary(a, isl.seed));
      if (r > 1.13) continue;
      const n = hashPair(x, y, isl.seed);
      // 岸线外只保留少量粒子，让边缘自然稀疏而不是一条硬边
      if (r > 1 && n > (1.13 - r) * 5) continue;
      const px = x + (n - 0.5) * 3;
      const py = y + (hashPair(x, y, 33) - 0.5) * 3;
      const z = islandTerrainHeight(isl, px, py);
      const w = islandLocalToWorld(isl, px, py, z);
      points.push({ x: w.x, y: w.y, z: w.z, r, n });
    }
  }
  const rings = [];
  for (let j = 1; j <= 23; j++) {
    const ring = [];
    const rr = j / 23;
    for (let k = 0; k <= 144; k++) {
      ring.push(landPoint(isl, (k / 144) * Math.PI * 2, rr));
    }
    rings.push(ring);
  }
  isl.points = points;
  isl.rings = rings;
  return isl;
}

// landPoint 把岸线参数 (角度 a, 半径倍率 r) 转成岛面世界坐标。
// 用于等高线采样；高度由 terrainHeight 决定，因此线条贴着地形起伏。
export function landPoint(isl, a, r) {
  const radius = isl.r * islandBoundary(a, isl.seed) * r;
  const x = Math.cos(a) * radius;
  const y = Math.sin(a) * radius * isl.sy;
  return islandLocalToWorld(isl, x, y, islandTerrainHeight(isl, x, y));
}

// islandPoint 把岛内局部坐标（含离地高度 z）投成世界坐标，供纸页与装饰共用。
// z 是相对岛面的额外高度：纸页浮在岛上，不是贴地。
export function islandPoint(isl, x, y, z = 0) {
  return islandLocalToWorld(isl, x, y, islandTerrainHeight(isl, x, y) + z);
}

// articleOnIsland 返回这座岛挂的文章索引；没有文章时返回 -1。
// 一处定义，避免 app.js 与渲染器各判一次导致标题与纸页错位。
export function articleOnIsland(isl) {
  return Number.isInteger(isl.article) ? isl.article : -1;
}

// hashPair 是 buildIslandGeometry 专用的稳定散列（与 pure.hash 同族但独立种子域）。
// 单独放在这里是为了让几何构建不依赖 UI 模块；同一坐标永远同一值。
function hashPair(x, y, s) {
  let n = Math.imul(Math.round(x * 10) | 0, 374761393) ^
    Math.imul(Math.round(y * 10) | 0, 668265263) ^
    Math.imul(s | 0, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
