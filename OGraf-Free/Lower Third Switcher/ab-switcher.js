/** ab-switcher.js: Two lower-third layouts in one graphic. */

import { _normaliseColors as _ncBase, easeOut as _easeOut, easeIn as _easeIn, clamp01, progress, _detectFormat, replaySchedule } from './ograf-helpers.js';

const SELECT_LISTS = {"currentLayout": ["a", "b"]};
const _normaliseColors = (d) => {
  const o = _ncBase(d);
  if (o && typeof o === 'object') for (const [k, list] of Object.entries(SELECT_LISTS)) {
    if (typeof o[k] === 'number') o[k] = list[Math.min(list.length, Math.max(1, Math.round(o[k]))) - 1];
  }
  return o;
};

let _POW = 3;
const easeOut = (t) => _easeOut(t, _POW);
const easeIn  = (t) => _easeIn(t, _POW);

const DEFAULT_STATE = {
  introDuration: 0.5,   // s, = manifest actionDurations.playAction / 1000
  outroDuration: 0.4,   // s, = manifest actionDurations.stopAction / 1000
  easePower: 3,
  currentLayout:  'a',
  nameA:          'Sarah Johnson',
  titleA:         'CEO, Acme Corp',
  subtitleA:      'London',
  nameB:          'James Chen',
  titleB:         'CTO, Acme Corp',
  subtitleB:      'New York',
  accentColor:    '#00d2ff',
  bgOpacity:      0.88,
  stagger:        0.15, 
  scale:          2.0,
};


function foldRows(base, rows, key, step) {
  let st = { ...base };
  let seen = base[key];
  for (const e of rows) {
    const a = e.action || {};
    if (a.type === 'updateAction') {
      const d = _normaliseColors(a.params?.data || {});
      const kept = st[key];
      st = { ...st, ...d };
      if (key in d) { if (d[key] === seen) st[key] = kept; seen = d[key]; }
    } else if (a.type === 'customAction') {
      st[key] = step(st[key], a.params?.id ?? a.params?.customActionId);
    }
  }
  return st;
}

const STYLE_TEXT = `
  :host {
    display: block;
    position: absolute;
    inset: 0;
    overflow: hidden;
    font-family: 'Helvetica Neue', Arial, sans-serif;
    --scale: 1;
    --safe-top:    108px;
    --safe-right:  192px;
    --safe-bottom: 108px;
    --safe-left:   192px;
  }

  .scene {
    position: absolute;
    bottom: var(--safe-bottom, 108px);
    left:   var(--safe-left, 192px);
    display: grid;          /* A and B share one cell, so the scene takes the size of the wider layout */
    align-items: end;
  }

  .layout-slot {
    grid-area: 1 / 1;
  }

  .card {
    display: flex;
    flex-direction: row;
    align-items: stretch;
    border-radius: 6px;
    overflow: hidden;
  }

  .accent-bar {
    width: calc(6px * var(--scale));
    flex-shrink: 0;
  }

  .text-block {
    padding: calc(12px * var(--scale)) calc(18px * var(--scale));
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: calc(4px * var(--scale));
    flex: 1;
  }

  .name-text {
    font-size: calc(22px * var(--scale));
    font-weight: 700;
    color: #ffffff;
    letter-spacing: 0.02em;
    line-height: 1.1;
    white-space: nowrap;
  }

  .subtitle-row {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 0;
    font-size: calc(13px * var(--scale));
    font-weight: 400;
    color: rgba(255,255,255,0.8);
    white-space: nowrap;
  }

  .title-text {
    /* inline */
  }

  .sep {
    margin: 0 8px;
    opacity: 0.5;
  }

  .subtitle-text {
    /* inline */
  }
`;

class ABSwitcher extends HTMLElement {
  constructor() {
    super();
    this._shadow = this.attachShadow({ mode: 'open' });
    this._state  = { ...DEFAULT_STATE };
    this._schedule = [];   
    this._els    = {};
    this._built  = false;
    this._initialData = {};
    this._optimistic = [];  
    this._lastMs = 0;
  }

  _build() {
    if (this._built) return;
    this._built = true;

    const style = document.createElement('style');
    style.textContent = STYLE_TEXT;

    const scene = document.createElement('div');
    scene.className = 'scene';

    const slotA = document.createElement('div');
    slotA.className = 'layout-slot';

    const cardA = document.createElement('div');
    cardA.className = 'card';

    const accentBarA = document.createElement('div');
    accentBarA.className = 'accent-bar';

    const textBlockA = document.createElement('div');
    textBlockA.className = 'text-block';

    const nameA = document.createElement('div');
    nameA.className = 'name-text';

    const subRowA = document.createElement('div');
    subRowA.className = 'subtitle-row';

    const titleA = document.createElement('span');
    titleA.className = 'title-text';

    const sepA = document.createElement('span');
    sepA.className = 'sep';
    sepA.textContent = '|';

    const subtitleA = document.createElement('span');
    subtitleA.className = 'subtitle-text';

    subRowA.appendChild(titleA);
    subRowA.appendChild(sepA);
    subRowA.appendChild(subtitleA);
    textBlockA.appendChild(nameA);
    textBlockA.appendChild(subRowA);
    cardA.appendChild(accentBarA);
    cardA.appendChild(textBlockA);
    slotA.appendChild(cardA);

    const slotB = document.createElement('div');
    slotB.className = 'layout-slot';

    const cardB = document.createElement('div');
    cardB.className = 'card';

    const accentBarB = document.createElement('div');
    accentBarB.className = 'accent-bar';

    const textBlockB = document.createElement('div');
    textBlockB.className = 'text-block';

    const nameB = document.createElement('div');
    nameB.className = 'name-text';

    const subRowB = document.createElement('div');
    subRowB.className = 'subtitle-row';

    const titleB = document.createElement('span');
    titleB.className = 'title-text';

    const sepB = document.createElement('span');
    sepB.className = 'sep';
    sepB.textContent = '|';

    const subtitleB = document.createElement('span');
    subtitleB.className = 'subtitle-text';

    subRowB.appendChild(titleB);
    subRowB.appendChild(sepB);
    subRowB.appendChild(subtitleB);
    textBlockB.appendChild(nameB);
    textBlockB.appendChild(subRowB);
    cardB.appendChild(accentBarB);
    cardB.appendChild(textBlockB);
    slotB.appendChild(cardB);

    scene.appendChild(slotA);
    scene.appendChild(slotB);

    this._shadow.appendChild(style);
    this._shadow.appendChild(scene);

    this._els = {
      scene,
      slotA, accentBarA, nameA, titleA, subtitleA, textBlockA, subRowA,
      slotB, accentBarB, nameB, titleB, subtitleB, textBlockB, subRowB,
    };
  }

  _applyState() {
    const s = this._state;
    const { accentColor, bgOpacity } = s;

    const bgRgb = '20,20,20';
    const bg = `rgba(${bgRgb},${bgOpacity})`;

    this._els.textBlockA.style.background = bg;
    this._els.textBlockB.style.background = bg;
    this._els.accentBarA.style.background = accentColor;
    this._els.accentBarB.style.background = accentColor;

    this._els.nameA.textContent     = s.nameA;
    this._els.titleA.textContent    = s.titleA;
    this._els.subtitleA.textContent = s.subtitleA;
    this._els.nameB.textContent     = s.nameB;
    this._els.titleB.textContent    = s.titleB;
    this._els.subtitleB.textContent = s.subtitleB;

    this._els.slotA.querySelector('.sep').style.display = s.subtitleA ? '' : 'none';
    this._els.slotB.querySelector('.sep').style.display = s.subtitleB ? '' : 'none';

    const fmt  = this.getAttribute('data-format') || 'landscape';
    const safe = this._safeFromEdge(fmt, this._canvasW || 1920, this._canvasH || 1080);
    const scene = this._els.scene;
    scene.style.setProperty('bottom', safe.bottom + 'px');
    scene.style.setProperty('left',   safe.left   + 'px');
    scene.style.removeProperty('right');
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

  _showLayout(layout) {
    const { slotA, slotB } = this._els;
    slotA.style.opacity = layout === 'a' ? '1' : '0';
    slotB.style.opacity = layout === 'b' ? '1' : '0';
  }

 
  _calcTimings() {
    const { stagger, introDuration, outroDuration } = this._state;
    const sIn  = Math.min(stagger, introDuration * 0.2);
    const sOut = Math.min(stagger, outroDuration * 0.2);
    const dIn  = introDuration - sIn * 3;
    const dOut = outroDuration - sOut * 3;
    return {
      barIn:    { start: 0,        dur: dIn },
      bgIn:     { start: sIn,      dur: dIn },
      nameIn:   { start: sIn * 2,  dur: dIn },
      subIn:    { start: sIn * 3,  dur: dIn },
      subOut:   { start: 0,        dur: dOut },
      nameOut:  { start: sOut,     dur: dOut },
      bgOut:    { start: sOut * 2, dur: dOut },
      barOut:   { start: sOut * 3, dur: dOut },
    };
  }


  _renderAtTime(secIn, secOut) {
    _POW = this._state.easePower ?? 3;
    const t = this._calcTimings();
    const P = (i, o) => secIn === null ? 0 : clamp01(
      easeOut(progress(secIn, i.start, i.dur)) - (secOut === null ? 0 : easeIn(progress(secOut, o.start, o.dur)))
    );
    const barP = P(t.barIn, t.barOut), bgP = P(t.bgIn, t.bgOut);
    const nameP = P(t.nameIn, t.nameOut), subP = P(t.subIn, t.subOut);
    const e = this._els;
    for (const k of ['A', 'B']) {
      e['accentBar' + k].style.opacity = barP;
      e['accentBar' + k].style.transform = `scaleY(${barP})`;
      e['textBlock' + k].style.opacity = bgP;
      e['name' + k].style.opacity = nameP;
      e['name' + k].style.transform = `translateY(calc(${(1 - nameP) * 14}px * var(--scale)))`;
      e['subRow' + k].style.opacity = subP;
      e['subRow' + k].style.transform = `translateY(calc(${(1 - subP) * 10}px * var(--scale)))`;
    }
    this._showLayout(this._state.currentLayout);
  }

  async load(params) {
    this._build();
    this._initialData = _normaliseColors(params?.data || {});
    this._state = { ...DEFAULT_STATE, ...this._initialData };
    this._seen = this._state.currentLayout;
    this._optimistic = [];
    this._lastMs = 0;
    this._detectedFormat = _detectFormat(params);
    const fmt = this._detectedFormat;
    const res = params?.renderCharacteristics?.resolution;
    this._canvasW = res?.width  || 1920;
    this._canvasH = res?.height || 1080;
    this.setAttribute('data-format', fmt);
    this._applySafeVars(fmt);
    this._watchSize();
    this._syncSize();
    this._paintAt(0);
    return { statusCode: 200 };
  }

  async dispose() {
    this._unwatchSize();
    return { statusCode: 200 };
  }

  async playAction(params) {
    return { statusCode: 200, currentStep: 0 };
  }

  async stopAction(params) {
    return { statusCode: 200 };
  }

  async setActionsSchedule(params) {
    const raw = params?.schedule || params?.actions || [];
    this._schedule = raw.slice().sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
    this._optimistic = [];  
    return { statusCode: 200 };
  }

  async customAction(params) {
    const id = params?.id ?? params?.customActionId;
    const now = performance.now();
    if (id === this._lastActionId && (now - (this._lastActionTime ?? 0)) < 200) {
      return { statusCode: 200 };   
    }
    this._lastActionId   = id;
    this._lastActionTime = now;
    this._optimistic.push({ timestamp: this._lastMs, action: { type: 'customAction', params: { id } } });
    this._paintAt(this._lastMs);
    return { statusCode: 200 };
  }

  _stepLayout(cur, id) {
    if (id === 'a' || id === 'b') return id;
    if (id === 'toggle') return cur === 'a' ? 'b' : 'a';
    return cur;
  }

  _stateAt(ms) {
    const rows = this._schedule.concat(this._optimistic)
      .filter((e) => (e.timestamp ?? 0) <= ms)
      .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
    return foldRows({ ...DEFAULT_STATE, ...this._initialData }, rows, 'currentLayout', (c, id) => this._stepLayout(c, id));
  }

  async updateAction(params) {
    const d = _normaliseColors(params?.data || {});
    const kept = { ...DEFAULT_STATE, ...this._initialData }.currentLayout;
    this._initialData = { ...this._initialData, ...d };
    if ('currentLayout' in d) {
      if (d.currentLayout === this._seen) this._initialData.currentLayout = kept;   
      else this._optimistic = [];                                                    
      this._seen = d.currentLayout;
    }
    this._paintAt(this._lastMs);
    return { statusCode: 200 };
  }

  async goToTime(params) {
    this._syncSize();
    const ms = typeof params === 'number' ? params
             : (typeof params?.timestamp === 'number' ? params.timestamp : 0);
    this._paintAt(ms);
    return { statusCode: 200 };
  }

  _paintAt(ms) {
    this._lastMs = ms;
    // ms -> s: the / 1000 conversion lives in replaySchedule
    const rep = replaySchedule(this._schedule, ms, {}, (d) => d);
    this._contentSec = rep.secIn ?? 0;
    this._state = this._stateAt(ms);
    this.style.setProperty('--scale', String(this._state.scale ?? 1.0));
    this._applyState();
    _POW = this._state.easePower ?? 3;
    this._renderAtTime(rep.secIn, rep.secOut);
  }
}

export default ABSwitcher;
