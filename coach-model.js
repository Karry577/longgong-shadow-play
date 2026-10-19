import { validateState } from './engine.js?v=0.2.0';

export const MODEL_LABELS = Object.freeze(['approach', 'left_align', 'right_align', 'left_unsteady', 'right_unsteady', 'settle', 'ready', 'resize', 'lift', 'raised']);
export const FEATURE_NAMES = Object.freeze(['left_error_x', 'left_error_y', 'right_error_x', 'right_error_y', 'left_distance', 'right_distance', 'left_speed', 'right_speed', 'left_span', 'right_span', 'left_reversals', 'right_reversals', 'left_dwell', 'right_dwell', 'left_reach', 'right_reach', 'standing', 'gripped', 'lifted', 'size_fit', 'lift_fraction', 'body_speed', 'body_staff_dx', 'window_fraction']);
const WINDOW = 1200;
const MODEL_FORMAT = 'yiren-motion-mlp';
const validatedModels = new WeakSet();

function motion(points, times) {
  if (points.length < 2) return { speed: 0, span: 0, reversals: 0 };
  let length = 0, reversals = 0;
  const velocities = [];
  for (let i = 1; i < points.length; i++) {
    const dt = Math.max(0.001, (times[i] - times[i - 1]) / 1000);
    const dx = points[i].x - points[i - 1].x, dy = points[i].y - points[i - 1].y;
    length += Math.hypot(dx, dy);
    velocities.push({ x: dx / dt, y: dy / dt });
  }
  for (let i = 1; i < velocities.length; i++) {
    const a = velocities[i - 1], b = velocities[i];
    const na = Math.hypot(a.x, a.y), nb = Math.hypot(b.x, b.y);
    if (na >= 10 && nb >= 10 && a.x * b.x + a.y * b.y < -0.2 * na * nb) reversals++;
  }
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  return {
    speed: length / Math.max(0.001, (times[times.length - 1] - times[0]) / 1000),
    span: Math.max(...xs) - Math.min(...xs) + Math.max(...ys) - Math.min(...ys),
    reversals: reversals / Math.max(1, velocities.length - 1),
  };
}

/** Returns 24 features, using only the latest 1200ms of valid stage samples. */
export function extractFeatures(samples) {
  if (!Array.isArray(samples) || !samples.length || samples.length > 4096) throw new Error('需要 1 至 4096 个动作采样');
  let previous = -Infinity;
  const clean = [];
  for (const item of samples) {
    if (!item || !Number.isFinite(item.t) || item.t < 0 || item.t < previous) throw new Error('动作采样时间须为升序有限毫秒');
    const sample = { t: item.t, state: validateState(item.state) };
    if (item.t === previous) clean[clean.length - 1] = sample;
    else clean.push(sample);
    previous = item.t;
  }
  const end = clean[clean.length - 1].t;
  const window = clean.filter(item => item.t >= end - WINDOW);
  const s = window[window.length - 1].state, times = window.map(item => item.t);
  const targets = { left: { x: s.staff.x - 8, y: s.staff.y + 30 }, right: { x: s.staff.x + 8, y: s.staff.y - 28 } };
  const le = { x: targets.left.x - s.hands.left.x, y: targets.left.y - s.hands.left.y };
  const re = { x: targets.right.x - s.hands.right.x, y: targets.right.y - s.hands.right.y };
  const left = motion(window.map(item => item.state.hands.left), times);
  const right = motion(window.map(item => item.state.hands.right), times);
  const body = motion(window.map(item => item.state.body), times);
  const reach = (target, x, y) => 180 / Math.max(180, Math.hypot(target.x - x, target.y - y));
  return [
    le.x / 180, le.y / 180, re.x / 180, re.y / 180,
    Math.hypot(le.x, le.y) / 180, Math.hypot(re.x, re.y) / 180,
    left.speed / 500, right.speed / 500, left.span / 180, right.span / 180,
    left.reversals, right.reversals, s.contacts.left / 0.28, s.contacts.right / 0.28,
    reach(targets.left, s.body.x - 22, s.body.y - 58), reach(targets.right, s.body.x + 23, s.body.y - 63),
    Number(s.staff.phase === 'standing'), Number(s.staff.phase === 'gripped'), Number(s.staff.phase === 'lifted'),
    Number(s.staff.size === 1), s.staff.lift / 220, body.speed / 500,
    (s.staff.x - s.body.x) / 1280, (end - window[0].t) / WINDOW,
  ];
}

function assertPlain(raw, seen = new Set(), depth = 0, budget = { count: 0 }) {
  if (depth > 10 || ++budget.count > 20000) throw new Error('模型嵌套过深或过大');
  if (typeof raw === 'string' && raw.length > 1024) throw new Error('模型字符串过长');
  if (raw === null || typeof raw === 'string' || typeof raw === 'boolean') return;
  if (typeof raw === 'number') { if (!Number.isFinite(raw)) throw new Error('模型包含非有限权重'); return; }
  if (typeof raw !== 'object' || seen.has(raw)) throw new Error('模型必须为普通 JSON 数据');
  const p = Object.getPrototypeOf(raw);
  if (p !== Object.prototype && p !== null && p !== Array.prototype) throw new Error('模型原型无效');
  seen.add(raw);
  if (Array.isArray(raw) && Reflect.ownKeys(raw).length !== raw.length + 1) throw new Error('模型数组不能缺项或包含额外属性');
  for (const key of Reflect.ownKeys(raw)) {
    if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype', 'toJSON'].includes(key)) throw new Error('模型包含危险键');
    const descriptor = Object.getOwnPropertyDescriptor(raw, key);
    if (!('value' in descriptor)) throw new Error('模型不能包含访问器');
    if (Array.isArray(raw) && key === 'length') continue;
    assertPlain(descriptor.value, seen, depth + 1, budget);
  }
  seen.delete(raw);
}
function vector(value, size, positive = false) {
  if (!Array.isArray(value) || value.length !== size || Array.from(value).some(n => !Number.isFinite(n) || Math.abs(n) > 1e6 || positive && n < 1e-8)) throw new Error('模型向量维度或数值无效');
  return Object.freeze([...value]);
}
function matrix(value, rows, columns) {
  if (!Array.isArray(value) || value.length !== rows) throw new Error('模型矩阵维度无效');
  return Object.freeze(value.map(row => vector(row, columns)));
}
export function validateModel(raw) {
  assertPlain(raw);
  if (raw.format !== MODEL_FORMAT || raw.version !== 1 || JSON.stringify(raw.labels) !== JSON.stringify(MODEL_LABELS) || JSON.stringify(raw.features) !== JSON.stringify(FEATURE_NAMES)) throw new Error('模型格式、标签或特征版本不匹配');
  if (!raw.architecture || raw.architecture.input !== 24 || raw.architecture.hidden !== 32 || raw.architecture.output !== 10) throw new Error('只支持 24-32-10 模型');
  const model = Object.freeze({
    format: MODEL_FORMAT, version: 1, labels: MODEL_LABELS, features: FEATURE_NAMES,
    architecture: Object.freeze({ input: 24, hidden: 32, output: 10 }),
    mean: vector(raw.mean, 24), scale: vector(raw.scale, 24, true),
    w1: matrix(raw.w1, 24, 32), b1: vector(raw.b1, 32),
    w2: matrix(raw.w2, 32, 10), b2: vector(raw.b2, 10),
  });
  validatedModels.add(model);
  return model;
}
export function predictMotion(samples, model) {
  const checked = validatedModels.has(model) ? model : validateModel(model);
  const features = extractFeatures(samples);
  const x = features.map((v, i) => (v - checked.mean[i]) / checked.scale[i]);
  const hidden = checked.b1.map((bias, j) => Math.max(0, bias + x.reduce((sum, v, i) => sum + v * checked.w1[i][j], 0)));
  const logits = checked.b2.map((bias, j) => bias + hidden.reduce((sum, v, i) => sum + v * checked.w2[i][j], 0));
  const max = Math.max(...logits), exps = logits.map(v => Math.exp(v - max));
  const total = exps.reduce((a, b) => a + b, 0), probabilities = exps.map(v => v / total);
  const index = probabilities.indexOf(Math.max(...probabilities));
  return { label: MODEL_LABELS[index], confidence: probabilities[index], probabilities, logits };
}
export async function loadCoachModel(url = new URL('./assets/coach-model.json', import.meta.url)) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`动作模型加载失败：${response.status}`);
  const text = await response.text();
  if (new TextEncoder().encode(text).length > 256 * 1024) throw new Error('动作模型文件过大');
  return validateModel(JSON.parse(text));
}
