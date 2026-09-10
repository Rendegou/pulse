<script setup>
import { computed } from 'vue';
import { usePulse } from '../ui/context.js';
const { view, copy, preferences, islandName } = usePulse();
// 诊断是低频派生视图；不把主机 fixture 文案误当真实来访记录。
const maxRate = computed(() => Math.max(.01, ...view.ports.map(item => item.rate)));
const metrics = computed(() => [
  ['m-conns', 'metricOnline', view.metrics.conns ?? '—'],
  ['m-hostrate', 'metricHost', `${view.hostRate.toFixed(1)}/s`],
  ['m-heap', 'metricHeap', view.metrics.heap_mb == null ? '—' : `${view.metrics.heap_mb.toFixed(1)} MB`],
  ['m-sys', 'metricSys', view.metrics.sys_mb == null ? '—' : `${view.metrics.sys_mb.toFixed(1)} MB`],
  ['m-dropped', 'metricDropped', view.metrics.dropped ?? '—'],
  ['m-frame', 'metricFrame', `${view.frameMs.toFixed(1)} ms`],
]);
// eventText 输出纯文本；语言切换时重新格式化，服务器字段绝不使用 v-html。
function eventText(event) {
  const data = event.data;
  if (event.kind === 'join') return `${data.id} ${copy('evJoin')}`;
  if (event.kind === 'leave') return `${data.id} ${copy('evLeave')}`;
  if (event.kind === 'island') return `${data.id} → ${islandName(data.island)}`;
  if (event.kind === 'water') return `${data.id} ${copy('evWater', { plant: islandName(data.island) })}`;
  if (event.kind === 'pulse') return `${data.id} ${copy('evPulse', { x: Math.round(data.x), y: Math.round(data.y) })}`;
  return `${data.sourceId} ${copy('evHost', { port: data.destinationPort, kind: data.kind })}${data.mode === 'fixture' ? copy('evFixtureSuffix') : ''}`;
}
// timeText 使用当前 UI 语言显示本机接收时间，不宣称服务端观测时间。
function timeText(time) { return new Date(time).toLocaleTimeString(preferences.prefs.value.lang, { hour12: false }); }
</script>

<template>
  <aside id="drawer" :hidden="!view.drawer" :aria-label="copy('runtime')">
    <button id="drawer-close" class="drawer-close" :aria-label="copy('close')" @click="view.drawer = false">×</button>
    <h3>{{ copy('runtime') }}</h3>
    <div class="drawer-row"><span id="sensor-badge" class="sensor-badge" :class="view.metrics.sensor_online ? 'on' : 'off'">{{ copy(view.metrics.sensor_online ? 'sensorLive' : 'sensorOffline') }}</span><span id="chip-conns">{{ view.metrics.conns ?? '—' }}</span></div>
    <div id="feed-title" class="section-title">{{ copy('feedTitle') }}</div>
    <div id="feed" class="feed"><div v-for="(event, index) in view.events" :key="`${event.time}-${index}`" class="event"><div class="time">{{ timeText(event.time) }}</div><div class="msg">{{ eventText(event) }}</div></div></div>
    <div id="ports-title" class="section-title">{{ copy('portsLive') }}</div>
    <div id="ports" class="ports"><div v-for="item in view.ports" :key="item.port" class="prow" :class="{ hot: item.rate > .5 }"><span>:{{ item.port }}</span><div class="bar"><span :style="{ width: `${Math.max(3, item.rate / maxRate * 100)}%` }"></span></div><span>{{ item.rate > 0 ? `${item.rate.toFixed(1)}/s` : '—' }}</span></div></div>
    <div class="metrics"><div v-for="[id, label, value] in metrics" :key="id" class="metric"><div class="label">{{ copy(label) }}</div><div :id="id" class="value">{{ value }}</div></div></div>
  </aside>
</template>
