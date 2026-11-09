/** DOT LATTICE: interlocking radial-gradient dot lattice, driven by goToTime. */

import { _normaliseColors, easeOut as _easeOut, easeIn as _easeIn, clamp01, progress, replaySchedule, envelope } from './ograf-helpers.js';

let _POW = 3;
const easeOut = (t) => _easeOut(t, _POW);
const easeIn  = (t) => _easeIn(t, _POW);

const DEFAULT_STATE = {
  introDuration: 0,
  outroDuration: 0,
  easePower: 3,
  colorPrimary:    '#f7d2a1',
  colorSecondary:  '#05057e',
  patternSize:     150,
  scrollEnabled:   true,
  scrollSpeedX:    20,
  scrollSpeedY:    20,
  rotation:        0,
  contained:       false,
  cardWidth:       480,
  cardHeight:      300,
  cornerRadius:    24,
  posX:            0,
  posY:            0,
  scale:           1.0,
  opacity:         1.0,
  animInStart: 0,
  animInDuration: 0.6,
  animOutStart: 100,
  animOutDuration: 0.5,
};

const FULL_BLEED_SIZE = 2800;

class DotLattice extends HTMLElement {

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
        /* ── CSS adapted from the Uiverse.io source (csemszepp) ──
           --c1/--c2/--s become dynamic; --scrollX/--scrollY are new,
           baked into each layer's position via calc() (see note above). */
        .swatch {
          --s: 150px;
          --c1: #f7d2a1;
          --c2: #05057e;
          --scrollX: 0px;
          --scrollY: 0px;
          --_g: var(--c1) 0% 5%, var(--c2) 6% 15%, var(--c1) 16% 25%, var(--c2) 26% 35%,
            var(--c1) 36% 45%, var(--c2) 46% 55%, var(--c1) 56% 65%, var(--c2) 66% 75%,
            var(--c1) 76% 85%, var(--c2) 86% 95%, #0000 96%;
          background: radial-gradient(50% 50% at 100% 0, var(--_g)) var(--scrollX) var(--scrollY),
            radial-gradient(50% 50% at 0 100%, var(--_g)) var(--scrollX) var(--scrollY),
            radial-gradient(50% 50%, var(--_g)) var(--scrollX) var(--scrollY),
            radial-gradient(50% 50%, var(--_g))
              calc(var(--s) / 2 + var(--scrollX)) calc(var(--s) / 2 + var(--scrollY))
              var(--c1);
          background-size: var(--s) var(--s);

        }
      </style>
      <div class="stage">
        <div class="swatch"></div>
      </div>
    `;
    this._els = { swatch: this._shadow.querySelector('.swatch') };
  }

  async load(params) {
    this._initialData = _normaliseColors(params.data || {});
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
    const data = _normaliseColors(params.data || {});
    this._state = { ...this._state, ...data };
    this._initialData = { ...this._initialData, ...data };
    this._applyStructure();
    this._renderAtTime(this._lastSec ?? 0);
    return { statusCode: 200 };
  }

  async goToTime(params) {
    const ms = typeof params === 'number' ? params
             : (typeof params?.timestamp === 'number' ? params.timestamp : 0);
    const rep = replaySchedule(this._schedule, ms, { ...DEFAULT_STATE, ...this._initialData }, _normaliseColors);
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

    el.style.setProperty('--c1', s.colorPrimary);
    el.style.setProperty('--c2', s.colorSecondary);
    el.style.setProperty('--s', `${s.patternSize}px`);

    if (s.contained) {
      el.style.width  = `${s.cardWidth}px`;
      el.style.height = `${s.cardHeight}px`;
      el.style.borderRadius = `${s.cornerRadius}px`;
    } else {
      el.style.width  = `${FULL_BLEED_SIZE}px`;
      el.style.height = `${FULL_BLEED_SIZE}px`;
      el.style.borderRadius = '0px';
    }
  }

  _renderAtTime(envSec) {
    const sec = envSec < 0 ? envSec : (this._contentSec ?? envSec);
    _POW = this._state.easePower ?? 3;
    this._lastSec = envSec;
    const s = this._state;
    const el = this._els.swatch;

    let sx = 0, sy = 0;
    if (s.scrollEnabled && s.patternSize > 0) {
      sx = (sec * s.scrollSpeedX) % s.patternSize;
      sy = (sec * s.scrollSpeedY) % s.patternSize;
    }
    el.style.setProperty('--scrollX', `${sx}px`);
    el.style.setProperty('--scrollY', `${sy}px`);

    const env = clamp01(
      easeOut(progress(envSec, s.animInStart, s.animInDuration)) -
      easeIn(progress(envSec, s.animOutStart, s.animOutDuration))
    );

    el.style.opacity = String(env * s.opacity);
    el.style.transform =
      `translate(${s.posX}px, ${s.posY}px) rotate(${s.rotation}deg) scale(${Number(s.scale).toFixed(4)})`;
  }
}

export default DotLattice;
