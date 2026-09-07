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
};

const dicts = { "zh-CN": zh, en };

// 启动时校验两份字典 key 集合一致（开发期防漏翻）。
for (const k of Object.keys(zh)) {
  if (!(k in en)) console.warn(`i18n 字典缺 en key: ${k}`);
}
for (const k of Object.keys(en)) {
  if (!(k in zh)) console.warn(`i18n 字典缺 zh key: ${k}`);
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
