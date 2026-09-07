// i18n.js — 界面文案字典与格式化。
// 规则（docs/08 §7）：两种语言 key 集合必须一致；缺 key 回退到中文原文；
// 协议字段（type/eventId/Session ID）不翻译；切换语言时已显示的内容一起重绘。

const zh = {
  spaceName: "我的书房",
  connecting: "连接中…",
  connected: "已连接",
  reconnecting: "重连中…",
  statusOpen: "运行状态",
  statusClose: "收起状态",
  theme: "主题",
  themeSystem: "跟随系统",
  themeLight: "明亮",
  themeDark: "深色",
  language: "语言",
  online: "{n} 在线",
  youHint: "你是 {id} · 移动鼠标或点击画布——在线的人都会看到",
  sensorLive: "主机感知 在线",
  sensorOffline: "主机感知 离线",
  viewSystem: "全部",
  viewPresence: "访客",
  viewHost: "主机雷达",
  legendYou: "你（光环）",
  legendRemote: "其他真实连接",
  legendPulse: "点击脉冲",
  legendHost: "主机事件（实线=live）",
  legendFixture: "fixture（虚线=演示注入）",
  portsLive: "端口 · 实时",
  feedTitle: "事件流",
  mOnline: "在线连接",
  mHostRate: "主机事件",
  mHeap: "Go 堆内存",
  mSys: "Go 向系统申请",
  mDropped: "慢消费丢弃",
  evJoin: "进入了房间",
  evLeave: "离开了房间",
  evPulse: "在 ({x}, {y}) 点了一下",
  evHost: "→ :{port} · {kind}",
  evFixtureSuffix: " · 演示",
  roomEmpty: "书架上还没有文章",
  place: "无界原野",
  sub: "掠过地表，在某一盏灯旁停下来。",
  hint: "拖动地表 · 滚轮靠近 · 点击房子下降",
  inHint: "点击桌上的书阅读 · 返回上空继续漫游",
  demo: "示例房屋 · 真实访客",
  enter: "向下进入",
  cancel: "取消",
  back: "↑ 回到上空",
  home: "归处",
  help: "玩法",
  helpTitle: "从上空，到一本书",
  helpCopy: "拖动像转动脚下的巨大地表，滚轮或双指缩放。点击一间房子，再选择“向下进入”，相机会连续靠近，屋顶淡去。方向键漫游、+ / − 缩放、Esc 返回。",
  limits: "世界按坐标生成，房屋是示例；访客是真实连接。地表没有可见球体边缘，缩放有数值保护。相同地点字符串会回到相同位置。",
  address: "输入一个地点，去那里",
  addressLabel: "地点字符串",
  houseDesc: "示例空间，有三篇可阅读的短文。",
  insideDesc: "屋顶已打开。桌上的书就是文章。",
  go: "前往",
  zoomIn: "放大",
  zoomOut: "缩小",
  zoomLimit: "已到当前细节尺度，仍可向任意方向漫游。",
  near: "附近的空间",
  articleSource: "示例文章 · 非真实博客导入",
  close: "关闭",
  statusOpen: "状态",
  you: "你",
  worldLabel: "可拖动缩放的粒子世界；亦可用方向键漫游，通过附近空间按钮进入房子",
  themeFollowSystem: "明暗跟随系统",
  houseNames: ["你的原点", "雨后的书屋", "远山来信", "风停的地方", "一页之间", "晚灯", "白露", "溪边札记"],
};

const en = {
  spaceName: "My Study",
  connecting: "CONNECTING…",
  connected: "CONNECTED",
  reconnecting: "RECONNECTING…",
  statusOpen: "Runtime",
  statusClose: "Close",
  theme: "Theme",
  themeSystem: "System",
  themeLight: "Light",
  themeDark: "Dark",
  language: "Language",
  online: "{n} online",
  youHint: "You are {id} · move or click — everyone online sees it",
  sensorLive: "HOST LIVE",
  sensorOffline: "SENSOR OFFLINE",
  viewSystem: "System",
  viewPresence: "Presence",
  viewHost: "Host Radar",
  legendYou: "You (ringed)",
  legendRemote: "Other live connections",
  legendPulse: "Click pulse",
  legendHost: "Host event (solid = live)",
  legendFixture: "Fixture (dashed = demo)",
  portsLive: "PORTS · LIVE",
  feedTitle: "EVENT STREAM",
  mOnline: "Online",
  mHostRate: "Host events",
  mHeap: "Go heap",
  mSys: "Go sys",
  mDropped: "Dropped",
  evJoin: "entered the room",
  evLeave: "left the room",
  evPulse: "clicked at ({x}, {y})",
  evHost: "→ :{port} · {kind}",
  evFixtureSuffix: " · fixture",
  roomEmpty: "No articles on the shelf yet",
  place: "Open terrain",
  sub: "Glide above the surface. Find a place to stay.",
  hint: "Drag to explore · Scroll to approach · Select a house",
  inHint: "Select a book to read · Return above to explore",
  demo: "Sample houses · Real visitors",
  enter: "Descend",
  cancel: "Dismiss",
  back: "↑ Return above",
  home: "Origin",
  help: "Guide",
  helpTitle: "From the sky to a book",
  helpCopy: "Drag to move across a vast curved surface. Scroll or pinch to zoom. Select a house and choose Descend: the camera approaches continuously as its roof fades. Arrow keys pan, + / − zoom and Esc returns.",
  limits: "The world is generated from coordinates; houses are samples. Visitors are real connections. No visible planet edge; zoom has numeric bounds. The same place string maps to the same location.",
  address: "A word, a place to go",
  addressLabel: "Place string",
  houseDesc: "A sample space with three short articles.",
  insideDesc: "The roof is open. Each book holds an article.",
  go: "Go",
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  zoomLimit: "Detail limit reached. You can still roam in any direction.",
  near: "Nearby places",
  articleSource: "Sample article · Not imported from a blog",
  close: "Close",
  statusOpen: "Runtime",
  you: "you",
  worldLabel: "Draggable, zoomable particle world; arrow keys roam, nearby places enter houses",
  themeFollowSystem: "Follow system theme",
  houseNames: ["Your origin", "After the rain", "Letters from afar", "Still air", "Between pages", "Evening light", "Dew", "River notes"],
};

const dicts = { "zh-CN": zh, en };

// 启动时校验两份字典 key 集合一致（开发期防漏翻）。
for (const k of Object.keys(zh)) {
  if (!(k in en)) console.warn(`i18n 字典缺 en key: ${k}`);
}
for (const k of Object.keys(en)) {
  if (!(k in zh)) console.warn(`i18n 字典缺 zh key: ${k}`);
}

// tArr 取数组型文案（如房屋名列表）；缺 key 回退中文，再退空数组。
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
