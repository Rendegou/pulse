import { inject } from 'vue';

export const PULSE_CONTEXT = Symbol('pulse');
// usePulse 只在当前应用树内共享状态与动作；没有全局单例，卸载后不会污染新页面。
export function usePulse() {
  const context = inject(PULSE_CONTEXT);
  if (!context) throw new Error('PULSE component must be inside App');
  return context;
}
