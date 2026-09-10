<script setup>
import { computed, onMounted, onBeforeUnmount, provide, ref, shallowReactive, watch } from 'vue';
import { createWorld } from './engine/world.js';
import { islandIndex } from './engine/islands.js';
import { createRuntime } from './realtime/runtime.js';
import { createPreferences } from './ui/preferences.js';
import { PULSE_CONTEXT } from './ui/context.js';
import { t, tArr } from './ui/i18n.js';
import WorldCanvas from './components/WorldCanvas.vue';
import WorldHud from './components/WorldHud.vue';
import GardenPanel from './components/GardenPanel.vue';
import DiagnosticsPanel from './components/DiagnosticsPanel.vue';

const canvas = ref(null), hud = ref(null);
const preferences = createPreferences();
const view = shallowReactive({
  connection: 'connecting', ready: false, you: null, online: 0, near: false, selected: 0,
  camera: { x: 0, y: 0, d: 1500, zoom: 1 }, plantTarget: null,
  garden: { version: 0, plants: [] }, watering: { busy: false, nextAt: 0, requestId: null },
  toast: null, events: [], ports: [], metrics: {}, frameMs: 0, hostRate: 0, drawer: false,
});
// world/runtime 保持普通对象；Vue 只代理上述低频快照，不跟踪 39 万海面点或远端缓冲。
const world = createWorld();
const runtime = createRuntime({ world, view, getPrefs: () => preferences.prefs.value });
let mounted = false;
// copy/list 每次调用读取语言 ref，让模板与 computed 能追踪语言依赖。
function copy(key, vars) { return t(preferences.prefs.value.lang, key, vars); }
function list(key) { return tArr(preferences.prefs.value.lang, key); }
// islandName 把协议 id 映射为示例名；未知服务端 id 原样显示。
function islandName(id) {
  const index = islandIndex(id);
  return index < 0 ? id || '—' : list('islandNames')[index];
}
// 照料记录是公开快照的派生文案，语言与当前岛改变都会重新计算。
const trace = computed(() => {
  const last = view.garden.plants[view.selected]?.last;
  return last ? copy('lastCared') + (last.id === view.you ? copy('you') : `${copy('guest')} ${last.id}`) + ' · ' + copy('lastWatered') : copy('lastNone');
});
const canWater = computed(() => view.ready && view.connection === 'connected' && !view.watering.busy && !view.watering.nextAt);
// home/approach/chooseIsland 是模板用的语义动作，只有引擎能够改相机。
function home() { world.selectIsland(0); world.returnAbove(); }
// approach 在当前岛的远景与近景间切换，保留连续镜头。
function approach() { if (view.near) world.returnAbove(); else world.approach(view.selected); }
// chooseIsland 先明确目标，再将相机靠近同一座岛。
function chooseIsland(index) { world.selectIsland(index); world.approach(index); }
// zoom 触及边界时提示，不直接改 UI 相机快照。
function zoom(factor) { if (!world.zoomAt(factor)) runtime.notify('zoomLimit'); }
// cycleTheme 循环用户明暗偏好，系统订阅由 preferences 管理。
function cycleTheme() {
  const current = preferences.prefs.value.theme;
  preferences.setTheme(current === 'system' ? 'light' : current === 'light' ? 'dark' : 'system');
}
// toggleLanguage 只切换界面语言，不翻译用户内容。
function toggleLanguage() { preferences.setLang(preferences.prefs.value.lang === 'zh-CN' ? 'en' : 'zh-CN'); }
provide(PULSE_CONTEXT, { view, preferences, copy, list, trace, canWater, islandName, world, runtime, home, approach, chooseIsland, zoom, cycleTheme, toggleLanguage });

// 偏好订阅属于组件；主题读取仅在变更时发生，不由每帧渲染触发。
watch(preferences.prefs, () => {
  document.title = `PULSE · ${copy('edition')}`;
  if (mounted) runtime.refreshTheme();
}, { immediate: true });
// 近景类保留既有响应式布局规则，并在卸载时移除。
watch(() => view.near, near => document.body.classList.toggle('near', near));
// 挂载后才交付 DOM；热更新会完整卸载旧引擎和连接后创建新实例。
onMounted(() => {
  mounted = true;
  runtime.start(canvas.value.nodes(), {
    isModalOpen: () => hud.value.isModalOpen(),
    getReservedRect: () => hud.value.reservedRect(),
  });
  // 开发诊断仅提供快照；生产不暴露内部状态或可调用的控制句柄。
  if (import.meta.env.DEV) Object.defineProperty(window, 'PULSE_WORLD', { configurable: true, get: () => world.diagnostics() });
});
onBeforeUnmount(() => {
  mounted = false;
  runtime.dispose(); preferences.dispose();
  document.body.classList.remove('near');
  if (import.meta.env.DEV) delete window.PULSE_WORLD;
});
</script>

<template>
  <WorldCanvas ref="canvas" />
  <WorldHud ref="hud" />
  <GardenPanel />
  <DiagnosticsPanel />
  <div id="toast" role="status" aria-live="polite" :class="{ on: view.toast }">{{ view.toast ? copy(view.toast.key, view.toast.vars) : '' }}</div>
</template>
