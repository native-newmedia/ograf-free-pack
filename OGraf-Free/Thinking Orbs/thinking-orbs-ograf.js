/** thinking-orbs-ograf.js: canvas graphic with all nine thinking-orbs states, a dotted spinner for AI "thinking" states. */

import { _normaliseColors as _ncBase, _resolveAssetPath, clamp01, easeIn, easeOut, progress, replaySchedule } from './ograf-helpers.js';
import { DEFAULT_STATE, resolvePreset } from './orb-core.js';
import { MODE_FRAMES } from './orb-modes.js';

import { parseJsonc } from './ograf-helpers.js';
const TUNING_FILE = 'orbs-tuning.jsonc';

const _normaliseColors = (d) => {
  if (!d || typeof d !== 'object') return d;
  const o = { ...d }, v = o.bgColor;
  if (v && typeof v === 'object' && 'r' in v && 'a' in v) {
    const h = (x) => Math.round((x ?? 0) * 255).toString(16).padStart(2, '0');
    o.bgColor = `#${h(v.r)}${h(v.g)}${h(v.b)}${h(v.a ?? 1)}`;
  }
  return _ncBase(o);
};

function _hexToRgba(hex) {
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(String(hex));
  if (!m) return [0, 0, 0, 1];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, m[2] ? parseInt(m[2], 16) / 255 : 1];
}

const DESIGN_SIZE = '64';

function _hexToRgb(hex) {
  const n = parseInt(String(hex || '#ffffff').replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function _lerpInk(dim, bright, t) {
  return [
    Math.round(dim[0] + (bright[0] - dim[0]) * t),
    Math.round(dim[1] + (bright[1] - dim[1]) * t),
    Math.round(dim[2] + (bright[2] - dim[2]) * t)
  ];
}

function _inkT(white, lightInk) {
  const w = Math.min(1, Math.max(0, white));
  return lightInk ? w : 1 - w;
}

let _tuningPromise = null;
function _loadTuning() {
  if (!_tuningPromise) {
    _tuningPromise = new Promise((resolve) => {
      const done = (v) => resolve(v);
      try {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', _resolveAssetPath(TUNING_FILE), true);
        xhr.timeout = 5000;
        xhr.onload = () => {
          try {
            done(xhr.responseText ? parseJsonc(xhr.responseText) : null);
          } catch {
            done(null);
          }
        };
        xhr.onerror = () => done(null);
        xhr.ontimeout = () => done(null);
        xhr.send(null);
      } catch {
        done(null);
      }
    });
  }
  return _tuningPromise;
}

class ThinkingOrbs extends HTMLElement {
  constructor() {
    super();
    this._state = { ...DEFAULT_STATE };
    this._initialData = {};
    this._schedule = [];
    this._tuning = null;
    this._width = 1920;
    this._height = 1080;
    this._lastSecIn = null; this._lastSecOut = null;

    const shadow = this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      :host { display:block; position:absolute; inset:0; width:100%; height:100%; overflow:hidden; }
      canvas { position:absolute; top:0; left:0; width:100%; height:100%; }
    `;
    shadow.appendChild(style);
    this._canvas = document.createElement('canvas');
    shadow.appendChild(this._canvas);
    this._ctx = this._canvas.getContext('2d');
  }

  connectedCallback() {
    this._resizeObserver = new ResizeObserver(() => this._onResize());
    this._resizeObserver.observe(this);
    this._onResize();
    _loadTuning().then((t) => {
      if (t && !this._tuning) {
        this._tuning = t;
        this._draw(this._lastSecIn, this._lastSecOut);
      }
    });
  }

  disconnectedCallback() {
    if (this._resizeObserver) this._resizeObserver.disconnect();
  }

  async load(params) {
    this._initialData = _normaliseColors(params?.data || {});
    this._state = { ...DEFAULT_STATE, ...this._initialData };
    this._schedule = [];
    this._lastSecIn = null; this._lastSecOut = null;
    this._draw(null, null);
    this._tuning = await _loadTuning();
    this._draw(null, null);
    return { statusCode: 200 };
  }

  async dispose() { return { statusCode: 200 }; }

  async playAction() {
    this._lastSecIn = this._state.introDuration; this._lastSecOut = null;
    this._draw(this._lastSecIn, null);
    return { statusCode: 200, currentStep: 0 };
  }

  async stopAction() {
    this._lastSecIn = this._state.introDuration; this._lastSecOut = this._state.outroDuration;
    this._draw(this._lastSecIn, this._lastSecOut);
    return { statusCode: 200 };
  }

  async customAction(params) {
    const id = params?.id;
    const now = performance.now();
    if (id === this._lastActionId && now - (this._lastActionTime ?? 0) < 200) {
      return { statusCode: 200 };
    }
    this._lastActionId = id;
    this._lastActionTime = now;
    return { statusCode: 200 };
  }

  async setActionsSchedule(payload) {
    this._schedule = (payload?.schedule || payload?.actions || [])
      .slice()
      .sort((a, b) => a.timestamp - b.timestamp);
    this._draw(this._lastSecIn, this._lastSecOut);
    return { statusCode: 200 };
  }

  async updateAction(params) {
    // A plain merge: nothing here is derived, so nothing can be silently reverted by the
    // per-frame state rebuild in goToTime.
    const data = _normaliseColors(params?.data || {});
    this._state = { ...this._state, ...data };
    this._initialData = { ...this._initialData, ...data };
    this._draw(this._lastSecIn, this._lastSecOut);
    return { statusCode: 200 };
  }

  async goToTime(params) {
    const ms = typeof params === 'number' ? params : (typeof params?.timestamp === 'number' ? params.timestamp : 0);
    // Rebuild from the baseline and replay the schedule (ms -> s conversion lives in replaySchedule).
    const { state, secIn, secOut } = replaySchedule(this._schedule, ms, { ...DEFAULT_STATE, ...this._initialData }, _normaliseColors);
    this._state = state;
    this._lastSecIn = secIn; this._lastSecOut = secOut;
    this._draw(secIn, secOut);
    return { statusCode: 200 };
  }

  _onResize() {
    const rect = this.getBoundingClientRect();
    this._width = rect.width || 1920;
    this._height = rect.height || 1080;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this._canvas.width = Math.round(this._width * dpr);
    this._canvas.height = Math.round(this._height * dpr);
    this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._draw(this._lastSecIn, this._lastSecOut);
  }

  _draw(secIn, secOut) {
    const ctx = this._ctx;
    const st = this._state;
    if (!ctx) return;
    const w = this._width;
    const h = this._height;

    ctx.clearRect(0, 0, w, h);

    const pow = Number(st.easePower) || 3;
    const inP  = secIn === null ? 0 : easeOut(progress(secIn, 0, st.introDuration), pow);
    const outP = secOut === null ? 0 : easeIn(progress(secOut, 0, st.outroDuration), pow);
    const envelope = clamp01(inP - outP);
    if (envelope <= 0.002) return;

    if (st.showBackground) {
      const bg = _hexToRgba(st.bgColor);
      ctx.fillStyle = `rgba(${bg[0]},${bg[1]},${bg[2]},${bg[3] * envelope})`;
      ctx.fillRect(0, 0, w, h);
    }

    const { mode, speed, opts } = resolvePreset(this._tuning, st.orbState, DESIGN_SIZE, {
      dotDensity: Number(st.dotDensity),
      dotSize: Number(st.dotSize)
    });
    const t = secIn * speed * Number(st.speedMul);
    const design = Number(DESIGN_SIZE);
    const frame = MODE_FRAMES[mode](design, t, opts);

    const k = (Number(st.orbSize) || design) / design;
    const cx = w * Number(st.posX);
    const cy = h * Number(st.posY);
    const ox = design / 2;
    const oy = design / 2;
    const dim = _hexToRgb(st.inkDimColor);
    const bright = _hexToRgb(st.inkBrightColor);
    const lightInk = st.theme === 'light' || Number(st.theme) === 2;

    ctx.save();
    ctx.globalAlpha = envelope;

    for (const l of frame.lines) {
      const rgb = _lerpInk(dim, bright, _inkT(l.white, lightInk));
      ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${l.a ?? 1})`;
      ctx.lineWidth = l.w * k;
      ctx.beginPath();
      ctx.moveTo(cx + (l.x1 - ox) * k, cy + (l.y1 - oy) * k);
      ctx.lineTo(cx + (l.x2 - ox) * k, cy + (l.y2 - oy) * k);
      ctx.stroke();
    }

    for (const d of frame.dots) {
      const rgb = _lerpInk(dim, bright, _inkT(d.white, lightInk));
      ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${d.a ?? 1})`;
      ctx.beginPath();
      ctx.arc(cx + (d.x - ox) * k, cy + (d.y - oy) * k, d.r * k, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}

export default ThinkingOrbs;
