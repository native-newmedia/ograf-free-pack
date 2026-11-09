/** Digital Circuit Background: canvas simulation, goToTime maps the timeline to _time for NRT scrubbing. */

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
function _rgba(hex) {
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(String(hex));
  if (!m) return String(hex);
  const n = parseInt(m[1], 16), a = m[2] ? parseInt(m[2], 16) / 255 : 1;
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
}
function _normaliseColors(data) {
  if (!data || typeof data !== 'object') return data;
  const out = { ...data };
  for (const k of Object.keys(out)) {
    if (/colou?r/i.test(k)) { const c = _toHex(out[k]); if (c) out[k] = c; }
  }
  return out;
}


function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const SIM_HZ = 60;
const WARMUP_SEC = 10;

const DEFAULT_STATE = {
  gridColor:       '#1a1a2eff',
  signalColor:     '#00d2ff',
  backgroundColor: '#050510ff',
  showBackground:  true,
  showGrid:        true,
  speed:           1.0,
  gridDensity:     40,
  signalSize:      1.0,
  trailLength:     5,
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

class DigitalCircuitBackground extends HTMLElement {
  constructor() {
    super();
    this._state    = { ...DEFAULT_STATE };
    this._schedule = [];
    this._width    = 1920;
    this._height   = 1080;
    this._signals  = [];
    this._rng      = null;
    this._lastSec  = 0;
    this._initialData = {};
    this._cols     = 0;
    this._rows     = 0;
    this._cellSize = 0;

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


  _simKey() { const s = this._state; return [s.gridDensity, s.speed, s.trailLength, this._width, this._height].join('|'); }

  _resetSim() {
    this._initGrid();
    this._rng = mulberry32(0xC1C017);
    this._signals = [];
    this._simStep = 0;
    this._simKeyVal = this._simKey();
  }

  _simTo(sec) {
    const target = Math.floor((Math.max(0, sec) + WARMUP_SEC) * SIM_HZ);
    if (!this._rng || this._simKeyVal !== this._simKey() || this._simStep > target) this._resetSim();
    while (this._simStep < target) {
      const maxSignals = this._cols * this._rows * 0.05;
      if (this._signals.length < maxSignals && this._rng() < 0.1) this._spawnSignal();
      this._updateSignals(1 / SIM_HZ);
      this._simStep++;
    }
  }

  _paintAt(sec) {
    this._simTo(sec);
    this._draw();
  }

  _onResize() {
    const rect       = this.getBoundingClientRect();
    this._width      = rect.width  || 1920;
    this._height     = rect.height || 1080;
    const dpr        = window.devicePixelRatio || 1;
    this._canvas.width  = this._width  * dpr;
    this._canvas.height = this._height * dpr;
    this._ctx.scale(dpr, dpr);
    this._initGrid();
    this._paintAt(this._lastSec ?? 0);
  }

  _initGrid() {
    this._cellSize = this._width / this._state.gridDensity;
    this._cols     = Math.ceil(this._width  / this._cellSize) + 1;
    this._rows     = Math.ceil(this._height / this._cellSize) + 1;
  }

  _spawnSignal() {
    const cx  = Math.floor(this._rng() * this._cols);
    const cy  = Math.floor(this._rng() * this._rows);
    const dir = Math.floor(this._rng() * 4);
    this._signals.push({
      cx, cy, tx: cx, ty: cy, progress: 0, dir,
      life: 1.0, history: [],
      speedVariance: 0.5 + this._rng(),
    });
  }

  _updateSignals(dt) {
    const speedBase = this._state.speed * 5.0;
    for (let i = this._signals.length - 1; i >= 0; i--) {
      const s = this._signals[i];
      s.progress += dt * speedBase * s.speedVariance;
      s.life     -= dt * 0.2;
      if (s.progress >= 1.0) {
        s.progress = 0;
        s.history.push({ x: s.cx, y: s.cy, tx: s.tx, ty: s.ty });
        const maxTrail = this._state.trailLength ?? 5;
        if (s.history.length > maxTrail) s.history.shift();
        s.cx = s.tx; s.cy = s.ty;
        if (this._rng() < 0.2) s.dir = (s.dir + (this._rng() < 0.5 ? 1 : 3)) % 4;
        switch (s.dir) {
          case 0: s.ty = s.cy - 1; break;
          case 1: s.tx = s.cx + 1; break;
          case 2: s.ty = s.cy + 1; break;
          case 3: s.tx = s.cx - 1; break;
        }
        if (s.tx < 0 || s.tx >= this._cols || s.ty < 0 || s.ty >= this._rows || s.life <= 0)
          this._signals.splice(i, 1);
      }
    }
  }

  _draw() {
    const { _width: w, _height: h, _ctx: ctx, _cellSize: cs, _state: st } = this;
    ctx.clearRect(0, 0, w, h);
    if (st.showBackground) {
      ctx.fillStyle = _rgba(st.backgroundColor);
      ctx.fillRect(0, 0, w, h);
    }

    if (st.showGrid) {
      ctx.strokeStyle = _rgba(st.gridColor);
      ctx.lineWidth   = 1;
      ctx.beginPath();
      for (let c = 0; c <= this._cols; c++) { ctx.moveTo(c * cs, 0); ctx.lineTo(c * cs, h); }
      for (let r = 0; r <= this._rows; r++) { ctx.moveTo(0, r * cs); ctx.lineTo(w, r * cs); }
      ctx.stroke();
    }

    ctx.lineCap = 'square';
    const sz = st.signalSize ?? 1.0;
    this._signals.forEach(s => {
      const alpha = Math.max(0, s.life);
      const hx = s.cx * cs + (s.tx - s.cx) * cs * s.progress;
      const hy = s.cy * cs + (s.ty - s.cy) * cs * s.progress;

      ctx.shadowColor = st.signalColor; ctx.shadowBlur = 10 * sz;
      ctx.fillStyle   = st.signalColor;
      ctx.beginPath(); ctx.arc(hx, hy, 3 * sz, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur  = 0;

      ctx.strokeStyle  = st.signalColor;
      ctx.lineWidth    = 3 * sz;
      ctx.globalAlpha  = alpha;
      ctx.beginPath(); ctx.moveTo(s.cx * cs, s.cy * cs); ctx.lineTo(hx, hy); ctx.stroke();

      ctx.lineWidth = 2 * sz;
      s.history.forEach((seg, i) => {
        ctx.globalAlpha = alpha * ((i + 1) / (s.history.length + 1)) * 0.5;
        ctx.beginPath(); ctx.moveTo(seg.x * cs, seg.y * cs); ctx.lineTo(seg.tx * cs, seg.ty * cs); ctx.stroke();
      });
      ctx.globalAlpha = 1.0;
    });
  }
}

export default DigitalCircuitBackground;
