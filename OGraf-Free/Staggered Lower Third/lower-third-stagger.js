/** OGraf Lower Third, staggered: timing comes from the schedule (Play/Stop rows), not from properties. */

import { _normaliseColors as _ncBase, easeOut, easeIn, clamp01, progress, _detectFormat, replaySchedule } from './ograf-helpers.js';

const _normaliseColors = (d) => {
  if (!d || typeof d !== 'object') return d;
  const o = { ...d };
  const h = (x) => Math.round((x ?? 0) * 255).toString(16).padStart(2, '0');
  for (const k of ['backgroundColor', 'titleColor']) {
    const v = o[k];
    if (v && typeof v === 'object' && 'r' in v && 'a' in v) o[k] = `#${h(v.r)}${h(v.g)}${h(v.b)}${h(v.a ?? 1)}`;
  }
  return _ncBase(o);
};
function _rgba(hex) {
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(String(hex));
  if (!m) return String(hex);
  const n = parseInt(m[1], 16), a = m[2] ? parseInt(m[2], 16) / 255 : 1;
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
}

const DEFAULT_STATE = {
  name:            'John Doe',
  title:           'Senior Producer',
  accentColor:     '#00d2ff',
  backgroundColor: '#0000009e',
  showBackground:  true,
  nameColor:       '#ffffff',
  titleColor:      '#ffffffc7',
  barWidth:        6,
  posX:            10,
  posY:            90,
  stagger:         0.15,
  easePower:       3,
  introDuration:   1.2,   // s — default = actionDurations.playAction / 1000
  outroDuration:   0.8,   // s — default = actionDurations.stopAction / 1000
  scale:           1.0,
};

const STYLE_TEXT = `
  :host {
    display: block;
    position: absolute;
    inset: 0;
    pointer-events: none;
    font-family: 'Helvetica Neue', Arial, sans-serif;
    --scale: 1;
    --safe-top:    108px;
    --safe-right:  192px;
    --safe-bottom: 108px;
    --safe-left:   192px;
  }
  .scene {
    position: absolute;
    display: flex;
    flex-direction: row;
    align-items: stretch;
    overflow: hidden;
  }
  .accent-bar {
    flex-shrink: 0;
    width: calc(6px * var(--scale));
    background: #00d2ff;
    transform-origin: top center;
    opacity: 0;
    transform: scaleY(0);
  }
  .text-block {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: calc(6px * var(--scale));
    padding: calc(18px * var(--scale)) calc(48px * var(--scale)) calc(18px * var(--scale)) calc(20px * var(--scale));
    background: var(--bg, rgba(0, 0, 0, 0.62));
    opacity: 0;
  }
  .name {
    font-size: calc(42px * var(--scale));
    font-weight: 700;
    color: var(--name-color, #ffffff);
    letter-spacing: 0.02em;
    line-height: 1;
    white-space: nowrap;
    opacity: 0;
    transform: translateY(calc(14px * var(--scale)));
  }
  .title {
    font-size: calc(22px * var(--scale));
    font-weight: 400;
    color: var(--title-color, rgba(255, 255, 255, 0.78));
    letter-spacing: 0.04em;
    white-space: nowrap;
    opacity: 0;
    transform: translateY(calc(10px * var(--scale)));
  }
`;

class LowerThirdStagger extends HTMLElement {

  constructor() {
    super();
    this._state = { ...DEFAULT_STATE };
    this._initialData = {};
    this._schedule = [];

    const root  = this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLE_TEXT;

    const scene         = document.createElement('div');
    scene.className     = 'scene';
    const bar           = document.createElement('div');
    bar.className       = 'accent-bar';
    const textBlock     = document.createElement('div');
    textBlock.className = 'text-block';
    const nameEl        = document.createElement('div');
    nameEl.className    = 'name';
    const titleEl       = document.createElement('div');
    titleEl.className   = 'title';

    textBlock.append(nameEl, titleEl);
    scene.append(bar, textBlock);
    root.append(style, scene);
    this._els = { scene, bar, textBlock, nameEl, titleEl };
  }

  async load(params) {
    this._initialData = _normaliseColors(params.data || {});
    this._state = { ...DEFAULT_STATE, ...this._initialData };
    this._schedule = [];
    this._detectedFormat = _detectFormat(params);
    const fmt = this._detectedFormat;
    const res = params?.renderCharacteristics?.resolution;
    this._canvasW = res?.width  || 1920;
    this._canvasH = res?.height || 1080;
    this.setAttribute('data-format', fmt);
    this._applySafeVars(fmt);
    this._watchSize();
    this._syncSize();
    this.style.setProperty('--scale', String(this._state.scale ?? 1.0));
    this._applyState();
    this._renderAtTime(0);
    return { statusCode: 200 };
  }

  async dispose() {
    this._unwatchSize();
    return { statusCode: 200 };
  }

  async playAction(params) {
    this._renderAtTime(this._state.introDuration);
    return { statusCode: 200, currentStep: 0 };
  }

  async stopAction(params) {
    if (params?.skipAnimation === true) {
      this._applyFrame(0, 0, 0, 0);
    } else {
      this._renderAtTime(this._state.introDuration, this._state.outroDuration);
    }
    return { statusCode: 200 };
  }

  async customAction() {
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
    this.style.setProperty('--scale', String(this._state.scale ?? 1.0));
    this._applyState();
    return { statusCode: 200 };
  }

  async goToTime(payload) {
    this._syncSize();
    const timestamp = typeof payload === 'number' ? payload
                     : (typeof payload?.timestamp === 'number' ? payload.timestamp : 0);
    // ms -> s: the / 1000 conversion lives in replaySchedule
    const { state, secIn, secOut } = replaySchedule(this._schedule, timestamp, { ...DEFAULT_STATE, ...this._initialData }, _normaliseColors);
    this._state = state;
    this.style.setProperty('--scale', String(this._state.scale ?? 1.0));
    this._applyState();
    if (secIn === null) this._applyFrame(0, 0, 0, 0);
    else this._renderAtTime(secIn, secOut);
    return { statusCode: 200 };
  }

  _calcTimings() {
    const { stagger, introDuration, outroDuration } = this._state;
    const elDurIn  = Math.max(0.05, introDuration - stagger * 3) * 0.9;
    const elDurOut = Math.max(0.05, outroDuration - stagger * 3) * 0.9;
    return {
      barIn:   { start: 0,           dur: elDurIn },
      bgIn:    { start: stagger,     dur: elDurIn },
      nameIn:  { start: stagger * 2, dur: elDurIn },
      titleIn: { start: stagger * 3, dur: elDurIn },
      titleOut: { start: 0,           dur: elDurOut },
      nameOut:  { start: stagger,     dur: elDurOut },
      bgOut:    { start: stagger * 2, dur: elDurOut },
      barOut:   { start: stagger * 3, dur: elDurOut },
    };
  }

  _renderAtTime(secIn, secOut = null) {
    const t = this._calcTimings();
    const pw = this._state.easePower ?? 3;
    const P = (inT, outT) => clamp01(easeOut(progress(secIn, inT.start, inT.dur), pw)
      - (secOut === null ? 0 : easeIn(progress(secOut, outT.start, outT.dur), pw)));
    this._applyFrame(P(t.barIn, t.barOut), P(t.bgIn, t.bgOut), P(t.nameIn, t.nameOut), P(t.titleIn, t.titleOut));
  }

  _applyFrame(barP, bgP, nameP, titleP) {
    const { bar, textBlock, nameEl, titleEl } = this._els;
    bar.style.opacity       = barP;
    bar.style.transform     = `scaleY(${barP})`;
    textBlock.style.opacity = bgP;
    nameEl.style.opacity    = nameP;
    nameEl.style.transform  = `translateY(calc(${(1 - nameP) * 14}px * var(--scale)))`;
    titleEl.style.opacity   = titleP;
    titleEl.style.transform = `translateY(calc(${(1 - titleP) * 10}px * var(--scale)))`;
  }

  _safeFromEdge(format, canvasW, canvasH) {
    let cropX, cropW, cropH;
    if (format === 'square') {
      cropW = canvasH; cropH = canvasH;
      cropX = (canvasW - cropW) / 2;
    } else if (format === 'portrait') {
      cropW = canvasH * (9 / 16); cropH = canvasH;
      cropX = (canvasW - cropW) / 2;
    } else {
      cropW = canvasW; cropH = canvasH; cropX = 0;
    }
    const m = {
      landscape: { t: 0.10, r: 0.10, b: 0.10, l: 0.10 },
      square:    { t: 0.12, r: 0.12, b: 0.12, l: 0.12 },
      portrait:  { t: 0.15, r: 0.08, b: 0.20, l: 0.08 },
    }[format] || { t: 0.10, r: 0.10, b: 0.10, l: 0.10 };
    return {
      top:    cropH * m.t,
      right:  canvasW - cropX - cropW + cropW * m.r,
      bottom: cropH * m.b,
      left:   cropX + cropW * m.l,
    };
  }

  _syncSize() {
    const r = this.getBoundingClientRect();
    const w = Math.round(r.width), h = Math.round(r.height);
    if (!w || !h || (w === this._canvasW && h === this._canvasH)) return;
    this._canvasW = w; this._canvasH = h;
    this._detectedFormat = _detectFormat({ renderCharacteristics: { resolution: { width: w, height: h } } });
    this.setAttribute('data-format', this._detectedFormat);
    this._applySafeVars(this._detectedFormat);
    this._applyState();
  }

  _watchSize() {
    this._onSize = () => this._syncSize();
    try { this._ro = new ResizeObserver(this._onSize); this._ro.observe(this); } catch (e) {}
    window.addEventListener('resize', this._onSize);
  }

  _unwatchSize() {
    try { this._ro && this._ro.disconnect(); } catch (e) {}
    if (this._onSize) window.removeEventListener('resize', this._onSize);
  }

  _applySafeVars(format) {
    const safe = this._safeFromEdge(format, this._canvasW || 1920, this._canvasH || 1080);
    this.style.setProperty('--safe-top',    safe.top    + 'px');
    this.style.setProperty('--safe-right',  safe.right  + 'px');
    this.style.setProperty('--safe-bottom', safe.bottom + 'px');
    this.style.setProperty('--safe-left',   safe.left   + 'px');
  }

  _applyState() {
    const { name, title, accentColor, backgroundColor, showBackground, nameColor, titleColor, barWidth, posX, posY } = this._state;
    const { scene, bar, nameEl, titleEl } = this._els;
    nameEl.textContent   = name  || '';
    titleEl.textContent  = title || '';
    bar.style.background = accentColor || '#00d2ff';
    scene.style.setProperty('--bg', showBackground === false ? 'transparent' : _rgba(backgroundColor));
    scene.style.setProperty('--name-color', _rgba(nameColor));
    scene.style.setProperty('--title-color', _rgba(titleColor));
    bar.style.width      = `calc(${Math.round(barWidth) || 6}px * var(--scale))`;
    const fmt  = this.getAttribute('data-format') || 'landscape';
    const safe = this._safeFromEdge(fmt, this._canvasW || 1920, this._canvasH || 1080);

    scene.style.removeProperty('right');
    scene.style.removeProperty('transform');
    scene.style.setProperty('left',   Number(posX ?? 10) + '%');
    scene.style.setProperty('bottom', (100 - Number(posY ?? 90)) + '%');
  }
}

export default LowerThirdStagger;
