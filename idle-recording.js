const finite = value => typeof value === 'number' && Number.isFinite(value);
const point = value => [value?.x ?? null, value?.y ?? null];

function actorSnapshot(actor) {
  return [point(actor?.body), point(actor?.hands?.left), point(actor?.hands?.right),
    actor?.staff?.phase, actor?.staff?.size, point(actor?.gripBody),
    actor?.contacts?.left, actor?.contacts?.right];
}

function worldSnapshot(world) {
  const flags = world?.flags;
  const lastEvent = world?.events?.at(-1);
  return {
    pose: JSON.stringify([actorSnapshot(world?.wukong), actorSnapshot(world?.dragon)]),
    task: JSON.stringify([world?.phase, world?.trial, world?.playerRole, world?.actionCount,
      world?.taskDwell, world?.aiDwell, world?.taskProgress,
      flags?.staffInvited, flags?.gestureSeen, flags?.leftMoved, flags?.rightMoved, flags?.farewellInvited]),
    event: lastEvent ? JSON.stringify([lastEvent.t, lastEvent.phase, lastEvent.trial,
      lastEvent.type, lastEvent.actor, lastEvent.control]) : '',
  };
}

function mediaSnapshot(media) {
  return { id: media?.clip?.id ?? null, offset: finite(media?.offset) ? media.offset : null,
    playing: media?.playing === true };
}

/** Freeze only the simulation/recording clock after genuine waiting.
 * Call update BEFORE the frame's tickDuet/director/interaction/tempo updates.
 * The saved snapshot is from the previous pre-tick call: the next call sees
 * both AI movement from that tick and actual pointer/key movement since then.
 * If advance=false skip those simulation updates and capture-clock growth,
 * but keep media events/tick and UI alive. A moving voice clock or rod wakes
 * the simulation immediately. Bed music, water shimmer and a queued/loading
 * voice are intentionally not reasons to record an otherwise empty wait.
 */
export class IdleRecordingGate {
  constructor({ tailSeconds = 1.2 } = {}) {
    // This tail also preserves the longest partner response delay (.85s),
    // human/AI dwell (.4s), grip contact (.28s), and short acting pauses.
    this.tailSeconds = finite(tailSeconds) ? Math.max(1, Math.min(5, tailSeconds)) : 1.2;
    this.reset();
  }

  reset(world = null) {
    this.previous = world ? worldSnapshot(world) : null;
    this.previousMedia = null;
    this.idleSeconds = 0;
    this.skippedSeconds = 0;
    this.wasEnabled = false;
    this.state = { advance: true, idle: false, reason: 'initial', idleSeconds: 0, skippedSeconds: 0 };
    return this.state;
  }

  update(world, dt, { media = null, scene = null, enabled = true, force = false } = {}) {
    const step = finite(dt) ? Math.max(0, Math.min(.1, dt)) : 0;
    const current = worldSnapshot(world), currentMedia = mediaSnapshot(media);
    const changedPose = !!this.previous && current.pose !== this.previous.pose;
    const changedTask = !!this.previous && current.task !== this.previous.task;
    const changedEvent = !!this.previous && current.event !== this.previous.event;
    const mediaChanged = !!this.previousMedia && (currentMedia.id !== this.previousMedia.id
      || currentMedia.playing !== this.previousMedia.playing);
    const mediaAdvanced = currentMedia.playing && currentMedia.id !== null
      && this.previousMedia?.id === currentMedia.id && currentMedia.offset !== null
      && this.previousMedia.offset !== null && currentMedia.offset > this.previousMedia.offset + 1e-5;
    const newObservation = !this.previous || !this.wasEnabled;
    this.previous = current;
    this.previousMedia = currentMedia;

    if (!enabled || !step) {
      this.wasEnabled = false;
      return this.publish(false, false, 'inactive');
    }
    this.wasEnabled = true;
    const phaseMinimum = finite(world?.phaseElapsed) && world.phase !== 'complete' && world.phaseElapsed < 2;
    const reason = force ? 'input' : scene?.blocked ? 'scene' : mediaAdvanced ? 'voice'
      : changedPose ? 'motion' : changedTask ? 'settle' : changedEvent ? 'event'
      : phaseMinimum ? 'phase-minimum' : mediaChanged ? 'voice-transition' : newObservation ? 'initial' : '';
    if (reason) {
      this.idleSeconds = 0;
      return this.publish(true, false, reason);
    }
    this.idleSeconds += step;
    const idle = this.idleSeconds + 1e-9 >= this.tailSeconds;
    if (idle) this.skippedSeconds += step;
    return this.publish(!idle, idle, idle ? 'idle' : 'tail');
  }

  publish(advance, idle, reason) {
    this.state = { advance, idle, reason, idleSeconds: this.idleSeconds, skippedSeconds: this.skippedSeconds };
    return this.state;
  }
}
