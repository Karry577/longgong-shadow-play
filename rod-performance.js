import { moveControl } from './engine.js';
import { getDuetView } from './duet.js?v=0.12.0';
import { getStageScript } from './stage-script.js';

const copy = value => JSON.parse(JSON.stringify(value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const position = (actor, rod) => rod === 'body' ? actor.body : actor.hands[rod];
const labels = { body: '身杆', left: '左手杆', right: '右手杆' };
const titles = { salute: '拱手见礼', announce: '扬手报门', offer: '展袖相迎', point: '举手指引', inspect: '探手细看', refuse: '收手摇首', thanks: '收势致谢', close: '归位亮相' };
const sameScene = (w, s) => w.phase === s.phase && w.trial === s.trial && w.playerRole === s.playerRole;
// A rod is a broad stage gesture, rather than a pixel-perfect pointer target.
// These radii are returned with the goal, so the visible circle and the gate
// always agree. Leaving an admitted circle uses a separate, wider boundary.
const POSE_RADIUS = 42;
const BODY_RADIUS = 20;
const POSE_HOLD = .12;
const EXIT_MARGIN = 14;
const EXIT_HOLD = .22;

/** Digital acting cues, not a claim of lineage-specific traditional technique.
 * Human rods are NEVER moved here. The other actor uses the real engine, so
 * its wrists, reach constraints and held staff are also saved in the replay. */
export function gestureGoal(actor, baseline, role, gesture = 'announce', index = 0) {
  const b = baseline.body, sign = role === 'wukong' ? 1 : -1;
  if (actor.staff.phase !== 'standing') {
    // Locked wrists must stay attached to the staff: articulate with the body.
    return { rod: 'body', point: { x: b.x + sign * (gesture === 'inspect' ? 18 : gesture === 'close' ? 0 : 10), y: Math.max(300, b.y - (gesture === 'announce' ? 14 : 0)) }, radius: BODY_RADIUS };
  }
  const rod = role === 'wukong' ? 'right' : 'left';
  const offsets = {
    salute: [45, -110], announce: [90, -155], offer: [130, -65],
    point: [145, -110], inspect: [135, -40], refuse: [35, -145],
    thanks: [30, -100], close: [70, -85],
  };
  const [x, y] = offsets[gesture] || offsets.announce;
  return { rod, point: { x: b.x + sign * x, y: b.y + y }, radius: POSE_RADIUS };
}

function aim(actor, rod, target, step) {
  const p = position(actor, rod), d = distance(p, target);
  if (d < .25 || step <= 0) return;
  const travel = Math.min(d, (rod === 'body' ? 78 : 145) * step);
  moveControl(actor, rod, (target.x - p.x) / d * travel, (target.y - p.y) / d * travel);
}

export class RodPerformance {
  constructor({ tempo = null } = {}) { this.tempo = tempo; this.reset(); }
  reset() { this.scene = null; this.baselines = null; this.script = []; this.index = 0; this.offset = 0; this.key = ''; this.stable = 0; this.outside = 0; this.last = null; this.waiting = true; this.state = null; this.returning = false; this.humanReturned = false; this.done = false; this.phraseKey = ''; this.phraseReleased = false; this.partnerKey = ''; this.partnerWait = 0; this.recorded = false; this.recordedOnly = false; this.mediaSeen = false; this.mediaRequestId = null; this.mediaComplete = false; }
  begin(world, { recorded = false, recordedOnly = false } = {}) {
    this.reset(); this.scene = { phase: world.phase, trial: world.trial, playerRole: world.playerRole };
    this.baselines = { wukong: copy(world.wukong), dragon: copy(world.dragon) };
    this.originalGoal = copy(getDuetView(world).goal);
    this.recordedOnly = recordedOnly;
    this.script = recordedOnly ? [] : getStageScript(world).lines;
    this.recorded = recorded || recordedOnly;
    return this;
  }
  assess(world, role, goal, dt, key) {
    const p = position(world[role], goal.rod);
    if (key !== this.key) { this.key = key; this.stable = 0; this.outside = 0; this.waiting = true; this.last = null; }
    const speed = this.last && dt > 0 ? distance(p, this.last) / dt : 0;
    this.last = { ...p };
    const d = distance(p, goal.point), inside = d <= goal.radius;
    if (this.waiting) {
      this.stable = inside && speed < 90 ? this.stable + dt : 0;
      if (this.stable + 1e-9 >= POSE_HOLD) { this.waiting = false; this.outside = 0; }
    } else {
      this.outside = d <= goal.radius + EXIT_MARGIN ? 0 : this.outside + dt;
      if (this.outside + 1e-9 >= EXIT_HOLD) { this.waiting = true; this.stable = 0; }
    }
    return { waiting: this.waiting, ready: !this.waiting, distance: d, progress: this.waiting ? Math.min(1, this.stable / POSE_HOLD) : 1, settleMs: POSE_HOLD * 1000 };
  }
  update(world, dt, media = {}) {
    if (!this.scene || !sameScene(world, this.scene)) { this.state = null; return null; }
    const step = Number.isFinite(dt) ? Math.max(0, Math.min(.1, dt)) : 0;
    if (this.done) return this.state;
    if (this.recordedOnly && this.recorded) {
      if (media.busy && media.clip && !this.mediaSeen) { this.mediaSeen = true; this.mediaRequestId = media.requestId ?? null; }
      const completed = !media.busy && (media.completed === true || media.outcome === 'completed')
        && this.mediaSeen && (this.mediaRequestId === null || this.mediaRequestId === media.requestId);
      if (completed) { this.recorded = false; this.mediaComplete = true; this.key = ''; return this.returnToScene(world, step); }
      if (media.failed || media.error || media.aborted || ['error', 'aborted'].includes(media.outcome) || !media.busy) {
        this.state = { active: true, recorded: true, recordedOnly: true, ready: false, waiting: true,
          interrupted: true, outcome: media.outcome || 'idle', line: null, role: world.playerRole,
          human: true, goal: null, actorGoal: null, offset: 0, returning: false, count: 0,
          title: '原声尚未完成', reason: media.error || (media.aborted ? '本次原声已中止，请重新接戏' : '等待有效原声，不能以无声台词推进') };
        return this.state;
      }
    }
    if (this.recorded && !media.busy) { this.recorded = false; this.key = ''; }
    if (this.returning || !this.recorded && this.index >= this.script.length) return this.returnToScene(world, step);
    let line, cueIndex, offset, recorded = this.recorded;
    if (recorded) {
      const clip = media.clip;
      if (!clip) return null;
      cueIndex = Math.max(0, clip.lines.findLastIndex(l => l.start <= (media.offset || 0) + .025));
      const raw = clip.lines[cueIndex];
      const gestures = clip.role === 'wukong' ? ['announce', 'salute', 'inspect', 'offer'] : ['offer', 'thanks'];
      const gesture = Object.hasOwn(titles, raw?.gesture) ? raw.gesture : Object.hasOwn(titles, clip.gesture) ? clip.gesture : gestures[cueIndex % gestures.length];
      line = { ...raw, id: clip.id, role: clip.role, title: titles[gesture], gesture };
      offset = media.offset || 0;
    } else { line = this.script[this.index]; cueIndex = this.index; offset = this.offset; }
    const actor = world[line.role], goal = gestureGoal(actor, this.baselines[line.role], line.role, line.gesture, cueIndex);
    const human = line.role === world.playerRole;
    const cueKey = `${recorded ? 'v' : 's'}:${line.id}:${cueIndex}`;
    // A complete recorded turn can carry several subtitle/gesture cues. Admit
    // its opening pose once, then keep the original voice continuous while
    // assessing each subsequent pose. Legacy packs still gate each phrase.
    const turnGate = recorded && media.clip.gateMode === 'turn';
    const admissionKey = turnGate ? `turn:${line.role}:${line.id}` : cueKey;
    const tempo = this.tempo?.state || { speedScale: 1, responseDelay: 0 };
    let responding = true;
    if (!human) {
      if (this.partnerKey !== cueKey) { this.partnerKey = cueKey; this.partnerWait = 0; }
      this.partnerWait += step;
      responding = this.partnerWait + 1e-9 >= tempo.responseDelay;
      if (responding) aim(actor, goal.rod, goal.point, step * tempo.speedScale);
      // The free hand responds too, instead of leaving both wrists frozen.
      if (responding && actor.staff.phase === 'standing') {
        const other = goal.rod === 'left' ? 'right' : 'left';
        const base = this.baselines[line.role].hands[other];
        aim(actor, other, { x: base.x, y: base.y - Math.sin(offset * 2.1) * 8 }, step * tempo.speedScale);
      }
      world.ai.status = responding ? `${line.title || titles[line.gesture]} · ${labels[goal.rod]}实际接演` : '留一口气，等你交戏后再接杆';
    }
    const check = this.assess(world, line.role, goal, responding ? step : 0, cueKey);
    const poseWaiting = check.waiting;
    // A phrase is admitted only after its actual pose is performed. Once
    // admitted, finish the current recorded interval rather than repeatedly
    // chopping its sound on every small departure. The next cue gates afresh.
    if (recorded) {
      if (this.phraseKey !== admissionKey) { this.phraseKey = admissionKey; this.phraseReleased = false; }
      if (check.ready) this.phraseReleased = true;
      check.waiting = !this.phraseReleased;
      check.ready = this.phraseReleased;
    }
    this.state = { ...check, active: true, recorded, recordedOnly: this.recordedOnly, line, role: line.role, cueIndex,
      offset, human, goal: human ? goal : null, actorGoal: goal, returning: false,
      poseWaiting, phraseReleased: recorded && this.phraseReleased, gateMode: turnGate ? 'turn' : 'phrase',
      title: line.title || titles[line.gesture], reason: human ? recorded && this.phraseReleased && poseWaiting ? turnGate ? `本段原声连贯演唱，${labels[goal.rod]}跟随新光圈调整；换角时再等停稳` : `本句原声继续，${labels[goal.rod]}先收回光圈；下一句会等你停稳` : `${labels[goal.rod]}${check.distance > goal.radius ? '移向新光圈' : '到位后停稳'}，接住「${line.title || titles[line.gesture]}」这句` : responding ? turnGate && this.phraseReleased ? 'AI随原声连续接演身段，换角再交戏' : 'AI正逐杆到位，原声随后继续' : '搭档按你的到位用时留白，再接下一句',
      count: recorded ? media.clip.lines.length : this.script.length };
    if (!recorded && !check.waiting) {
      this.offset += step;
      this.state.offset = this.offset;
      if (this.offset >= line.duration) this.advance();
    }
    return this.state;
  }
  advance() {
    if (this.recorded || this.returning || !this.state?.ready || this.offset < 1.2) return false;
    this.index++; this.offset = 0; this.key = ''; return true;
  }
  returnToScene(world, step) {
    this.returning = true;
    const returnGoals = role => {
      const actor = world[role], base = this.baselines[role];
      return (actor.staff.phase === 'standing' ? ['body', 'left', 'right'] : ['body'])
        .map(rod => ({ rod, point: copy(position(base, rod)), radius: rod === 'body' ? 20 : 38 }))
        .sort((a, b) => distance(position(actor, b.rod), b.point) - b.radius - (distance(position(actor, a.rod), a.point) - a.radius));
    };
    const ai = world.ai.actor;
    for (const g of returnGoals(ai)) aim(world[ai], g.rod, g.point, step * (this.tempo?.state.speedScale || 1));
    // Rejoin the actual next task directly. Recreating all three pre-song rod
    // coordinates served no stage purpose and caused a long precision chore.
    // The duet still checks the player's current physical pose, movement flags
    // and dwell; this director never restores or moves the human actor.
    const view = getDuetView(world);
    const goal = view.goal;
    const aiReady = returnGoals(ai).every(g => distance(position(world[ai], g.rod), g.point) <= g.radius);
    const check = goal ? this.assess(world, world.playerRole, goal, step, `return:${goal.rod}`)
      : { ready: view.actionEnabled, waiting: !view.actionEnabled, distance: 0, progress: view.progress, settleMs: POSE_HOLD * 1000 };
    this.humanReturned = view.actionEnabled;
    this.done = aiReady && view.actionEnabled;
    this.state = { ...check, ready: this.done, waiting: !this.done, active: !this.done, returning: true,
      recorded: false, recordedOnly: this.recordedOnly, mediaComplete: this.mediaComplete, role: world.playerRole, human: true, goal, actorGoal: goal, offset: 0,
      title: '收势接戏', reason: view.actionEnabled ? '你的身段已稳，搭档收势后接下一场' : goal ? `${labels[goal.rod]}靠近下一场光圈，稍停即可接戏` : view.objective, line: null };
    return this.state;
  }
}

export function readStageReplay(world) {
  const e = [...world.events].reverse().find(e => e.type === 'stage_stop' || e.type.startsWith('stage_at_'));
  if (!e || e.type === 'stage_stop' || e.phase !== world.phase || e.trial !== world.trial) return null;
  const match = /^stage_at_([a-z0-9]+)_(\d+)_([rp])$/.exec(e.type);
  if (!match) return null;
  const lines = getStageScript(world).lines, line = lines.find(l => l.id === match[1] && l.role === e.actor);
  if (!line) return null;
  const offset = Number(match[2]) / 1000 + (match[3] === 'r' ? Math.max(0, world.elapsed - e.t) : 0);
  return { active: true, recorded: false, line, role: line.role, human: line.role === world.playerRole,
    cueIndex: lines.indexOf(line), offset: Math.min(offset, line.duration), waiting: match[3] === 'p',
    reason: '按已保存动作回放', count: lines.length, title: line.title };
}
