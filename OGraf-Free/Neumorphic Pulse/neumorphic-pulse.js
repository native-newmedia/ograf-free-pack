/** neumorphic-pulse.js: Soft-UI neumorphic panel that raises in, periodically presses/releases like a button, then raises back out. */

import { _normaliseColors as _normaliseColorsBase, easeOut as _easeOut, easeIn as _easeIn, clamp01, progress, replaySchedule, envelope } from './ograf-helpers.js';

let _POW = 3;
const easeOut = (t) => _easeOut(t, _POW);
const easeIn  = (t) => _easeIn(t, _POW);
import { _shadeRgba } from './ograf-helpers.js';

function unpackBridge(d) {
  const s = d && d.bridgeJson;
  if (typeof s !== 'string' || !s.trim()) return d;
  try {
    const o = JSON.parse(s);
    return o && typeof o === 'object' && !Array.isArray(o) ? { ...d, ...o } : d;
  } catch { return d; }
}
const _normaliseColors = (data) => _normaliseColorsBase(unpackBridge(data));

const DEFAULT_STATE = {
  introDuration: 0.7,   // s, = manifest actionDurations.playAction / 1000
  outroDuration: 0.5,   // s, = manifest actionDurations.stopAction / 1000
  easePower: 3,
  label:            'Confirm',
  bgColor:          '#e0e5ec',
  accentColor:      '#00d2ff',
  shape:            1,
  neuShape:         1,
  lightSource:      1,
  size:             220,
  cornerRadius:     32,
  shadowDistance:   20,
  pressDepth:       0.7,
  iconType:         2,
  showLabel:        true,
  pulseEnabled:     true,
  pulseInterval:    2.2,
  pulseDuration:    0.6,
  posX:             0,
  posY:             0,
  scale:            1.0,
  animInStart: 0,
  animInDuration: 0.7,
  animOutStart: 100,
  animOutDuration: 0.5,
};

const ICON_PATHS = {
  check: '<path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  heart: '<path d="M12 20.5s-7.2-4.4-9.7-9.1C.7 8 1.8 3.8 6 3.8c2.1 0 3.6 1.5 4 3 .4-1.5 1.9-3 4-3 4.2 0 5.3 4.2 3.7 7.6-2.5 4.7-9.7 9.1-9.7 9.1z" fill="currentColor" stroke="none"/>',
  power: '<path d="M12 3v8" stroke-linecap="round"/><path d="M18 6.6a9 9 0 1 1-12 0" fill="none" stroke-linecap="round"/>',
  lock:  '<rect x="5" y="11" width="14" height="9" rx="2" fill="none"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11" fill="none" stroke-linecap="round"/>',
  star:  '<path d="M12 2.5l2.9 6.3 6.9.7-5.2 4.7 1.5 6.8L12 17.7 5.9 21l1.5-6.8L2.2 9.5l6.9-.7z" fill="currentColor" stroke="none"/>',
};

const LIGHT_SOURCES = {
  1: { sx:  1, sy:  1, angle: 145, name: 'Top Left'     },
  2: { sx: -1, sy:  1, angle: 225, name: 'Top Right'    },
  3: { sx: -1, sy: -1, angle: 315, name: 'Bottom Right' },
  4: { sx:  1, sy: -1, angle: 45,  name: 'Bottom Left'  },
};

const SHAPE_NAMES = { 1: 'rounded-square', 2: 'circle', 3: 'pill' };
const ICON_NAMES  = { 1: 'none', 2: 'check', 3: 'heart', 4: 'power', 5: 'lock', 6: 'star' };

const NEU_SHAPE_NAMES = {
  1: 'flat',
  2: 'concave',
  3: 'convex',
  4: 'pressed',
};

class NeumorphicPulse extends HTMLElement {

  constructor() {
    super();
    this._state = { ...DEFAULT_STATE };
    this._shadow = this.attachShadow({ mode: 'open' });
    this._shadow.innerHTML = `
      <style>
        :host { display:block; position:absolute; inset:0; width:100%; height:100%; overflow:hidden; }
        .stage {
          position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
        }
        /* Neumorphism only reads correctly when the surrounding surface is the
           SAME colour as the shape — the shape is "extruded" from one flat
           surface using shadow alone, never a different-coloured card on top
           of a different-coloured backdrop. .stage's background is set to
           bgColor every frame in _applyColorsAndShadow(). */
        .panel {
          position:relative; display:flex; flex-direction:column; align-items:center; justify-content:center;
          gap:14px; transform-origin:center center;
        }
        .icon { display:block; }
        .icon svg { display:block; }
        .label {
          font-family: 'DM Sans', 'Segoe UI', Arial, sans-serif;
          font-weight: 600; letter-spacing: 0.01em; text-align:center;
          user-select:none;
        }
      </style>
      <div class="stage">
        <div class="panel">
          <div class="icon"></div>
          <div class="label"></div>
        </div>
      </div>
    `;
    this._els = {
      stage: this._shadow.querySelector('.stage'),
      panel: this._shadow.querySelector('.panel'),
      icon:  this._shadow.querySelector('.icon'),
      label: this._shadow.querySelector('.label'),
    };
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

  async playAction(params)  { return { statusCode: 200, currentStep: 0 }; }
  async stopAction(params)  { return { statusCode: 200 }; }

  async customAction(params) {
    const id = params?.id;
    const now = performance.now();
    if (id === this._lastActionId && (now - (this._lastActionTime ?? 0)) < 200) {
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

    const shape = SHAPE_NAMES[s.shape] || s.shape;
    const iconType = ICON_NAMES[s.iconType] || s.iconType;

    let radius;
    if (shape === 'circle') radius = '50%';
    else if (shape === 'pill') radius = `${Math.round(s.size / 2)}px`;
    else radius = `${s.cornerRadius}px`;

    this._els.panel.style.width  = `${shape === 'pill' ? Math.round(s.size * 1.8) : s.size}px`;
    this._els.panel.style.height = `${s.size}px`;
    this._els.panel.style.borderRadius = radius;

    if (iconType !== 'none') {
      const path = ICON_PATHS[iconType] || ICON_PATHS.check;
      const iconSize = Math.round(s.size * 0.34);
      this._els.icon.innerHTML =
        `<svg viewBox="0 0 24 24" width="${iconSize}" height="${iconSize}" stroke="currentColor" stroke-width="2.2">${path}</svg>`;
      this._els.icon.style.display = 'block';
    } else {
      this._els.icon.style.display = 'none';
    }

    this._els.label.style.display = s.showLabel ? 'block' : 'none';
    this._els.label.textContent = s.label;
    this._els.label.style.fontSize = `${Math.round(s.size * 0.1)}px`;
  }

  _renderAtTime(envSec) {
    const sec = envSec < 0 ? envSec : (this._contentSec ?? envSec);
    _POW = this._state.easePower ?? 3;
    this._lastSec = envSec;
    const s = this._state;

    const env = clamp01(
      easeOut(progress(envSec, s.animInStart, s.animInDuration)) -
      easeIn(progress(envSec, s.animOutStart, s.animOutDuration))
    );

    let pressT = 0;
    const holdStart = s.animInStart + s.animInDuration;
    const holdEnd   = s.animOutStart;
    if (s.pulseEnabled && sec >= holdStart && sec < holdEnd && s.pulseInterval > 0) {
      const cycle = (sec - holdStart) % s.pulseInterval;
      const dur = Math.max(0.05, Math.min(s.pulseDuration, s.pulseInterval));
      const phase = cycle / dur;
      pressT = phase <= 1 ? Math.sin(Math.min(1, phase) * Math.PI) : 0;
    }

    this._applyColorsAndShadow(pressT, env);

    const envScale   = 0.85 + 0.15 * env;
    const pressScale = 1 - pressT * 0.035;
    const totalScale = s.scale * envScale * pressScale;
    this._els.panel.style.opacity   = '1';
    this._els.stage.style.opacity   = String(env);
    this._els.panel.style.transform =
      `translate(${s.posX}px, ${s.posY}px) scale(${totalScale.toFixed(4)})`;

    this._els.icon.style.color  = s.accentColor;
    this._els.label.style.color = s.accentColor;
    this._els.label.style.opacity = String(1 - pressT * 0.25);
  }

  _applyColorsAndShadow(pressT, env) {
    const s = this._state;

    this._els.stage.style.background = s.bgColor;
    this._els.panel.style.background = s.bgColor;

    const dist = s.shadowDistance;
    const blur = dist * 1.1;
    const insetDist = dist * 0.5;
    const insetBlur = blur * 0.7;

    const shade = 0.35 + s.pressDepth * 0.35;
    const neuShape = NEU_SHAPE_NAMES[s.neuShape] || s.neuShape || 'flat';

    const ls = LIGHT_SOURCES[Math.round(s.lightSource) || 1] || LIGHT_SOURCES[1];
    const sx = ls.sx, sy = ls.sy;
    const fmt = n => Math.round(n * 100) / 100;

    const raisedAlpha  = (1 - pressT) * env;
    const pressedAlpha = pressT * env;
    const lightRaised = _shadeRgba(s.bgColor,  shade, raisedAlpha * 0.9);
    const darkRaised  = _shadeRgba(s.bgColor, -shade, raisedAlpha * 0.9);

    const darkPressed  = _shadeRgba(s.bgColor, -shade, pressedAlpha * 0.8);
    const lightPressed = _shadeRgba(s.bgColor,  shade, pressedAlpha * 0.8);

    let shadows;
    if (neuShape === 'pressed') {
      const deepInset = insetDist * (1 + pressT * 0.4);
      shadows = [
        `inset ${fmt(sx * deepInset)}px ${fmt(sy * deepInset)}px ${fmt(insetBlur)}px ${_shadeRgba(s.bgColor, -shade, env * 0.8)}`,
        `inset ${fmt(-sx * deepInset)}px ${fmt(-sy * deepInset)}px ${fmt(insetBlur)}px ${_shadeRgba(s.bgColor,  shade, env * 0.8)}`,
      ];
    } else {
      shadows = [
        `${fmt(sx * dist)}px ${fmt(sy * dist)}px ${fmt(blur)}px ${darkRaised}`,
        `${fmt(-sx * dist)}px ${fmt(-sy * dist)}px ${fmt(blur)}px ${lightRaised}`,
        `inset ${fmt(-sx * insetDist)}px ${fmt(-sy * insetDist)}px ${fmt(insetBlur)}px ${lightPressed}`,
        `inset ${fmt(sx * insetDist)}px ${fmt(sy * insetDist)}px ${fmt(insetBlur)}px ${darkPressed}`,
      ];
    }
    this._els.panel.style.boxShadow = shadows.join(', ');

    if (neuShape === 'convex' || neuShape === 'concave') {
      const gradShade = shade * 0.5 * (1 - pressT * 0.5);
      const lightG = _shadeRgba(s.bgColor,  gradShade, 1);
      const darkG  = _shadeRgba(s.bgColor, -gradShade, 1);
      const first  = neuShape === 'convex' ? lightG : darkG;
      const second = neuShape === 'convex' ? darkG  : lightG;
      this._els.panel.style.background = `linear-gradient(${ls.angle}deg, ${first}, ${second})`;
    } else {
      this._els.panel.style.background = s.bgColor;
    }
  }
}

export default NeumorphicPulse;
