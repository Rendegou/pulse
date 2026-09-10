<script setup>
import { ref } from 'vue';
import { usePulse } from '../ui/context.js';
const { copy, runtime } = usePulse();
const sea = ref(null), land = ref(null), air = ref(null), labels = ref(null);
// nodes 只在挂载后提供节点；labels 的子节点由引擎独占，Vue 不渲染其中的投影标签。
function nodes() { return { sea: sea.value, land: land.value, air: air.value, labelHost: labels.value }; }
defineExpose({ nodes });
</script>

<template>
  <canvas id="sea" ref="sea" aria-hidden="true"></canvas>
  <canvas id="land" ref="land" tabindex="0" :aria-label="copy('worldLabel')" @pointermove="runtime.pointer"></canvas>
  <canvas id="air" ref="air" aria-hidden="true"></canvas>
  <div id="labels" ref="labels"></div>
</template>
