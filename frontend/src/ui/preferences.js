import { shallowRef } from 'vue';

// createPreferences 创建页面级偏好订阅；不在模块导入时注册永久全局监听。
export function createPreferences() {
  const query = matchMedia('(prefers-color-scheme: dark)');
  const prefs = shallowRef({ theme: 'system', resolvedTheme: 'light', lang: 'zh-CN' });
  // apply 校验输入并同步根节点；存储不可用时本页内仍能切换。
  function apply(theme, lang, persist = false) {
    theme = ['system', 'light', 'dark'].includes(theme) ? theme : 'system';
    lang = ['zh-CN', 'en'].includes(lang) ? lang : 'zh-CN';
    const resolvedTheme = theme === 'system' ? (query.matches ? 'dark' : 'light') : theme;
    prefs.value = { theme, lang, resolvedTheme };
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
    document.documentElement.lang = lang;
    if (persist) {
      try { localStorage.setItem('pulse.theme', theme); localStorage.setItem('pulse.lang', lang); } catch { /* 本页继续 */ }
    }
  }
  // follow 仅在跟随系统时响应操作系统主题，不覆盖用户手动选择。
  function follow() { if (prefs.value.theme === 'system') apply('system', prefs.value.lang); }
  try { apply(localStorage.getItem('pulse.theme'), localStorage.getItem('pulse.lang')); } catch { apply('system', 'zh-CN'); }
  query.addEventListener('change', follow);
  // setTheme/setLang 保留另一项选择，并将新偏好持久化。
  function setTheme(theme) { apply(theme, prefs.value.lang, true); }
  // setLang 更改语言并持久化，保留明暗偏好。
  function setLang(lang) { apply(prefs.value.theme, lang, true); }
  // dispose 释放系统订阅，支持 Vue 热更新与卸载。
  function dispose() { query.removeEventListener('change', follow); }
  return { prefs, setTheme, setLang, dispose };
}
