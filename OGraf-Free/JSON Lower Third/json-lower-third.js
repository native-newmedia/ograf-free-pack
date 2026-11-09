// ─ Asset + XHR helpers
function _resolveAssetPath(p) {
  p = String(p).trim().replace(/\\/g, '/');
  if (/^[A-Za-z]:\//.test(p)) p = 'file:///' + p;
  try { return new URL(p, import.meta.url).href; } catch { return p; }
}

function _xhrText(url) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.timeout   = 8000;
    xhr.onload    = () => xhr.responseText ? resolve(xhr.responseText) : reject('empty');
    xhr.onerror   = () => reject('network error');
    xhr.ontimeout = () => reject('timeout');
    xhr.send(null);
  });
}

import { parseJsonc, _normaliseColors, easeOut, easeIn, clamp01, progress, replaySchedule } from './ograf-helpers.js';

const DEFAULT_STATE = {
  accentColor:     '#00d2ff',
  nameColor:       '#ffffff',
  titleColor:      '#c9c9c9',
  locationColor:   '#ffffff',
  locationOpacity: 0.45,
  showLocation:    true,
  reloadData:      false,
  dataFile:        'data/data.jsonc',
  showAccentBar:   true,
  showLiveBug:     true,
  liveBugColor:    '#ffffff',
  liveBugBgColor:  '#e53030',
  introDuration:   0.6,   // s, = manifest actionDurations.playAction / 1000
  outroDuration:   0.4,   // s, = manifest actionDurations.stopAction / 1000
  easePower:       3,
  stagger:         0.12,
  scale:           1.5,
};

const FALLBACK_DATA = { name: '—', title: '—', location: '', live: false };

const STYLE_TEXT = `
  :host {
    display: block;
    position: absolute;
    inset: 0;
    pointer-events: none;
    font-family: "Inter", "DM Sans", sans-serif;
    --scale: 1;
  }
  .scene {
    position: absolute;
    left: max(5vw, calc(72px * var(--scale)));
    bottom: max(8vh, calc(86px * var(--scale)));
    display: flex;
    flex-direction: column;
    gap: 0;

  }
  .bar {
    height: calc(3px * var(--scale));
    background: var(--accent, #00d2ff);
    width: 0;
    margin-bottom: calc(10px * var(--scale));
  }
  .name {
    font-size: clamp(calc(28px * var(--scale)), 3.5vw, calc(42px * var(--scale)));
    font-weight: 700;
    color: var(--name-color, #ffffff);
    line-height: 1.1;
    letter-spacing: -0.01em;
  }
  .title-row {
    display: flex;
    align-items: center;
    gap: calc(10px * var(--scale));
    margin-top: calc(4px * var(--scale));
  }
  .title {
    font-size: clamp(calc(14px * var(--scale)), 1.6vw, calc(18px * var(--scale)));
    font-weight: 400;
    color: var(--title-color, #c9c9c9);
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }
  .location {
    font-size: clamp(calc(12px * var(--scale)), 1.4vw, calc(16px * var(--scale)));
    color: var(--location-color, #ffffff);
    font-weight: 300;
  }
  .live-bug {
    font-family: monospace;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--live-color, #ffffff);
    background: var(--live-bg, #e53030);
    padding: 2px 8px 3px;
    border-radius: 3px;
    display: none;
    align-items: center;
    gap: 5px;
  }
  .live-bug.visible { display: flex; }
  .live-dot {
    width: 6px; height: 6px;
    background: #fff;
    border-radius: 50%;
    /* Static (no pulse keyframes): NRT output must be a pure function of the
       timestamp — a wall-clock CSS animation would capture nondeterministically. */
  }
`;

class JsonLowerThird extends HTMLElement {

  constructor() {
    super();
    this._state    = { ...DEFAULT_STATE };
    this._initialData = {};
    this._schedule = [];
    this._jsonData = { ...FALLBACK_DATA };

    // playAction/stopAction are SYNCHRONOUS jumps to a representative frame, NEVER an async
    // requestAnimationFrame loop. Blackmagic's docs forbid
    // setTimeout/setInterval/requestAnimationFrame for animation under NRT: an async loop races
    // Fusion's synchronous frame capture and silently kills the ENTIRE Inspector, not just
    // animation.
    this._lastSec   = 0;

    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>${STYLE_TEXT}</style>
      <div class="scene">
        <div class="bar"></div>
        <div class="name"></div>
        <div class="title-row">
          <div class="title"></div>
          <div class="location"></div>
          <div class="live-bug"><div class="live-dot"></div> Live</div>
        </div>
      </div>
    `;

    this._els = {
      scene:    root.querySelector('.scene'),
      bar:      root.querySelector('.bar'),
      name:     root.querySelector('.name'),
      title:    root.querySelector('.title'),
      location: root.querySelector('.location'),
      liveBug:  root.querySelector('.live-bug'),
    };
  }

  async load(params) {
    this._initialData = _normaliseColors(params.data || {});
    this._state = { ...DEFAULT_STATE, ...this._initialData };
    this.style.setProperty('--scale', String(this._state.scale ?? 1.0));
    this._applyState();

    await this._fetchData();
    this._renderAtTime(0);
    return { statusCode: 200 };
  }

  async dispose() {
    return { statusCode: 200 };
  }

  _dataKey() { return (this._state.dataFile || 'data/data.jsonc') + '|' + (this._state.reloadData ? 1 : 0); }

  async _fetchData() {
    const file = this._state.dataFile || 'data/data.jsonc';
    this._loadedFile = this._dataKey();
    try {
      this._jsonData = parseJsonc(await _xhrText(_resolveAssetPath(file)));
    } catch (err) {
      console.warn('[JsonLowerThird] data load failed — using fallback', err);
      this._jsonData = { ...FALLBACK_DATA };
    }
    this._applyJsonData();
  }

  async playAction(params) {
    if (params?.skipAnimation === true) this._applyFullyShown();
    else this._renderAtTime(this._state.introDuration);
    return { statusCode: 200, currentStep: 0 };
  }

  async stopAction(params) {
    if (params?.skipAnimation === true) this._applyFullyHidden();
    else this._renderAtTime(this._state.introDuration, this._state.outroDuration);
    return { statusCode: 200 };
  }

  async customAction(params) {
    return { statusCode: 200 };
  }

  async setActionsSchedule(params) {
    const raw = params?.schedule || params?.actions || [];
    this._schedule = raw.slice().sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
    return { statusCode: 200 };
  }

  _applyUpdateData(params) {
    this._state = { ...this._state, ..._normaliseColors(params?.data || {}) };
    this.style.setProperty('--scale', String(this._state.scale ?? 1.0));
    this._applyState();
  }

  async updateAction(params) {
    this._initialData = { ...this._initialData, ..._normaliseColors(params?.data || {}) };
    this._applyUpdateData(params);
    if (this._dataKey() !== this._loadedFile) await this._fetchData();
    this._renderAtTime(this._lastSec);
    return { statusCode: 200 };
  }

  async goToTime(params) {
    const ms = typeof params === 'number' ? params : (params?.timestamp ?? 0);
    this._lastSec = ms / 1000;
    const { state, secIn, secOut } = replaySchedule(this._schedule, ms, { ...DEFAULT_STATE, ...this._initialData }, _normaliseColors);
    this._state = state;
    this.style.setProperty('--scale', String(this._state.scale ?? 1.0));
    this._applyState();
    if (this._dataKey() !== this._loadedFile) await this._fetchData();
    if (secIn === null) this._applyFullyHidden();
    else this._renderAtTime(secIn, secOut);
    return { statusCode: 200 };
  }

  _applyFullyShown() {
    this._els.bar.style.width = '100%';
    for (const el of [this._els.name, this._els.title, this._els.liveBug]) {
      el.style.opacity = 1;
      el.style.transform = 'translateY(0)';
    }
    this._els.location.style.opacity   = String(this._state.locationOpacity ?? 0.45);
    this._els.location.style.transform = 'translateY(0)';
  }

  _applyFullyHidden() {
    this._els.bar.style.width = '0%';
    for (const el of [this._els.name, this._els.title, this._els.location, this._els.liveBug]) {
      el.style.opacity = 0;
    }
  }

  _renderAtTime(secIn, secOut = null) {
    const { introDuration, outroDuration, stagger, locationOpacity, easePower } = this._state;
    const pw = easePower ?? 3;
    const elDurIn  = Math.max(0.05, introDuration - stagger * 2);
    const elDurOut = Math.max(0.05, outroDuration - stagger * 2);
    const P = (inS, outS) => clamp01(
      easeOut(progress(secIn, inS, elDurIn), pw) -
      (secOut === null ? 0 : easeIn(progress(secOut, outS, elDurOut), pw))
    );
    const barP   = P(0,           stagger * 2);
    const nameP  = P(stagger,     stagger);
    const titleP = P(stagger * 2, 0);

    this._els.bar.style.width = `${barP * 100}%`;

    this._els.name.style.opacity   = nameP;
    this._els.name.style.transform = `translateY(calc(${(1 - nameP) * 16}px * var(--scale)))`;

    this._els.title.style.opacity    = titleP;
    this._els.title.style.transform  = `translateY(calc(${(1 - titleP) * 10}px * var(--scale)))`;
    this._els.location.style.opacity = String((locationOpacity ?? 0.45) * titleP);
    this._els.liveBug.style.opacity  = titleP;
  }

  _applyJsonData() {
    const { name = '—', title = '—' } = this._jsonData;
    this._els.name.textContent     = name;
    this._els.title.textContent    = title;
    this._applyLocation();
    this._applyLiveBug();
  }

  _applyLocation() {
    const location = this._state.showLocation === false ? '' : (this._jsonData?.location || '');
    this._els.location.textContent = location ? `· ${location}` : '';
  }

  _applyLiveBug() {
    const show = (this._state.showLiveBug !== false) && !!this._jsonData?.live;
    this._els.liveBug.classList.toggle('visible', show);
  }

  _applyState() {
    const { accentColor, nameColor, titleColor, locationColor, locationOpacity, showAccentBar, liveBugColor, liveBugBgColor } = this._state;
    const { scene, bar, location, liveBug } = this._els;
    if (accentColor)    scene.style.setProperty('--accent', accentColor);
    if (nameColor)      scene.style.setProperty('--name-color', nameColor);
    if (titleColor)     scene.style.setProperty('--title-color', titleColor);
    if (locationColor)  scene.style.setProperty('--location-color', locationColor);
    location.style.opacity = String(locationOpacity ?? 0.45);
    bar.style.display = showAccentBar === false ? 'none' : 'block';
    liveBug.style.color      = liveBugColor   || '#ffffff';
    liveBug.style.background = liveBugBgColor || '#e53030';
    this._applyLocation();
    this._applyLiveBug();
  }
}

export default JsonLowerThird;
