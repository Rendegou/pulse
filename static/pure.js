// pure.js — 纯函数模块：不读 DOM、不读时钟、不改外部状态。
// 只有这里的函数能被 node --test 脱离浏览器直接测。
// 注意：本文件会被 go:embed 进二进制并由浏览器加载，保持零依赖、无副作用。

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

// ---------- 世界投影（纯函数，可单测） ----------

// projectCalc 把世界坐标投影到屏幕。局部曲面近似：中心平展、四周压缩。
// view = { cx, cy, zoom, W, H }；R 始终大于可见半径，边界落在视口外。
// z 是物件相对地表的高度（世界单位）。
export function projectCalc(view, x, y, z = 0) {
  const R = Math.hypot(view.W, view.H) * 0.78;
  const u = (x - view.cx) * view.zoom,
    v = (y - view.cy) * view.zoom;
  const q = Math.sqrt(1 + (u * u + v * v) / (R * R));
  return {
    x: view.W * 0.5 + u / q,
    y: view.H * 0.53 + (v / q) * 0.82 - z * view.zoom * 0.62,
    scale: view.zoom / q,
  };
}

// unprojectCalc 是 projectCalc(z=0) 的逆变换：把地表屏幕点反解为世界坐标。
// 拖动锚定和光标缩放依赖这个互逆关系。
export function unprojectCalc(view, x, y) {
  const R = Math.hypot(view.W, view.H) * 0.78;
  const u = x - view.W * 0.5,
    v = (y - view.H * 0.53) / 0.82;
  const q = Math.sqrt(Math.max(0.05, 1 - (u * u + v * v) / (R * R)));
  return { x: view.cx + u / (view.zoom * q), y: view.cy + v / (view.zoom * q) };
}
