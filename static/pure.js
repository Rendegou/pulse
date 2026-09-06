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
