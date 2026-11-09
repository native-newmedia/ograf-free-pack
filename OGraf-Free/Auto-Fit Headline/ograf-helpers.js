/** ograf-helpers.js: shared helpers for the variable-font graphics; the font loader can fall back to Google Fonts (needs accessToPublicInternet). */

export function _toHex(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && 'r' in value) {
    const r = Math.round((value.r ?? 0) * 255).toString(16).padStart(2, '0');
    const g = Math.round((value.g ?? 0) * 255).toString(16).padStart(2, '0');
    const b = Math.round((value.b ?? 0) * 255).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
  }
  return String(value);
}
export function _normaliseColors(data) {
  if (!data || typeof data !== 'object') return data;
  const out = { ...data };
  for (const key of Object.keys(out)) {
    if (/colou?r/i.test(key)) { const c = _toHex(out[key]); if (c) out[key] = c; }
  }
  return out;
}
export function _hexToRgba(hex, alpha = 1) {
  const h = (hex || '#ffffff').replace('#', '');
  const r = parseInt(h.substring(0, 2), 16) || 0;
  const g = parseInt(h.substring(2, 4), 16) || 0;
  const b = parseInt(h.substring(4, 6), 16) || 0;
  return `rgba(${r},${g},${b},${alpha})`;
}

export function clamp01(t) { return Math.max(0, Math.min(1, t)); }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function easeOut(t) { return 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3); }
export function easeIn(t) { return Math.pow(Math.max(0, Math.min(1, t)), 2); }
export function easeInOutCubic(t) {
  t = clamp01(t);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
export function easeOutCubic(t) { return 1 - Math.pow(1 - clamp01(t), 3); }
export function easeOutBack(t) {
  const c1 = 1.70158, c3 = c1 + 1;
  t = clamp01(t);
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
export function progress(sec, start, duration) {
  if (duration <= 0) return sec >= start ? 1 : 0;
  return clamp01((sec - start) / duration);
}
export function pingPong(sec, periodSec) {
  if (periodSec <= 0) return 0;
  const t = ((sec % periodSec) + periodSec) % periodSec;
  const half = periodSec / 2;
  return t <= half ? t / half : 1 - (t - half) / half;
}
export function easingByName(name) {
  switch (name) {
    case 'easeIn': return easeIn;
    case 'easeInOutCubic': return easeInOutCubic;
    case 'easeOutBack': return easeOutBack;
    case 'linear': return (t) => clamp01(t);
    case 'easeOutCubic':
    default: return easeOutCubic;
  }
}

export function _resolveAssetPath(p, base) {
  try { return new URL(p, base || import.meta.url).href; } catch { return p; }
}
export function _xhrText(url) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.timeout = 8000;
    xhr.onload = () => {
      if (xhr.status && xhr.status >= 400) { reject(new Error('http ' + xhr.status)); return; }
      xhr.responseText ? resolve(xhr.responseText) : reject(new Error('empty response'));
    };
    xhr.onerror = () => reject(new Error('network error'));
    xhr.ontimeout = () => reject(new Error('timeout'));
    xhr.send(null);
  });
}
export function _xhrBinary(url) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'arraybuffer';
    xhr.timeout = 10000;
    xhr.onload = () => {
      if (xhr.status && xhr.status >= 400) { reject(new Error('http ' + xhr.status)); return; }
      (xhr.response && xhr.response.byteLength > 0) ? resolve(xhr.response) : reject(new Error('empty buffer'));
    };
    xhr.onerror = () => reject(new Error('network error'));
    xhr.ontimeout = () => reject(new Error('timeout'));
    xhr.send(null);
  });
}

export function parseFontAxes(buffer) {
  const axes = new Map();
  try {
    const view = new DataView(buffer);
    const sfntTag = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    if (sfntTag === 'ttcf') return axes;
    const numTables = view.getUint16(4);
    let fvarOffset = null;
    for (let i = 0; i < numTables; i++) {
      const rec = 12 + i * 16;
      const tag = String.fromCharCode(view.getUint8(rec), view.getUint8(rec + 1), view.getUint8(rec + 2), view.getUint8(rec + 3));
      if (tag === 'fvar') { fvarOffset = view.getUint32(rec + 8); break; }
    }
    if (fvarOffset == null) return axes;
    const axesArrayOffset = view.getUint16(fvarOffset + 4);
    const axisCount = view.getUint16(fvarOffset + 8);
    const axisSize = view.getUint16(fvarOffset + 10) || 20;
    for (let i = 0; i < axisCount; i++) {
      const a = fvarOffset + axesArrayOffset + i * axisSize;
      const tag = String.fromCharCode(view.getUint8(a), view.getUint8(a + 1), view.getUint8(a + 2), view.getUint8(a + 3));
      axes.set(tag, {
        min: view.getInt32(a + 4) / 65536,
        default: view.getInt32(a + 8) / 65536,
        max: view.getInt32(a + 12) / 65536,
      });
    }
  } catch (e) {
    console.warn('[variable-font] fvar parse failed — treating as zero known axes:', e?.message || e);
  }
  return axes;
}
export function hasAxis(fontInfo, tag) {
  return !!(fontInfo && fontInfo.axes && fontInfo.axes.has(tag));
}

/** Variable font loader: sibling font file, then Google Fonts (needs accessToPublicInternet and Fusion online), then system fallback. Always resolves. */
export async function loadVariableFont(shadowRoot, opts) {
  const { family, siblingUrl, googleFontsCssUrl, googleFontsAxes, fallbackStack } = opts;

  try {
    const buf = await _xhrBinary(_resolveAssetPath(siblingUrl));
    const axes = parseFontAxes(buf);
    const face = new FontFace(family, buf, { style: 'normal' });
    const loaded = await face.load();
    document.fonts.add(loaded);
    return { family, tier: 1, axes };
  } catch (e) {
    console.warn(`[variable-font] sibling "${siblingUrl}" not available (${e?.message || e}); trying Google Fonts.`);
  }

  // Tier 2 — Google Fonts, requires accessToPublicInternet. Axes are
  // asserted by the caller (no local bytes to introspect), not detected.
  try {
    if (!googleFontsCssUrl) throw new Error('no googleFontsCssUrl configured');
    const style = document.createElement('style');
    style.textContent = `@import url('${googleFontsCssUrl}');`;
    shadowRoot.appendChild(style);
    await Promise.race([
      document.fonts.load(`16px "${family}"`).then(() => document.fonts.ready),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000)),
    ]);
    return { family, tier: 2, axes: googleFontsAxes || new Map() };
  } catch (e) {
    console.warn(`[variable-font] Google Fonts load failed (${e?.message || e}); using system fallback "${fallbackStack}".`);
  }

  return { family: fallbackStack, tier: 3, axes: new Map() };
}

export function makeActionDebouncer(windowMs = 200) {
  let lastId = null, lastAt = 0;
  return function shouldSkip(id) {
    const now = performance.now();
    if (id === lastId && (now - lastAt) < windowMs) return true;
    lastId = id; lastAt = now;
    return false;
  };
}

export function classifyAspect(width, height) {
  if (!width || !height) return '16:9';
  const r = width / height;
  if (r > 1.35) return '16:9';
  if (r < 0.75) return '9:16';
  return '1:1';
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
