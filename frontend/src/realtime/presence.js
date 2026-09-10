import { samplePosition } from './interpolation.js';
import { t } from '../ui/i18n.js';
const RENDER_DELAY = 120;
// createPresence 持有每帧渲染数据；这些 Map/缓冲不交给 Vue 深度代理。主题颜色仅切换时更新。
export function createPresence(state, pulses, getLang) {
let colors = { gold: '#d7b38c', foam: '#9eccc3', bg: '#091c20' };
// presenceOverlay 每帧把真实访客和脉冲画进世界（world.js 的渲染循环调用）。
// 自己的指针就是系统光标（不遮、不重画）；这里只画别人的指针，位置在世界坐标上插值，
// 再用我自己的相机投影——两端相机不同也指向同一处地表。
function presenceOverlay(ctx, now, helpers) {
  const lang = getLang();
  for (const [id, s] of state.sessions) {
    if (s.deadAt && now - s.deadAt >= 600) { state.sessions.delete(id); continue; }
    if (id === state.you) continue; // 自己的指针交给系统光标，避免两个箭头互相打架
    const p = samplePosition(s, now - RENDER_DELAY);
    const sp = helpers.project(p.x, p.y, s.z || 0);
    if (!sp || sp.x < 0 || sp.x > helpers.W || sp.y < 0 || sp.y > helpers.H) continue;
    // 平滑：远端包是离散的，用指数插值让指针走起来像有人真的在移动
    s.shown = s.shown || { x: p.x, y: p.y, z: s.z || 0 };
    s.shown.x += (p.x - s.shown.x) * 0.3;
    s.shown.y += (p.y - s.shown.y) * 0.3;
    s.shown.z += ((s.z || 0) - s.shown.z) * 0.3;
    const q = helpers.project(s.shown.x, s.shown.y, s.shown.z);
    if (!q) continue;

    let alpha = 1;
    if (s.deadAt) {
      const life = (now - s.deadAt) / 600;
      if (life >= 1) {
        state.sessions.delete(id);
        continue;
      }
      alpha = 1 - life;
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(q.x, q.y);
    ctx.strokeStyle = paletteFoam();
    ctx.fillStyle = paletteBg();
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(5, 16);
    ctx.lineTo(9, 10);
    ctx.lineTo(16, 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = paletteFoam();
    ctx.font = '11px "Segoe UI","Microsoft YaHei",sans-serif';
    ctx.textAlign = "left";
    ctx.fillText(`${t(lang, "guest")} ${id}`, 19, 18);
    ctx.restore();
  }

  // 脉冲环：世界坐标投影到海面，600ms 生灭
  for (let i = pulses.length - 1; i >= 0; i--) {
    const life = (now - pulses[i].bornAt) / 600;
    if (life >= 1) {
      pulses.splice(i, 1);
      continue;
    }
    const sp = helpers.project(pulses[i].wx, pulses[i].wy);
    if (!sp) continue;
    ctx.globalAlpha = (1 - life) * 0.8;
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, (6 + life * 46) * clampScale(sp.s), 0, Math.PI * 2);
    ctx.strokeStyle = pulses[i].mine ? paletteAccent() : paletteFoam();
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

// clampScale 把投影尺度限制在合理范围，避免贴近镜头时脉冲环铺满整屏。
function clampScale(s) {
  return Math.max(0.25, Math.min(3, s || 1));
}

// paletteAccent 读取当前主题的强调色（脉冲与“你”的指针共用）。
function paletteAccent() { return colors.gold; }

// paletteFoam 读取当前主题的浪沫色（别人的指针用它，和岛屿材质同一套颜色）。
function paletteFoam() { return colors.foam; }

// paletteBg 读取当前主题的背景色（指针箭头的填充色，避免半透明箭头糊在画面上）。
function paletteBg() { return colors.bg; }

// overlayActive 报告实时层是否还有活动：有存活脉冲或远端访客时需要继续出帧。
// world.js 用它决定是否保持动画循环；没有活动时页面静止、CPU 让出去。
function overlayActive() {
  if (pulses.length) return true;
  for (const [id] of state.sessions) {
    if (id !== state.you) return true;
  }
  return false;
}


// setColors 接收主题缓存，避免每个访客每帧读取计算样式。
function setColors(next) { colors = next; }
return { draw: presenceOverlay, active: overlayActive, setColors };
}
