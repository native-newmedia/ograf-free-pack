/** orb-core.js: shared engine core for the thinking-orbs graphic (state, sizing, draw options). */

export function lerp(a, b, f) {
  return a + (b - a) * f;
}

export function clamp01(t) {
  return Math.max(0, Math.min(1, t));
}

export function frac(x) {
  return x - Math.floor(x);
}

export function angleDelta(a, b) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

export function hashD(a, b) {
  const h = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return h - Math.floor(h);
}

export function vnoise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let fx = x - xi;
  let fy = y - yi;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hashD(xi, yi);
  const b = hashD(xi + 1, yi);
  const c = hashD(xi, yi + 1);
  const d = hashD(xi + 1, yi + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

export function fibDir(i, n) {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const y = 1 - (2 * (i + 0.5)) / n;
  const rad = Math.sqrt(1 - y * y);
  const a = i * golden;
  return [rad * Math.cos(a), y, rad * Math.sin(a)];
}

export function makeProj(yaw, tilt, cx, cy, scale) {
  const st = Math.sin(tilt);
  const ct = Math.cos(tilt);
  const sy = Math.sin(yaw);
  const cyw = Math.cos(yaw);
  return (x, y, z) => {
    const x1 = x * cyw + z * sy;
    const z1 = -x * sy + z * cyw;
    const y1 = y * ct - z1 * st;
    const z2 = y * st + z1 * ct;
    return [cx + x1 * scale, cy - y1 * scale, z2];
  };
}

export function radiusScale(size, pow) {
  return (size / 300) ** pow;
}

export function finalizeFrame(dots, lines, rMin = 0.3) {
  const visible = [];
  for (const d of dots) {
    if ((d.a ?? 1) < 0.02) continue;
    d.r = Math.max(rMin, d.r);
    visible.push(d);
  }
  visible.sort((a, b) => a.z - b.z);
  return { dots: visible, lines: lines.filter((l) => (l.a ?? 1) >= 0.02) };
}

const COUNT_PAIRS = [
  ['latRings', 'lonDensity'],
  ['rings', 'lonDensity'],
  ['lanes', 'segs']
];
const COUNT_KEYS = ['orbitN', 'ghostN', 'nodeN', 'strandN', 'signals'];
const ICON_DENSITY_KEYS = ['iconD'];

const RADIUS_KEYS = [
  'rBase',
  'rDepth',
  'rActive',
  'rDot',
  'ghostR',
  'partR',
  'partRDepth',
  'nodeR',
  'nodeRDepth'
];

export const SCALING_KEYS = {
  countPairs: COUNT_PAIRS,
  countKeys: COUNT_KEYS,
  iconDensityKeys: ICON_DENSITY_KEYS,
  radiusKeys: RADIUS_KEYS
};

export function scaleCounts(opts, scale) {
  const out = { ...opts };
  const done = new Set();
  const rt = Math.sqrt(scale);
  for (const [a, b] of COUNT_PAIRS) {
    const va = out[a];
    const vb = out[b];
    if (va != null && vb != null && !done.has(a) && !done.has(b)) {
      out[a] = Math.max(2, Math.round(va * rt));
      out[b] = Math.max(2, Math.round(vb * rt));
      done.add(a);
      done.add(b);
    }
  }
  for (const k of COUNT_KEYS) {
    const v = out[k];
    if (v != null && v !== 0 && !done.has(k)) out[k] = Math.max(1, Math.round(v * scale));
  }
  for (const k of ICON_DENSITY_KEYS) {
    const v = out[k];
    if (v != null) out[k] = Math.max(0.02, v * scale);
  }
  return out;
}

export function scaleRadii(opts, scale) {
  const out = { ...opts };
  for (const k of RADIUS_KEYS) {
    const v = out[k];
    if (v != null) out[k] = v * scale;
  }
  out.rSizeMul = (out.rSizeMul ?? 1) * scale;
  return out;
}

export const STATE_TO_MODE = {
  working: 'orbits',
  searching: 'globe',
  solving: 'rubik',
  listening: 'wave',
  connecting: 'web',
  weaving: 'braid',
  composing: 'ribbon',
  breathing: 'ring',
  shaping: 'morph'
};

export const STATE_ORDER = Object.keys(STATE_TO_MODE);

export function resolveState(v) {
  const s = String(v ?? '');
  if (/^\d+$/.test(s)) return STATE_ORDER[Number(s) - 1] ?? STATE_ORDER[0];
  return STATE_TO_MODE[s] ? s : 'searching';
}

export function resolvePreset(tuning, state, size, muls = {}) {
  const mode = STATE_TO_MODE[resolveState(state)] || 'globe';
  const preset = tuning?.presets?.[mode]?.[String(size)] ?? null;

  let opts = { ...(tuning?.baseProfiles?.[mode] ?? {}) };
  const count = (preset?.count ?? 1) * (muls.dotDensity ?? 1);
  const radii = (preset?.size ?? 1) * (muls.dotSize ?? 1);
  if (count !== 1) opts = scaleCounts(opts, count);
  if (radii !== 1) opts = scaleRadii(opts, radii);
  if (preset?.extra) opts = { ...opts, ...preset.extra };

  return { mode, speed: preset?.speed ?? 1, opts };
}

export const INK = {
  inkDimColor: '#000000',
  inkBrightColor: '#ffffff'
};

export const DEFAULT_STATE = {
  orbState: 2,
  theme: 1,
  dotDensity: 1.0,
  dotSize: 1.0,
  orbSize: 240,
  posX: 0.5,
  posY: 0.5,
  speedMul: 1.0,
  ...INK,
  bgColor: '#000000ff',
  showBackground: false,
  introDuration: 0.6,   // s, = manifest actionDurations.playAction / 1000
  outroDuration: 0.4,   // s, = manifest actionDurations.stopAction / 1000
  easePower: 3
};
