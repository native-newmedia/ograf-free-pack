/** PINWHEEL: seamless four-colour pinwheel pattern built from a repeating SVG tile. */

import { _normaliseColors, easeOut as _easeOut, easeIn as _easeIn, clamp01, progress, replaySchedule, envelope } from './ograf-helpers.js';

let _POW = 3;
const easeOut = (t) => _easeOut(t, _POW);
const easeIn  = (t) => _easeIn(t, _POW);

const DEFAULT_STATE = {
  introDuration: 0,
  outroDuration: 0,
  easePower: 3,
  colorC1:         '#ff847c',
  colorC2:         '#e84a5f',
  colorC3:         '#fecea8',
  colorC4:         '#99b898',
  patternSize:     150,
  scrollSpeedX:    20,
  scrollSpeedY:    20,
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

class Pinwheel extends HTMLElement {

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
        /* Seamless SVG pinwheel tile — background-image and background-size
           are written from JS in _applyStructure() (the SVG tile is rebuilt
           when colours/size change); background-position is scrolled per
           frame. */
        .swatch {
          background-repeat: repeat;

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

    el.style.backgroundImage =
      'url("data:image/svg+xml,' + encodeURIComponent(this._tileSVG()) + '")';
    el.style.backgroundSize = `${s.patternSize}px ${s.patternSize}px`;
    el.style.backgroundRepeat = 'repeat';

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

  _tileSVG() {
    const s = this._state;
    const c1 = s.colorC1, c2 = s.colorC2, c3 = s.colorC3, c4 = s.colorC4;
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">' +
      `<polygon points="50,50 0,0 50,0" fill="${c1}"/>` +
      `<polygon points="50,50 50,100 0,100" fill="${c1}"/>` +
      `<polygon points="50,50 50,0 100,0" fill="${c2}"/>` +
      `<polygon points="50,50 100,100 50,100" fill="${c2}"/>` +
      `<polygon points="50,50 0,50 0,0" fill="${c3}"/>` +
      `<polygon points="50,50 100,0 100,50" fill="${c3}"/>` +
      `<polygon points="50,50 0,50 0,100" fill="${c4}"/>` +
      `<polygon points="50,50 100,50 100,100" fill="${c4}"/>` +
      '</svg>'
    );
  }

  _renderAtTime(envSec) {
    const sec = envSec < 0 ? envSec : (this._contentSec ?? envSec);
    _POW = this._state.easePower ?? 3;
    this._lastSec = envSec;
    const s = this._state;
    const el = this._els.swatch;

    el.style.backgroundPosition = `${sec * s.scrollSpeedX}px ${sec * s.scrollSpeedY}px`;

    const env = clamp01(
      easeOut(progress(envSec, s.animInStart, s.animInDuration)) -
      easeIn(progress(envSec, s.animOutStart, s.animOutDuration))
    );
    el.style.opacity = String(env * s.opacity);
    el.style.transform =
      `translate(${s.posX}px, ${s.posY}px) scale(${Number(s.scale).toFixed(4)})`;
  }
}

export default Pinwheel;
