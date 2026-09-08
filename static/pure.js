// pure.js — 纯函数模块：不读 DOM、不读时钟、不改外部状态。
// 只有这里的函数能被 node --test 脱离浏览器直接测。
// 注意：本文件会被 go:embed 进二进制并由浏览器加载，保持零依赖、无副作用。
//
// 投影体系（2026-09-09 起为“潮汐群岛”透视，取代旧的局部曲面近似）：
// - 世界坐标 x/y 是海平面上的平面坐标，z 是高出海面的高度（世界单位）。
// - 相机 = 中心 (cx, cy) + 距离 d + 倾角 tilt；海水、岛屿、纸页、访客共用同一套
//   projectCalc，因此屏幕命中、缩放锚定和指针上报天然一致。
// - 投影可能返回 null（越过近裁剪），调用方必须处理，不能假定总是有点。

// normalizePointer 把视口鼠标坐标换算成画布归一化坐标（0..1）。
// rect 是画布的 getBoundingClientRect() 结果（含 left/top/width/height）。
// rect 宽或高非正时返回 null（尺寸异常，采样无意义）；
// 坐标超出画布范围时夹紧到 [0,1]（鼠标可以移出画布边缘）。
export function normalizePointer(clientX, clientY, rect) {
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
  };
}

// appendPositionSample 把一条远程位置样本追加进缓冲，并维持两个上限：
// 时间上只保留最近 maxAgeMs 毫秒，条数上最多 maxLen 条（先按时间清，再按条数砍）。
// 相同时间戳的样本保留后到的一个（去重策略固定在此，不允许除零重发）。
// 直接原地修改 buf 并返回它；now 由调用方传入（函数内不读时钟，方便测试）。
export function appendPositionSample(buf, sample, now, maxAgeMs = 1000, maxLen = 32) {
  const last = buf[buf.length - 1];
  if (last && last.t === sample.t) {
    buf[buf.length - 1] = sample; // 同时间戳：后到覆盖先到
  } else {
    buf.push(sample);
  }
  const cutoff = now - maxAgeMs;
  while (buf.length > 0 && buf[0].t < cutoff) buf.shift();
  while (buf.length > maxLen) buf.shift();
  return buf;
}

// SEND_BUDGET_BYTES 是 WebSocket 待发字节的预算上限（64 KiB）。
// 超过说明对端消费不过来；这只是应用层发送策略，不代表浏览器有这个硬上限。
export const SEND_BUDGET_BYTES = 64 * 1024;

// canSend 决定这一帧光标要不要发（纯函数，便于测试）。
// 三个条件：有新坐标（dirty）且连接处于 OPEN 且待发字节未超预算。
// 超预算时丢弃本帧——pending 始终保留最新值，下一帧覆盖式重发，不排队积压。
export function canSend(dirty, readyStateOpen, bufferedAmount, budgetBytes = SEND_BUDGET_BYTES) {
  return dirty && readyStateOpen && bufferedAmount < budgetBytes;
}

// markSeen 事件去重登记：id 已见过返回 false，没见过则记录并返回 true。
// seen 最多保留 max 条，超出时删掉最旧的（Set 按插入序迭代，第一个即最旧）。
// 原地修改 seen；这是防止同一事件被重复播放的有界去重缓存。
export function markSeen(seen, id, max = 256) {
  if (seen.has(id)) return false;
  seen.add(id);
  if (seen.size > max) {
    seen.delete(seen.values().next().value);
  }
  return true;
}

// RADAR_PORTS 是 Host Radar 雷达环上预置的端口。
export const RADAR_PORTS = [22, 80, 443, 3000, 3306, 5432, 8080];

// portPosition 计算端口在雷达环上的归一化位置（绕中心一圈，12 点方向起顺时针）。
// 未知端口放到环上最后一个槽位：不丢事件，但也不假装认识它。
export function portPosition(port) {
  const i = RADAR_PORTS.indexOf(port);
  const idx = i === -1 ? RADAR_PORTS.length : i;
  const total = RADAR_PORTS.length + 1;
  const a = -Math.PI / 2 + (idx / total) * Math.PI * 2;
  return { x: 0.5 + Math.cos(a) * 0.3, y: 0.5 + Math.sin(a) * 0.3 };
}

// ratePerSecond 计算时间戳序列在最近 windowMs 内的事件速率（条/秒）。
// 调用方负责保证 times 按时间升序（乱序也能算，只是口径变成"窗口内总数/窗口"）。
export function ratePerSecond(times, now, windowMs) {
  const cutoff = now - windowMs;
  let n = 0;
  for (const t of times) if (t >= cutoff) n++;
  return n / (windowMs / 1000);
}

// ---------- 数值小工具 ----------

// clamp 把 x 限制在 [a,b] 内；不修改输入，NaN 会原样穿过（调用方保证输入有限）。
export function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

// smoothstep 在 [a,b] 上做平滑过渡（0→1，两端导数为 0）。
// 用于细节渐显、倾角插值等“不突变”的权重；a==b 时按 0/1 阶跃处理。
export function smoothstep(a, b, x) {
  if (a === b) return x < a ? 0 : 1;
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

// hash 由整数坐标与种子生成稳定的 [0,1) 值；用于示例内容分布，不是身份或密码。
// 同一 (x,y,s) 永远得到同一个值：缩放、返回或换设备都不会重新随机。
export function hash(x, y, s = 0) {
  let n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

// ---------- 潮汐群岛投影 ----------

// tidalTilt 返回当前镜头距离对应的倾角（弧度）。
// 远处接近俯视（0.36），靠近后逐渐抬高（最大约 0.74），让下降过程有俯仰变化。
// d 是相机到海平面的距离（世界单位）。
export function tidalTilt(d) {
  return 0.36 + 0.38 * (1 - smoothstep(460, 1150, d));
}

// projectCalc 把世界坐标投到屏幕（潮汐群岛透视）。
// view = { cx, cy, d, W, H, F }：cx/cy 是相机中心，d 是相机距离，F 是焦距（像素·世界单位）。
// z 是高出海面的高度，会同时改变屏幕位置和尺度（越高越靠近相机→越大）。
// 返回 {x, y, s, d}：屏幕坐标、像素尺度、该点的相机深度；
// 越过近裁剪（深度 < 45）时返回 null，调用方必须跳过而不是画到屏幕上。
export function projectCalc(view, x, y, z = 0) {
  const dx = x - view.cx, dy = y - view.cy;
  // 远处轻微下沉，模拟地球曲率，让海面在视口边缘自然弯下去。
  const h = z - (dx * dx + dy * dy) / 13500;
  const tilt = tidalTilt(view.d), si = Math.sin(tilt), co = Math.cos(tilt);
  const depth = view.d - dy * si - h * co;
  if (depth < 45) return null;
  const s = view.F / depth;
  return {
    x: view.W * 0.57 + dx * s,
    y: view.H * 0.55 + (dy * co - h * si) * s,
    s,
    d: depth,
  };
}

// unprojectCalc 把屏幕点反解为海平面（z=0）世界坐标，用于拖动锚定、滚轮锚定和光标上报。
// 采用 7 次牛顿迭代：投影含曲率与倾角，没有稳定闭式解；失败或退化时返回当前估计值。
// 返回值总是有限数——调用方不需要处理 null，但不能假定它一定在视口内。
export function unprojectCalc(view, sx, sy) {
  let x = view.cx + (sx - view.W * 0.57) * view.d / view.F;
  let y = view.cy + (sy - view.H * 0.55) * view.d / view.F;
  for (let i = 0; i < 7; i++) {
    const p = projectCalc(view, x, y, 0);
    const px = projectCalc(view, x + 1, y, 0);
    const py = projectCalc(view, x, y + 1, 0);
    if (!p || !px || !py) break;
    const ex = sx - p.x, ey = sy - p.y;
    const a = px.x - p.x, b = py.x - p.x;
    const c = px.y - p.y, d = py.y - p.y;
    const det = a * d - b * c;
    if (Math.abs(det) < 1e-5) break;
    // 单步修正有界：极端参数下不让迭代跳到世界之外
    x += clamp((ex * d - ey * b) / det, -2000, 2000);
    y += clamp((ey * a - ex * c) / det, -2000, 2000);
  }
  return { x, y };
}

// pointInQuad 判断屏幕点是否落在四边形内（射线法）。
// points 是顺时针或逆时针的 {x,y} 数组；用于纸页命中，不做任何容差。
export function pointInQuad(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

// ---------- 岛屿几何（纯函数，输入是岛参数对象） ----------

// islandBoundary 返回岸线的半径倍率：角度 a 处岸线相对平均半径的偏移。
// seed 决定这座岛的不规则形状；同 seed 永远同形状，镜头移动不会让岸线抖动。
export function islandBoundary(a, seed) {
  return 1 + 0.11 * Math.sin(3 * a + seed) + 0.065 * Math.cos(5 * a - seed * 0.3) + 0.04 * Math.sin(2 * a + seed);
}

// islandLocalToWorld 把岛屿局部坐标 (x,y,z) 转到世界坐标。
// 局部坐标不随镜头变化；rot 是岛屿自转角，z 原样带出（高度属于世界轴）。
export function islandLocalToWorld(isl, x, y, z = 0) {
  const c = Math.cos(isl.rot), sn = Math.sin(isl.rot);
  return { x: isl.x + x * c - y * sn, y: isl.y + x * sn + y * c, z };
}

// islandTerrainHeight 返回岛面在局部坐标 (x,y) 处的高度（世界单位，海平面为 0）。
// 岸边贴近海面、内侧隆起、再叠加一个小丘；同一坐标恒定，不随时间变化。
export function islandTerrainHeight(isl, x, y) {
  const a = Math.atan2(y / isl.sy, x);
  const r = Math.hypot(x, y / isl.sy) / (isl.r * islandBoundary(a, isl.seed));
  return 5 + 57 * Math.pow(Math.max(0, 1 - r * r), 1.6) +
    20 * Math.exp(-(((x + 55) ** 2) / 8500 + ((y + 40) ** 2) / 3300));
}

// islandContains 判断世界点是否落在岛的岸线包围内（含岸边浅滩）。
// 用椭圆归一化距离 ≤1.15 近似：1.15 覆盖岸线外侧的浅水，避免“看着在岛上却点不到”。
export function islandContains(isl, x, y) {
  const d = Math.hypot((x - isl.x) / isl.r, (y - isl.y) / (isl.r * isl.sy));
  return d <= 1.15;
}

// resolveIsland 返回世界坐标命中的岛 id（都不命中返回 null）。
// 多岛同时命中时取归一化距离最近的一座，保证归属判定唯一。
export function resolveIsland(islands, x, y) {
  let best = null, bestD = Infinity;
  for (const isl of islands) {
    const d = Math.hypot((x - isl.x) / isl.r, (y - isl.y) / (isl.r * isl.sy));
    if (d <= 1.15 && d < bestD) { bestD = d; best = isl.id; }
  }
  return best;
}
