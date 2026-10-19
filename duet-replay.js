import { cloneDuet, validateDuet, createDuet } from './duet.js?v=0.12.0';

export const MAX_DURATION = 20 * 60 * 1000;
export const MAX_FRAMES = 20000;
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
const FORMAT = 'yiren-duet-recording';
const ROOT_KEYS = new Set(['format', 'version', 'playerRole', 'duration', 'frames']);
const FRAME_KEYS = new Set(['t', 'world']);
const BAD_KEYS = new Set(['__proto__', 'prototype', 'constructor', 'toJSON']);
const tails = new WeakMap();
const roles = new Set(['wukong', 'dragon']);
const fail = message => { throw new Error(`无效合演文件：${message}`); };

function time(value) {
  if (!Number.isFinite(value) || value < 0 || value > MAX_DURATION) {
    throw new RangeError('时间须为 0 至 1200000 之间的有限毫秒数');
  }
  return value;
}
function byteLength(value) { return new TextEncoder().encode(value).byteLength; }

// Inspect descriptors before any reads, cloning or JSON.stringify. Accessors and
// toJSON hooks supplied by an imported/caller-created object are never invoked.
function descriptorsOf(value, array = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value) !== array) fail('对象结构无效');
  const proto = Object.getPrototypeOf(value);
  if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) fail('只接受普通 JSON 对象');
  if (Object.getOwnPropertySymbols(value).length) fail('不接受 Symbol 属性');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (BAD_KEYS.has(key)) fail('包含危险属性');
    if (!('value' in descriptor)) fail('不接受访问器属性');
  }
  return descriptors;
}
function safeJson(value, ancestors = new Set(), depth = 0, budget = { n: 0 }) {
  if (depth > 64 || ++budget.n > 20000000) fail('对象过深或过大');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('包含非有限数值');
    return;
  }
  if (typeof value !== 'object') fail('只能包含 JSON 数据');
  const array = Array.isArray(value);
  const descriptors = descriptorsOf(value, array);
  if (ancestors.has(value)) fail('存在循环引用');
  ancestors.add(value);
  const length = array ? descriptors.length.value : 0;
  if (array && Object.keys(descriptors).length !== length + 1) fail('数组不能缺项或附加属性');
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (array && key === 'length') continue;
    if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= length)) fail('数组包含额外属性');
    safeJson(descriptor.value, ancestors, depth + 1, budget);
  }
  ancestors.delete(value);
}
function checkedWorld(raw, role) {
  safeJson(raw);
  const world = cloneDuet(validateDuet(raw));
  if (!roles.has(world.playerRole) || (role && world.playerRole !== role)) fail('玩家角色不一致');
  return world;
}
function header(recording) {
  const d = descriptorsOf(recording);
  if (Object.keys(d).some(key => !ROOT_KEYS.has(key))) fail('包含未知顶层字段');
  if (d.format?.value !== FORMAT || d.version?.value !== 1) fail('格式或版本不支持');
  if (!roles.has(d.playerRole?.value)) fail('玩家角色无效');
  time(d.duration?.value);
  const frames = d.frames?.value;
  if (!Array.isArray(frames) || Object.getPrototypeOf(frames) !== Array.prototype ||
      frames.length < 1 || frames.length > MAX_FRAMES) fail('帧数量须为 1 至 20000');
  return recording;
}
function frameAt(recording, index) {
  const descriptor = Object.getOwnPropertyDescriptor(recording.frames, String(index));
  if (!descriptor || !('value' in descriptor)) fail('帧数组包含缺项或访问器');
  const frame = descriptor.value;
  const d = descriptorsOf(frame);
  if (Object.keys(d).some(key => !FRAME_KEYS.has(key)) || !d.world) fail('帧结构无效');
  time(d.t?.value);
  return frame;
}
function normalizedRecording(raw) {
  safeJson(raw);
  header(raw);
  let previous = -1;
  let previousElapsed = -1;
  const frames = raw.frames.map((_, index) => {
    const frame = frameAt(raw, index);
    if ((index === 0 && frame.t !== 0) || frame.t <= previous || frame.t > raw.duration) {
      fail('帧时间须从零开始、严格递增且不超过总时长');
    }
    const world = checkedWorld(frame.world, raw.playerRole);
    if (world.elapsed < previousElapsed) fail('场景时钟不能倒退');
    previous = frame.t;
    previousElapsed = world.elapsed;
    return { t: frame.t, world };
  });
  return { format: FORMAT, version: 1, playerRole: raw.playerRole, duration: raw.duration, frames };
}
function signature(world) {
  // Only the two display/simulation clocks are immaterial to a stationary pose.
  // Dwell, flags, events and AI metadata remain semantically significant.
  return JSON.stringify({ ...world, elapsed: 0, phaseElapsed: 0 });
}
function validTail(recording, last) {
  const tail = tails.get(recording);
  return tail && tail.frame === last && tail.t === recording.duration ? tail : null;
}
function advanceClocks(world, deltaMs) {
  const result = cloneDuet(world);
  result.elapsed += deltaMs / 1000;
  result.phaseElapsed += deltaMs / 1000;
  return checkedWorld(result, world.playerRole);
}
function endpoint(recording, last) {
  const tail = validTail(recording, last);
  return tail ? cloneDuet(tail.world) : advanceClocks(last.world, recording.duration - last.t);
}

export function createDuetRecording(initial = createDuet()) {
  const world = checkedWorld(initial);
  const first = { t: 0, world };
  const recording = { format: FORMAT, version: 1, playerRole: world.playerRole, duration: 0, frames: [first] };
  tails.set(recording, { frame: first, t: 0, world: cloneDuet(world) });
  return recording;
}

export function captureDuet(recording, world, t) {
  header(recording);
  time(t);
  if (t < recording.duration) throw new RangeError('录制时间不能倒退，请先截断');
  const next = checkedWorld(world, recording.playerRole);
  const last = frameAt(recording, recording.frames.length - 1);
  const before = checkedWorld(last.world, recording.playerRole);
  const oldEndpoint = endpoint(recording, last);
  if (next.elapsed < oldEndpoint.elapsed) fail('场景时钟不能倒退');
  if (t === last.t) {
    last.world = next;
    recording.duration = t;
    tails.set(recording, { frame: last, t, world: next });
    return recording;
  }
  if (signature(before) === signature(next)) {
    if (recording.frames.length >= MAX_FRAMES && t > last.t) fail('帧数量超过 20000');
    recording.duration = t;
    tails.set(recording, { frame: last, t, world: next });
    return recording;
  }
  const needsHold = recording.duration > last.t && recording.duration < t;
  if (recording.frames.length + (needsHold ? 2 : 1) > MAX_FRAMES) fail('帧数量超过 20000');
  if (needsHold) recording.frames.push({ t: recording.duration, world: oldEndpoint });
  const frame = { t, world: next };
  recording.frames.push(frame);
  recording.duration = t;
  tails.set(recording, { frame, t, world: next });
  return recording;
}

export function updateDuetDuration(recording, t) {
  header(recording);
  time(t);
  if (t < recording.duration) throw new RangeError('录制时间不能倒退，请先截断');
  const last = frameAt(recording, recording.frames.length - 1);
  const world = advanceClocks(endpoint(recording, last), t - recording.duration);
  return captureDuet(recording, world, t);
}

function discreteChanged(before, after) {
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object') return false;
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (['phase', 'trial', 'size'].includes(key) && before[key] !== after[key]) return true;
    if (before[key] && after[key] && typeof before[key] === 'object' && typeof after[key] === 'object' &&
        discreteChanged(before[key], after[key])) return true;
  }
  return false;
}
function blendCoordinates(before, after, amount) {
  for (const key of Object.keys(before)) {
    if ((key === 'x' || key === 'y') && Number.isFinite(before[key]) && Number.isFinite(after[key])) {
      before[key] += (after[key] - before[key]) * amount;
    } else if (before[key] && after[key] && typeof before[key] === 'object' && typeof after[key] === 'object') {
      blendCoordinates(before[key], after[key], amount);
    }
  }
}
function blendActors(before, after, amount) {
  // The actor states are the only branches with physical coordinates. Do not
  // interpolate event history, task state or AI policy metadata.
  for (const role of roles) {
    if (before[role] && after[role]) blendCoordinates(before[role], after[role], amount);
  }
}

export function sampleDuet(recording, t) {
  header(recording);
  if (!Number.isFinite(t)) throw new RangeError('采样时间必须为有限毫秒数');
  const target = Math.max(0, Math.min(t, recording.duration));
  let low = 0;
  let high = recording.frames.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (frameAt(recording, middle).t <= target) low = middle + 1;
    else high = middle;
  }
  const previous = frameAt(recording, Math.max(0, low - 1));
  const before = checkedWorld(previous.world, recording.playerRole);
  if (target === previous.t) return before;
  const next = low < recording.frames.length ? frameAt(recording, low) :
    recording.duration > previous.t ? { t: recording.duration, world: endpoint(recording, previous) } : null;
  if (!next) return before;
  const after = checkedWorld(next.world, recording.playerRole);
  const amount = (target - previous.t) / (next.t - previous.t);
  if (amount >= 1) return after;
  const result = cloneDuet(before);
  result.elapsed += (after.elapsed - before.elapsed) * amount;
  result.phaseElapsed = before.phase === after.phase && before.trial === after.trial
    ? before.phaseElapsed + (after.phaseElapsed - before.phaseElapsed) * amount
    : before.phaseElapsed + result.elapsed - before.elapsed;
  if (!discreteChanged(before, after)) blendActors(result, after, amount);
  try { return checkedWorld(result, recording.playerRole); }
  catch {
    // Endpoint interpolation can cross an impossible held pose. Preserve the
    // legal prior pose and advance only clocks rather than inventing contact.
    before.elapsed = result.elapsed;
    before.phaseElapsed = result.phaseElapsed;
    return checkedWorld(before, recording.playerRole);
  }
}

function materialized(recording) {
  const source = normalizedRecording(recording);
  const originalLast = frameAt(recording, recording.frames.length - 1);
  if (source.duration > originalLast.t) {
    if (source.frames.length >= MAX_FRAMES) fail('帧数量超过 20000');
    source.frames.push({ t: source.duration, world: endpoint(recording, originalLast) });
  }
  return source;
}
export function truncateDuet(recording, t) {
  const source = materialized(recording);
  time(t);
  if (t > source.duration) throw new RangeError('截断时间不能超过原时长');
  const world = sampleDuet(source, t);
  const frames = source.frames.filter(frame => frame.t <= t);
  if (frames[frames.length - 1].t !== t) {
    if (frames.length >= MAX_FRAMES) fail('帧数量超过 20000');
    frames.push({ t, world });
  }
  return { ...source, duration: t, frames };
}
export function serializeDuet(recording) {
  const text = JSON.stringify(materialized(recording));
  if (byteLength(text) > MAX_FILE_BYTES) fail('文件超过 8 MiB');
  return text;
}
export function parseDuet(text) {
  if (typeof text !== 'string') fail('须传入 JSON 文本');
  if (text.length > MAX_FILE_BYTES || byteLength(text) > MAX_FILE_BYTES) fail('文件超过 8 MiB');
  let raw;
  try { raw = JSON.parse(text); }
  catch { fail('JSON 语法错误'); }
  return normalizedRecording(raw);
}
