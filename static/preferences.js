// preferences.js — 主题与语言偏好：读取、持久化、订阅。
// 规则（docs/08 §6-7）：
// - 主题偏好为 system|light|dark；实际生效为 light|dark；跟随系统时监听系统变化
// - 手动选择覆盖系统；可以随时恢复"跟随系统"
// - localStorage 读写都捕获异常：存储失败时本页内偏好仍然生效
// - 首屏防闪由 index.html 的内联脚本负责（绘制前设置 data-theme）

const THEME_KEY = "pulse.theme";
const LANG_KEY = "pulse.lang";

// 主题状态：preference 是用户选择（含 system），resolved 是实际生效值
let theme = "system";
let resolvedTheme = "light";
let lang = "zh-CN";
const listeners = new Set();

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

// resolveTheme 把用户偏好换算成实际生效主题。
function resolveTheme(pref) {
  if (pref === "dark") return "dark";
  if (pref === "light") return "light";
  return darkQuery.matches ? "dark" : "light";
}

// apply 把当前偏好写到 DOM（data-theme + color-scheme）并通知订阅者。
function apply() {
  resolvedTheme = resolveTheme(theme);
  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.style.colorScheme = resolvedTheme;
  document.documentElement.lang = lang;
  for (const fn of listeners) fn({ theme, resolvedTheme, lang });
}

// 系统主题变化时跟随——仅在偏好为 system 时生效（手动选择不被系统覆盖）。
darkQuery.addEventListener("change", () => {
  if (theme === "system") apply();
});

// initPreferences 从 localStorage 读取偏好并应用。必须在首屏绘制前由
// 内联脚本完成首次应用，这里是 module 环境的正式初始化。
export function initPreferences() {
  try {
    theme = localStorage.getItem(THEME_KEY) || "system";
    lang = localStorage.getItem(LANG_KEY) || "zh-CN";
  } catch {
    theme = "system";
    lang = "zh-CN";
  }
  apply();
}

// setTheme 切换主题偏好（system|light|dark）并持久化。
export function setTheme(next) {
  theme = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // 存储失败不影响本页使用
  }
  apply();
}

// setLang 切换语言（zh-CN|en）并持久化。
export function setLang(next) {
  lang = next;
  try {
    localStorage.setItem(LANG_KEY, next);
  } catch {
    // 同上
  }
  apply();
}

// getPrefs 返回当前偏好快照。
export function getPrefs() {
  return { theme, resolvedTheme, lang };
}

// onPreferenceChange 订阅偏好变化（主题或语言），返回退订函数。
export function onPreferenceChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
