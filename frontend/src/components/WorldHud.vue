<script setup>
import { computed, ref } from 'vue';
import { usePulse } from '../ui/context.js';
import { ISLANDS } from '../engine/islands.js';
const { view, preferences, copy, list, runtime, world, home, approach, chooseIsland, zoom, cycleTheme, toggleLanguage } = usePulse();
const address = ref(''), intro = ref(null), helpDialog = ref(null), helpButton = ref(null);
// 显示数据来自低频相机快照，不触发帧循环。
const coordinates = computed(() => {
  const format = new Intl.NumberFormat(preferences.prefs.value.lang, { maximumFractionDigits: 0 });
  return `${format.format(view.camera.x)} / ${format.format(view.camera.y)}`;
});
const themeLabel = computed(() => copy({ system: 'themeSystem', light: 'themeLight', dark: 'themeDark' }[preferences.prefs.value.theme]));
// 帮助使用原生 dialog 约束焦点；关闭回到触发按钮，恢复世界动画。
function openHelp() { helpDialog.value.showModal(); }
function closeHelp() { helpDialog.value.close(); }
function afterHelpClose() { helpButton.value.focus(); world.wake(); }
// 以下查询通过组件引用交给引擎，避免核心模块查找全局 DOM。
function isModalOpen() { return !!helpDialog.value?.open; }
function reservedRect() { return intro.value?.getBoundingClientRect(); }
function submitAddress() { runtime.goAddress(address.value); }
defineExpose({ isModalOpen, reservedRect });
</script>

<template>
  <header>
    <button id="brand" class="brand" :aria-label="copy('home')" @click="home">pulse<small id="edition">{{ copy('edition') }}</small></button>
    <nav class="tools">
      <form id="address-form" @submit.prevent="submitAddress"><input id="address" v-model="address" maxlength="64" :aria-label="copy('addressLabel')" :placeholder="copy('address')"><button id="go" :aria-label="copy('go')">↗</button></form>
      <button id="theme" @click="cycleTheme">{{ themeLabel }}</button>
      <button id="locale" :aria-label="copy('language')" @click="toggleLanguage">{{ preferences.prefs.value.lang === 'zh-CN' ? 'EN' : '中文' }}</button>
      <button id="status-btn" :aria-expanded="view.drawer" aria-controls="drawer" @click="view.drawer = !view.drawer">{{ copy('statusOpen') }}</button>
      <button id="help" ref="helpButton" @click="openHelp">{{ copy('help') }}</button>
      <span class="status"><span id="ws-dot" class="dot" :class="{ on: view.connection === 'connected' }"></span><span id="ws-label">{{ copy(view.connection) }}</span></span>
    </nav>
  </header>
  <section id="intro" ref="intro">
    <p id="eyebrow" class="eyebrow">{{ copy('eyebrow') }}</p>
    <h1 id="headline">{{ view.near ? list('islandNames')[view.selected] : copy('headline') }}</h1>
    <p id="description">{{ copy(view.near ? 'nearDesc' : 'description') }}</p>
    <button id="approach" @click="approach"><span id="approach-text">{{ copy(view.near ? 'back' : 'approach') }}</span><span aria-hidden="true">↘</span></button>
  </section>
  <nav id="nearby" :aria-label="copy('nearby')">
    <h2 id="nearby-title">{{ copy('nearby') }}</h2>
    <button v-for="(island, index) in ISLANDS" :key="island.id" type="button" :data-island="island.id" :class="{ current: index === view.selected }" @click="chooseIsland(index)"><span>{{ list('islandNames')[index] }}</span><span class="arrow">↗</span></button>
  </nav>
  <p id="hint">{{ copy(view.near ? 'nearHint' : 'hint') }}</p>
  <footer>
    <div class="footnote"><div id="coordinates" class="coordinates">{{ coordinates }}</div><div id="fixture">{{ copy('demo') }}</div></div>
    <div class="zoom">
      <button id="minus" :aria-label="copy('zoomOut')" :disabled="view.camera.d >= 2400" @click="zoom(1.38)">−</button>
      <output id="zoom">{{ view.camera.zoom.toFixed(1) }}×</output>
      <button id="plus" :aria-label="copy('zoomIn')" :disabled="view.camera.d <= 280" @click="zoom(.72)">+</button>
      <button id="origin" @click="home">{{ copy('home') }}</button>
    </div>
  </footer>
  <dialog id="help-dialog" ref="helpDialog" aria-labelledby="help-title" @close="afterHelpClose">
    <button class="close" :aria-label="copy('close')" @click="closeHelp">×</button>
    <span class="dialog-label">PULSE</span><h2 id="help-title">{{ copy('helpTitle') }}</h2>
    <div id="help-copy"><p v-for="paragraph in list('helpCopy')" :key="paragraph">{{ paragraph }}</p></div>
    <p id="limit-copy">{{ copy('limits') }}</p>
    <button id="system-theme" @click="preferences.setTheme('system')">{{ copy('themeFollowSystem') }}</button>
  </dialog>
</template>
