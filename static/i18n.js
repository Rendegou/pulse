// i18n.js — 界面文案字典与格式化。
// 规则：两种语言 key 集合必须一致（启动时校验）；缺 key 回退到中文原文；
// 协议字段（type/eventId/Session ID）不翻译；切换语言时已显示的内容一起重绘。
// 数组型文案（helpCopy）由 app.js 逐段渲染成 <p>，不拼 HTML。

const zh = {
  edition: "潮汐之间",
  eyebrow: "海上手记",
  headline: "潮汐之间",
  description: "让岛屿相隔远一点，\n让一个念头，有停留的地方。",
  approach: "走近我的岛",
  back: "回到海上",
  nearby: "海的另一边",
  offline: "离线预览",
  demo: "示例岛屿 · 真实访客",
  hint: "拖动漫游 · 滚轮靠近 · 点击岛屿",
  nearHint: "点开一页文字 · 向后滚动回到海上",
  nearDesc: "潮声很轻。\n这里有一篇短文，读一会儿。",
  articles: "一篇文章",
  read: "打开阅读 ↗",
  sample: "示例短文",
  minutes: "分钟",
  next: "下一篇",
  end: "写在这里，也留在这里。",
  help: "玩法",
  helpTitle: "在潮汐之间漫游",
  helpCopy: [
    "拖动海面探索，滚轮或双指缩放。点一座岛，镜头会连续下降；靠近后，点纸页或标题阅读。",
    "方向键可移动，＋ / − 可缩放，Esc 回到海上。右上角可切换明暗与语言；语言切换只影响界面与示例文章。",
    "别人的光标是真实连接：位置来自服务端广播，不是演示动画。岛屿与文章是示例内容，没有连接真实博客。",
  ],
  limits: "减少动态的系统设置会暂停海浪并关闭镜头缓动。",
  home: "归处",
  statusOpen: "状态",
  themeSystem: "跟随系统",
  themeLight: "浅色",
  themeDark: "深色",
  themeFollowSystem: "明暗跟随系统",
  language: "语言",
  connecting: "连接中…",
  connected: "已连接",
  reconnecting: "重连中…",
  sensorLive: "主机感知 在线",
  sensorOffline: "主机感知 离线",
  portsLive: "端口 · 实时",
  feedTitle: "事件流",
  evJoin: "进入了世界",
  evLeave: "离开了世界",
  evPulse: "在 ({x}, {y}) 点了一下",
  evHost: "→ :{port} · {kind}",
  evFixtureSuffix: " · 演示",
  articleSource: "示例短文 · 非真实博客导入",
  address: "输入一个地点，去那里",
  addressLabel: "地点字符串",
  go: "前往",
  zoomIn: "靠近",
  zoomOut: "拉远",
  zoomLimit: "已经到最近处，仍可向任意方向漫游。",
  worldLabel: "粒子群岛；拖动探索、滚轮靠近，也可用附近岛屿按钮进入。",
  you: "你",
  // 岛名与文章标签是示例内容，与 islands.js / articles.js 的索引一一对应。
  islandNames: ["你的原点", "雨后手记", "远山来信"],
  articleTags: ["随笔", "观察", "生活"],
};

const en = {
  edition: "BETWEEN TIDES",
  eyebrow: "NOTES AT SEA",
  headline: "Between tides",
  description: "A little more space between islands.\nA place for a thought to stay.",
  approach: "Approach my island",
  back: "Back to the sea",
  nearby: "ACROSS THE WATER",
  offline: "Offline preview",
  demo: "Sample islands · Real visitors",
  hint: "Drag to wander · Scroll to approach · Select an island",
  nearHint: "Open a story · Scroll back to the sea",
  nearDesc: "The tide is quiet here.\nOne short story, if you have a moment.",
  articles: "one story",
  read: "Open the story ↗",
  sample: "Sample story",
  minutes: "min",
  next: "Next story",
  end: "Written here, and left here.",
  help: "Guide",
  helpTitle: "Wandering between tides",
  helpCopy: [
    "Drag the water to explore, scroll or pinch to zoom. Select an island and the camera descends; close up, open a page or its label to read.",
    "Arrow keys pan, + / − zoom, Esc returns to the sea. The top right switches theme and language; language only affects the interface and the sample stories.",
    "Other pointers are real connections: their positions arrive over the server, not from a demo animation. Islands and stories are sample content; no real blog is connected.",
  ],
  limits: "The system's reduced-motion setting pauses the waves and disables camera easing.",
  home: "Home",
  statusOpen: "Runtime",
  themeSystem: "System",
  themeLight: "Light",
  themeDark: "Dark",
  themeFollowSystem: "Follow system theme",
  language: "Language",
  connecting: "CONNECTING…",
  connected: "CONNECTED",
  reconnecting: "RECONNECTING…",
  sensorLive: "HOST LIVE",
  sensorOffline: "SENSOR OFFLINE",
  portsLive: "PORTS · LIVE",
  feedTitle: "EVENT STREAM",
  evJoin: "entered the world",
  evLeave: "left the world",
  evPulse: "clicked at ({x}, {y})",
  evHost: "→ :{port} · {kind}",
  evFixtureSuffix: " · fixture",
  articleSource: "Sample story · Not imported from a blog",
  address: "A word, a place to go",
  addressLabel: "Place string",
  go: "Go",
  zoomIn: "Approach",
  zoomOut: "Zoom out",
  zoomLimit: "Closest view reached. You can still roam in any direction.",
  worldLabel: "Particle islands; drag to explore, scroll to approach, or use the nearby island buttons.",
  you: "you",
  islandNames: ["Your origin", "After the rain", "Letters from afar"],
  articleTags: ["notes", "observation", "living"],
};

const dicts = { "zh-CN": zh, en };

// 启动时校验两份字典 key 集合一致（开发期防漏翻）。
for (const k of Object.keys(zh)) {
  if (!(k in en)) console.warn(`i18n 字典缺 en key: ${k}`);
}
for (const k of Object.keys(en)) {
  if (!(k in zh)) console.warn(`i18n 字典缺 zh key: ${k}`);
}

// tArr 取数组型文案（岛名、帮助段落、文章标签）；缺 key 回退中文，再退空数组。
export function tArr(lang, key) {
  return (dicts[lang] && dicts[lang][key]) ?? zh[key] ?? [];
}

// t 按当前语言取文案并做 {占位} 插值；缺 key 回退中文，再没有就回退 key 本身。
export function t(lang, key, vars) {
  let s = (dicts[lang] && dicts[lang][key]) ?? zh[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}
