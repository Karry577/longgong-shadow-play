import { parseRecording, sample, MAX_DURATION } from './replay.js';
import { validateState } from './engine.js';
import { MODEL_LABELS } from './coach-model.js';

export const ANNOTATION_FORMAT = 'yiren-motion-annotation';
export const DATASET_FORMAT = 'yiren-human-motion-dataset';
export const ROLES = Object.freeze(['wukong', 'dragon']);
export const IDENTITIES = Object.freeze(['ordinary', 'practitioner', 'inheritor_self_reported']);
const dangerous = new Set(['__proto__', 'constructor', 'prototype', 'toJSON']);
function safe(value, depth = 0, seen = new Set(), budget = { n: 0 }) {
  if (++budget.n > 2000000 || depth > 32) throw new Error('数据过大或嵌套过深');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') { if (value.length > 8192) throw new Error('文本过长'); return; }
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('禁止非有限数值'); return; }
  if (typeof value !== 'object' || seen.has(value)) throw new Error('只接受安全 JSON 数据');
  const p = Object.getPrototypeOf(value);
  if (p !== Object.prototype && p !== null && p !== Array.prototype) throw new Error('对象原型无效');
  seen.add(value);
  for (const k of Reflect.ownKeys(value)) {
    if (typeof k !== 'string' || dangerous.has(k)) throw new Error('危险属性');
    const d = Object.getOwnPropertyDescriptor(value, k);
    if (!('value' in d)) throw new Error('禁止访问器');
    if (Array.isArray(value) && k === 'length') continue;
    safe(d.value, depth + 1, seen, budget);
  }
  seen.delete(value);
}
function id(value, name) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{2,64}$/.test(value)) throw new Error(`${name}须为2—64位匿名英文/数字ID`);
  if (dangerous.has(value)) throw new Error(`${name}不能使用系统保留词`);
  return value;
}
function finiteTime(value) { if (!Number.isFinite(value) || value < 0 || value > MAX_DURATION) throw new Error('时间范围无效'); return value; }
function identity(value = 'ordinary') { if (!IDENTITIES.includes(value)) throw new Error('身份类型无效'); return value; }
function fingerprint(text) { let n = 2166136261; for (let i = 0; i < text.length; i++) n = Math.imul(n ^ text.charCodeAt(i), 16777619); return `local-${(n >>> 0).toString(16)}`; }

/** Normalizes a v1 or duet actor track. It never silently relabels the AI actor. */
export function extractActorRecording(raw, role = 'wukong') {
  safe(raw);
  if (!ROLES.includes(role)) throw new Error('角色无效');
  if (raw.format === 'yiren-shadow-play') {
    if (role !== 'wukong') throw new Error('旧版录制仅含悟空');
    const recording = parseRecording(JSON.stringify(raw));
    return { recording, manualRole: 'wukong', actorControl: 'human_self_reported', originalFormat: raw.format, originalVersion: raw.version };
  }
  if (raw.format !== 'yiren-duet-recording' || ![1, 3].includes(raw.version) || !Array.isArray(raw.frames) || !raw.frames.length || raw.frames.length > 20000) throw new Error('不支持的录制格式');
  const manualRole = raw.playerRole || raw.frames[0].world?.playerRole;
  if (!ROLES.includes(manualRole)) throw new Error('合演录制缺少固定手动角色');
  const frames = raw.frames.map(frame => {
    if (!frame.world || frame.world.playerRole && frame.world.playerRole !== manualRole) throw new Error('录制中的手动角色发生变化');
    if (frame.world.ai?.actor === manualRole) throw new Error('AI角色与手动角色冲突');
    return { t: frame.t, state: validateState(frame.world[role]) };
  });
  const recording = parseRecording(JSON.stringify({ format: 'yiren-shadow-play', version: 1, title: '龙宫得宝', duration: raw.duration, frames }));
  return { recording, manualRole, actorControl: role === manualRole ? 'human_self_reported' : 'ai', originalFormat: raw.format, originalVersion: raw.version };
}

export function createAnnotation(rawRecording, form) {
  safe(form);
  const role = form.role || 'wukong', track = extractActorRecording(rawRecording, role);
  if (track.actorControl === 'ai') throw new Error('AI操演角色不能创建真人标注');
  if (form.verification && form.verification !== 'unverified') throw new Error('本地自报不能授予已核验身份');
  const start = finiteTime(Number(form.start)), end = finiteTime(Number(form.end));
  if (end <= start || end > track.recording.duration) throw new Error('起止时间须在录制内且结束晚于开始');
  const windowStart = Math.max(start, end - 1200);
  const frames = track.recording.frames.filter(f => f.t > windowStart && f.t < end).map(f => ({ t: f.t, state: validateState(f.state) }));
  const window = [{ t: windowStart, state: sample(track.recording, windowStart) }, ...frames, { t: end, state: sample(track.recording, end) }];
  const recordingID = fingerprint(JSON.stringify(track.recording));
  const raw = {
    format: ANNOTATION_FORMAT, version: 1,
    id: form.id || `${recordingID}-${Math.round(start)}-${Math.round(end)}-${form.annotatorID}`,
    participantID: form.participantID, annotatorID: form.annotatorID,
    participantIdentity: identity(form.participantIdentity), annotatorIdentity: identity(form.annotatorIdentity),
    verification: 'unverified', consent: form.consent === true,
    consentScope: ['research', 'training', 'export'], source: 'human_recording',
    role, label: form.label, range: { start, end }, window,
    note: String(form.note || '').slice(0, 2000),
    review: { status: form.reviewStatus || 'pending', reviewerID: form.reviewerID || '', note: String(form.reviewNote || '').slice(0, 2000) },
    provenance: { declaration: 'self_reported_unverified', actorControl: track.actorControl, playerRole: track.manualRole, recordingID,
      recordingFormat: track.originalFormat, recordingVersion: track.originalVersion, duration: track.recording.duration,
      originalFrameCount: track.recording.frames.length, windowStart, windowEnd: end,
      snapshots: 'Native recorded frames plus interpolated range endpoints; final 1200ms only. Identity and human origin are not authenticated.' },
  };
  return validateAnnotation(raw);
}

export function validateAnnotation(raw) {
  safe(raw);
  if (!raw || raw.format !== ANNOTATION_FORMAT || raw.version !== 1) throw new Error('标注格式无效');
  id(raw.participantID, '表演者ID'); id(raw.annotatorID, '标注者ID');
  identity(raw.participantIdentity); identity(raw.annotatorIdentity);
  if (raw.verification !== 'unverified') throw new Error('身份不能由本地自报认证');
  if (typeof raw.consent !== 'boolean' || JSON.stringify(raw.consentScope) !== JSON.stringify(['research', 'training', 'export'])) throw new Error('授权范围缺失');
  if (raw.source !== 'human_recording' || !ROLES.includes(raw.role) || !MODEL_LABELS.includes(raw.label)) throw new Error('来源、角色或人工标签无效');
  if (!raw.provenance || raw.provenance.declaration !== 'self_reported_unverified' || !['human_self_reported', 'ai'].includes(raw.provenance.actorControl)) throw new Error('来源声明缺失');
  if (!ROLES.includes(raw.provenance.playerRole) || !['yiren-shadow-play', 'yiren-duet-recording'].includes(raw.provenance.recordingFormat)) throw new Error('录制摘要无效');
  if (typeof raw.provenance.recordingID !== 'string' || raw.provenance.recordingID.length > 100) throw new Error('录制ID无效');
  const start = finiteTime(raw.range?.start), end = finiteTime(raw.range?.end), duration = finiteTime(raw.provenance.duration);
  if (end <= start || end > duration || raw.provenance.windowStart !== Math.max(start, end - 1200) || raw.provenance.windowEnd !== end) throw new Error('片段范围与摘要不一致');
  if (!Array.isArray(raw.window) || raw.window.length < 2 || raw.window.length > 20000) throw new Error('动作快照缺失或过多');
  let previous = -1;
  for (const frame of raw.window) {
    finiteTime(frame.t);
    if (frame.t <= previous || frame.t < raw.provenance.windowStart || frame.t > end) throw new Error('窗口时间须严格递增');
    validateState(frame.state); previous = frame.t;
  }
  if (raw.window[0].t !== raw.provenance.windowStart || raw.window.at(-1).t !== end) throw new Error('动作窗口端点缺失');
  if (!raw.review || !['pending', 'accepted', 'rejected'].includes(raw.review.status)) throw new Error('复核状态无效');
  if (raw.review.reviewerID) id(raw.review.reviewerID, '复核者ID');
  if (typeof raw.id !== 'string' || raw.id.length > 200 || typeof raw.note !== 'string' || raw.note.length > 2000) throw new Error('标注ID或备注无效');
  const clone = JSON.parse(JSON.stringify(raw));
  clone.window = raw.window.map(f => ({ t: f.t, state: validateState(f.state) }));
  return clone;
}

/** Labels are supplied by annotators. No model inference is used in this path. */
export function buildDataset(records) {
  if (!Array.isArray(records) || records.length > 10000) throw new Error('标注列表无效');
  const excluded = [], candidates = [], valid = [];
  const reject = (raw, reason) => {
    const descriptor = raw && typeof raw === 'object' ? Object.getOwnPropertyDescriptor(raw, 'id') : null;
    excluded.push({ id: descriptor && 'value' in descriptor && typeof descriptor.value === 'string' ? descriptor.value.slice(0, 200) : 'invalid', reason });
  };
  for (const raw of records) {
    let r; try { r = validateAnnotation(raw); } catch { reject(raw, 'invalid_annotation'); continue; }
    valid.push(r);
  }
  // A pending disagreement is unresolved, not evidence that the accepted label
  // is correct. Quarantine both sides until the disagreement is rejected or
  // corrected. Unauthorized/AI/unsupported/rejected entries cannot supply GT.
  const reviewable = valid.filter(r => r.consent && r.role === 'wukong' &&
    r.role === r.provenance.playerRole && r.provenance.actorControl !== 'ai' && r.review.status !== 'rejected');
  const conflicts = new Set();
  for (let i = 0; i < reviewable.length; i++) for (let j = i + 1; j < reviewable.length; j++) {
    const a = reviewable[i], b = reviewable[j];
    if (a.provenance.recordingID === b.provenance.recordingID && a.role === b.role && a.label !== b.label &&
        Math.max(a.range.start, b.range.start) < Math.min(a.range.end, b.range.end)) {
      conflicts.add(a); conflicts.add(b);
    }
  }
  for (const r of valid) {
    let reason = null;
    if (r.provenance.actorControl === 'ai' || r.role !== r.provenance.playerRole) reason = 'ai_actor';
    else if (!r.consent) reason = 'consent_missing';
    else if (conflicts.has(r)) reason = 'conflicting_labels';
    else if (r.review.status !== 'accepted') reason = r.review.status === 'rejected' ? 'review_rejected' : 'review_pending';
    else if (!r.review.reviewerID || r.review.reviewerID === r.annotatorID) reason = 'independent_review_missing';
    else if (r.role !== 'wukong') reason = 'role_task_not_supported';
    if (reason) reject(r, reason); else candidates.push(r);
  }
  const ownership = new Map();
  for (const r of candidates) {
    const key = `${r.provenance.recordingID}/${r.role}`;
    if (!ownership.has(key)) ownership.set(key, new Set());
    ownership.get(key).add(r.participantID);
  }
  const eligible = candidates.filter(r => {
    if (ownership.get(`${r.provenance.recordingID}/${r.role}`).size > 1) { reject(r, 'participant_recording_conflict'); return false; }
    return true;
  });
  const seen = new Set(), unique = eligible.filter(r => {
    const key = `${r.provenance.recordingID}/${r.role}/${r.range.start}/${r.range.end}/${r.label}/${r.participantID}`;
    if (seen.has(key)) { reject(r, 'duplicate_window'); return false; } seen.add(key); return true;
  });
  const participants = [...new Set(unique.map(r => r.participantID))].sort();
  const participantSplits = Object.create(null), splits = { train: [], val: [], test: [] };
  participants.forEach((participant, i) => { participantSplits[participant] = participants.length < 3 ? 'train' : i === participants.length - 1 ? 'test' : i === participants.length - 2 ? 'val' : 'train'; });
  unique.forEach(r => splits[participantSplits[r.participantID]].push(r));
  const excludedByReason = {}; excluded.forEach(r => { excludedByReason[r.reason] = (excludedByReason[r.reason] || 0) + 1; });
  return {
    format: DATASET_FORMAT, version: 1, status: 'not_validated',
    declarations: { labels: 'Human-entered labels with separate-ID review; not auto-generated model labels.', identity: 'Self-reported; no verified inheritor credentials. Different IDs are not proof of different people.', humanOrigin: 'Self-reported recording; not independently authenticated.', task: 'Wukong rod-control pilot only. Dragon role requires separately defined tasks/features.', split: 'Anonymous participant-group split; never split one participant across partitions.' },
    splits, participantSplits, excluded,
    summary: { inputCount: records.length, eligibleSelfReportedWindows: unique.length, excludedCount: excluded.length, excludedByReason, participantCount: participants.length, verifiedHumanParticipants: 0, verifiedInheritors: 0 },
  };
}
