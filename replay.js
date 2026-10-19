import { cloneState, validateState, createState } from './engine.js?v=0.2.0';

export const MAX_DURATION = 20 * 60 * 1000;
export const MAX_FRAMES = 20000;
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
const FORMAT = 'yiren-shadow-play';
const BAD_KEYS = new Set(['__proto__', 'prototype', 'constructor', 'toJSON']);
const ROOT_KEYS = new Set(['format', 'version', 'title', 'duration', 'frames']);
const FRAME_KEYS = new Set(['t', 'state']);

function fail(message) { throw new Error(`无效排演文件：${message}`); }
function time(value) {
  if (!Number.isFinite(value) || value < 0 || value > MAX_DURATION) {
    throw new RangeError('时间须为 0 至 1200000 之间的有限毫秒数');
  }
  return value;
}
function byteLength(value) { return new TextEncoder().encode(value).byteLength; }

// Validate before stringify/clone, so a supplied getter or toJSON never runs.
function safeJson(value, ancestors = new Set(), depth = 0, count = { n: 0 }) {
  if (depth > 64 || ++count.n > 2000000) fail('对象过深或过大');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('包含非有限数值');
    return;
  }
  if (typeof value !== 'object') fail('只能包含 JSON 数据，不能包含代码对象');
  const proto = Object.getPrototypeOf(value);
  if (Array.isArray(value) ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) {
    fail('只接受普通 JSON 对象');
  }
  if (ancestors.has(value)) fail('存在循环引用');
  if (Object.getOwnPropertySymbols(value).length) fail('不接受 Symbol 属性');
  ancestors.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (BAD_KEYS.has(key)) fail('包含危险属性');
    if (descriptor.get || descriptor.set) fail('不接受访问器属性');
    if (Array.isArray(value) && key === 'length') continue;
    if (Array.isArray(value) && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) {
      fail('数组包含额外属性');
    }
    safeJson(descriptor.value, ancestors, depth + 1, count);
  }
  if (Array.isArray(value) && Object.keys(descriptors).length !== value.length + 1) fail('数组不能缺项');
  ancestors.delete(value);
}

function checkedState(raw) {
  safeJson(raw);
  return cloneState(validateState(raw));
}
function shallowRecording(recording) {
  if (!recording || recording.format !== FORMAT || recording.version !== 1) fail('格式或版本不支持');
  time(recording.duration);
  if (!Array.isArray(recording.frames) || recording.frames.length < 1 || recording.frames.length > MAX_FRAMES) {
    fail('帧数量须为 1 至 20000');
  }
}
function normalizedRecording(raw) {
  safeJson(raw);
  shallowRecording(raw);
  if (Object.keys(raw).some(key => !ROOT_KEYS.has(key))) fail('包含未知顶层字段');
  if (typeof raw.title !== 'string' || !raw.title.trim() || raw.title.length > 200) fail('标题无效');
  let previous = -1;
  const frames = raw.frames.map((frame, index) => {
    if (!frame || Array.isArray(frame) || typeof frame !== 'object' ||
        Object.keys(frame).some(key => !FRAME_KEYS.has(key))) fail('帧结构无效');
    time(frame.t);
    if ((index === 0 && frame.t !== 0) || frame.t <= previous || frame.t > raw.duration) {
      fail('帧时间须从零开始、严格递增且不超过总时长');
    }
    previous = frame.t;
    return { t: frame.t, state: checkedState(frame.state) };
  });
  return { format: FORMAT, version: 1, title: raw.title, duration: raw.duration, frames };
}

export function createRecording(initial = createState()) {
  return {
    format: FORMAT, version: 1, title: '龙宫得宝', duration: 0,
    frames: [{ t: 0, state: checkedState(initial) }],
  };
}

export function updateDuration(recording, t) {
  shallowRecording(recording);
  time(t);
  if (t < recording.duration) throw new RangeError('录制时间不能倒退，请先截断');
  recording.duration = t;
  return recording;
}

export function capture(recording, state, t) {
  shallowRecording(recording);
  time(t);
  if (t < recording.duration) throw new RangeError('录制时间不能倒退，请先截断');
  const next = checkedState(state);
  const last = recording.frames[recording.frames.length - 1];
  if (JSON.stringify(last.state) === JSON.stringify(next)) {
    recording.duration = t;
    return recording;
  }
  if (t === last.t) {
    last.state = next;
    recording.duration = t;
    return recording;
  }
  // A compressed stationary tail needs a hold endpoint when movement resumes.
  // Without it, interpolation would make the actor start moving too early.
  const needsHold = recording.duration > last.t && recording.duration < t;
  if (recording.frames.length + (needsHold ? 2 : 1) > MAX_FRAMES) fail('帧数量超过 20000');
  if (needsHold) recording.frames.push({ t: recording.duration, state: cloneState(last.state) });
  recording.frames.push({ t, state: next });
  recording.duration = t;
  return recording;
}

function blendCoordinates(before, after, amount) {
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object') return;
  for (const key of Object.keys(before)) {
    if ((key === 'x' || key === 'y') && Number.isFinite(before[key]) && Number.isFinite(after[key])) {
      before[key] += (after[key] - before[key]) * amount;
    } else if (before[key] && after[key] && typeof before[key] === 'object' && typeof after[key] === 'object') {
      blendCoordinates(before[key], after[key], amount);
    }
  }
}
function continuousBranches(before, after, amount) {
  for (const key of Object.keys(before)) {
    if (!before[key] || !after[key] || typeof before[key] !== 'object' || typeof after[key] !== 'object') continue;
    if (key === 'body' || key === 'hands' || key === 'staff') blendCoordinates(before[key], after[key], amount);
    else continuousBranches(before[key], after[key], amount);
  }
}
function discreteChanged(before, after) {
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object') return false;
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if ((key === 'phase' || key === 'size') && before[key] !== after[key]) return true;
    if (before[key] && after[key] && typeof before[key] === 'object' && typeof after[key] === 'object' &&
        discreteChanged(before[key], after[key])) return true;
  }
  return false;
}

export function sample(recording, t) {
  shallowRecording(recording);
  if (!Number.isFinite(t)) throw new RangeError('采样时间必须为有限毫秒数');
  const target = Math.max(0, Math.min(t, recording.duration));
  const frames = recording.frames;
  let low = 0;
  let high = frames.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (frames[middle].t <= target) low = middle + 1;
    else high = middle;
  }
  const previous = frames[Math.max(0, low - 1)];
  const next = frames[low];
  const result = cloneState(previous.state);
  if (!next || target === previous.t || discreteChanged(previous.state, next.state)) return result;
  continuousBranches(result, next.state, (target - previous.t) / (next.t - previous.t));
  // A valid endpoint pair can cross an invalid contact/geometry state. Hold the
  // previous pose instead of showing an impossible intermediate configuration.
  try { return checkedState(result); }
  catch { return cloneState(previous.state); }
}

export function truncate(recording, t) {
  const source = normalizedRecording(recording);
  time(t);
  if (t > source.duration) throw new RangeError('截断时间不能超过原时长');
  const state = sample(source, t);
  const frames = source.frames.filter(frame => frame.t <= t);
  if (frames[frames.length - 1].t !== t) {
    if (frames.length >= MAX_FRAMES) fail('帧数量超过 20000');
    frames.push({ t, state });
  }
  return { ...source, duration: t, frames };
}

export function serialize(recording) {
  const text = JSON.stringify(normalizedRecording(recording));
  if (byteLength(text) > MAX_FILE_BYTES) fail('文件超过 8 MiB');
  return text;
}

export function parseRecording(text) {
  if (typeof text !== 'string') fail('须传入 JSON 文本');
  if (text.length > MAX_FILE_BYTES || byteLength(text) > MAX_FILE_BYTES) fail('文件超过 8 MiB');
  let raw;
  try { raw = JSON.parse(text); }
  catch { fail('JSON 语法错误'); }
  return normalizedRecording(raw);
}
