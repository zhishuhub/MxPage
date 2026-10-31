// K图：同时生成几套的自动降速。网站那头连续超时、限流或报 5xx 时少开一套（两次降速至少隔 2 分钟），
// 之后连续 8 次请求顺利再加回一套，最多回到设置的套数。只记在内存里，重启应用就恢复成设置值。

const COOLDOWN_MS = 120_000;
const RECOVER_AFTER = 8;

type ThrottleState = { cut: number; lastCutAt: number; okStreak: number };
const holder = globalThis as typeof globalThis & { ktuThrottle?: ThrottleState };
const state = (holder.ktuThrottle ??= { cut: 0, lastCutAt: 0, okStreak: 0 });

export function noteProviderStrain(now = Date.now()) {
  state.okStreak = 0;
  if (now - state.lastCutAt < COOLDOWN_MS) return;
  state.cut++;
  state.lastCutAt = now;
}

export function noteProviderOk() {
  if (!state.cut) return;
  if (++state.okStreak < RECOVER_AFTER) return;
  state.cut--;
  state.okStreak = 0;
}

/** 当前实际同时跑几套：设置值减去降掉的，至少 1 套。 */
export function effectiveConcurrency(configured: number) {
  return Math.max(1, configured - state.cut);
}

export function resetThrottle() {
  Object.assign(state, { cut: 0, lastCutAt: 0, okStreak: 0 });
}
