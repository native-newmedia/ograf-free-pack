/** Wave Interference Background: canvas wave pattern, goToTime maps the timeline to _time for NRT scrubbing. */

import { replaySchedule } from './ograf-helpers.js';

function _toHex(v) {
  if (!v) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && 'r' in v) {
    const r = Math.round((v.r ?? 0) * 255).toString(16).padStart(2, '0');
    const g = Math.round((v.g ?? 0) * 255).toString(16).padStart(2, '0');
    const b = Math.round((v.b ?? 0) * 255).toString(16).padStart(2, '0');
    const a = 'a' in v ? Math.round((v.a ?? 1) * 255).toString(16).padStart(2, '0') : '';
    return `#${r}${g}${b}${a}`;
  }
  return String(v);
}
function _normaliseColors(data) {
  if (!data || typeof data !== 'object') return data;
  const out = { ...data };
  for (const k of Object.keys(out)) {
    if (/colou?r/i.test(k)) { const c = _toHex(out[k]); if (c) out[k] = c; }
  }
  return out;
}

function _rgba(hex) {
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(String(hex));
  if (!m) return String(hex);
  const n = parseInt(m[1], 16), a = m[2] ? parseInt(m[2], 16) / 255 : 1;
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
}

const DEFAULT_STATE = {
  backgroundColor: '#050508ff',
  showBackground:  true,
  colorStart: '#4b0082',
  colorEnd:   '#0000ff',
  speed:      1.0,
  complexity: 5,
  amplitude:  100,
};

function _fadeAt(schedule, ms, init) {
  let intro = Number(init?.introDuration ?? 0), outro = Number(init?.outroDuration ?? 0);
  let tPlay = (schedule && schedule.length) ? null : 0, tStop = null;
  for (const ev of (schedule || []).slice().sort((a, b) => a.timestamp - b.timestamp)) {
    if (ev.timestamp > ms) break;
    const { type, params } = ev.action || {};
    if (type === 'updateAction') {
      const d = params?.data || {};
      if (d.introDuration != null) intro = Number(d.introDuration);
      if (d.outroDuration != null) outro = Number(d.outroDuration);
    } else if (type === 'playAction') { tPlay = ev.timestamp; tStop = null; }
    else if (type === 'stopAction') tStop = ev.timestamp;
  }
  if (tPlay === null) return 0;
  const c01 = (t) => Math.max(0, Math.min(1, t));
  const ramp = (t, d) => d > 0 ? c01(t / d) : (t >= 0 ? 1 : 0);
  const inP = 1 - Math.pow(1 - ramp((ms - tPlay) / 1000, intro), 3);
  const outP = tStop === null ? 0 : Math.pow(ramp((ms - tStop) / 1000, outro), 2);
  return inP * (1 - outP);
}

class WaveInterferenceBackground extends HTMLElement {
  constructor() {
    super();
    this._state     = { ...DEFAULT_STATE };
    this._schedule   = [];
    this._width     = 1920;
    this._height    = 1080;
    this._time      = 0;

    const shadow = this.attachShadow({ mode: 'open' });
    const style  = document.createElement('style');
    style.textContent = `
      :host { display:block; position:absolute; inset:0; overflow:hidden; }
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
  }

  disconnectedCallback() {
    if (this._resizeObserver) this._resizeObserver.disconnect();
  }

  async load(params) {
    this._envInit = { ...(params?.data || {}) };
    this._initialData = _normaliseColors(params?.data || {});
    this._state = { ...DEFAULT_STATE, ...this._initialData };
    this._lastSec = 0;
    this._paintAt(0);
    return { statusCode: 200 };
  }

  async dispose()                  { return { statusCode: 200 }; }
  async playAction(params)         { return { statusCode: 200, currentStep: 0 }; }
  async stopAction(params)         { return { statusCode: 200 }; }
  async customAction(params)       { return { statusCode: 200 }; }
  async setActionsSchedule(params) {
    const raw = params?.schedule || params?.actions || [];
    this._schedule = raw.slice().sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
    return { statusCode: 200 };
  }

  _updateState(data) {
    if (!data) return;
    this._state = { ...this._state, ..._normaliseColors(data) };
  }

  _applyUpdateData(params) {
    this._updateState((params && params.data) || {});
  }

  async updateAction(params) {
    this._initialData = { ...this._initialData, ..._normaliseColors((params && params.data) || {}) };
    this._applyUpdateData(params);
    this._paintAt(this._lastSec);
    return { statusCode: 200 };
  }

  async goToTime(params) {
    const _msFade = typeof params === 'number' ? params : (typeof params?.timestamp === 'number' ? params.timestamp : 0);
    // ms -> s: the / 1000 conversion lives in _fadeAt
    this.style.opacity = String(_fadeAt(this._schedule, _msFade, this._envInit));
    const ms = typeof params === 'number' ? params : (params?.timestamp ?? 0);
    this._state = { ...DEFAULT_STATE, ...this._initialData };
    for (const event of this._schedule) {
      if ((event.timestamp ?? 0) > ms) break;
      const action = event.action || {};
      if (action.type === 'updateAction') this._applyUpdateData(action.params || {});
    }
    // ms -> s: the / 1000 conversion lives in replaySchedule
    const rep = replaySchedule(this._schedule, ms, {}, (d) => d);
    this._lastSec = rep.secIn ?? 0;
    this._paintAt(this._lastSec);
    return { statusCode: 200 };
  }

  _paintAt(sec) {
    this._time = sec * this._state.speed;
    this._draw();
  }

  _onResize() {
    const rect   = this.getBoundingClientRect();
    this._width  = rect.width  || 1920;
    this._height = rect.height || 1080;
    const dpr    = window.devicePixelRatio || 1;
    this._canvas.width  = this._width  * dpr;
    this._canvas.height = this._height * dpr;
    this._ctx.scale(dpr, dpr);
    this._paintAt(this._lastSec ?? 0);
  }

  _draw() {
    const w = this._width, h = this._height, ctx = this._ctx;
    const { complexity, amplitude, colorStart, colorEnd, backgroundColor, showBackground } = this._state;

    ctx.clearRect(0, 0, w, h);
    if (showBackground) {
      ctx.fillStyle = _rgba(backgroundColor);
      ctx.fillRect(0, 0, w, h);
    }

    for (let i = 0; i < complexity; i++) {
      ctx.beginPath();
      const yBase = h / 2 + (i - complexity / 2) * (h / complexity * 0.5);
      ctx.moveTo(0, h); ctx.lineTo(0, yBase);
      for (let x = 0; x <= w; x += 10) {
        const ang1 = (x * 0.003) + (this._time * 0.5) + i;
        const ang2 = (x * 0.01)  - (this._time * 0.3) + (i * 1.5);
        const y = yBase + Math.sin(ang1) * amplitude + Math.sin(ang2) * (amplitude * 0.5);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h); ctx.closePath();

      const grad = ctx.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, colorStart); grad.addColorStop(1, colorEnd);
      ctx.globalAlpha = 0.5;
      ctx.fillStyle   = grad;
      ctx.fill();
    }

    ctx.globalAlpha = 1.0;
  }
}

export default WaveInterferenceBackground;
