/** Flow Field Background: canvas particle flow field, goToTime maps the timeline to _time for NRT scrubbing. */

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

const F2 = 0.5 * (Math.sqrt(3.0) - 1.0);
const G2 = (3.0 - Math.sqrt(3.0)) / 6.0;
const _P = new Uint8Array(256);
const _Perm = new Uint8Array(512);
const _Grad2 = [[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[1,0],[-1,0],[0,1],[0,-1],[0,1],[0,-1]];

(function seedNoise() {
  for (let i = 0; i < 256; i++) _P[i] = i;
  const seed = 77;
  for (let i = 0; i < 256; i++) {
    const r = (i * 123 + seed * 456) % 256;
    const t = _P[i]; _P[i] = _P[r]; _P[r] = t;
  }
  for (let i = 0; i < 512; i++) _Perm[i] = _P[i & 255];
})();

function simplex2(x, y) {
  const s  = (x + y) * F2;
  const i  = Math.floor(x + s), j = Math.floor(y + s);
  const t  = (i + j) * G2;
  const x0 = x - (i - t), y0 = y - (j - t);
  const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
  const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
  const ii = i & 255, jj = j & 255;
  const gi0 = _Perm[ii + _Perm[jj]] % 12;
  const gi1 = _Perm[ii + i1 + _Perm[jj + j1]] % 12;
  const gi2 = _Perm[ii + 1 + _Perm[jj + 1]] % 12;
  let n0 = 0, n1 = 0, n2 = 0;
  let t0 = 0.5 - x0*x0 - y0*y0; if (t0 >= 0) { t0 *= t0; n0 = t0*t0*(_Grad2[gi0][0]*x0+_Grad2[gi0][1]*y0); }
  let t1 = 0.5 - x1*x1 - y1*y1; if (t1 >= 0) { t1 *= t1; n1 = t1*t1*(_Grad2[gi1][0]*x1+_Grad2[gi1][1]*y1); }
  let t2 = 0.5 - x2*x2 - y2*y2; if (t2 >= 0) { t2 *= t2; n2 = t2*t2*(_Grad2[gi2][0]*x2+_Grad2[gi2][1]*y2); }
  return 70.0 * (n0 + n1 + n2);
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

const BLUR = 80;
const BLEED = BLUR * 3;
const TRAIL = 30;

const NOISE_FREQ = 0.01;

const DEFAULT_STATE = {
  color1:          '#00ffff',
  color2:          '#ff00ff',
  backgroundColor: '#050510ff',
  showBackground:  true,
  speed:           1.0,
  scale:           1.0,
  particleCount:   1000,
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

class FlowFieldBackground extends HTMLElement {
  constructor() {
    super();
    this._state     = { ...DEFAULT_STATE };
    this._schedule    = [];
    this._particles = [];
    this._rng       = null;
    this._lastSec   = 0;
    this._initialData = {};
    this._width     = 1920;
    this._height    = 1080;
    this._time      = 0;
    this._gridIntensities = new Float32Array(0);
    this._gridRows  = 0;
    this._gridCols  = 0;

    const shadow = this.attachShadow({ mode: 'open' });
    const style  = document.createElement('style');
    style.textContent = `
      :host { display:block; position:absolute; inset:0; overflow:hidden; }
      canvas { position:absolute; top:0; left:0; width:100%; height:100%; }
    `;
    shadow.appendChild(style);

    this._bgCanvas = document.createElement('canvas');
    this._bgCanvas.style.filter = `blur(${BLUR}px)`;
    shadow.appendChild(this._bgCanvas);
    this._bgCtx = this._bgCanvas.getContext('2d');

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


  _simKey() { const s = this._state; return [s.particleCount, s.scale, s.speed, this._width, this._height].join('|'); }

  _resetSim() {
    const w = this._width, h = this._height;
    this._rng = mulberry32(0xF10F1E1D);
    this._simTime = 0;
    this._simStep = 0;
    this._gridCols = Math.ceil(w / 100);
    this._gridRows = Math.ceil(h / 100);
    this._gridIntensities = new Float32Array(this._gridCols * this._gridRows);
    this._particles = [];
    for (let i = 0; i < this._state.particleCount; i++) {
      this._particles.push({ x: this._rng() * w, y: this._rng() * h, age: this._rng() * 100, life: 100 + this._rng() * 100, hist: [] });
    }
    this._simKeyVal = this._simKey();
  }

  _step(dt) {
    const w = this._width, h = this._height, rng = this._rng;
    const { scale, speed } = this._state;
    const ROWS = this._gridRows, COLS = this._gridCols;
    const cellW = w / COLS, cellH = h / ROWS;
    const gridCounts = new Int32Array(ROWS * COLS);
    this._simTime += dt * speed;
    {
      const timeOffset = this._simTime * 0.2;
      for (const p of this._particles) {
        const n     = simplex2(p.x * NOISE_FREQ / scale + timeOffset * 0.1, p.y * NOISE_FREQ / scale - timeOffset * 0.1);
        const angle = n * Math.PI * 4;
        p.x += Math.cos(angle) * speed * 2; p.y += Math.sin(angle) * speed * 2; p.age++;
        if (p.age > p.life) {
          p.x = rng() * w; p.y = rng() * h;
          p.age = 0; p.life = 100 + rng() * 200;
        } else {
          if (p.x < 0) p.x = w; if (p.x > w) p.x = 0;
          if (p.y < 0) p.y = h; if (p.y > h) p.y = 0;
        }
        const col = Math.min(COLS - 1, Math.max(0, Math.floor(p.x / cellW)));
        const row = Math.min(ROWS - 1, Math.max(0, Math.floor(p.y / cellH)));
        gridCounts[row * COLS + col]++;
        const mix = (Math.sin(n * Math.PI) + 1) / 2;
        const opacity = 1 - (p.age / p.life);
        p.hist.unshift({ x: p.x, y: p.y, r: Math.max(0, (rng() * 2.5 + 1.5) * opacity), c: mix > 0.5 ? 1 : 2 });
        if (p.hist.length > TRAIL) p.hist.length = TRAIL;
      }
    }
    const particlesPerCellAvg = this._state.particleCount / (ROWS * COLS);
    const maxDensity = Math.max(1, particlesPerCellAvg * 2);
    for (let i = 0; i < gridCounts.length; i++) {
      const target = Math.min(1.0, gridCounts[i] / maxDensity);
      this._gridIntensities[i] += (target - this._gridIntensities[i]) * 0.1;
    }
  }

  _simTo(sec) {
    const target = Math.floor(Math.max(0, sec) * SIM_HZ);
    if (!this._rng || this._simKeyVal !== this._simKey() || this._simStep > target) this._resetSim();
    while (this._simStep < target) { this._step(1 / SIM_HZ); this._simStep++; }
  }

  _paintAt(sec) {
    this._simTo(sec);
    this._draw();
  }

  _onResize() {
    const rect   = this.getBoundingClientRect();
    this._width  = rect.width  || 1920;
    this._height = rect.height || 1080;
    const dpr    = window.devicePixelRatio || 1;

    const bs = this._bgCanvas.style;
    bs.left = bs.top = `${-BLEED}px`;
    bs.width  = `${this._width  + 2 * BLEED}px`;
    bs.height = `${this._height + 2 * BLEED}px`;
    this._bgCanvas.width  = (this._width  + 2 * BLEED) * dpr;
    this._bgCanvas.height = (this._height + 2 * BLEED) * dpr;
    this._bgCtx.setTransform(dpr, 0, 0, dpr, BLEED * dpr, BLEED * dpr);

    this._canvas.width  = this._width  * dpr;
    this._canvas.height = this._height * dpr;
    this._ctx.scale(dpr, dpr);

    this._paintAt(this._lastSec ?? 0);
  }

  _draw() {
    const w = this._width, h = this._height;
    const { color1, color2, backgroundColor, showBackground } = this._state;
    const ROWS = this._gridRows, COLS = this._gridCols;
    const cellW = w / COLS, cellH = h / ROWS;

    this._ctx.clearRect(0, 0, w, h);
    for (let k = TRAIL - 1; k >= 0; k--) {
      this._ctx.globalAlpha = Math.pow(0.9, k);
      for (const p of this._particles) {
        const d = p.hist[k];
        if (!d) continue;
        this._ctx.fillStyle = d.c === 1 ? color1 : color2;
        this._ctx.beginPath();
        this._ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        this._ctx.fill();
      }
    }
    this._ctx.globalAlpha = 1.0;

    const bg = this._bgCtx;
    bg.clearRect(-BLEED, -BLEED, w + 2 * BLEED, h + 2 * BLEED);
    if (!showBackground) return;
    bg.fillStyle = _rgba(backgroundColor);
    bg.fillRect(-BLEED, -BLEED, w + 2 * BLEED, h + 2 * BLEED);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const intensity = this._gridIntensities[r * COLS + c];
        if (intensity > 0.01) {
          const x0 = c === 0 ? -BLEED : c * cellW, x1 = c === COLS - 1 ? w + BLEED : (c + 1) * cellW + 1;
          const y0 = r === 0 ? -BLEED : r * cellH, y1 = r === ROWS - 1 ? h + BLEED : (r + 1) * cellH + 1;
          bg.globalAlpha = intensity * 0.6;
          bg.fillStyle   = color1;
          bg.fillRect(x0, y0, x1 - x0, y1 - y0);
        }
      }
    }
    bg.globalAlpha = 1.0;
  }
}

export default FlowFieldBackground;
