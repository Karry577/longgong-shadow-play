import { validateState, solvePose } from './engine.js';

// These are inspectable geometry/time rules, not labels learned from a model.
const RODS = ['body', 'left', 'right'];
const NAMES = { body: '身杆', left: '左手杆', right: '右手杆' };
const MAX_GAP = 350;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const at = (state, rod) => rod === 'body' ? state.body : state.hands[rod];
const localAt = (state, rod) => rod === 'body' ? { ...state.body }
  : { x: state.hands[rod].x - state.body.x, y: state.hands[rod].y - state.body.y };
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const direction = (dx, dy) => `${Math.abs(dx) > 1 ? dx > 0 ? '右' : '左' : ''}${Math.abs(dy) > 1 ? dy > 0 ? '下' : '上' : ''}` || '光圈中心';
const num = value => Math.round(value);

function positive(value, fallback, max) {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0 || value > max) throw new Error('证据时间配置无效');
  return value;
}
function samplesInWindow(samples, windowMs) {
  if (!Array.isArray(samples) || samples.length > 4096) throw new Error('动作采样须为不超过4096项的数组');
  const clean = [];
  let previous = -Infinity;
  for (const sample of samples) {
    if (!sample || !Number.isFinite(sample.t) || sample.t < 0 || sample.t < previous) throw new Error('动作时间须为升序有限毫秒');
    const item = { t: sample.t, state: validateState(sample.state) };
    if (sample.t === previous) clean[clean.length - 1] = item;
    else clean.push(item);
    previous = sample.t;
  }
  if (!clean.length) return [];
  const end = clean.at(-1).t;
  let tail = clean.filter(s => s.t >= end - windowMs);
  // A lost sampling interval does not count as observed stillness or motion.
  for (let i = tail.length - 1; i > 0; i--) {
    if (tail[i].t - tail[i - 1].t > MAX_GAP) { tail = tail.slice(i); break; }
  }
  return tail;
}
function metrics(samples, rod, local = false) {
  const point = local ? localAt : at;
  let travelPx = 0, reversals = 0, lastV = null, lastSpeed = 0;
  for (let i = 1; i < samples.length; i++) {
    const p = point(samples[i - 1].state, rod), q = point(samples[i].state, rod);
    const dt = samples[i].t - samples[i - 1].t;
    if (dt <= 0 || dt > MAX_GAP) continue;
    const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy);
    const v = { x: dx / dt * 1000, y: dy / dt * 1000 };
    lastSpeed = Math.hypot(v.x, v.y); travelPx += d;
    if (d >= .8 && lastSpeed >= 12) {
      if (lastV && v.x * lastV.x + v.y * lastV.y < -.2 * lastSpeed * Math.hypot(lastV.x, lastV.y)) reversals++;
      lastV = v;
    }
  }
  const durationMs = samples.length > 1 ? samples.at(-1).t - samples[0].t : 0;
  return { travelPx, reversals, lastSpeed, durationMs, speedPxPerSecond: durationMs ? travelPx / durationMs * 1000 : 0 };
}
function goalFacts(samples, goal) {
  const distances = samples.map(s => dist(at(s.state, goal.rod), goal.point));
  let stableMs = 0, exits = 0;
  for (let i = 1; i < samples.length; i++) {
    if (distances[i - 1] <= goal.radius && distances[i] > goal.radius) exits++;
  }
  for (let i = samples.length - 1; i > 0; i--) {
    const dt = samples[i].t - samples[i - 1].t;
    const speed = dist(at(samples[i].state, goal.rod), at(samples[i - 1].state, goal.rod)) / dt * 1000;
    if (dt <= 0 || dt > MAX_GAP || distances[i] > goal.radius || distances[i - 1] > goal.radius || speed >= 90) break;
    stableMs += dt;
  }
  let overshoot = null;
  // Require an actually observed in-circle point between opposite sides.
  // Do not invent an unseen crossing by interpolating sparse observations.
  for (let i = 1; i < samples.length; i++) {
    if (distances[i] <= goal.radius && distances[i - 1] > goal.radius) {
      const p = at(samples[i - 1].state, goal.rod), q = at(samples.at(-1).state, goal.rod);
      const a = { x: p.x - goal.point.x, y: p.y - goal.point.y };
      const b = { x: q.x - goal.point.x, y: q.y - goal.point.y };
      if (distances.at(-1) > goal.radius && a.x * b.x + a.y * b.y < -.25 * Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y)) {
        overshoot = { enteredAt: samples[i].t, beyondCirclePx: distances.at(-1) - goal.radius };
      }
    }
  }
  return { stableMs, exits, overshoot };
}

/**
 * samples: [{t: milliseconds, state: an actual engine state}], ascending.
 * goal: {rod:'body'|'left'|'right', point:{x,y}, radius, id?}, or null.
 * inputRod/lastInputAt must describe a real input event, not selected UI focus.
 * This function never operates a rod or grants grip/task completion. In
 * particular, its default 180ms feedback does not replace canGrip's 280ms gate.
 */
export function analyzeActionEvidence(samples, goal, options = {}) {
  const windowMs = positive(options.windowMs, 1200, 5000);
  const settleMs = positive(options.settleMs, 180, 2000);
  const clean = samplesInWindow(samples, windowMs);
  const last = clean.at(-1), state = last?.state;
  const base = { source: 'rules', role: options.role === 'dragon' ? 'dragon' : 'wukong',
    issue: 'no_goal', rod: null, hand: null, title: '等待当前身段', hint: '进入当前身段后，再核对实际杆位。',
    guide: null, direction: '', distancePx: null, modelUsedForPriority: false,
    evidence: { windowMs: last ? last.t - clean[0].t : 0, sampleCount: clean.length, measuredAt: last?.t ?? null } };
  // The classifier remains the caller's optional priority aid. No probability
  // supplied here is treated as a distance, a movement, or a quality judgment.
  if (!last) return { ...base, issue: 'no_data', title: '等待动作采样', hint: '还没有可核对的实际轨迹。' };
  if (options.replay || options.paused) return { ...base, issue: options.replay ? 'replay' : 'paused',
    title: options.replay ? '历史动作回看' : '操演已暂停', hint: options.replay ? '正在查看保存的动作；继续操演后再给当前纠错。' : '继续操演后再累计停稳时间。' };
  if (!goal) return base;
  if (!RODS.includes(goal.rod) || !goal.point || !Number.isFinite(goal.point.x) || !Number.isFinite(goal.point.y)
    || Math.abs(goal.point.x) > 10000 || Math.abs(goal.point.y) > 10000 || !Number.isFinite(goal.radius) || goal.radius <= 0 || goal.radius > 250) throw new Error('当前身段目标无效');
  if (options.inputRod !== undefined && options.inputRod !== null && !RODS.includes(options.inputRod)) throw new Error('实际输入杆无效');
  if (options.lastInputAt !== undefined && options.lastInputAt !== null && (!Number.isFinite(options.lastInputAt) || options.lastInputAt < 0)) throw new Error('实际输入时间无效');
  const p = at(state, goal.rod), dx = goal.point.x - p.x, dy = goal.point.y - p.y, distancePx = Math.hypot(dx, dy);
  const facts = goalFacts(clean, goal);
  const world = Object.fromEntries(RODS.map(rod => [rod, metrics(clean, rod)]));
  const relative = Object.fromEntries(RODS.map(rod => [rod, metrics(clean, rod, true)]));
  const evidence = { ...base.evidence, targetRod: goal.rod, target: { ...goal.point }, radiusPx: goal.radius,
    distancePx, dx, dy, stableMs: facts.stableMs, requiredStableMs: settleMs, exits: facts.exits,
    reversals: relative[goal.rod].reversals, travelPx: relative[goal.rod].travelPx,
    bodyTravelPx: world.body.travelPx, bodyReversals: world.body.reversals,
    leftRelativeTravelPx: relative.left.travelPx, rightRelativeTravelPx: relative.right.travelPx };
  const result = { ...base, rod: goal.rod, hand: goal.rod, distancePx, direction: direction(dx, dy), evidence,
    guide: { rod: goal.rod, hand: goal.rod, from: { ...p }, to: { ...goal.point }, radius: goal.radius } };
  if (goal.rod !== 'body') {
    const shoulder = solvePose(state)[goal.rod].shoulder, reach = dist(shoulder, goal.point);
    evidence.reachPx = reach; evidence.maxReachPx = 180;
    if (reach > 180 + 1e-6) {
      const move = Math.max(0, reach - 176) / reach;
      const to = { x: clamp(state.body.x + (goal.point.x - shoulder.x) * move, 100, 1120), y: clamp(state.body.y + (goal.point.y - shoulder.y) * move, 300, 520) };
      const bx = to.x - state.body.x, by = to.y - state.body.y;
      return { ...result, issue: 'unreachable', rod: 'body', hand: 'body', direction: direction(bx, by),
        title: `${NAMES[goal.rod]}目标超出可达范围，先移身杆`,
        hint: `肩到目标 ${num(reach)} 像素，手臂上限180像素；身杆往${direction(bx, by)}约${num(Math.hypot(bx, by))}像素，再调${NAMES[goal.rod]}。`,
        guide: { rod: 'body', hand: 'body', from: { ...state.body }, to, radius: 6 } };
    }
  }
  // Clear old movement accusations immediately after actually observed settling.
  if (distancePx <= goal.radius && facts.stableMs >= settleMs) return { ...result, issue: 'ready',
    title: `${NAMES[goal.rod]}已到位并停稳`, hint: `距目标 ${num(distancePx)} 像素，已观察到连续停稳${num(facts.stableMs)}毫秒；可按本句要求接戏。` };
  const freshInput = RODS.includes(options.inputRod) && Number.isFinite(options.lastInputAt)
    && last.t - options.lastInputAt >= 0 && last.t - options.lastInputAt <= 300;
  const bothHandsCarried = relative.left.travelPx <= 3 && relative.right.travelPx <= 3 && world.body.travelPx > 10;
  if (goal.rod !== 'body' && bothHandsCarried) return { ...result, issue: 'body_carry', rod: 'body', hand: 'body',
    title: '身体移动时，双手正一起移动',
    hint: `近${num(evidence.windowMs)}毫秒身杆走了${num(world.body.travelPx)}像素${world.body.reversals ? `、反向${world.body.reversals}次` : ''}；两手相对身体各移动不超过3像素。${distancePx > goal.radius ? `先稳身杆，再单独调${NAMES[goal.rod]}，往${result.direction}约${num(distancePx)}像素。` : `目标手已入圈，保持身杆与手杆不动，停稳${num(settleMs)}毫秒。`}`,
    guide: { rod: 'body', hand: 'body', from: { ...state.body }, to: { ...state.body }, radius: 6 } };
  const inputSamples = clean.filter(s => s.t >= last.t - 450);
  if (distancePx > goal.radius && freshInput && options.inputRod !== goal.rod && inputSamples.length >= 2) {
    const moved = metrics(inputSamples, options.inputRod, options.inputRod !== 'body');
    const targetMoved = metrics(inputSamples, goal.rod, goal.rod !== 'body');
    if (moved.travelPx >= 8 && targetMoved.travelPx <= 3) return { ...result, issue: 'wrong_rod',
      title: `本句要调${NAMES[goal.rod]}，刚才动的是${NAMES[options.inputRod]}`,
      hint: `近${num(moved.durationMs)}毫秒${NAMES[options.inputRod]}独立移动${num(moved.travelPx)}像素，目标杆只移动${num(targetMoved.travelPx)}像素。选${NAMES[goal.rod]}，往${result.direction}约${num(distancePx)}像素。`,
      evidence: { ...evidence, inputRod: options.inputRod, lastInputAt: options.lastInputAt,
        inputWindowMs: moved.durationMs, inputTravelPx: moved.travelPx, targetTravelPx: targetMoved.travelPx } };
  }
  const nearby = distancePx <= goal.radius + 12;
  const shaky = relative[goal.rod].reversals >= 3 && relative[goal.rod].travelPx >= 10 && relative[goal.rod].speedPxPerSecond >= 18;
  if (nearby && (shaky || facts.exits >= 2)) return { ...result, issue: 'unsteady',
    title: `${NAMES[goal.rod]}在目标附近反复调整`,
    hint: `近${num(evidence.windowMs)}毫秒${NAMES[goal.rod]}${shaky ? `独立反向${relative[goal.rod].reversals}次` : `离开光圈${facts.exits}次`}；${distancePx > goal.radius ? `先往${result.direction}轻回${num(distancePx)}像素，再` : ''}停住${num(settleMs)}毫秒，别反复补偿。` };
  if (facts.overshoot) return { ...result, issue: 'overshoot',
    title: `${NAMES[goal.rod]}进圈后又越过了目标`,
    hint: `已记录到进圈后从另一侧离开，越出圈边${num(facts.overshoot.beyondCirclePx)}像素；往${result.direction}约${num(distancePx)}像素回中心，再停稳${num(settleMs)}毫秒。`,
    evidence: { ...evidence, enteredAt: facts.overshoot.enteredAt, overshootPx: facts.overshoot.beyondCirclePx } };
  if (distancePx <= goal.radius) return { ...result, issue: 'settle',
    title: `${NAMES[goal.rod]}已入圈，还需停稳`,
    hint: `距目标 ${num(distancePx)} 像素；已连续停稳${num(facts.stableMs)}毫秒，还需约${num(Math.max(0, settleMs - facts.stableMs))}毫秒。保持这一根杆不动。` };
  return { ...result, issue: 'align', title: `${NAMES[goal.rod]}往${result.direction}轻移`,
    hint: `距目标中心 ${num(distancePx)} 像素（横向${num(Math.abs(dx))}、纵向${num(Math.abs(dy))}），送进半径${num(goal.radius)}像素的光圈后停稳${num(settleMs)}毫秒。` };
}

/** Stateful display hysteresis, entirely driven by sample milliseconds.
 * Unsupported old accusations are never retained: transitions use a neutral
 * observation message carrying the CURRENT measured distance instead.
 */
export function createEvidenceCoach({ settleMs = 180, confirmMs = 160, holdMs = 320 } = {}) {
  positive(settleMs, 180, 2000); positive(confirmMs, 160, 2000); positive(holdMs, 320, 5000);
  let scope = '', published = null, pending = null, lastTime = -Infinity;
  const reset = () => { scope = ''; published = null; pending = null; lastTime = -Infinity; };
  return {
    reset,
    update(samples, goal, options = {}) {
      const current = analyzeActionEvidence(samples, goal, { ...options, settleMs: options.settleMs ?? settleMs });
      const now = current.evidence.measuredAt ?? 0;
      const nextScope = JSON.stringify([options.sceneKey ?? '', options.role ?? 'wukong', goal?.id ?? '', goal?.rod, goal?.point?.x, goal?.point?.y, goal?.radius]);
      if (scope !== nextScope || now < lastTime) { reset(); scope = nextScope; }
      lastTime = now;
      const key = [current.issue, current.rod, current.direction].join(':');
      if (!published || ['ready', 'unreachable', 'paused', 'replay', 'no_goal', 'no_data'].includes(current.issue)) {
        published = { key, at: now }; pending = null; return { ...current, stabilizing: false };
      }
      if (published.key === key) { pending = null; return { ...current, stabilizing: false }; }
      if (!pending || pending.key !== key) pending = { key, at: now };
      if (now - pending.at >= confirmMs && now - published.at >= holdMs) {
        published = { key, at: now }; pending = null; return { ...current, stabilizing: false };
      }
      return { ...current, issue: 'observing', rawIssue: current.issue, stabilizing: true,
        title: `${NAMES[goal?.rod] || '当前杆位'}正在调整`,
        hint: `当前距目标 ${num(current.distancePx ?? 0)} 像素；正在核对连续轨迹，先轻移、稍停。` };
    },
  };
}
