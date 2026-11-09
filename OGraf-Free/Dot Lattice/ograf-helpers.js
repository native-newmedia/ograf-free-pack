/**
 * ograf-helpers.js — copied per-graphic-folder (do not import from a shared parent path)
 */

export function _toHex(v) {
  if (!v) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && 'r' in v) {
    const r = Math.round((v.r ?? 0) * 255).toString(16).padStart(2, '0');
    const g = Math.round((v.g ?? 0) * 255).toString(16).padStart(2, '0');
    const b = Math.round((v.b ?? 0) * 255).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
  }
  return String(v);
}

export function _normaliseColors(data) {
  if (!data || typeof data !== 'object') return data;
  const out = { ...data };
  for (const k of Object.keys(out)) {
    if (/colou?r/i.test(k)) { const c = _toHex(out[k]); if (c) out[k] = c; }
  }
  return out;
}

export function easeOut(t, p = 3) { return 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), p); }
export function easeIn(t, p = 2)  { return Math.pow(Math.max(0, Math.min(1, t)), p); }
export function clamp01(t) { return Math.max(0, Math.min(1, t)); }

export function progress(sec, start, duration) {
  if (duration <= 0) return sec >= start ? 1 : 0;
  return clamp01((sec - start) / duration);
}

export function replaySchedule(schedule, timestampMs, baseState, normalise = (d) => d) {
  const sched = (schedule || []).slice().sort((a, b) => a.timestamp - b.timestamp);
  let state = { ...baseState };
  let tPlay = sched.length ? null : 0;
  let tStop = null;
  for (const ev of sched) {
    if (ev.timestamp > timestampMs) break;
    const { type, params } = ev.action || {};
    if (type === 'updateAction') state = { ...state, ...normalise(params?.data || {}) };
    else if (type === 'playAction') { tPlay = ev.timestamp; tStop = null; }
    else if (type === 'stopAction') tStop = ev.timestamp;
  }
  return {
    state,
    secIn:  tPlay === null ? null : (timestampMs - tPlay) / 1000,
    secOut: tStop === null ? null : (timestampMs - tStop) / 1000,
  };
}

// Adapter for graphics whose _renderAtTime(sec) still uses animInStart/animOutStart internally.
// Maps (secIn, secOut) onto one synthetic time axis: intro at 0.., exit at ENV_OUT_BASE..
// and returns the state with the derived anim* fields filled in. Hold = clamp just before the exit.
// Not for continuous motion that needs absolute time: pass ms/1000 separately for that.
export const ENV_OUT_BASE = 100;
export function envelope(state, secIn, secOut) {
  const s = { ...state, animInStart: 0, animInDuration: state.introDuration,
              animOutStart: ENV_OUT_BASE, animOutDuration: state.outroDuration };
  const sec = secIn === null ? null : secOut === null ? Math.min(secIn, ENV_OUT_BASE - 0.001) : ENV_OUT_BASE + secOut;
  return { state: s, sec };
}
