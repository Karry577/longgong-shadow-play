import { getDuetView, getPlayer } from './duet.js?v=0.12.0';

const finite = value => typeof value === 'number' && Number.isFinite(value);
const point = value => !!value && finite(value.x) && finite(value.y);
const roles = new Set(['wukong', 'dragon']);
const rods = new Set(['body', 'left', 'right']);
const labels = { body: '身杆', left: '左手杆', right: '右手杆' };
const sameScene = (world, scene) => !!world && world.phase === scene.phase &&
  world.trial === scene.trial && world.playerRole === scene.playerRole;

/**
 * A pure gate for a currently playing, real recorded vocal passage.
 * dt is in seconds. The host pauses/resumes the SAME media element according
 * to waiting; it must not seek/restart it when this state changes.
 *
 * begin() freezes the current gesture target, so moving the body cannot move
 * a relative target away while the singer sustains a line. update() never
 * advances the drama. Only finish() can submit its original action, once.
 */
export class MotionVocalGate {
  constructor({ outsideSeconds = .12, settleSeconds = .25, exitMargin = 3,
    maxSettleSpeed = 55, onComplete = null } = {}) {
    this.outsideSeconds = finite(outsideSeconds) && outsideSeconds >= 0 ? outsideSeconds : .12;
    this.settleSeconds = finite(settleSeconds) && settleSeconds >= 0 ? settleSeconds : .25;
    this.exitMargin = finite(exitMargin) && exitMargin >= 0 ? exitMargin : 3;
    this.maxSettleSpeed = finite(maxSettleSpeed) && maxSettleSpeed >= 0 ? maxSettleSpeed : 55;
    this.onComplete = typeof onComplete === 'function' ? onComplete : null;
    this.reset();
  }

  reset() {
    this.scene = null; this.goal = null; this.actionId = null;
    this.invalidGoal = false; this.stale = false; this.completed = false;
    this.outside = 0; this.settled = 0; this.lastPoint = null;
    this.current = { ready: false, held: false, waiting: false, reason: '', actionId: null };
    return this.snapshot();
  }

  cancel() { return this.reset(); }
  snapshot() { return { ...this.current }; }

  begin(world, id) {
    this.reset(); this.actionId = id ?? null;
    if (!world || !roles.has(world.playerRole) || typeof world.phase !== 'string' || !finite(world.trial)) {
      this.invalidGoal = true;
      this.current = { ready: false, held: false, waiting: true, reason: '操演状态无效', actionId: this.actionId };
      return this.snapshot();
    }
    this.scene = Object.freeze({ phase: world.phase, trial: world.trial, playerRole: world.playerRole });
    let goal;
    try { goal = getDuetView(world).goal; } catch { this.invalidGoal = true; }
    if (goal != null) {
      if (!rods.has(goal.rod) || !point(goal.point) || !finite(goal.radius) || goal.radius <= 0) this.invalidGoal = true;
      else this.goal = Object.freeze({ rod: goal.rod, point: Object.freeze({ ...goal.point }), radius: goal.radius });
    }
    this.current = { ready: !this.invalidGoal, held: !this.goal && !this.invalidGoal,
      waiting: this.invalidGoal, reason: this.invalidGoal ? '身段目标无效，请重新开始唱段' : '', actionId: this.actionId };
    return this.update(world, 0);
  }

  update(world, dt, roleOrOptions = this.scene?.playerRole) {
    if (!this.scene) return this.snapshot();
    if (!sameScene(world, this.scene)) this.stale = true;
    if (this.stale) {
      this.current = { ready: false, held: false, waiting: true, reason: '场次或角色已变化，请结束旧唱段', actionId: this.actionId };
      return this.snapshot();
    }
    if (this.completed) return this.snapshot();
    const role = typeof roleOrOptions === 'string' ? roleOrOptions : roleOrOptions?.role ?? this.scene.playerRole;
    if (!roles.has(role)) {
      this.current = { ready: false, held: false, waiting: true, reason: '唱者角色无效', actionId: this.actionId };
      return this.snapshot();
    }
    // The partner's recording follows the partner. Human rods cannot pause AI.
    if (role !== world.playerRole) {
      this.outside = 0; this.settled = 0; this.lastPoint = null;
      this.current = { ready: true, held: true, waiting: false, reason: 'AI角色唱段', actionId: this.actionId };
      return this.snapshot();
    }
    if (this.invalidGoal) return this.snapshot();
    if (!this.goal) {
      this.current = { ready: true, held: true, waiting: false, reason: '此句无需保持指定身段', actionId: this.actionId };
      return this.snapshot();
    }
    // A suspended browser frame cannot count as a long, observed steady hold.
    const step = finite(dt) && dt > 0 ? Math.min(dt, .1) : 0;
    let position;
    try { const actor = getPlayer(world); position = this.goal.rod === 'body' ? actor.body : actor.hands[this.goal.rod]; } catch { /* fail closed below */ }
    if (!point(position)) {
      this.outside = 0; this.settled = 0; this.lastPoint = null;
      this.current = { ready: false, held: false, waiting: true, reason: `${labels[this.goal.rod]}坐标无效，请重新对位`, actionId: this.actionId };
      return this.snapshot();
    }
    const distance = Math.hypot(position.x - this.goal.point.x, position.y - this.goal.point.y);
    const speed = this.lastPoint && step > 0 ? Math.hypot(position.x - this.lastPoint.x, position.y - this.lastPoint.y) / step : 0;
    this.lastPoint = { x: position.x, y: position.y };
    const inside = distance <= this.goal.radius;
    const held = distance <= this.goal.radius + (this.current.waiting ? 0 : this.exitMargin);
    let waiting = this.current.waiting;
    if (waiting) {
      this.outside = 0;
      this.settled = inside && speed <= this.maxSettleSpeed ? this.settled + step : 0;
      if (inside && speed <= this.maxSettleSpeed && this.settled + 1e-9 >= this.settleSeconds) { waiting = false; this.settled = 0; }
    } else {
      this.settled = 0;
      this.outside = held ? 0 : this.outside + step;
      if (!held && this.outside + 1e-9 >= this.outsideSeconds) { waiting = true; this.outside = 0; }
    }
    const reason = waiting ? (inside ? `${labels[this.goal.rod]}已回圈，请停稳${Math.round(this.settleSeconds * 1000)}毫秒续唱` :
      `${labels[this.goal.rod]}离开目标圈，请移回并停稳续唱`) : !held ? `${labels[this.goal.rod]}偏离目标，请移回圈内` : '';
    this.current = { ready: !waiting, held, waiting, reason, actionId: this.actionId };
    return this.snapshot();
  }

  /** Submit only when the original scene is still current and media has ended. */
  finish(world, callback = this.onComplete) {
    if (this.scene && !sameScene(world, this.scene)) this.stale = true;
    if (!this.scene || this.completed || this.stale || !sameScene(world, this.scene) || !this.current.ready) return false;
    this.completed = true;
    if (typeof callback === 'function') callback(this.actionId);
    return true;
  }
}
