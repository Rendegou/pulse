// i18n.js — 界面文案字典与格式化。
// 规则：两种语言 key 集合必须一致（启动时校验）；缺 key 回退到中文原文；
// 协议字段（type/eventId/Session ID）不翻译；切换语言时已显示的内容一起重绘。
// 数组型文案（helpCopy、careStage）由 app.js 逐项渲染，不拼 HTML。

const zh = {
  edition: "来过，便有回响",
  eyebrow: "海上手记",
  headline: "留一片绿意",
  description: "这是你在海上的一小块地方。\n有人来过，便多一点生机。",
  approach: "靠近这株植物",
  back: "回到海上",
  nearby: "去海的另一边",
  offline: "离线预览",
  demo: "示例岛屿 · 真实访客",
  hint: "拖动漫游 · 滚轮靠近 · 点一座岛",
  nearHint: "给植物浇一捧水 · 向后滚动回到海上",
  nearDesc: "给相遇一点回应。\n为岛上的植物浇一捧水。",
  // 照料面板与植物标签
  water: "浇一点水",
  waiting: "水正在落下…",
  careDetail: "点植物也可以浇水 · 不会枯萎，不用打卡",
  careLabel: "照料植物",
  plantMeta: "岛上植物",
  readMore: "点这里也可以",
  careStage: ["一株植物，等一捧水。", "叶片舒展开了。", "它长出了一个花苞。", "这朵花，记得来过的人。"],
  lastCared: "最近照料：",
  lastNone: "还没有照料记录",
  lastWatered: "浇过水",
  you: "你",
  guest: "访客",
  visit: "打开访客窗口",
  together: "两个人的水，落在同一株植物上。",
  thanks: "水落下了，叶片轻轻回应。",
  remoteWatered: "也浇了一捧水。",
  arrival: "有人来到这片海上",
  waterUnconfirmed: "这次浇水未确认，请稍后重试",
  onlineOne: "此刻，只有你在这里",
  onlineMany: " 个窗口在同一片海上",
  help: "玩法",
  helpTitle: "在潮汐之间做一件小事",
  helpCopy: [
    "拖动海面探索，滚轮或双指缩放。点一座岛，镜头会连续下降；靠近后点植物或“浇一点水”。",
    "水落下，叶片舒展；第二次出现花苞，第三次开花。之后仍会回应，不会枯萎，也不需要每日打卡。",
    "“打开访客窗口”会打开一个真实的新连接：把两个窗口并排，移动鼠标、分别浇水，就能看到彼此的指针和同一株植物的变化。",
  ],
  limits: "减少动态的系统设置会暂停海浪，浇水反馈改为静态变化。",
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
  evJoin: "来到了这片海上",
  evLeave: "离开了这片海上",
  evPulse: "在 ({x}, {y}) 点了一下",
  evWater: "给{plant}浇了水",
  evHost: "→ :{port} · {kind}",
  evFixtureSuffix: " · 演示",
  address: "输入一个地点，去那里",
  addressLabel: "地点字符串",
  go: "前往",
  zoomIn: "靠近",
  zoomOut: "拉远",
  zoomLimit: "已经到最近处，仍可向任意方向漫游。",
  worldLabel: "粒子群岛；拖动探索、滚轮靠近，靠近后可给岛上的植物浇水。",
  // 岛名与植物标签是示例内容，与 islands.js 的三座岛一一对应。
  islandNames: ["你的原点", "雨后的花园", "远山的庭院"],
};

const en = {
  edition: "A SMALL SHARED MOMENT",
  eyebrow: "NOTES AT SEA",
  headline: "A little green",
  description: "A small place of your own at sea.\nA little more alive after each visit.",
  approach: "Approach the plant",
  back: "Back to the sea",
  nearby: "Across the water",
  offline: "Offline preview",
  demo: "Sample islands · Real visitors",
  hint: "Drag to wander · Scroll to approach · Select an island",
  nearHint: "Give the plant some water · Scroll back to the sea",
  nearDesc: "Give an encounter a small reply.\nA handful of water is enough.",
  water: "Give some water",
  waiting: "Let the water settle…",
  careDetail: "Select the plant to water · No wilting, no daily chores",
  careLabel: "Care for the plant",
  plantMeta: "The plant here",
  readMore: "Or select it here",
  careStage: ["A plant. A little water.", "The leaves unfurl.", "A small bud has appeared.", "A flower that remembers a visit."],
  lastCared: "Last cared for by ",
  lastNone: "No visits recorded yet",
  lastWatered: "watered this plant",
  you: "you",
  guest: "visitor",
  visit: "Open a visitor window",
  together: "Two visitors. One little plant.",
  thanks: "A little water. A gentle reply.",
  remoteWatered: "gave some water too.",
  arrival: "Someone has arrived",
  waterUnconfirmed: "Watering was not confirmed. Please try again.",
  onlineOne: "Just you, for now",
  onlineMany: " windows on the same sea",
  help: "Guide",
  helpTitle: "A small thing to do between tides",
  helpCopy: [
    "Drag the water to explore, scroll or pinch to zoom. Select an island and the camera descends; close up, select the plant or Give some water.",
    "The water falls and the leaves unfurl; a bud appears on the second visit and a flower on the third. It never wilts and needs no daily chores.",
    "Open a visitor window creates a real second connection. Place the windows side by side to see each cursor and water the same plant.",
  ],
  limits: "The system's reduced-motion setting pauses the waves and keeps watering feedback still.",
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
  evJoin: "arrived on this sea",
  evLeave: "left this sea",
  evPulse: "clicked at ({x}, {y})",
  evWater: "watered {plant}",
  evHost: "→ :{port} · {kind}",
  evFixtureSuffix: " · fixture",
  address: "A word, a place to go",
  addressLabel: "Place string",
  go: "Go",
  zoomIn: "Approach",
  zoomOut: "Zoom out",
  zoomLimit: "Closest view reached. You can still roam in any direction.",
  worldLabel: "Particle islands; drag to explore, scroll to approach, then water the plant on an island.",
  islandNames: ["Your origin", "The rain garden", "A distant courtyard"],
};

const dicts = { "zh-CN": zh, en };

// 启动时校验两份字典 key 集合一致（开发期防漏翻）。
for (const k of Object.keys(zh)) {
  if (!(k in en)) console.warn(`i18n 字典缺 en key: ${k}`);
}
for (const k of Object.keys(en)) {
  if (!(k in zh)) console.warn(`i18n 字典缺 zh key: ${k}`);
}

// tArr 取数组型文案（岛名、帮助段落、生长阶段）；缺 key 回退中文，再退空数组。
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
