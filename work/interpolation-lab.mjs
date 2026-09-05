// 实验：复现"新点到达导致正在播放的轨迹被改写"（外加一个过冲观察）
// 用法：在项目根目录执行  node work/interpolation-lab.mjs
//
// 这个文件复刻 static/app.js 里 samplePosition 的核心分支，
// 不改主程序——实验在练习区进行，结论再决定是否回迁。

// lerp 线性插值：t∈[0,1] 时在 a、b 之间按比例取值。
function lerp(a, b, t) {
  return a + (b - a) * t;
}

// catmullRom 用四个连续采样点计算 t∈[0,1] 处的平滑曲线值（只管一维）。
// 与主程序 static/app.js 中的实现保持一致，改公式要两边同步。
function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t,
    t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

// sampleAt 复刻 samplePosition 的分支逻辑：在按时间升序的样本 buf 里找到
// 夹住 renderT 的相邻两点；四个邻居齐用样条，缺邻居退回直线。
// 返回 { x, mode }：mode 标明这次走了哪个分支——分支切换正是本实验的主角。
function sampleAt(buf, renderT) {
  if (buf.length === 0) return { x: null, mode: "empty" };
  const last = buf[buf.length - 1];
  if (renderT >= last.t) return { x: last.x, mode: "clamp-last" };
  const first = buf[0];
  if (renderT <= first.t) return { x: first.x, mode: "clamp-first" };

  for (let i = 0; i < buf.length - 1; i++) {
    const a = buf[i],
      b = buf[i + 1];
    if (a.t <= renderT && renderT <= b.t) {
      const k = (renderT - a.t) / (b.t - a.t);
      const p0 = buf[i - 1],
        p3 = buf[i + 2];
      if (p0 && p3) {
        return { x: catmullRom(p0.x, a.x, b.x, p3.x, k), mode: "spline" };
      }
      return { x: lerp(a.x, b.x, k), mode: "lerp(缺邻居)" };
    }
  }
  return { x: last.x, mode: "fallback" };
}

// getSpeed 用前后两点的位移÷时间差估算运动速度（单位：归一化坐标/毫秒）。
// 注意：两点 t 相同时会除零返回 Infinity，调用方需保证时间戳不重复。
function getSpeed(p1, p2) {
  const { x: x0, t: t0 } = p1;
  const { x: x1, t: t1 } = p2;
  return (x1 - x0) / (t1 - t0);
}
// ---------- 实验 A：新点到达，renderT=75 的位置会不会变？ ----------

const renderT = 75;
const threePoints = [
  { t: 0, x: 0 },
  { t: 50, x: 0.4 },
  { t: 100, x: 0.6 },
];
const fourPoints = [...threePoints, { t: 150, x: 0.2 }]; // 只追加"未来"的点

const before = sampleAt(threePoints, renderT);
const after = sampleAt(fourPoints, renderT);

console.log("=== 实验 A：同一个渲染时刻，追加后续采样点 ===");
console.log(
  `三点缓冲:  x = ${before.x.toFixed(3)}  (走了 ${before.mode} 分支)`,
);
console.log(`四点缓冲:  x = ${after.x.toFixed(3)}  (走了 ${after.mode} 分支)`);
console.log(
  `差值: ${(after.x - before.x).toFixed(3)} —— 渲染时刻没变、旧点没变，位置变了`,
);
console.log(
  "若画布宽 1000px，相当于同一个点在两版计算里相差",
  Math.round((after.x - before.x) * 1000),
  "px",
);

// ---------- 实验 B：样条会不会越过采样范围？ ----------

// 输入 0 → 1 → 1 → 0（先升、持平、再降），看中间算出的最大值
const overshoot = catmullRom(0, 1, 1, 0, 0.5);
console.log("\n=== 实验 B：过冲观察 ===");
console.log(`输入范围 [0, 1]，中点 t=0.5 算出: ${overshoot.toFixed(3)}`);
console.log(overshoot > 1 ? "越界了：曲线冲过了输入的最大值" : "没有越界");

// ---------- Hermite 方案：带速度、时间感知、防过冲 ----------

// hermite 用两端点的位置和切线做三次插值（只管一维）。
// a、b 是两端位置；ma、mb 是两端切线×段长（即段内位移量纲）；s∈[0,1] 是段内进度。
// 四个基函数分别控制：a 的位置权重、a 的切线权重、b 的位置权重、b 的切线权重。
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

// tangentAt 估算 buf[idx] 这一点的时间感知切线（坐标/毫秒）：
// 取前后邻居的割线斜率；转折或停滞处（相邻两段方向不一致）取 0 防过冲。
// 缓冲头尾缺邻居时返回 0，等价于"从静止出发 / 平滑停下"。
function tangentAt(buf, idx) {
  const prev = buf[idx - 1],
    next = buf[idx + 1];
  if (!prev || !next) return 0;
  const dPrev = buf[idx].x - prev.x; // 前一段的方向
  const dNext = next.x - buf[idx].x; // 后一段的方向
  if (dPrev * dNext <= 0) return 0; // 转折点（含持平）：先停再走
  return (next.x - prev.x) / (next.t - prev.t);
}

// sampleAtHermite 与 sampleAt 同样的段落定位，但段内用 Hermite：
// 端点切线由时间差估出，相邻段因此共享一致的交界速度，转弯处不越界。
function sampleAtHermite(buf, renderT) {
  if (buf.length === 0) return { x: null, mode: "empty" };
  const last = buf[buf.length - 1];
  if (renderT >= last.t) return { x: last.x, mode: "clamp-last" };
  const first = buf[0];
  if (renderT <= first.t) return { x: first.x, mode: "clamp-first" };

  for (let i = 0; i < buf.length - 1; i++) {
    const a = buf[i],
      b = buf[i + 1];
    if (a.t <= renderT && renderT <= b.t) {
      const s = (renderT - a.t) / (b.t - a.t);
      const span = b.t - a.t; // 切线×段长 = 段内位移，喂给 hermite
      const x = hermite(
        a.x,
        b.x,
        tangentAt(buf, i) * span,
        tangentAt(buf, i + 1) * span,
        s,
      );
      return { x, mode: "hermite" };
    }
  }
  return { x: last.x, mode: "fallback" };
}

// ---------- 实验 C：Hermite 还会过冲吗？ ----------

// 输入 (0,0)→(50,1)→(100,1)→(150,0)：升、持平、降。
// 样条会冲到 1.125；Hermite 的转折规则在 (50,1) 和 (100,1) 两处把切线归零。
const hill = [
  { t: 0, x: 0 },
  { t: 50, x: 1 },
  { t: 100, x: 1 },
  { t: 150, x: 0 },
];
const hMid = sampleAtHermite(hill, 75);
console.log("\n=== 实验 C：Hermite 过冲检查 ===");
console.log(
  `山顶段中点: x = ${hMid.x.toFixed(3)}（输入最大 1，样条在这里算出 1.125）`,
);
console.log(hMid.x <= 1 ? "没有越界 ✓" : "越界了 ✗");

// ---------- 实验 A′：Hermite 会不会改写历史？ ----------

const hBefore = sampleAtHermite(threePoints, renderT);
const hAfter = sampleAtHermite(fourPoints, renderT);
console.log("\n=== 实验 A′：同一个 renderT=75，Hermite 前后对比 ===");
console.log(`三点缓冲:  x = ${hBefore.x.toFixed(4)}`);
console.log(`四点缓冲:  x = ${hAfter.x.toFixed(4)}`);
console.log(
  `差值: ${Math.abs(hAfter.x - hBefore.x).toFixed(4)}（样条当年差 0.050）`,
);
console.log("注：本例未来点是急转弯，转折规则把 mb 归零所以恰好不变；");
console.log(
  '若未来点延续原方向，mb 仍会更新——彻底解法是"段落播放后冻结"，留作下一步。',
);
