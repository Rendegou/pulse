<script setup>
import { computed } from 'vue';
import { usePulse } from '../ui/context.js';
const { view, copy, list, trace, canWater, runtime, world } = usePulse();
// 阶段以权威快照派生；等待仅影响按钮，不乐观增加 care。
const stage = computed(() => view.garden.plants[view.selected]?.care || 0);
const actionLabel = computed(() => copy(view.watering.busy || view.watering.nextAt ? 'waiting' : 'water'));
// hover 只通知引擎高亮，不创建第二套植物或照料状态。
function enter(event) { world.setPlantHover(true); runtime.plantPointer(event); }
function leave() { world.setPlantHover(false); }
</script>

<template>
  <section id="care" :hidden="!view.near" :aria-label="copy('careLabel')">
    <p id="care-note" aria-live="polite">{{ list('careStage')[stage] }}</p>
    <div class="care-actions">
      <button id="water" :disabled="!canWater" @click="runtime.waterPlant"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3C10 7 5 11 5 15a7 7 0 0 0 14 0c0-4-5-8-7-12Z"/></svg><span id="water-label">{{ actionLabel }}</span></button>
      <a id="visit" href="/?visitor=1" target="_blank" rel="noopener">{{ copy('visit') }}</a>
    </div>
    <p id="care-detail">{{ copy('careDetail') }} · {{ trace }}</p>
  </section>
  <div id="plant-target" :hidden="!view.near || !view.plantTarget" :style="view.plantTarget">
    <button id="plant-hit" :aria-label="copy('water')" :disabled="!canWater" @click="runtime.waterPlant" @pointermove="runtime.plantPointer" @pointerenter="enter" @pointerleave="leave"></button><span id="plant-caption">{{ copy('water') }}</span>
  </div>
  <p id="presence" role="status">{{ !view.ready ? copy(view.connection) : view.online <= 1 ? copy('onlineOne') : `${view.online}${copy('onlineMany')}` }}</p>
  <p id="trace">{{ trace }}</p>
</template>
