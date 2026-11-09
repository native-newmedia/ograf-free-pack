/**
 * OGraf Sine Wave Lines Background
 * Multiple layered sine waves drifting across the screen. Each wave has its
 * own frequency, amplitude, phase offset and colour, creating an organic,
 * flowing interference pattern.
 */

import { _normaliseColors, replaySchedule } from './ograf-helpers.js';

function hexToRgba(hex, alpha) {
  const h = (hex || '#ffffff').replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function _rgba(hex) {
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(String(hex));
  if (!m) return String(hex);
  const n = parseInt(m[1], 16), a = m[2] ? parseInt(m[2], 16) / 255 : 1;
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
}
function _norm(data) {
  const v = data && data.backgroundColor;
  if (!v || typeof v !== 'object' || !('a' in v)) return _normaliseColors(data);
  const h = (x) => Math.round((x ?? 0) * 255).toString(16).padStart(2, '0');
  return _normaliseColors({ ...data, backgroundColor: `#${h(v.r)}${h(v.g)}${h(v.b)}${h(v.a ?? 1)}` });
}

const DEFAULT_STATE = {
  backgroundColor: '#020818ff',
  showBackground:  true,
  waveColor1:      '#00d2ff',
  waveColor2:      '#7b2fff',
  waveColor3:      '#ff2fd6',
  waveCount:       6,
  speed:           1.0,
  amplitude:       80,
  lineWidth:       2.0,
  blur:            0,
};

function buildWaves(count) {
  const waves = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    waves.push({
      yBase:        0.15 + t * 0.70,
      frequency:    0.0008 + (i % 3) * 0.0004,
      speedMult:    0.6 + (i * 0.13) % 0.8,
      phaseOffset:  (i * 1.618) % (Math.PI * 2),
      freq2:        0.0015 + (i % 4) * 0.0003,
      freq2Mult:    0.3 + (i % 3) * 0.15,
      colorSlot:    i % 3,
      alpha:        0.35 + Math.sin(t * Math.PI) * 0.45,
    });
  }
  return waves;
}

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

class SineWaveLinesBackground extends HTMLElement {

  constructor() {
    super();
    this._state     = { ...DEFAULT_STATE };
    this._schedule   = [];
    this._width     = 1920;
    this._height    = 1080;
    this._time      = 0;
    this._waves     = [];

    const shadow = this.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host {
          display: block;
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          overflow: hidden;
        }
        canvas {
          position: absolute;
          top: 0; left: 0;
          width: 100%; height: 100%;
        }
      </style>
    `;
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
    this._initialData = _norm(params?.data || {});
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
    this._state = { ...this._state, ..._norm(data) };
  }

  _applyUpdateData(params) {
    this._updateState((params && params.data) || {});
  }

  async updateAction(params) {
    this._initialData = { ...this._initialData, ..._norm((params && params.data) || {}) };
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
    this._onInit();
    this._time = sec * this._state.speed;
    this._draw();
  }

  _onResize() {
    const rect    = this.getBoundingClientRect();
    this._width   = rect.width  || 1920;
    this._height  = rect.height || 1080;
    const dpr     = window.devicePixelRatio || 1;
    this._canvas.width  = this._width  * dpr;
    this._canvas.height = this._height * dpr;
    this._ctx.scale(dpr, dpr);
    this._onInit();
    this._paintAt(this._lastSec ?? 0);
  }

  _onInit() {
    this._waves = buildWaves(Math.max(1, Math.round(this._state.waveCount)));
  }

  _draw() {
    const w   = this._width;
    const h   = this._height;
    const ctx = this._ctx;
    const s   = this._state;
    const t   = this._time;

    ctx.clearRect(0, 0, w, h);
    if (s.showBackground) {
      ctx.fillStyle = _rgba(s.backgroundColor);
      ctx.fillRect(0, 0, w, h);
    }

    if (s.blur > 0) {
      ctx.filter = `blur(${s.blur}px)`;
    }

    const palette = [s.waveColor1, s.waveColor2, s.waveColor3];

    const STEP = 4;

    this._waves.forEach(wave => {
      const yBase = wave.yBase * h;
      const amp   = s.amplitude;
      const color = palette[wave.colorSlot] || '#ffffff';
      const alpha = wave.alpha;

      ctx.beginPath();
      ctx.lineWidth   = s.lineWidth;
      ctx.strokeStyle = hexToRgba(color, alpha);
      ctx.lineCap     = 'round';
      ctx.lineJoin    = 'round';

      const drift = t * 60 * wave.speedMult;

      for (let x = 0; x <= w + STEP; x += STEP) {
        const angle1 = (x + drift) * wave.frequency + wave.phaseOffset + t * wave.speedMult;
        const angle2 = (x + drift) * wave.freq2     + wave.phaseOffset * 1.3 + t * wave.speedMult * 0.7;
        const y = yBase
                + Math.sin(angle1) * amp
                + Math.sin(angle2) * amp * wave.freq2Mult;

        if (x === 0) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
      }

      ctx.stroke();

      ctx.beginPath();
      ctx.lineWidth   = s.lineWidth * 4;
      ctx.strokeStyle = hexToRgba(color, alpha * 0.12);

      for (let x = 0; x <= w + STEP; x += STEP) {
        const angle1 = (x + drift) * wave.frequency + wave.phaseOffset + t * wave.speedMult;
        const angle2 = (x + drift) * wave.freq2     + wave.phaseOffset * 1.3 + t * wave.speedMult * 0.7;
        const y = yBase
                + Math.sin(angle1) * amp
                + Math.sin(angle2) * amp * wave.freq2Mult;

        if (x === 0) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
      }
      ctx.stroke();
    });

    if (s.blur > 0) ctx.filter = 'none';
  }
}

export default SineWaveLinesBackground;
