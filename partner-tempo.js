// Transparent timing rules for the stage partner. This is not a learned model,
// a musician-labelled performance estimate, an acoustic BPM detector or a way
// to change the pitch/speed of the original recording.
const finite = value => typeof value === 'number' && Number.isFinite(value);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const median = values => {
  const sorted = [...values].sort((a, b) => a - b), i = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2;
};
function sceneKey(world) {
  return world && typeof world.phase === 'string' && finite(world.trial) &&
    ['wukong', 'dragon'].includes(world.playerRole)
    ? JSON.stringify([world.phase, world.trial, world.playerRole]) : null;
}

/**
 * Measures only a real player's time to first complete a displayed rod goal.
 * Observe live performance, never replay, with dt in seconds. Pass active:false
 * for transport/dialog/hidden pauses, and human:false during partner turns.
 * A goalId must identify one distinct target, for example "line-id:cue-index".
 *
 * Read state.speedScale for AI rod travel and state.responseDelay for the
 * silence before its next turn. Never use them to retime original vocal media.
 */
export class PartnerTempo {
  constructor({ windowSize = 5, referenceSeconds = 1.4, minSampleSeconds = .12,
    maxSampleSeconds = 15 } = {}) {
    this.windowSize = Number.isInteger(windowSize) && windowSize >= 1 && windowSize <= 12 ? windowSize : 5;
    this.referenceSeconds = finite(referenceSeconds) && referenceSeconds > 0 ? referenceSeconds : 1.4;
    this.minSampleSeconds = finite(minSampleSeconds) && minSampleSeconds >= 0 ? minSampleSeconds : .12;
    this.maxSampleSeconds = finite(maxSampleSeconds) && maxSampleSeconds > this.minSampleSeconds ? maxSampleSeconds : 15;
    this.reset();
  }

  reset() {
    this.samples = []; this.totalSamples = 0; this.excludedSamples = 0;
    this.completed = new Set(); this.current = null; this.scene = null;
    this.speedScale = 1;
    return this.state;
  }

  resetTracking() {
    this.current = null; this.scene = null;
    return this.state;
  }

  get state() {
    const observed = this.samples.length ? median(this.samples) : null;
    const basis = observed ?? this.referenceSeconds;
    return {
      policy: 'recent-human-goal-time-v1', kind: 'rule',
      speedScale: this.speedScale,
      responseDelay: clamp(.15 + basis * .14, .18, .85),
      sampleCount: this.samples.length, totalSamples: this.totalSamples,
      medianSeconds: observed, recentSeconds: [...this.samples],
      excludedSamples: this.excludedSamples,
      pendingSeconds: this.current && !this.current.done ? this.current.elapsed : null,
      explanation: observed === null
        ? '规则节奏策略：尚无有效真人身段完成记录，使用默认杆速与接句留白。'
        : `规则节奏策略：按最近${this.samples.length}次真人身段完成用时的中位数${observed.toFixed(2)}秒调整搭档杆速与接句留白，原录音速度保持不变。`,
    };
  }

  observe(world, dt, { goalId, human = true, ready = false, active = true } = {}) {
    const scene = sceneKey(world);
    if (scene !== this.scene) { this.current = null; this.scene = scene; }
    if (!scene || (typeof goalId !== 'string' && !finite(goalId)) || String(goalId).length === 0 || !human) {
      this.current = null;
      return this.state;
    }
    const key = JSON.stringify([scene, String(goalId)]);
    if (!this.current || this.current.key !== key) {
      this.current = { key, elapsed: 0, done: this.completed.has(key) };
    }
    const goal = this.current;
    if (!active || goal.done) return this.state;
    // A suspended frame is not evidence that a human actively worked for a long
    // interval. The live engine already uses small dt; cap unexpected gaps too.
    const step = finite(dt) && dt > 0 ? Math.min(.1, dt) : 0;
    goal.elapsed += step;
    if (!ready) return this.state;
    goal.done = true; this.completed.add(key);
    if (goal.elapsed < this.minSampleSeconds || goal.elapsed > this.maxSampleSeconds) {
      this.excludedSamples++;
      return this.state;
    }
    this.samples.push(goal.elapsed);
    if (this.samples.length > this.windowSize) this.samples.shift();
    this.totalSamples++;
    const targetSpeed = clamp(Math.sqrt(this.referenceSeconds / median(this.samples)), .6, 1.15);
    // One unusually fast/slow target cannot abruptly change the partner's arms.
    this.speedScale = clamp(targetSpeed, this.speedScale - .15, this.speedScale + .15);
    return this.state;
  }
}
