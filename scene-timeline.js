import { trimWorldEvents } from './event-history.js';
import { getWeaponSupportPoints } from './stage-attendants.js?v=0.12.0';

// Scene presentation is a function of saved simulation clocks and events.
// It never moves the player's rods and never reads performance.now/Date.now.
export const SCENE_TIMINGS = Object.freeze({
  dragonWait: 4.8, dragonEntrance: 2.2, present: 3.6, withdraw: 3.2, treasuryReveal: 1,
});

const finite = value => typeof value === 'number' && Number.isFinite(value);
const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const progress = (time, start, duration) => clamp((time - start) / duration);
const ease = value => value * value * (3 - 2 * value);
const lerp = (a, b, value) => a + (b - a) * value;
// Replay seeks use integer milliseconds. Give scene clocks the same precision
// (at most 0.5ms rounding), so 1.1s does not become 1.099999999s after sampling.
// Simulation state, recorded rod coordinates and event times stay untouched.
const stageTime = seconds => Math.round(seconds * 1000) / 1000;
const STAGE_CUES = new Set(['opening', 'weapon_called', 'weapon_placed', 'weapon_tried']);
const phases = new Set(['arrival', 'request', 'trial', 'guide', 'staff', 'farewell', 'complete']);
const WING_X = 1330, WEAPON_X = 820, CARRY_Y = 475, PLACED_Y = 445, CREW_SCALE = .78;

/** Append a replay-safe, idempotent presentation cue for the current beat.
 * Call weapon_called only AFTER the real command excerpt completes, not when
 * it is queued/paused/errors. Capture the recording after a new event is added.
 * weapon_placed/tried are optional app bookkeeping; no human success is inferred.
 */
export function markStageCue(world, cue) {
  if (!STAGE_CUES.has(cue) || !world || !phases.has(world.phase)
      || !finite(world.elapsed) || world.elapsed < 0 || !Array.isArray(world.events)) {
    throw new Error('舞台事件无效');
  }
  const type = `stage_${cue}`, trial = world.trial ?? 0;
  if (![0, 1].includes(trial)) throw new Error('舞台试器编号无效');
  if (world.events.some(event => event.type === type && event.phase === world.phase && event.trial === trial)) return false;
  const event = { t: world.elapsed, phase: world.phase, trial, type, actor: 'system', control: 'system' };
  world.events.push(event);
  trimWorldEvents(world);
  return event;
}

function cueTime(world, cue) {
  return [...(world.events || [])].reverse().find(event => event.type === `stage_${cue}`
    && event.phase === world.phase && event.trial === (world.trial ?? 0)
    && finite(event.t) && event.t <= world.elapsed)?.t ?? null;
}

function hiddenWeapon(type = 'knife') {
  return { visible: false, type, status: 'waiting', x: WEAPON_X, y: PLACED_Y,
    angle: 0, carrying: false, placed: false };
}

function placedWeapon(type) {
  return { ...hiddenWeapon(type), visible: true, status: 'placed', placed: true };
}

function carriers(centerX, time, carrying, facing, angle = Math.PI / 2, motion = {}) {
  const flat = 1 - Math.abs(Math.cos(angle));
  const supports=getWeaponSupportPoints({x:centerX,y:CARRY_Y,angle});
  const sideClearance=44-22*flat;
  const walking=motion.walking!==false;
  const edge=walking?clamp(Math.min((motion.progress??.5)*6,(1-(motion.progress??.5))*6)):0;
  const walkAmount=ease(edge);
  const distance=finite(motion.distance)?Math.max(0,motion.distance):time*8*22*CREW_SCALE/Math.PI;
  return ['shrimp', 'crab'].map((type, index) => ({
    // Each player stays on its own side of the same real support axis. The
    // final 88px body gap keeps both head/arm silhouettes readable as the
    // weapon rises; no rendered offset is applied to a main actor or rod.
    type, x: supports[index].x + (index ? -sideClearance : sideClearance),
    // Keep boots on the same front-stage floor while the hands turn the prop.
    y: CARRY_Y + 88 * CREW_SCALE, scale: CREW_SCALE,
    facing, walkPhase: distance*Math.PI/(22*CREW_SCALE)+index*Math.PI, walking, walkAmount, carrying,
  }));
}

function present(type, age, clock) {
  age=stageTime(age);
  if (age >= SCENE_TIMINGS.present) return { weapon: placedWeapon(type), attendants: [], blocked: false };
  const enter = progress(age, 0, 1.75), lower = progress(age, 1.75, .6), leave = progress(age, 2.35, 1.25);
  const x = lerp(WING_X, WEAPON_X, ease(enter));
  const y = lerp(CARRY_Y, PLACED_Y, ease(lower));
  const angle = lerp(Math.PI / 2, 0, ease(lower));
  const placed = age >= 2.35;
  return {
    weapon: { visible: true, type, status: placed ? 'placed' : age >= 1.75 ? 'placing' : 'presenting',
      x, y, angle, carrying: !placed, placed },
    attendants: carriers(placed ? lerp(WEAPON_X, WING_X, ease(leave)) : x,
      clock, !placed, placed ? 1 : -1, angle,
      placed?{walking:true,progress:leave,distance:lerp(WEAPON_X,WING_X,ease(leave))-WEAPON_X}
        :{walking:age<1.75,progress:enter,distance:WING_X-x}),
    blocked: true,
  };
}

function withdraw(type, age, clock) {
  age=stageTime(age);
  if (age >= SCENE_TIMINGS.withdraw) return { weapon: hiddenWeapon(type), attendants: [], blocked: false };
  const enter = progress(age, 0, 1.1), lift = progress(age, 1.1, .55), leave = progress(age, 1.65, 1.55);
  const carrying = age >= 1.1;
  const x = carrying ? lerp(WEAPON_X, WING_X, ease(leave)) : WEAPON_X;
  const y = lerp(PLACED_Y, CARRY_Y, ease(lift));
  const angle = lerp(0, Math.PI / 2, ease(lift));
  return {
    weapon: { visible: true, type, status: carrying ? 'withdrawing' : 'awaiting-withdrawal',
      x, y, angle, carrying, placed: !carrying },
    attendants: carriers(carrying ? x : lerp(WING_X, WEAPON_X, ease(enter)),
      clock, carrying, carrying ? 1 : -1, angle,
      carrying?{walking:age>=1.65,progress:leave,distance:x-WEAPON_X}
        :{walking:true,progress:enter,distance:WING_X-lerp(WING_X,WEAPON_X,ease(enter))}),
    blocked: true,
  };
}

/** Stateless scene for live playback, pause, replay and arbitrary seek.
 * media is only used to explain an awaiting original command; its wall clock
 * cannot advance attendants. legacy=true displays old recordings that predate
 * saved stage cues without waiting forever for a missing command marker.
 * blocked holds scene commits (and new trial1/guide actions), not player input.
 * For trial0, permit the initial command audio before a weapon exists; after
 * its successful completion mark weapon_called and wait for delivery. On first
 * placed/unblocked, reset gestureSeen/taskDwell once and require a real new
 * rod movement before actionDuet. Animation completion never proves a trial.
 */
export function getStageScene(world, { media = null, legacy = false } = {}) {
  const clock = finite(world?.elapsed) ? stageTime(Math.max(0, world.elapsed)) : 0;
  const rawAge = finite(world?.phaseElapsed) ? Math.max(0, world.phaseElapsed) : 0;
  const phase = phases.has(world?.phase) ? world.phase : 'arrival';
  const age = phase==='arrival'?rawAge:stageTime(rawAge);
  const arrival = phase === 'arrival';
  const entrance = legacy || !arrival ? 1 : progress(age, SCENE_TIMINGS.dragonWait, SCENE_TIMINGS.dragonEntrance);
  const dragon = { visible: entrance > 0, entranceProgress: entrance,
    offsetX: (1 - ease(entrance)) * 380, dx: (1 - ease(entrance)) * 380,
    waitingInWing: arrival && entrance === 0, playerControlled: world?.playerRole === 'dragon' };
  const background = arrival
    ? { mode: entrance === 0 ? 'palaceOutside' : 'palaceInside', fromMode: 'palaceOutside', transition: entrance }
    : { mode: 'palaceInside', fromMode: 'palaceOutside', transition: 1 };
  const scene = { timeMs: clock * 1000, background, dragon,
    staff: { visible: false, revealProgress: 0 }, weapon: hiddenWeapon(), attendants: [],
    blocked: arrival && entrance < 1, blockingReason: '', caption: '' };
  if (arrival) {
    scene.blockingReason = entrance === 0 ? '宫门初开，龙王尚在幕后候场' : '龙王正从右侧幕门现身';
    scene.caption = entrance === 0
      ? world?.playerRole === 'dragon' ? '龙王幕后候场 · 可以整理三杆，等幕门亮相后迎客' : '水晶宫门外 · 悟空入宫，候龙王现身'
      : entrance < 1 ? '龙王亮相 · 留出登场锣鼓与身段' : '龙王现身 · 两角可以接演访宫原声';
  } else if (phase === 'request') {
    scene.caption = '水晶宫内 · 悟空说明来意，龙王命取兵器';
  } else if (phase === 'trial' && world.trial === 0) {
    const called = cueTime(world, 'weapon_called');
    if (legacy) Object.assign(scene, { weapon: placedWeapon('knife') });
    else if (called !== null) Object.assign(scene, present('knife', Math.max(0, clock - called), clock));
    scene.blockingReason = scene.blocked ? '虾兵蟹将正在抬刀、放稳与退场' : '';
    scene.caption = called === null && !legacy
      ? media?.clip?.role === 'dragon' ? '龙王命取兵器 · 原场口令结束后虾兵蟹将上场' : '兵器尚在库中 · 先接龙王取器口令'
      : scene.blocked ? '虾兵蟹将抬刀上殿 · 请等兵器放稳、兵将退开' : cueTime(world,'weapon_tried')!==null?'刀已试过 · 接原声回应，再随光圈收势换器':'刀已放稳 · 轻动手杆、稍停，接试器回应';
  } else if (phase === 'trial') {
    if (legacy) Object.assign(scene, { weapon: placedWeapon('halberd') });
    else if (age < SCENE_TIMINGS.withdraw) Object.assign(scene, withdraw('knife', age, clock));
    else Object.assign(scene, present('halberd', age - SCENE_TIMINGS.withdraw, clock));
    scene.blockingReason = scene.blocked ? age < SCENE_TIMINGS.withdraw ? '兵将先撤回旧刀' : '兵将正在抬来第二件兵器' : '';
    scene.caption = scene.blocked ? age < SCENE_TIMINGS.withdraw
      ? '旧刀不合手 · 虾兵蟹将先收器回库' : '撤刀之后再呈长柄兵器 · 尚未放稳请稍候'
      : '长柄兵器已放稳 · 亲手试器后接龙王引看海藏';
  } else if (phase === 'guide') {
    const reveal = legacy ? 1 : progress(age, SCENE_TIMINGS.withdraw, SCENE_TIMINGS.treasuryReveal);
    if (!legacy && age < SCENE_TIMINGS.withdraw) Object.assign(scene, withdraw('halberd', age, clock));
    scene.background = { mode: reveal > 0 ? 'treasury' : 'palaceInside', fromMode: 'palaceInside', transition: reveal };
    scene.staff = { visible: reveal > 0, revealProgress: reveal };
    scene.blocked = !legacy && reveal < 1;
    scene.blockingReason = scene.blocked ? age < SCENE_TIMINGS.withdraw ? '兵将正在收回长柄兵器' : '转入海藏，神铁渐显' : '';
    scene.caption = scene.blocked ? age < SCENE_TIMINGS.withdraw ? '试器已毕 · 先由兵将收器回库' : '转入海藏 · 神铁在水光中显现' : '海藏神铁 · 顺着龙王的手势近前看宝';
  } else if (['staff', 'farewell', 'complete'].includes(phase)) {
    scene.background = { mode: 'treasury', fromMode: 'palaceInside', transition: 1 };
    scene.staff = { visible: true, revealProgress: 1 };
    scene.caption = phase === 'staff' ? '海藏取宝 · 握稳双手、换片、提棒'
      : phase === 'farewell' ? '携宝辞宫 · 龙王拦问，悟空持棒接演' : '一折落幕 · 宫门水光归静';
  }
  return scene;
}
