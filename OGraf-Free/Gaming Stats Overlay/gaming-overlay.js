/** gaming-overlay.js: Esports/streaming HUD with K/D/A stats, rank, viewer count and win streak. */

import { parseJsonc, _normaliseColors as _ncBase, easeOut as _easeOut, easeIn as _easeIn, clamp01, progress, _resolveAssetPath, _xhrText, replaySchedule, envelope } from './ograf-helpers.js';

const _normaliseColors = (d) => {
  if (!d || typeof d !== 'object') return d;
  const o = { ...d };
  const h = (x) => Math.round((x ?? 0) * 255).toString(16).padStart(2, '0');
  for (const k of ['backgroundColor', 'frameColor']) {
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

let _POW = 3;
const easeOut = (t) => _easeOut(t, _POW);
const easeIn  = (t) => _easeIn(t, _POW);

const DEFAULT_STATE = {
  dataFile: 'data/stats.jsonc',
  reloadData: false,
  introDuration: 0.4,   // s, = manifest actionDurations.playAction / 1000
  outroDuration: 0.35,   // s, = manifest actionDurations.stopAction / 1000
  easePower: 3,
  accentColor:     '#a78bfa',
  backgroundColor: '#08080cd9',
  showBackground:  true,
  frameColor:      '#a78bfaff',
  showFrame:       true,
  stagger:         0.15,
  showSubscribers: true,
  showStreak:      true,
  scale:           1.0,
  countDuration:   1.0,
  animInStart: 0,
  animInDuration: 0.4,
  animOutStart: 100,
  animOutDuration: 0.35,
};

const DEFAULT_DATA = {
  playerName:  'PLAYER',
  game:        'GAME',
  kills:       0,
  deaths:      0,
  assists:     0,
  rank:        'Unranked',
  rankIcon:    '🎮',
  subscribers: 0,
  viewers:     0,
  winStreak:   0,
};

const STYLE_TEXT = `
  :host {
    display: block;
    position: absolute;
    inset: 0;
    overflow: hidden;
    font-family: "Open Sans", "Helvetica Neue", Arial, sans-serif;
    --scale: 1;
  }

  #scene {
    position: absolute;
    top: 32px;
    right: 32px;
    width: 480px;
    background: var(--bg, rgba(8, 8, 12, 0.85));
    border-left: 3px solid var(--frame, #a78bfa);
    display: flex;
    flex-direction: column;
    gap: 0;
    overflow: hidden;
    box-shadow: var(--shadow, 0 4px 32px rgba(0,0,0,0.7), inset 0 0 0 1px rgba(255,255,255,0.06));
  }

  #header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 14px 6px 14px;
    border-bottom: 1px solid rgba(255,255,255,0.08);
  }

  #player-name {
    font-size: 18px;
    font-weight: 700;
    color: #ffffff;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 260px;
  }

  #game-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--accent, #a78bfa);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    background: rgba(167,139,250,0.12);
    padding: 2px 8px;
    border: 1px solid rgba(167,139,250,0.3);
  }

  #stats-row {
    display: flex;
    align-items: stretch;
    padding: 10px 14px;
    gap: 4px;
    border-bottom: 1px solid rgba(255,255,255,0.08);
  }

  .stat-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    flex: 1;
    padding: 4px 6px;
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.06);
    min-width: 0;
  }

  .stat-cell + .stat-cell {
    margin-left: 4px;
  }

  .stat-label {
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: rgba(255,255,255,0.4);
    margin-bottom: 2px;
  }

  .stat-value {
    font-family: "Courier New", "Lucida Console", monospace;
    font-size: 22px;
    font-weight: 700;
    line-height: 1;
    color: #ffffff;
  }

  .stat-value.color-kills   { color: #4ade80; }
  .stat-value.color-deaths  { color: #f87171; }
  .stat-value.color-assists { color: #fbbf24; }
  .stat-value.color-kd-good { color: var(--accent, #a78bfa); }
  .stat-value.color-kd-bad  { color: #f87171; opacity: 0.75; }

  #rank-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 14px;
    border-bottom: 1px solid rgba(255,255,255,0.08);
  }

  #rank-icon { font-size: 14px; }

  #rank-label {
    font-size: 13px;
    font-weight: 600;
    color: rgba(255,255,255,0.75);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  #meta-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 14px 8px 14px;
    gap: 12px;
  }

  .meta-item {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    font-weight: 600;
    color: rgba(255,255,255,0.55);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .meta-item .meta-icon { font-size: 11px; opacity: 0.8; }
  .meta-item .meta-val  { color: rgba(255,255,255,0.85); }
  .meta-item .meta-val.streak-hot { color: #fbbf24; }

  #accent-bar {
    height: 2px;
    background: linear-gradient(90deg, var(--frame, #a78bfa) 0%, transparent 100%);
  }
`;

const TEMPLATE_HTML = `
  <style>${STYLE_TEXT}</style>
  <div id="scene">
    <div id="header">
      <span id="player-name">PLAYER</span>
      <span id="game-label">GAME</span>
    </div>
    <div id="stats-row">
      <div class="stat-cell" id="cell-k">
        <span class="stat-label">K</span>
        <span class="stat-value color-kills" id="val-kills">0</span>
      </div>
      <div class="stat-cell" id="cell-d">
        <span class="stat-label">D</span>
        <span class="stat-value color-deaths" id="val-deaths">0</span>
      </div>
      <div class="stat-cell" id="cell-a">
        <span class="stat-label">A</span>
        <span class="stat-value color-assists" id="val-assists">0</span>
      </div>
      <div class="stat-cell" id="cell-kd">
        <span class="stat-label">K/D</span>
        <span class="stat-value" id="val-kd">0.00</span>
      </div>
    </div>
    <div id="rank-row">
      <span id="rank-icon">🎮</span>
      <span id="rank-label">Unranked</span>
    </div>
    <div id="meta-row">
      <div class="meta-item" id="subs-item">
        <span class="meta-icon">👥</span>
        <span class="meta-val" id="val-viewers">0</span>
        <span style="opacity:0.5;font-size:10px;margin-left:2px">viewers</span>
      </div>
      <div class="meta-item" id="streak-item">
        <span class="meta-icon">★</span>
        <span class="meta-val" id="val-streak">0</span>
        <span style="opacity:0.5;font-size:10px;margin-left:2px">streak</span>
      </div>
    </div>
    <div id="accent-bar"></div>
  </div>
`;

class GamingOverlay extends HTMLElement {
  constructor() {
    super();
    this._shadow     = this.attachShadow({ mode: 'open' });
    this._shadow.innerHTML = TEMPLATE_HTML;
    this._state      = { ...DEFAULT_STATE };
    this._schedule    = [];
    this._data       = { ...DEFAULT_DATA };
    this._els        = {};
    this._currentSec = 0;
    this._bindEls();
  }

  _bindEls() {
    const s = this._shadow;
    this._els = {
      scene:      s.getElementById('scene'),
      header:     s.getElementById('header'),
      statsRow:   s.getElementById('stats-row'),
      rankRow:    s.getElementById('rank-row'),
      metaRow:    s.getElementById('meta-row'),
      accentBar:  s.getElementById('accent-bar'),
      playerName: s.getElementById('player-name'),
      gameLabel:  s.getElementById('game-label'),
      valKills:   s.getElementById('val-kills'),
      valDeaths:  s.getElementById('val-deaths'),
      valAssists: s.getElementById('val-assists'),
      valKd:      s.getElementById('val-kd'),
      rankIcon:   s.getElementById('rank-icon'),
      rankLabel:  s.getElementById('rank-label'),
      subsItem:   s.getElementById('subs-item'),
      streakItem: s.getElementById('streak-item'),
      valViewers: s.getElementById('val-viewers'),
      valStreak:  s.getElementById('val-streak'),
    };
  }

  _dataKey() { return (this._state.dataFile || 'data/stats.jsonc') + '|' + (this._state.reloadData ? 1 : 0); }

  async _loadData() {
    this._loadedKey = this._dataKey();
    try {
      const url = _resolveAssetPath(this._state.dataFile || 'data/stats.jsonc');
      const raw = await _xhrText(url);
      if (raw) {
        const parsed = parseJsonc(raw);
        this._data = { ...DEFAULT_DATA, ...parsed };
      }
    } catch (e) {
    }
  }

  _applyState() {
    const s = this._state;
    const el = this._els.scene;
    el.style.setProperty('--accent', s.accentColor);
    el.style.setProperty('--bg', s.showBackground ? _rgba(s.backgroundColor) : 'transparent');
    el.style.setProperty('--frame', s.showFrame ? _rgba(s.frameColor) : 'transparent');
    if (s.showBackground) el.style.removeProperty('--shadow'); else el.style.setProperty('--shadow', 'none');
    this.style.setProperty('--scale', String(s.scale ?? 1.0));

    this._els.subsItem.style.display   = s.showSubscribers ? '' : 'none';
    this._els.streakItem.style.display = s.showStreak      ? '' : 'none';
  }

  _applyData() {
    const d = this._data;
    this._els.playerName.textContent = d.playerName || 'PLAYER';
    this._els.gameLabel.textContent  = d.game       || 'GAME';
    this._els.rankIcon.textContent   = d.rankIcon   || '🎮';
    this._els.rankLabel.textContent  = d.rank       || 'Unranked';

    const kd = d.kills / Math.max(d.deaths, 1);
    const kdEl = this._els.valKd;
    kdEl.classList.remove('color-kd-good', 'color-kd-bad');
    if (kd >= 2.0) kdEl.classList.add('color-kd-good');
    else if (kd < 1.0) kdEl.classList.add('color-kd-bad');

    const streakEl = this._els.valStreak;
    streakEl.classList.toggle('streak-hot', d.winStreak >= 3);
  }

  _updateStatCells() {
    const d = this._data;
    this._els.valKills.textContent   = d.kills;
    this._els.valDeaths.textContent  = d.deaths;
    this._els.valAssists.textContent = d.assists;

    const kd = d.kills / Math.max(d.deaths, 1);
    this._els.valKd.textContent = kd.toFixed(2);

    const kdEl = this._els.valKd;
    kdEl.classList.remove('color-kd-good', 'color-kd-bad');
    if (kd >= 2.0) kdEl.classList.add('color-kd-good');
    else if (kd < 1.0) kdEl.classList.add('color-kd-bad');

    this._els.valViewers.textContent = _fmtCount(d.viewers);
    this._els.valStreak.textContent  = d.winStreak;
    this._els.valStreak.classList.toggle('streak-hot', d.winStreak >= 3);
  }

  _renderAtTime(sec) {
    _POW = this._state.easePower ?? 3;
    const s  = this._state;
    const d  = this._data;
    const sc = s.scale ?? 1.0;

    const e = this._els;
    const parts = [e.scene, e.header, e.statsRow, e.rankRow, e.metaRow, e.accentBar];
    const N = parts.length;
    const inW  = Math.max(0.05, s.animInDuration),  outW = Math.max(0.05, s.animOutDuration);
    const stIn  = Math.min(s.stagger ?? 0.15, 0.6 * inW  / (N - 1));
    const stOut = Math.min(s.stagger ?? 0.15, 0.6 * outW / (N - 1));
    const pAt = (i) => clamp01(
      easeOut(progress(sec, s.animInStart + i * stIn, inW - stIn * (N - 1))) -
      easeIn(progress(sec, s.animOutStart + (N - 1 - i) * stOut, outW - stOut * (N - 1)))
    );
    const p = pAt(0);
    e.scene.style.opacity         = p;
    e.scene.style.transformOrigin = 'top right';
    e.scene.style.transform = `translateY(${(1 - p) * 14}px) scale(${sc})`;
    for (let i = 1; i < N; i++) {
      const pi = pAt(i);
      parts[i].style.opacity   = i === N - 1 ? pi * 0.6 : pi;
      parts[i].style.transform = `translateY(${(1 - pi) * 8}px)`;
    }

    const countP = easeOut(progress(sec, s.animInStart, s.countDuration));
    this._els.valKills.textContent   = Math.round(countP * d.kills);
    this._els.valDeaths.textContent  = Math.round(countP * d.deaths);
    this._els.valAssists.textContent = Math.round(countP * d.assists);

    const kdFinal = d.kills / Math.max(d.deaths, 1);
    const kdNow   = countP * kdFinal;
    this._els.valKd.textContent = kdNow.toFixed(2);

    const kdEl = this._els.valKd;
    kdEl.classList.remove('color-kd-good', 'color-kd-bad');
    if (kdFinal >= 2.0) kdEl.classList.add('color-kd-good');
    else if (kdFinal < 1.0) kdEl.classList.add('color-kd-bad');

    const viewersNow = Math.round(countP * d.viewers);
    this._els.valViewers.textContent = _fmtCount(viewersNow);

    this._els.valStreak.textContent = countP > 0.5 ? d.winStreak : 0;
    this._els.valStreak.classList.toggle('streak-hot', d.winStreak >= 3 && countP > 0.5);
  }

  async load(params) {
    this._state = { ...DEFAULT_STATE, ..._normaliseColors(params.data || {}) };
    this.style.setProperty('--scale', String(this._state.scale ?? 1.0));
    await this._loadData();
    this._applyState();
    this._applyData();
    this._renderAtTime(0);
    return { statusCode: 200 };
  }

  async dispose() {
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
    return { statusCode: 200 };
  }

  async customAction(params) {
    const id = params?.id;

    if (id === 'refresh') {
      await this._loadData();
      this._applyData();
      this._updateStatCells();
    } else if (id === 'kill') {
      this._data.kills += 1;
      this._updateStatCells();
    } else if (id === 'death') {
      this._data.deaths += 1;
      this._updateStatCells();
    } else if (id === 'reset') {
      this._data.kills   = 0;
      this._data.deaths  = 0;
      this._data.assists = 0;
      this._updateStatCells();
    }

    return { statusCode: 200 };
  }

  _applyUpdateData(params) {
    this._state = { ...this._state, ..._normaliseColors(params?.data || {}) };
    this.style.setProperty('--scale', String(this._state.scale ?? 1.0));
    this._applyState();
  }

  async _reloadIfNeeded() {
    if (this._dataKey() === this._loadedKey) return;
    await this._loadData();
    this._applyData();
    this._updateStatCells();
  }

  async updateAction(params) {
    this._applyUpdateData(params);
    await this._reloadIfNeeded();
    return { statusCode: 200 };
  }

  async goToTime(params) {
    const ms = typeof params === 'number'
      ? params
      : (typeof params?.timestamp === 'number' ? params.timestamp : 0);
    for (const event of this._schedule) {
      if ((event.timestamp ?? 0) > ms) break;
      const action = event.action || {};
      if (action.type === 'updateAction') {
        this._applyUpdateData(action.params || {});
      }
    }
    await this._reloadIfNeeded();
    this._currentSec = ms / 1000;
    const rep = replaySchedule(this._schedule, ms, {}, (d) => d);
    const absSec = ms / 1000;   // ms -> s (absolute clip time, for any continuous motion)
    const env = envelope(this._state, rep.secIn, rep.secOut);
    this._contentSec = rep.secIn ?? 0;
    this._state = env.state;
    _POW = this._state.easePower ?? 3;
    this._currentSec = env.sec === null ? -1 : env.sec;
    this._renderAtTime(env.sec === null ? -1 : env.sec);
    return { statusCode: 200 };
  }
}

function _fmtCount(n) {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

export default GamingOverlay;
