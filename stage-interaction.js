import { markStageCue } from './scene-timeline.js?v=0.12.0';

const hasCue = (world, cue) => world.events.some(e => e.type === `stage_${cue}` && e.phase === world.phase && e.trial === world.trial);
const RADIUS = 38;
const HOLD = .14;
const MIN_TRAVEL = 4;

/** A real rod check after the carriers put the weapon down. This class only
 * reads the player's wrist; it never moves it or infers success from animation. */
export class StageInteraction {
  constructor() { this.reset(); }
  reset() { this.key = ''; this.stable = 0; this.last = null; this.travel = 0; this.state = null; }
  update(world, scene, dt, { legacy = false } = {}) {
    this.state = null;
    const key = `${world.phase}:${world.trial}:${world.playerRole}`;
    if (key !== this.key) { this.reset(); this.key = key; }
    if (legacy || world.phase !== 'trial' || scene.blocked || !scene.weapon.placed || hasCue(world, 'weapon_tried')) {
      this.stable = 0; this.last = null; return null;
    }
    if (markStageCue(world, 'weapon_placed')) {
      world.flags.gestureSeen = false; world.taskDwell = 0; world.taskProgress = 0;
    }
    const rod = world.playerRole === 'wukong' ? 'right' : 'left';
    // A fresh small lift follows the presentation pose (dragon: 910,425).
    // Keeping the exact same goal would strand a correctly pre-positioned
    // player: no new motion could be observed by simply following the circle.
    const point = world.playerRole === 'wukong' ? { x: 820, y: 410 } : { x: 910, y: 390 };
    const p = world[world.playerRole].hands[rod], distance = Math.hypot(p.x - point.x, p.y - point.y);
    const step = Number.isFinite(dt) ? Math.max(0, Math.min(.1, dt)) : 0;
    const motion = this.last ? Math.hypot(p.x - this.last.x, p.y - this.last.y) : 0;
    const speed = step > 0 ? motion / step : 0;
    this.travel += motion;
    this.last = { ...p };
    this.stable = this.travel >= MIN_TRAVEL && distance <= RADIUS && speed < 90 ? this.stable + step : 0;
    if (this.stable + 1e-9 >= HOLD) { markStageCue(world, 'weapon_tried'); this.state = null; return null; }
    const hand = rod === 'right' ? '右' : '左';
    this.state = { active: true, stageInteraction: true, human: true, role: world.playerRole,
      line: null, recorded: false, waiting: true, ready: false, returning: false, offset: 0,
      goal: { rod, point, radius: RADIUS }, distance, progress: this.stable / HOLD, settleMs: HOLD * 1000,
      title: world.trial ? '试长柄器' : '试刀亮相',
      reason: `${hand}手杆${this.travel < MIN_TRAVEL && distance <= RADIUS ? '轻动一下' : '靠近'}兵器上方光圈${distance > RADIUS ? `（距圈边${Math.ceil(distance - RADIUS)}像素）` : ''}，稍停0.14秒即可试器接戏` };
    return this.state;
  }
}

export function hasStageTimeline(recording) {
  return recording.frames.some(frame => frame.world.events.some(e => e.type === 'stage_opening'));
}
