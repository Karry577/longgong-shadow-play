/**
 * Original words and percussion DATA, not a traditional libretto or a recording.
 * This module has no audio objects, timers, speech synthesis or playback effects.
 */
import { sampleDuet, serializeDuet, parseDuet } from './duet-replay.js?v=0.12.0';

const PHASES = ['arrival', 'request', 'trial', 'guide', 'staff', 'farewell', 'complete'];
const ROLES = ['wukong', 'dragon'];
const plans = new WeakMap();
const EPS = 1e-7;
export const SCORE_VERSION = 1;
export const CAPTION_HOLD_MS = 5000; // Caption window only, never an audio-duration claim.

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
const copy = value => JSON.parse(JSON.stringify(value));

export const SCORE_PROVENANCE = deepFreeze({
  version: SCORE_VERSION,
  authorship: '本作原创数字舞台配词与节拍',
  story: '依据《西游记》龙宫借器相关情节作精简改编',
  traditionalLibretto: false,
  traditionalVocalRecording: false,
  lyricStatus: 'text-only',
  musicStatus: 'teaching-patterns-only',
  audioAssets: '本模块不含录音；实际配乐由音频模块另行标注来源。',
  note: '不是传统唱本、地方戏曲锣鼓经或传承人唱腔；七字句以念白呈现，不表示已有实唱录音。',
});

// Twenty-four original seven-character lines; no modern film dialogue.
export const PERFORMANCE_LYRICS = deepFreeze({
  arrival: {
    wukong: ['花果山前辞翠岭', '水晶宫外叩朱扉'],
    dragon: ['海门初启迎来客', '且向晶宫问姓名'],
  },
  request: {
    wukong: ['访遍群峰寻利器', '愿从海藏试锋芒'],
    dragon: ['千年海藏陈兵刃', '几样神锋任君量'],
  },
  trial: {
    wukong: ['九股叉轻难趁手', '方天画戟亦寻常'],
    dragon: ['九股叉开分水势', '方天戟起动寒光'],
  },
  guide: {
    wukong: ['随君移步观深处', '直向神铁问短长'],
    dragon: ['海藏深沉留古铁', '禹迹遗珍映海光'],
  },
  staff: {
    wukong: ['神铁应声随手起', '长短相宜放彩光'],
    dragon: ['海藏神珍君试看', '金光一线照龙堂'],
  },
  farewell: {
    wukong: ['得此神珍酬壮志', '辞君还赴故山乡'],
    dragon: ['海藏神珍今有主', '海门相送水云长'],
  },
});

const SECTIONS = deepFreeze({
  arrival: { title: '水晶宫前', bpm: 72 },
  request: { title: '借器陈情', bpm: 68 },
  'trial-0': { title: '先试九股叉', bpm: 84 },
  'trial-1': { title: '再试方天画戟', bpm: 90 },
  guide: { title: '海藏指铁', bpm: 64 },
  staff: { title: '神铁如意', bpm: 76 },
  farewell: { title: '携宝辞宫', bpm: 72 },
  complete: { title: '收锣落幕', bpm: 60 },
});

function fail(message) { throw new Error(`无效演出配词数据：${message}`); }
function own(object, key, optional = false) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor) { if (optional) return undefined; fail(`缺少${key}`); }
  if (!('value' in descriptor)) fail('不接受访问器');
  return descriptor.value;
}
function plain(object) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) fail('须为普通对象');
  const proto = Object.getPrototypeOf(object);
  if (proto !== Object.prototype && proto !== null) fail('须为普通对象');
  for (const key of Reflect.ownKeys(Object.getOwnPropertyDescriptors(object))) {
    if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor', 'toJSON'].includes(key)) fail('危险属性');
    own(object, key);
  }
  return object;
}
function phaseInfo(world) {
  plain(world);
  const phase = own(world, 'phase');
  const trial = own(world, 'trial', true) ?? 0;
  if (!PHASES.includes(phase) || ![0, 1].includes(trial)) fail('场次或试器编号');
  return { phase, trial, key: phase === 'trial' ? `trial-${trial}` : phase };
}
function linesFor(phase, trial, actor = null) {
  if (!PERFORMANCE_LYRICS[phase]) return [];
  const roles = actor ? [actor] : ROLES;
  return roles.flatMap(role => PERFORMANCE_LYRICS[phase][role]
    .filter((_, index) => phase !== 'trial' || index === trial)
    .map(text => ({ role, text, kind: '白' })));
}

/** beat is beats-per-bar (4), not the name of a regional opera rhythm. */
export function getPerformanceScore(world) {
  const { phase, trial, key } = phaseInfo(world);
  return {
    key, title: SECTIONS[key].title, beat: 4, bpm: SECTIONS[key].bpm,
    section: phase, lines: linesFor(phase, trial), provenance: copy(SCORE_PROVENANCE),
  };
}

const PATTERNS = deepFreeze({
  enter: [{ atBeat: 0, voice: 'gong', gain: 0.32 }, { atBeat: 0.5, voice: 'drum', gain: 0.22 }, { atBeat: 1, voice: 'clapper', gain: 0.18 }],
  reply: [{ atBeat: 0, voice: 'clapper', gain: 0.17 }],
  weapon: [{ atBeat: 0, voice: 'drum', gain: 0.26 }, { atBeat: 0.5, voice: 'clapper', gain: 0.2 }, { atBeat: 1, voice: 'gong', gain: 0.28 }],
  point: [{ atBeat: 0, voice: 'clapper', gain: 0.15 }, { atBeat: 0.75, voice: 'drum', gain: 0.17 }],
  grip: [{ atBeat: 0, voice: 'drum', gain: 0.2 }],
  resize: [{ atBeat: 0, voice: 'clapper', gain: 0.12 }, { atBeat: 0.25, voice: 'clapper', gain: 0.1 }],
  lift: [{ atBeat: 0, voice: 'gong', gain: 0.38 }, { atBeat: 0.5, voice: 'drum', gain: 0.24 }],
  close: [{ atBeat: 0, voice: 'gong', gain: 0.3 }, { atBeat: 1, voice: 'clapper', gain: 0.15 }, { atBeat: 1.5, voice: 'drum', gain: 0.12 }],
});

/**
 * A cue describes words/percussion only. The host must not treat every render as
 * permission to play it. ai_reply must be a real explicit event, not ai.status.
 * staff: invite_staff = the first dragon line; reply/staff_release = the second.
 */
export function getCueForEvent(event) {
  plain(event);
  const type = own(event, 'type');
  const actor = own(event, 'actor', true) ?? 'system';
  const control = own(event, 'control', true) ?? (type === 'ai_reply' ? 'ai' : actor === 'system' ? 'system' : 'human');
  const t = own(event, 't', true);
  if (typeof type !== 'string' || type.length > 64 || !['wukong', 'dragon', 'system'].includes(actor)
    || !['human', 'ai', 'system'].includes(control) || t !== undefined && (!Number.isFinite(t) || t < 0)) fail('事件字段');
  const { phase, trial, key } = phaseInfo(event);
  let lines = [], pattern = null, title = SECTIONS[key].title;
  if (type === 'reply' || type === 'ai_reply' || type === 'staff_release') {
    if (!ROLES.includes(actor)) return null;
    lines = linesFor(phase, trial, actor);
    if (phase === 'staff' && actor === 'dragon') lines = lines.slice(1);
    pattern = PATTERNS.reply;
  } else if (type === 'invite_staff' && phase === 'staff' && actor === 'dragon') {
    lines = linesFor('staff', trial, 'dragon').slice(0, 1); pattern = PATTERNS.point; title = '请试神铁';
  } else if (type === 'farewell' && phase === 'farewell' && actor === 'dragon') {
    lines = linesFor('farewell', trial, 'dragon'); pattern = PATTERNS.close;
  } else if (type === 'overture' && actor === 'system') { pattern = PATTERNS.enter; title = '开场引子'; }
  else if (type === 'enter') pattern = phase === 'trial' ? PATTERNS.weapon : PATTERNS.enter;
  else if (type === 'trial_second') pattern = PATTERNS.weapon;
  else if (type === 'grip_staff') pattern = PATTERNS.grip;
  else if (type === 'resize_staff') pattern = PATTERNS.resize;
  else if (type === 'lift_staff') pattern = PATTERNS.lift;
  else if (type === 'complete') pattern = PATTERNS.close;
  if (!pattern) return null;
  return {
    key: `${key}:${type}:${actor}`, eventId: `${type}|${phase}|${trial}|${actor}|${control}|${t ?? ''}`,
    title, beat: 4, bpm: SECTIONS[key].bpm, section: phase, actor, control,
    sourceEvent: {type,phase,trial,actor,control,t:t??0},
    percussion: copy(pattern), lines, provenance: copy(SCORE_PROVENANCE),
  };
}

function fingerprint(recording) {
  plain(recording);
  const frames = own(recording, 'frames'), duration = own(recording, 'duration');
  if (!Array.isArray(frames) || !Number.isFinite(duration)) fail('录制结构');
  const length = own(frames, 'length');
  if (!length) fail('空录制');
  const last = own(frames, String(length - 1)); plain(last);
  const world = own(last, 'world'); plain(world);
  return { frames, length, duration, last, world, elapsed: own(world, 'elapsed') };
}
function sameFingerprint(a, b) {
  return a.frames === b.frames && a.length === b.length && a.duration === b.duration
    && a.last === b.last && a.world === b.world && a.elapsed === b.elapsed;
}
function eventKey(e) { return `${e.type}|${e.phase}|${e.trial}|${e.actor}|${e.control}|${e.t}`; }
function groupKey(e) { return `${e.phase}|${e.trial}|${e.actor}|${e.control}|${e.t}`; }

function planFor(recording) {
  const mark = fingerprint(recording);
  const cached = plans.get(recording);
  if (cached && sameFingerprint(mark, cached.mark)) return cached.plan;
  // Validate on first access/change, including getters/toJSON and size limits.
  const safe = parseDuet(serializeDuet(recording));
  const initialClock = safe.frames[0].world.elapsed;
  const seen = new Set(), raw = [], sections = [];
  let previousKey = null;
  for (const frame of safe.frames) {
    const info = phaseInfo(frame.world);
    if (info.key !== previousKey) {
      sections.push({ startMs: frame.t, phase: info.phase, trial: info.trial, key: info.key });
      previousKey = info.key;
    }
    for (const event of frame.world.events) {
      const key = eventKey(event);
      if (seen.has(key)) continue;
      seen.add(key);
      // A clipped recording can inherit earlier history. Do not sing old lines
      // again at clip start. Its current scene still receives background music.
      if (event.t < initialClock - EPS) continue;
      raw.push({ event, startMs: frame.t, order: raw.length });
      if (raw.length > 4096) fail('演出提示过多');
    }
  }
  const specific = new Set(raw.filter(row => ['invite_staff', 'farewell'].includes(row.event.type)).map(row => groupKey(row.event)));
  const cues = [];
  for (const row of raw) {
    // actionDuet stores reply and invite_staff/farewell at the same instant.
    // The specific event supplies the words; keep only one vocal/percussion cue.
    if (row.event.type === 'reply' && specific.has(groupKey(row.event))) continue;
    const cue = getCueForEvent(row.event);
    if (!cue) continue;
    cues.push({ ...cue, id: cue.eventId, startMs: row.startMs, worldEventTime: row.event.t, order: row.order });
  }
  cues.sort((a, b) => a.startMs - b.startMs || a.order - b.order);
  const plan = { duration: safe.duration, sections, cues };
  plans.set(recording, { mark, plan });
  return plan;
}

/**
 * Read-only transport snapshot. No `play` flag is returned: callers must keep a
 * previous cursor and trigger only getScoreCuesBetween() during forward playback.
 * startMs uses the first recorded frame containing an event, so sound never
 * anticipates the corresponding saved discrete scene/action state.
 */
export function getScoreTimeline(recording, t, { captionHoldMs = CAPTION_HOLD_MS } = {}) {
  if (!Number.isFinite(t) || !Number.isFinite(captionHoldMs) || captionHoldMs < 0 || captionHoldMs > 60000) fail('时间');
  const plan = planFor(recording);
  const cursor = Math.max(0, Math.min(t, plan.duration));
  const world = sampleDuet(recording, cursor);
  const score = getPerformanceScore(world);
  const section = [...plan.sections].reverse().find(item => item.startMs <= cursor) || plan.sections[0];
  const past = plan.cues.filter(cue => cue.startMs <= cursor);
  const latest = past.at(-1) || null;
  const vocal = [...past].reverse().find(cue => cue.lines.length && cursor < cue.startMs + captionHoldMs) || null;
  return {
    timeMs: cursor, score, musicStartMs: section.startMs, musicOffsetMs: cursor - section.startMs,
    activeCue: vocal ? copy({ ...vocal, offsetMs: cursor - vocal.startMs }) : null,
    latestCue: latest ? copy(latest) : null,
    nextCue: plan.cues.find(cue => cue.startMs > cursor) ? copy(plan.cues.find(cue => cue.startMs > cursor)) : null,
    lines: vocal ? copy(vocal.lines) : [],
    subtitle: vocal ? vocal.lines.map(line => line.text).join('\n') : '',
    cues: copy(plan.cues), provenance: copy(SCORE_PROVENANCE),
  };
}

/** Forward-only event window (fromMs,toMs]; seeking backwards never replays. */
export function getScoreCuesBetween(recording, fromMs, toMs) {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) fail('时间');
  if (toMs <= fromMs) return [];
  const plan = planFor(recording);
  const end = Math.min(toMs, plan.duration);
  return copy(plan.cues.filter(cue => cue.startMs > fromMs && cue.startMs <= end));
}
