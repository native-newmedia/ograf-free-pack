/** CYBER GRID: radial vignette plus two grid-line layers scrolling at independent speeds, driven by goToTime. */

import { _normaliseColors, easeOut as _easeOut, easeIn as _easeIn, clamp01, progress, replaySchedule, envelope } from './ograf-helpers.js';

function _norm(data) {
  const v = data && data.bgColor;
  if (!v || typeof v !== 'object' || !('a' in v)) return _normaliseColors(data);
  const h = (x) => Math.round((x ?? 0) * 255).toString(16).padStart(2, '0');
  return _normaliseColors({ ...data, bgColor: `#${h(v.r)}${h(v.g)}${h(v.b)}${h(v.a ?? 1)}` });
}

let _POW = 3;
const easeOut = (t) => _easeOut(t, _POW);
const easeIn  = (t) => _easeIn(t, _POW);

const DEFAULT_STATE = {
  introDuration: 0,
  outroDuration: 0,
  easePower: 3,
  bgColor:         '#050505ff',
  showBackground:  true,
  gridColorMain:   '#03e9f4',
  gridColorSub:    '#d903f4',
  mainOpacity:     0.10,
  subOpacity:      0.05,
  mainCellSize:    60,
  subCellSize:     20,
  mainThickness:   1,
  subThickness:    1,
  mainSpeed:       15,
  subSpeed:        10,
  posX:            0,
  posY:            0,
  animInStart: 0,   
  animInDuration: 0.6,   
  animOutStart: 100,   
  animOutDuration: 0.5,   
};

const FULL_BLEED_SIZE = 2800;

class CyberGrid extends HTMLElement {

  constructor() {
    super();
    this._state = { ...DEFAULT_STATE };
    this._shadow = this.attachShadow({ mode: 'open' });
    this._shadow.innerHTML = `
      <style>
        :host {
          display:block; position:absolute; inset:0; width:100%; height:100%;
          overflow:hidden; background: transparent;
        }
        .stage {
          position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
          overflow:hidden;
        }
        /* ── CSS adapted from the Uiverse.io source (sunn_2633) ──
           colours/opacities are pre-composited into rgba() strings in JS
           (--gridMainRgba/--gridSubRgba) rather than built from separate
           colour + alpha custom properties, for reliable cross-browser
           behaviour. --mainScroll/--subScroll replace the source's
           @keyframes cyber-move loop. */
        .swatch {
          --bg: #050505;
          --gridMainRgba: rgba(3,233,244,0.1);
          --gridSubRgba: rgba(217,3,244,0.05);
          --mainSize: 60px;
          --subSize: 20px;
          --mainThickness: 1px;
          --subThickness: 1px;
          --mainScroll: 0px;
          --subScroll: 0px;
          position: relative;
          background-color: var(--bg);
        }
        /* Grid layers (vignette removed: it was slow in Fusion) */
        .grid {
          position: absolute; inset: 0;
          background-image:
            linear-gradient(var(--gridMainRgba) var(--mainThickness), transparent var(--mainThickness)),
            linear-gradient(90deg, var(--gridMainRgba) var(--mainThickness), transparent var(--mainThickness)),
            linear-gradient(var(--gridSubRgba) var(--subThickness), transparent var(--subThickness)),
            linear-gradient(90deg, var(--gridSubRgba) var(--subThickness), transparent var(--subThickness));
          background-size:
            var(--mainSize) var(--mainSize),
            var(--mainSize) var(--mainSize),
            var(--subSize) var(--subSize),
            var(--subSize) var(--subSize);
          background-position:
            var(--mainScroll) var(--mainScroll),
            var(--mainScroll) var(--mainScroll),
            var(--subScroll) var(--subScroll),
            var(--subScroll) var(--subScroll);
        }
      </style>
      <div class="stage">
        <div class="swatch"><div class="grid"></div></div>
      </div>
    `;
    this._els = { swatch: this._shadow.querySelector('.swatch') };
  }

  async load(params) {
    this._initialData = _norm(params.data || {});
    this._state = { ...DEFAULT_STATE, ...this._initialData };
    this._schedule = [];
    this._applyStructure();
    this._renderAtTime(0);
    return { statusCode: 200 };
  }

  async dispose() { return { statusCode: 200 }; }
  async playAction(params) { return { statusCode: 200, currentStep: 0 }; }
  async stopAction(params) { return { statusCode: 200 }; }
  async customAction(params) { return { statusCode: 200 }; }
  async setActionsSchedule(payload) {

    this._schedule = (payload?.schedule || payload?.actions || [])
      .slice()
      .sort((a, b) => a.timestamp - b.timestamp);
    return { statusCode: 200 };
  }

  async updateAction(params) {
    const data = _norm(params.data || {});
    this._state = { ...this._state, ...data };
    this._initialData = { ...this._initialData, ...data };
    this._applyStructure();
    this._renderAtTime(this._lastSec ?? 0);
    return { statusCode: 200 };
  }

  async goToTime(params) {
    const ms = typeof params === 'number' ? params
             : (typeof params?.timestamp === 'number' ? params.timestamp : 0);
    const rep = replaySchedule(this._schedule, ms, { ...DEFAULT_STATE, ...this._initialData }, _norm);
    const absSec = ms / 1000;   // ms -> s (absolute clip time, for any continuous motion)
    const env = envelope(rep.state, rep.secIn, rep.secOut);
    this._contentSec = rep.secIn ?? 0;
    this._state = env.state;
    _POW = this._state.easePower ?? 3;
    this._applyStructure();
    if (env.sec === null) { this._renderAtTime(-1); } else this._renderAtTime(env.sec);
    return { statusCode: 200 };
  }

  _applyStructure() {
    const s = this._state;
    const el = this._els.swatch;

    el.style.setProperty('--bg', s.showBackground ? _hexToRgba(s.bgColor, 1) : 'transparent');
    el.style.setProperty('--gridMainRgba', _hexToRgba(s.gridColorMain, s.mainOpacity));
    el.style.setProperty('--gridSubRgba', _hexToRgba(s.gridColorSub, s.subOpacity));
    el.style.setProperty('--mainSize', `${s.mainCellSize}px`);
    el.style.setProperty('--subSize', `${s.subCellSize}px`);
    el.style.setProperty('--mainThickness', `${s.mainThickness}px`);
    el.style.setProperty('--subThickness', `${s.subThickness}px`);

    el.style.width  = `${FULL_BLEED_SIZE}px`;
    el.style.height = `${FULL_BLEED_SIZE}px`;
  }

  _renderAtTime(envSec) {
    const sec = envSec < 0 ? envSec : (this._contentSec ?? envSec);
    _POW = this._state.easePower ?? 3;
    this._lastSec = envSec;
    const s = this._state;
    const el = this._els.swatch;

    const mainScroll = s.mainCellSize > 0 ? (sec * s.mainSpeed) % s.mainCellSize : 0;
    const subScroll  = s.subCellSize  > 0 ? (sec * s.subSpeed)  % s.subCellSize  : 0;
    el.style.setProperty('--mainScroll', `${mainScroll}px`);
    el.style.setProperty('--subScroll', `${subScroll}px`);

    const env = clamp01(
      easeOut(progress(envSec, s.animInStart, s.animInDuration)) -
      easeIn(progress(envSec, s.animOutStart, s.animOutDuration))
    );

    el.style.opacity = String(env);
    el.style.transform = `translate(${s.posX}px, ${s.posY}px)`;
  }
}

function _hexToRgba(hex, alpha) {
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex || '');
  if (!m) return `rgba(255,255,255,${alpha})`;
  const n = parseInt(m[1], 16), a = (m[2] ? parseInt(m[2], 16) / 255 : 1) * alpha;
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}

export default CyberGrid;
