/** Data-Driven Lower Third: text driven by a local JSON file (data/lower-third.jsonc). */

import { parseJsonc, _normaliseColors as _ncBase, easeOut as _easeOut, easeIn as _easeIn, clamp01, progress, _resolveAssetPath, _xhrText, _detectFormat, replaySchedule, envelope } from './ograf-helpers.js';

const _normaliseColors = _ncBase;

let _POW = 3;
const easeOut = (t) => _easeOut(t, _POW);
const easeIn  = (t) => _easeIn(t, _POW);

const DEFAULT_DATA_FILE = 'data/lower-third.jsonc';

const DEFAULT_STATE = {
  dataFile: DEFAULT_DATA_FILE,
  reloadData: false,
  introDuration: 0.55,   // s, = manifest actionDurations.playAction / 1000
  outroDuration: 0.4,   // s, = manifest actionDurations.stopAction / 1000
  easePower: 3,
  manualName:    'Jane Smith',
  title:         'Senior Correspondent',
  subtitle:      'Washington D.C.',
  showSubtitle:  true,
  showCounter:   true,
  accentColor:   '#00d2ff',
  nameColor:     '#ffffff',
  titleColor:    '#dcdcdc',
  showAccentBar: true,
  bgOpacity:     0.72,
  posX:          10,
  posY:          90,
  dataIndex:     1,
  animInStart: 0,
  animInDuration: 0.55,
  animOutStart: 100,
  animOutDuration: 0.4,
  stagger:        0.08,
  scale:          1.5,
};

const STYLE_TEXT = `
  :host { display:block; position:absolute; inset:0; pointer-events:none;
          font-family:"Helvetica Neue",Arial,sans-serif; --scale:1;
          --safe-top:108px; --safe-right:192px; --safe-bottom:108px; --safe-left:192px; }
  .scene { position:absolute; display:flex; flex-direction:row; align-items:stretch; }
  .bar { flex-shrink:0; width:calc(6px * var(--scale)); background:var(--accent,#00d2ff); }
  .panel { position:relative; display:flex; flex-direction:column; justify-content:center;
           padding:calc(14px * var(--scale)) calc(44px * var(--scale)) calc(14px * var(--scale)) calc(18px * var(--scale));
           background:rgba(0,0,0,var(--bg-op,0.72));
           gap:calc(5px * var(--scale)); min-width:0; }
  .kicker { font-size:calc(12px * var(--scale)); font-weight:600; color:var(--accent,#00d2ff);
            white-space:nowrap; letter-spacing:0.14em; text-transform:uppercase;
            margin-bottom:calc(2px * var(--scale)); }
  .name  { font-size:calc(38px * var(--scale)); font-weight:700; color:var(--name-color,#ffffff); white-space:nowrap;
           line-height:1; letter-spacing:0.02em; }
  .title { font-size:calc(20px * var(--scale)); font-weight:400; color:var(--title-color,#dcdcdc);
           white-space:nowrap; letter-spacing:0.04em; }
  .subtitle { font-size:calc(16px * var(--scale)); font-weight:400; color:var(--accent,#00d2ff);
              white-space:nowrap; letter-spacing:0.06em; text-transform:uppercase; }
  .counter { position:absolute; right:calc(10px * var(--scale)); bottom:calc(6px * var(--scale));
             font-family:monospace; font-size:calc(10px * var(--scale)); color:rgba(255,255,255,0.3); }
  .status { position:absolute; bottom:12px; right:16px;
            font-family:monospace; font-size:11px; color:rgba(255,255,255,0.5);
            }
`;

class DataDrivenLowerThird extends HTMLElement {
  constructor() {
    super();
    this._state    = { ...DEFAULT_STATE };
    this._data     = [];
    this._index    = 0;
    this._everLoaded        = false;
    this._lastHostDataIndex = null;
    this._schedule          = [];
    this._scheduleBaseIndex = 0;


    this._lastSec = 0;

    const root  = this.attachShadow({ mode:'open' });
    const style = document.createElement('style'); style.textContent = STYLE_TEXT;
    const scene    = document.createElement('div'); scene.className = 'scene';
    const bar      = document.createElement('div'); bar.className   = 'bar';
    const panel    = document.createElement('div'); panel.className = 'panel';
    const kickerEl = document.createElement('div'); kickerEl.className = 'kicker';
    const nameEl   = document.createElement('div'); nameEl.className   = 'name';
    const titleEl  = document.createElement('div'); titleEl.className  = 'title';
    const subEl    = document.createElement('div'); subEl.className    = 'subtitle';
    const counterEl= document.createElement('div'); counterEl.className= 'counter';
    const statusEl = document.createElement('div'); statusEl.className = 'status';
    panel.append(kickerEl, nameEl, titleEl, subEl, counterEl);
    scene.append(bar, panel);
    root.append(style, scene, statusEl);
    this._els = { scene, bar, panel, kickerEl, nameEl, titleEl, subEl, counterEl, statusEl };
  }

  async load(params) {
    this._state = { ...DEFAULT_STATE, ..._normaliseColors(params.data || {}) };
    this._detectedFormat = _detectFormat(params);
    const res = params?.renderCharacteristics?.resolution;
    this._canvasW = res?.width  || 1920;
    this._canvasH = res?.height || 1080;
    this.setAttribute('data-format', this._detectedFormat);
    this._applySafeVars(this._detectedFormat);
    this._watchSize();
    this._syncSize();
    this.style.setProperty('--scale', String(this._state.scale ?? 1.0));
    this._applyTheme();
    this._applyPosition();
    this._lastHostDataIndex = this._normDataIndex(this._state.dataIndex);

    await this._fetchData(false);

    this._scheduleBaseIndex = this._index;
    this._baseState = { ...this._state };

    this._renderAtTime(0);
    return { statusCode: 200 };
  }

  async dispose() {
    this._unwatchSize();
    return { statusCode: 200 };
  }

  async playAction(params) {
    if (params?.skipAnimation === true) this._applyFullyShown();
    else this._renderAtTime(this._state.animInStart + this._state.animInDuration);
    return { statusCode: 200, currentStep: 0 };
  }

  async stopAction(params) {
    if (params?.skipAnimation === true) this._applyFullyHidden();
    else this._renderAtTime(this._state.animOutStart + this._state.animOutDuration);
    return { statusCode: 200 };
  }

  async setActionsSchedule(params) {
    const raw = params?.schedule || params?.actions || [];
    this._schedule = raw.slice().sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
    return { statusCode: 200 };
  }

  _indexFor(id, current, total) {
    const n = total || 1;
    if (id === 'next') return (current + 1) % n;
    if (id === 'prev') return (current - 1 + n) % n;
    return current;
  }

  async customAction(params) {
    const id = params?.id;
    if (id === 'fetch') {
      await this._fetchData(true);
    } else if (id === 'next' || id === 'prev') {
      const now  = Date.now();
      this._lastStepAt = this._lastStepAt || {};
      if (now - (this._lastStepAt[id] || 0) < 200) return { statusCode: 200 };
      this._lastStepAt[id] = now;

      this._index = this._indexFor(id, this._index, Math.max(1, this._data.length));
      this._state.dataIndex = this._data.length ? this._index + 1 : 1;
      this._applyCurrent();
    }
    return { statusCode: 200 };
  }


  _applyUpdateData(params) {
    const skip = params?.skipAnimation ?? params?.data?.skipAnimation ?? false;
    this._state = { ...this._state, ..._normaliseColors(params?.data || {}) };
    this.style.setProperty('--scale', String(this._state.scale ?? 1.0));
    this._applyTheme();
    this._applyPosition();

    if (!this._data.length) {
      this._applyText(this._state);
    } else {
      const norm = this._normDataIndex(this._state.dataIndex);
      if (this._lastHostDataIndex !== null && norm !== this._lastHostDataIndex) {
        this._lastHostDataIndex = norm;
        this._index = this._clampIndex(norm - 1, this._data.length);
      }
      this._applyCurrent();
    }
    return skip;
  }

  async updateAction(params) {
    this._baseState = { ...(this._baseState || this._state), ..._normaliseColors(params?.data || {}) };
    this._applyUpdateData(params);
    if (this._dataKey() !== this._loadedKey) await this._fetchData(false);
    this._renderAtTime(this._lastSec);
    return { statusCode: 200 };
  }

  async goToTime(params) {
    this._syncSize();
    const ms  = typeof params === 'number' ? params : (params?.timestamp ?? 0);
    this._lastSec = ms / 1000;
    if (this._baseState) this._state = { ...this._baseState };

    const drivesSchedule = this._schedule.some((ev) => {
      const a  = ev.action || {};
      const id = a.params?.id ?? a.id;
      return a.type === 'customAction' && (id === 'next' || id === 'prev');
    });
    if (drivesSchedule) {
      let index = this._scheduleBaseIndex;
      const total = Math.max(1, this._data.length);
      for (const event of this._schedule) {
        if ((event.timestamp ?? 0) > ms) break;
        const action = event.action || {};
        if (action.type === 'customAction') {
          const id = action.params?.id ?? action.id;
          if (id === 'next' || id === 'prev') index = this._indexFor(id, index, total);
        }
      }
      if (index !== this._index) {
        this._index = index;
        this._state.dataIndex = this._data.length ? index + 1 : 1;
        this._applyCurrent();
      }
    }


    for (const event of this._schedule) {
      if ((event.timestamp ?? 0) > ms) break;
      const action = event.action || {};
      if (action.type === 'updateAction') {
        this._applyUpdateData(action.params || {});
      }
    }

    if (this._dataKey() !== this._loadedKey) await this._fetchData(false);

    const rep = replaySchedule(this._schedule, ms, {}, (d) => d);
    const absSec = ms / 1000;   // ms -> s (absolute clip time, for any continuous motion)
    const env = envelope(this._state, rep.secIn, rep.secOut);
    this._state = env.state;
    _POW = this._state.easePower ?? 3;
    this._renderAtTime(env.sec === null ? -1 : env.sec);
    return { statusCode: 200 };
  }

  _applyFullyShown() {
    this._els.bar.style.transform = 'scaleY(1)';
    this._els.panel.style.opacity = 1;
    this._els.panel.style.transform = 'translateX(0)';
    this._els.kickerEl.style.opacity = 1;
    this._els.nameEl.style.opacity  = 1;
    this._els.titleEl.style.opacity = 1;
    this._els.subEl.style.opacity   = 1;
  }

  _applyFullyHidden() {
    this._els.bar.style.transform = 'scaleY(0)';
    this._els.panel.style.opacity = 0;
    this._els.kickerEl.style.opacity = 0;
    this._els.nameEl.style.opacity  = 0;
    this._els.titleEl.style.opacity = 0;
    this._els.subEl.style.opacity   = 0;
  }

  _dataKey() { return (this._state.dataFile || DEFAULT_DATA_FILE) + '|' + (this._state.reloadData ? 1 : 0); }

  async _fetchData(showStatus) {
    if (showStatus) this._setStatus('Fetching…');
    this._loadedKey = this._dataKey();
    try {
      const text = await _xhrText(_resolveAssetPath(this._state.dataFile || DEFAULT_DATA_FILE), 6000);
      const data = parseJsonc(text);
      const list = Array.isArray(data) ? data : [data];
      const firstLoad = !this._everLoaded;
      this._data = list;
      if (firstLoad) {
        this._index = this._clampIndex(this._normDataIndex(this._state.dataIndex) - 1, list.length);
      } else {
        this._index = this._clampIndex(this._index, list.length);
      }
      this._everLoaded = true;
      this._applyCurrent();
      if (showStatus) this._setStatus(`✓ ${this._data.length} loaded`, 3000);
    } catch(e) {
      this._setStatus(`Fetch failed: ${e}`, 4000);
      this._data  = [];
      this._index = 0;
      this._applyText(this._state);
    }
  }

  _clampIndex(i, len) { return Math.max(0, Math.min(len - 1, i)); }

  _normDataIndex(v) {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? n : 1;
  }

  _applyCurrent() {
    const rec = this._data[this._index] || {};
    this._applyText(rec);
  }

  _applyText(src) {
    const { showSubtitle, showCounter } = this._state;
    this._els.kickerEl.textContent   = src.show || '';
    this._els.kickerEl.style.display = src.show ? '' : 'none';
    this._els.nameEl.textContent     = (src.name ?? src.manualName) || '';
    this._els.titleEl.textContent    = src.title    || '';
    this._els.subEl.textContent      = src.subtitle || '';
    this._els.subEl.style.display    = (showSubtitle && src.subtitle) ? '' : 'none';
    this._els.counterEl.textContent  = (showCounter && this._data.length > 1)
      ? `${this._index + 1} / ${this._data.length}` : '';
  }

  _setStatus(msg) { if (/error/i.test(String(msg))) console.warn('[ograf]', msg); }

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
    this._applyPosition();
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

  _applyTheme() {
    const { accentColor, bgOpacity, nameColor, titleColor, showAccentBar } = this._state;
    const root = this._els.scene;
    root.style.setProperty('--accent',      accentColor || '#00d2ff');
    root.style.setProperty('--bg-op',       String(bgOpacity ?? 0.72));
    root.style.setProperty('--name-color',  nameColor  || '#ffffff');
    root.style.setProperty('--title-color', titleColor || '#dcdcdc');
    this._els.bar.style.background = accentColor || '#00d2ff';
    this._els.bar.style.display    = showAccentBar === false ? 'none' : '';
  }

  _applyPosition() {
    const { posX, posY } = this._state;
    const s = this._els.scene;
    s.style.removeProperty('transform');
    s.style.removeProperty('top'); s.style.removeProperty('right');
    s.style.setProperty('left',   (Number(posX ?? 10)) + '%');
    s.style.setProperty('bottom', (100 - Number(posY ?? 90)) + '%');
  }

  _renderAtTime(sec) {
    _POW = this._state.easePower ?? 3;
    const { animInStart, animInDuration, animOutStart, animOutDuration, stagger } = this._state;
    const k = Math.min(1, (animOutDuration * 0.5) / ((stagger * 3) || 1));
    const outDur = animOutDuration - stagger * 3 * k;
    const P = (inOff, outOff) => clamp01(
      easeOut(progress(sec, animInStart + inOff, animInDuration)) -
      easeIn( progress(sec, animOutStart + (stagger * 3 - outOff) * k, outDur))
    );

    const barP   = P(0,          stagger * 3);
    const panelP = P(stagger,    stagger * 2);
    const nameP  = P(stagger * 2, stagger);
    const titleP = P(stagger * 3, 0);

    this._els.bar.style.transform   = `scaleY(${barP})`;
    this._els.bar.style.transformOrigin = 'top center';
    this._els.panel.style.opacity   = panelP;
    this._els.panel.style.transform = `translateX(calc(${(1 - panelP) * -20}px * var(--scale)))`;
    this._els.kickerEl.style.opacity = nameP;
    this._els.nameEl.style.opacity  = nameP;
    this._els.titleEl.style.opacity = titleP;
    this._els.subEl.style.opacity   = titleP;
  }
}

export default DataDrivenLowerThird;
