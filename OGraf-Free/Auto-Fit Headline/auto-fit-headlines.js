/** auto-fit-headlines.js: headline auto-fit that reshapes Roboto Flex's `wdth` axis to fill a fixed-width container. */

import {
  _normaliseColors, _hexToRgba, loadVariableFont, hasAxis, makeActionDebouncer, classifyAspect,
  replaySchedule, easeOut, easeIn, clamp01, progress,
} from './ograf-helpers.js';

const FONT_FAMILY          = 'RobotoFlexAutoFit';
const GOOGLE_FONTS_CSS_URL = 'https://fonts.googleapis.com/css2?family=Roboto+Flex:opsz,wght,wdth@8..144,100..1000,25..151&display=swap';
const GOOGLE_FONTS_AXES = new Map([
  ['wght', { min: 100, default: 400, max: 1000 }],
  ['wdth', { min: 25, default: 100, max: 151 }],
  ['opsz', { min: 8, default: 14, max: 144 }],
]);
const FALLBACK_STACK       = '"Arial Narrow", Arial, sans-serif';

const DEFAULT_STATE = {
  headlineText:     'AUTO-FIT HEADLINES (ROBOTO FLEX) — SHORT HEADLINES EXPAND, LONG ONES CONDENSE WITHOUT LETTERFORM DISTORTION',
  urgency:          1,
  subheadText:      '',
  headlineColor:    '#ffffff',
  subheadColor:     '#ffffff',
  accentColor:      '#ffb800',
  headlineSize:     100,
  urgencySize:      100,
  posX:             6,
  posY:             50,
  fontUrl:          './RobotoFlex-Variable.ttf',
  minWdth:          62,
  maxWdth:          125,
  manualWdth:       0,
  introDuration:    1,     // s, = manifest actionDurations.playAction / 1000
  outroDuration:    1,     // s, = manifest actionDurations.stopAction / 1000
  stagger:          0.15,
  showDebug:        false,
};

const URGENCY_WEIGHT = { BREAKING: 900, ALERT: 700, UPDATE: 500, DEVELOPING: 400 };
const URGENCY_NAMES  = ['BREAKING', 'ALERT', 'UPDATE', 'DEVELOPING'];
function _urgencyName(v) {
  if (typeof v === 'string' && URGENCY_WEIGHT[v.toUpperCase()]) return v.toUpperCase();
  return URGENCY_NAMES[Math.min(4, Math.max(1, Math.round(Number(v)) || 1)) - 1];
}

const CONTAINER_RATIO = { '16:9': 0.82, '1:1': 0.86, '9:16': 0.9 };

class AutoFitHeadlines extends HTMLElement {
  constructor() {
    super();
    this._state = { ...DEFAULT_STATE };
    this._initialData = {};
    this._schedule = [];
    this._shouldSkipAction = makeActionDebouncer(200);
    this._width = 1920; this._height = 1080;

    const shadow = this.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>
      :host { display:block; position:absolute; inset:0; width:100%; height:100%; overflow:hidden; background:transparent; }
      .afh-stage { position:absolute; inset:0; display:flex; flex-direction:column; justify-content:center; }
      .afh-container { position:absolute; left:0; top:50%; transform:translateY(-50%);
                       display:flex; flex-direction:column; }
      .afh-urgency { font-family:'${FONT_FAMILY}', ${FALLBACK_STACK}; text-transform:uppercase; letter-spacing:0.14em;
                     font-weight:700; margin-bottom:0.35em; }
      .afh-headline { font-family:'${FONT_FAMILY}', ${FALLBACK_STACK}; text-transform:uppercase;
                      white-space:nowrap; line-height:1.02;  }
      .afh-subhead { font-family:'${FONT_FAMILY}', ${FALLBACK_STACK};
                     margin-top:0.4em; font-weight:400; white-space:pre-wrap; }
      .afh-rule { height:4px; margin-top:0.3em; width:64px; }
      .afh-measure { position:absolute; left:-9999px; top:-9999px; visibility:hidden; white-space:nowrap;
                     text-transform:uppercase; }
      .afh-legend { position:absolute; left:24px; bottom:20px; font-family:'SF Mono', Menlo, monospace;
                    font-size:14px; color:rgba(255,255,255,0.4); letter-spacing:0.02em; }
    </style>`;
    this._shadow = shadow;

    const stage = document.createElement('div');
    stage.className = 'afh-stage';
    const container = document.createElement('div');
    container.className = 'afh-container';
    this._urgencyEl = document.createElement('div'); this._urgencyEl.className = 'afh-urgency';
    this._headlineEl = document.createElement('div'); this._headlineEl.className = 'afh-headline';
    this._ruleEl = document.createElement('div'); this._ruleEl.className = 'afh-rule';
    this._subheadEl = document.createElement('div'); this._subheadEl.className = 'afh-subhead';
    container.append(this._urgencyEl, this._headlineEl, this._ruleEl, this._subheadEl);
    stage.appendChild(container);
    shadow.appendChild(stage);

    this._measureEl = document.createElement('div');
    this._measureEl.className = 'afh-measure';
    shadow.appendChild(this._measureEl);

    this._legend = document.createElement('div');
    this._legend.className = 'afh-legend';
    shadow.appendChild(this._legend);

    this._stage = stage; this._container = container;
  }

  connectedCallback() {
    this._ro = new ResizeObserver(() => this._applyResponsive(true));
    this._ro.observe(this);
    this._applyResponsive(true);
  }
  disconnectedCallback() { this._ro?.disconnect(); }

  async load(params) {
    this._initialData = _normaliseColors(params?.data || {});
    this._state = { ...DEFAULT_STATE, ...this._initialData };
    this._schedule = [];
    const res = params?.renderCharacteristics?.resolution;
    if (res?.width && res?.height) { this._width = res.width; this._height = res.height; }
    await this._loadFont();
    this._applyResponsive(true);
    this._applyState(true);
    this._paintStagger(null, null);
    return { statusCode: 200 };
  }

  async _loadFont() {
    const fontInfo = await loadVariableFont(this._shadow, {
      family: FONT_FAMILY,
      siblingUrl: this._state.fontUrl || DEFAULT_STATE.fontUrl,
      googleFontsCssUrl: GOOGLE_FONTS_CSS_URL,
      googleFontsAxes: GOOGLE_FONTS_AXES,
      fallbackStack: FALLBACK_STACK,
    });
    this._fontTier = fontInfo.tier;
    this._hasWght = hasAxis(fontInfo, 'wght');
    this._hasWdth = hasAxis(fontInfo, 'wdth');
  }

  async dispose() { this._ro?.disconnect(); return { statusCode: 200 }; }
  async playAction()  { this._paintStagger(this._state.introDuration, null); return { statusCode: 200, currentStep: 0 }; }
  async stopAction()  { this._paintStagger(this._state.introDuration, this._state.outroDuration); return { statusCode: 200 }; }

  async setActionsSchedule(payload) {
    this._schedule = (payload?.schedule || payload?.actions || [])
      .slice()
      .sort((a, b) => a.timestamp - b.timestamp);
    return { statusCode: 200 };
  }

  async updateAction(params) {
    const data = _normaliseColors(params?.data || {});
    this._state = { ...this._state, ...data };
    this._initialData = { ...this._initialData, ...data };
    this._applyResponsive(true);
    this._paintStagger(this._secIn ?? null, this._secOut ?? null);
    return { statusCode: 200 };
  }

  async customAction(params) {
    const id = params?.id;
    if (!id || this._shouldSkipAction(id)) return { statusCode: 200 };
    if (id === 'refresh') {
      await this._loadFont();
      this._applyResponsive(true);
    }
    return { statusCode: 200 };
  }

  async goToTime(params) {
    const ms = typeof params === 'number' ? params
             : (typeof params?.timestamp === 'number' ? params.timestamp : 0);
    // ms -> s: the / 1000 conversion lives in replaySchedule
    const { state, secIn, secOut } = replaySchedule(this._schedule, ms, { ...DEFAULT_STATE, ...this._initialData }, _normaliseColors);
    this._state = state;
    this._applyResponsive(true);
    this._paintStagger(secIn, secOut);
    return { statusCode: 200 };
  }

  // Per-element start/duration. The step is capped so the four elements spread over at most 60 % of
  // each window (shortcut: the Inspector stagger is capped when it would not fit, e.g. a 0.5 s intro).
  _calcTimings() {
    const { stagger, introDuration, outroDuration } = this._state;
    const sIn  = Math.min(stagger, introDuration * 0.2);
    const sOut = Math.min(stagger, outroDuration * 0.2);
    const dIn  = introDuration - sIn * 3;
    const dOut = outroDuration - sOut * 3;
    return {
      urgIn:  { start: 0,        dur: dIn },  headIn:  { start: sIn,      dur: dIn },
      ruleIn: { start: sIn * 2,  dur: dIn },  subIn:   { start: sIn * 3,  dur: dIn },
      subOut: { start: 0,        dur: dOut }, ruleOut: { start: sOut,     dur: dOut },
      headOut:{ start: sOut * 2, dur: dOut }, urgOut:  { start: sOut * 3, dur: dOut },
    };
  }

  _paintStagger(secIn, secOut) {
    this._secIn = secIn; this._secOut = secOut;
    const t = this._calcTimings();
    const P = (i, o) => secIn === null ? 0 : clamp01(
      easeOut(progress(secIn, i.start, i.dur)) - (secOut === null ? 0 : easeIn(progress(secOut, o.start, o.dur)))
    );
    const urgP = P(t.urgIn, t.urgOut), headP = P(t.headIn, t.headOut);
    const ruleP = P(t.ruleIn, t.ruleOut), subP = P(t.subIn, t.subOut);
    this._urgencyEl.style.opacity = urgP;
    this._urgencyEl.style.translate = `0 ${(1 - urgP) * -10}px`;
    this._headlineEl.style.opacity = headP;
    this._headlineEl.style.translate = `0 ${(1 - headP) * 24}px`;
    this._ruleEl.style.opacity = ruleP;
    this._ruleEl.style.transform = `scaleX(${ruleP})`;
    this._ruleEl.style.transformOrigin = 'left center';
    this._subheadEl.style.opacity = subP;
    this._subheadEl.style.translate = `0 ${(1 - subP) * 14}px`;
  }

  _applyResponsive(refit) {
    const rect = this.getBoundingClientRect();
    const w = rect.width  > 0 ? rect.width  : this._width;
    const h = rect.height > 0 ? rect.height : this._height;
    this._width = w; this._height = h;
    const aspect = classifyAspect(w, h);
    this._aspect = aspect;
    const headlineScale = (this._state.headlineSize ?? 100) / 100;
    const urgencyScale  = (this._state.urgencySize  ?? 100) / 100;
    const headlinePx = (aspect === '9:16' ? h * 0.052 : aspect === '1:1' ? h * 0.072 : h * 0.095) * headlineScale;
    const urgencyPx  = headlinePx * 0.28 * urgencyScale;
    const subheadPx  = headlinePx * 0.34;
    this._headlinePx = headlinePx;
    this._headlineEl.style.fontSize = headlinePx + 'px';
    this._urgencyEl.style.fontSize = Math.max(11, urgencyPx) + 'px';
    this._subheadEl.style.fontSize = Math.max(12, subheadPx) + 'px';
    this._measureEl.style.fontSize = headlinePx + 'px';
    this._container.style.width = (w * (CONTAINER_RATIO[aspect] || 0.82)) + 'px';
    if (refit) this._applyState(true);
  }

  _containerWidthPx() {
    return this._width * (CONTAINER_RATIO[this._aspect] || 0.82);
  }

  _autoFitWdth(text, wght) {
    const { minWdth, maxWdth } = this._state;
    const manualWdth = this._state.manualWdth > 0 ? Math.min(151, Math.max(25, this._state.manualWdth)) : 0;
    const containerWidth = this._containerWidthPx();

    if (manualWdth > 0) {
      const wdth = this._hasWdth ? manualWdth : 100;
      const scalePct = this._hasWdth ? 100 : manualWdth;
      const finalWidthPx = this._hasWdth
        ? this._measureAt(text, wght, manualWdth)
        : this._measureAt(text, wght, 100) * (manualWdth / 100);
      return { wdth, scalePct, mode: 'manual', overflow: finalWidthPx > containerWidth + 1 };
    }
    if (this._fontTier === 3) {
      const step = wght < 500 ? 400 : wght < 700 ? 600 : wght < 900 ? 700 : 900;
      this._measureEl.style.fontFamily = FALLBACK_STACK;
      this._measureEl.style.fontVariationSettings = '';
      this._measureEl.style.fontWeight = String(step);
      this._measureEl.textContent = text || ' ';
      const natural = this._measureEl.offsetWidth || 1;
      return { wdth: 100, scalePct: 100, mode: 'unavailable', overflow: natural > containerWidth + 1 };
    }

    const measured = this._measureAt(text, wght, 100);
    const mode = measured > containerWidth ? 'condensed' : measured < containerWidth * 0.7 ? 'expanded' : 'natural';
    const rawWdth = 100 * (containerWidth / measured);

    if (this._hasWdth) {
      const fits = (w) => this._measureAt(text, wght, w) <= containerWidth;
      const bisect = (lo, hi) => { for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; } return lo; };
      const wdth = mode === 'natural' ? 100
        : mode === 'condensed' ? (fits(minWdth) ? bisect(minWdth, 100) : minWdth)
        : (fits(maxWdth) ? maxWdth : bisect(100, maxWdth));
      const finalWidthPx = wdth === 100 ? measured : this._measureAt(text, wght, wdth);
      return { wdth, mode, overflow: finalWidthPx > containerWidth + 1 };
    }
    const scalePct = mode === 'natural' ? 100 : mode === 'condensed' ? Math.max(minWdth, rawWdth) : Math.min(maxWdth, rawWdth);
    const finalWidthPx = measured * (scalePct / 100);
    return { wdth: 100, scalePct, mode: `${mode}-scalex`, overflow: finalWidthPx > containerWidth + 1 };
  }

  _measureAt(text, wght, wdth) {
    this._measureEl.style.fontFamily = `'${FONT_FAMILY}', ${FALLBACK_STACK}`;
    this._measureEl.style.fontVariationSettings = this._hasWght
      ? `'wght' ${wght}${this._hasWdth ? `, 'wdth' ${wdth}` : ''}` : '';
    this._measureEl.style.fontWeight = this._hasWght ? '' : String(wght);
    this._measureEl.textContent = text || ' ';
    return this._measureEl.offsetWidth || 1;
  }

  _applyState() {
    const { subheadText, accentColor, headlineColor, subheadColor, posX, posY } = this._state;
    const urgency = _urgencyName(this._state.urgency);
    const wght = URGENCY_WEIGHT[urgency];
    const text = this._state.headlineText || DEFAULT_STATE.headlineText;

    this._urgencyEl.textContent = urgency;
    this._urgencyEl.style.color = accentColor;
    this._subheadEl.textContent = subheadText || '';
    this._subheadEl.style.display = subheadText ? 'block' : 'none';
    this._subheadEl.style.color = _hexToRgba(subheadColor || '#ffffff', 0.78);
    this._ruleEl.style.background = accentColor;
    this._headlineEl.style.color = headlineColor || '#ffffff';

    this._container.style.left = (posX ?? 6) + '%';
    this._container.style.top  = (posY ?? 50) + '%';

    const fit = this._autoFitWdth(text, wght);
    this._headlineEl.textContent = text;

    if (fit.overflow) {
      this._headlineEl.style.whiteSpace = 'normal';
      this._headlineEl.style.width = this._containerWidthPx() + 'px';
    } else {
      this._headlineEl.style.whiteSpace = 'nowrap';
      this._headlineEl.style.width = 'auto';
    }

    if (this._fontTier === 3) {
      const step = wght < 500 ? 400 : wght < 700 ? 600 : wght < 900 ? 700 : 900;
      this._headlineEl.style.fontWeight = String(step);
      this._headlineEl.style.fontVariationSettings = '';
      this._headlineEl.style.transform = `scaleX(${(fit.scalePct / 100).toFixed(3)})`;
      this._headlineEl.style.transformOrigin = 'left center';
    } else {
      const parts = [];
      if (this._hasWght) parts.push(`'wght' ${wght}`);
      if (this._hasWdth) parts.push(`'wdth' ${fit.wdth.toFixed(1)}`);
      this._headlineEl.style.fontVariationSettings = parts.join(', ');
      this._headlineEl.style.fontWeight = this._hasWght ? '' : String(wght < 500 ? 400 : wght < 700 ? 600 : wght < 900 ? 700 : 900);
      this._headlineEl.style.transform = this._hasWdth ? 'none' : `scaleX(${(fit.scalePct / 100).toFixed(3)})`;
      this._headlineEl.style.transformOrigin = 'left center';
    }

    const axisNote = this._fontTier === 3 ? 'no font loaded — full fallback'
      : !this._hasWdth ? `wdth not in this font — fit via scaleX(${(fit.scalePct / 100).toFixed(2)})`
      : `wdth ${fit.wdth.toFixed(0)}`;
    const wrapNote = fit.overflow ? ', wrapped' : '';
    this._legend.style.display = this._state.showDebug ? 'block' : 'none';
    this._legend.textContent = `${axisNote} (${fit.mode}${wrapNote}) · wght ${wght} · container ${this._containerWidthPx().toFixed(0)}px`;
  }
}

export default AutoFitHeadlines;
