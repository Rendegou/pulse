// 1. 线性插值：t∈[0,1] 时在 a、b 之间取值
function lerp(a, b, t) {
  return a + (b - a) * t;
}

// 2. 在按时间升序的样本队列里，求 renderT 时刻的值
//    入参: buf = [{t, x}, ...]（按 t 升序），renderT = 数
//    返回: 一个数
//    边界自己定，但要定死: 空队列、renderT 早于第一点、晚于最后点
//    修正记录（闭卷第一版 → 测试后）:
//      - 钳制分支误返回 {x,y} 对象（从 samplePosition 带出来的肌肉记忆），统一为数值
//      - renderT 恰好等于最后一点的 t 时漏分支（用 <= 兜底）
//      - 空队列从裸 undefined 改为显式 null, 与"返回数值"的契约写明
function sampleAt(buf, renderT) {
  if (buf.length === 0) {
    return null; // 契约：空队列返回 null（不是数值，调用方需判断）
  }
  if (renderT <= buf[0].t) {
    return buf[0].x; // 早于等于第一点：钳到第一点
  }
  if (renderT >= buf[buf.length - 1].t) {
    return buf[buf.length - 1].x; // 晚于等于最后点：钳到最后点
  }
  for (let i = 0; i < buf.length - 1; i++) {
    if (renderT >= buf[i].t && renderT < buf[i + 1].t) {
      return lerp(
        buf[i].x,
        buf[i + 1].x,
        (renderT - buf[i].t) / (buf[i + 1].t - buf[i].t),
      );
    }
  }
  return buf[buf.length - 1].x; // 逻辑上到不了（边界已被上面吃掉），兜底
}
