import { appendPositionSample, markSeen, ratePerSecond, RADAR_PORTS } from '../engine/pure.js';
import { ISLANDS, islandIndex } from '../engine/islands.js';
import { createConnection } from './connection.js';
import { createPresence } from './presence.js';
import { createWatering } from '../garden/watering.js';
import { t, tArr } from '../ui/i18n.js';
import { readPalette } from '../ui/palette.js';

// createRuntime 装配真实协议与场景；view 只接收低频界面快照，高频光标缓冲由本实例独占。
// start 必须在 canvas 挂载后调用一次，dispose 同时终止连接、动作、定时器和引擎。
export function createRuntime({ world, view, getPrefs, createTransport = createConnection, url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws` }) {
  const state = { you: null, sessions: new Map() };
  const pulses = [], seenPulses = new Set(), seenHost = new Set();
  const hostTimes = [], portTimes = new Map();
  const pending = { x: 0, y: 0, island: '', dirty: false };
  let pulseSeq = 0, lastCamera = 0, toastTimer, senderTimer, statsTimer, started = false, disposed = false;
  const presence = createPresence(state, pulses, () => getPrefs().lang);
  const connection = createTransport({
    url,
    onMessage,
    // status 变为断连时撤销连接级等待，不把旧请求带到新连接。
    onStatus(status) {
      view.connection = status;
      if (status !== 'connected') { watering.reset(); view.ready = false; }
    },
  });
  const watering = createWatering({
    send: connection.send,
    // 低频动作快照可供 Vue 跟踪，不包含粒子或 socket。
    changed(next) { view.watering = next; },
    notify,
  });

  // notify 保存文案键与插值参数；Toast 显示期间切语言仍能更新。
  function notify(key, vars) {
    clearTimeout(toastTimer);
    view.toast = { key, vars };
    toastTimer = setTimeout(() => { view.toast = null; }, 3000);
  }
  // syncGarden 从引擎取得经过版本/形状检查的快照，再更新照料视图。
  function syncGarden() { view.garden = world.getGarden(); syncLabels(); }
  // syncLabels 文案由 UI 字典提供；定位与投影子节点仍归引擎管理。
  function syncLabels() {
    const lang = getPrefs().lang;
    world.setIslandLabels(tArr(lang, 'islandNames'), t(lang, 'plantMeta'));
    const plant = world.getGarden().plants[world.getSelected()];
    world.setPlantLabelText({
      meta: t(lang, 'plantMeta'), name: tArr(lang, 'careStage')[plant?.care || 0],
      more: t(lang, world.getNearState() ? 'water' : 'approach'),
    });
  }
  // refreshTheme 在主题切换时刷新两种渲染器的缓存，同时同步引擎标签语言。
  function refreshTheme() {
    const palette = readPalette();
    world.setPalette(palette);
    presence.setColors({ bg: palette.bg, gold: palette.gold, foam: `rgb(${palette.foam.join(',')})` });
    syncLabels();
  }
  // syncCamera 把相机与命中区压缩为低频 UI 数据；世界投影和视觉动画仍逐帧运行。
  function syncCamera(force = false) {
    const now = performance.now();
    if (!force && now - lastCamera < 180) return;
    lastCamera = now;
    view.camera = world.getCamera();
    const hit = world.plantSurfacePoint(world.getSelected());
    view.plantTarget = !hit || hit.x < 30 || hit.x > innerWidth - 30 || hit.y < 90 || hit.y > innerHeight - 210
      ? null : { left: `${hit.x}px`, top: `${hit.y}px`, width: `${Math.max(64, Math.min(210, 95 * hit.s))}px`, height: `${Math.max(75, Math.min(230, 115 * hit.s))}px` };
  }
  // syncSelection 在选岛/靠近边界通知 UI；不让组件直接修改引擎内部状态。
  function syncSelection() {
    view.selected = world.getSelected();
    view.near = world.getNearState();
    syncLabels();
    syncCamera(true);
  }
  // syncCount 统计仍在线的真实连接；离场的淡出尾帧不计入在线人数。
  function syncCount() { view.online = [...state.sessions.values()].filter(s => !s.deadAt).length; }
  // record 保留最多 20 条结构化事件，模板输出文本，服务端字符串不进入 HTML。
  function record(kind, data) { view.events = [{ kind, data, time: Date.now() }, ...view.events].slice(0, 20); }
  // recordHost 只保留时间窗口，fixture 来源标识随事件一起保存。
  function recordHost(event) {
    const now = performance.now();
    hostTimes.push(now);
    // 端口条仅展示白名单，其他端口仍计入总速率与事件；不永久积累无用端口数组。
    if (RADAR_PORTS.includes(event.destinationPort)) {
      if (!portTimes.has(event.destinationPort)) portTimes.set(event.destinationPort, []);
      portTimes.get(event.destinationPort).push(now);
    }
    record('host', { ...event });
  }
  // onMessage 消费已有 Go 协议；plant 广播更新画面，water_result 独立确认本次动作。
  function onMessage(event) {
    if (disposed) return;
    switch (event.type) {
      case 'welcome':
        state.you = event.you;
        view.you = event.you;
        state.sessions.clear();
        for (const session of event.sessions || []) state.sessions.set(session.id, { ...session, bornAt: performance.now() });
        pending.dirty = false;
        pulses.length = 0;
        seenPulses.clear(); seenHost.clear();
        watering.reset();
        world.setGarden(event.garden, true);
        view.ready = true;
        syncGarden(); syncCount();
        break;
      case 'join':
        state.sessions.set(event.session.id, { ...event.session, bornAt: performance.now() });
        record('join', { id: event.session.id });
        if (event.session.id !== state.you) notify('arrival');
        syncCount();
        break;
      case 'leave': {
        const session = state.sessions.get(event.id);
        if (session) session.deadAt = performance.now();
        record('leave', { id: event.id });
        syncCount();
        break;
      }
      case 'cursor': {
        if (event.id === state.you) break;
        const session = state.sessions.get(event.id);
        if (!session) break;
        const now = performance.now();
        session.buf ||= [];
        appendPositionSample(session.buf, { t: now, x: event.wx, y: event.wy }, now);
        Object.assign(session, { wx: event.wx, wy: event.wy, z: Number(event.z) || 0, island: event.island });
        break;
      }
      case 'presence': {
        const session = state.sessions.get(event.id);
        if (session) Object.assign(session, { island: event.island, wx: event.wx, wy: event.wy });
        if (event.id !== state.you) record('island', { id: event.id, island: event.island });
        break;
      }
      case 'pulse':
        if (!markSeen(seenPulses, event.eventId)) break;
        pulses.push({ wx: event.wx, wy: event.wy, bornAt: performance.now(), mine: event.id === state.you });
        if (pulses.length > 64) pulses.shift();
        record('pulse', { id: event.id, x: event.wx, y: event.wy });
        break;
      case 'water_result': watering.result(event); break;
      case 'plant':
        world.setGarden(event.garden);
        world.addWaterEffect(event.plantId, event.together);
        syncGarden();
        notify(event.id === state.you ? (event.together ? 'together' : 'thanks') : 'remoteWaterNotice', { id: event.id });
        record('water', { id: event.id, island: event.plantId });
        break;
      case 'host_event':
        if (markSeen(seenHost, event.eventId)) recordHost(event);
        break;
      case 'metrics': view.metrics = { ...event }; break;
    }
    world.wake();
  }
  // waterPlant 是所有照料入口的唯一动作；收到 welcome 前不允许向未知花园发送。
  function waterPlant() {
    if (!world.getNearState()) { world.approach(world.getSelected()); return; }
    if (!view.ready) { notify('connecting'); return; }
    const plant = ISLANDS[world.getSelected()];
    if (plant) watering.request(plant.id);
  }
  // pointer 只记录最新世界位置；20Hz 定时器发送，避免 pointermove 直接打满网络。
  function pointer(event) {
    const point = world.screenToSurface(event.clientX, event.clientY);
    Object.assign(pending, { x: point.x, y: point.y, island: islandAt(point.x, point.y), dirty: true });
  }
  // plantPointer 必须用屏幕位置反投影；plantSurfacePoint.x/y 是像素，不能作为世界坐标发送。
  function plantPointer(event) { pointer(event); }
  // islandAt 是上报提示，真实归属仍由服务端按权威几何计算。
  function islandAt(x, y) {
    let best = '', distance = Infinity;
    for (const island of ISLANDS) {
      const d = Math.hypot((x - island.x) / island.r, (y - island.y) / (island.r * island.sy));
      if (d <= 1.15 && d < distance) { best = island.id; distance = d; }
    }
    return best;
  }
  // goAddress 保留现有字符串漫游功能；它不是个人岛链接或鉴权入口。
  function goAddress(value) {
    value = value.trim().normalize('NFC');
    if (!value) return;
    let hash = 2166136261;
    for (const ch of value) hash = Math.imul(hash ^ ch.codePointAt(0), 16777619);
    const x = ((hash >>> 0) % 10001 - 5000) * 560;
    const y = ((Math.imul(hash, 2246822519) >>> 0) % 10001 - 5000) * 560;
    const index = islandIndex(islandAt(x, y));
    if (index >= 0) { world.selectIsland(index); world.approach(index); }
    else world.flyTo({ x, y, d: 700 });
  }
  // tickDiagnostics 每秒发布一次指标并裁剪历史；不把帧时间或高频事件逐条响应化。
  function tickDiagnostics() {
    const now = performance.now(), cutoff = now - 10000;
    for (const times of [hostTimes, ...portTimes.values()]) while (times.length && times[0] < cutoff) times.shift();
    view.hostRate = ratePerSecond(hostTimes, now, 10000);
    view.ports = RADAR_PORTS.map(port => ({ port, rate: ratePerSecond(portTimes.get(port) || [], now, 10000) }));
    view.frameMs = world.getStats().frameMs;
    syncCount();
  }
  // start 接收组件提供的真实节点与布局查询，核心运行层不再按全局 id 查找 DOM。
  function start(nodes, layout) {
    if (started || disposed) return;
    started = true;
    world.initWorld(nodes, {
      onIslandSelect: syncSelection, onNearChange: syncSelection, onPlantLabel: syncLabels,
      onPlantWater: waterPlant, onPlantHover: syncSelection, onCameraMove: () => syncCamera(),
      // 脉冲使用独立事件号，仍播放服务端回声；不伪造成功。
      onGroundPulse(wx, wy) { if (view.ready) connection.send({ type: 'pulse', v: 2, clientEventId: `c${pulseSeq++}`, wx, wy }); },
      isReading: layout.isModalOpen, isModalOpen: layout.isModalOpen,
      getReservedRect: layout.getReservedRect, overlayActive: presence.active,
    });
    world.setOverlay(presence.draw);
    refreshTheme(); syncSelection(); syncGarden();
    connection.connect();
    // 每轮读取最新 pending；发送失败保留 dirty，但 welcome 会作废旧连接待发坐标。
    senderTimer = setInterval(() => {
      if (!view.ready || !pending.dirty) return;
      if (connection.send({ type: 'cursor', v: 3, wx: pending.x, wy: pending.y, island: pending.island })) pending.dirty = false;
    }, 50);
    statsTimer = setInterval(tickDiagnostics, 1000);
  }
  // dispose 先撤销连接/动作，再清计时器与引擎；重复卸载无副作用。
  function dispose() {
    if (disposed) return;
    disposed = true;
    connection.dispose(); watering.dispose();
    clearTimeout(toastTimer); clearInterval(senderTimer); clearInterval(statsTimer);
    world.dispose();
    state.sessions.clear(); pulses.length = 0;
  }
  return { start, dispose, refreshTheme, waterPlant, pointer, plantPointer, goAddress, notify };
}
