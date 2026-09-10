// RENDER_DELAY 是渲染比实时慢的毫秒数（20Hz 更新间隔 50ms + 抖动余量）。
const RENDER_DELAY = 120;

// samplePosition 在世界坐标上插值：从缓冲找夹住渲染时刻的相邻两点做 Hermite。
// s.buf 是按到达时刻排序的 {t, x, y} 队列（世界坐标，t 是本机接收时钟）。
export function samplePosition(s, renderT) {
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

