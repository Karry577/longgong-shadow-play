import {
  createState, moveControl, updateContacts, canGrip, gripStaff, resizeStaff,
  getGripTargets, solvePose, cloneState, validateState,
} from './engine.js';
import { predictMotion } from './coach-model.js';
import { trimWorldEvents } from './event-history.js';

export const DUET_PHASES = Object.freeze(['arrival', 'request', 'trial', 'guide', 'staff', 'farewell', 'complete']);
const ROLES = ['wukong', 'dragon'];
const MIN_PHASE = 2;
const HOLD = 0.24;
// Version-1 recordings made before v0.12 stored up to 400ms for both dwell
// fields. Reading history must preserve those original measurements; only the
// next live tick applies the current, shorter admission hold.
const RECORDED_HOLD_MAX = 0.4;
const RADIUS = 38;
const histories = new WeakMap();
// Only rod travel is paced. Contact dwell and the scene clock stay in real seconds.
const partnerSpeeds = new WeakMap();
const opposite = role => role === 'wukong' ? 'dragon' : 'wukong';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const finite = v => typeof v === 'number' && Number.isFinite(v);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const near = (a, b, r = RADIUS) => distance(a, b) <= r;
const copyPoint = p => ({ x: p.x, y: p.y });
const newFlags = () => ({ staffInvited: false, gestureSeen: false, leftMoved: false, rightMoved: false, farewellInvited: false });

export function createDuet(role = 'wukong') {
  if (!ROLES.includes(role)) throw new Error('请选择孙悟空或东海龙王');
  const wukong = createState();
  moveControl(wukong, 'body', -160, 0);
  const dragon = createState();
  moveControl(dragon, 'body', 620, 0);
  moveControl(dragon, 'left', 980 - dragon.hands.left.x, 430 - dragon.hands.left.y);
  moveControl(dragon, 'right', 920 - dragon.hands.right.x, 460 - dragon.hands.right.y);
  return {
    format: 'yiren-duet-world', version: 1, playerRole: role, wukong, dragon,
    phase: 'arrival', elapsed: 0, phaseElapsed: 0, trial: 0,
    taskProgress: 0, actionCount: 0, taskDwell: 0, aiDwell: 0,
    flags: newFlags(),
    ai: { status: role === 'wukong' ? '龙王正在迎客' : '悟空正在入宫', policy: 'goal-policy-v1', actor: opposite(role), modelUsed: false },
    events: [],
  };
}

export function getPlayer(w) { return w[w.playerRole]; }

function event(w, type, actor = 'system', control = 'system') {
  w.events.push({ t: w.elapsed, phase: w.phase, trial: w.trial, type, actor, control });
  trimWorldEvents(w);
}
function enter(w, phase, type = 'enter') {
  w.phase = phase;
  w.phaseElapsed = 0;
  w.taskDwell = 0;
  w.aiDwell = 0;
  w.taskProgress = 0;
  w.flags = newFlags();
  if (phase === 'trial') w.trial = 0;
  event(w, type);
}

function chestTargets(actor) {
  return {
    left: { x: actor.body.x - 15, y: actor.body.y - 85 },
    right: { x: actor.body.x + 2, y: actor.body.y - 95 },
  };
}
function requestTarget(actor, role) {
  return role === 'wukong'
    ? { x: actor.body.x + 60, y: actor.body.y - 105 }
    : { x: actor.body.x - 50, y: actor.body.y - 115 };
}
function trialTarget(w, role) {
  // The second weapon is presented a little higher, requiring a new real gesture.
  // The dragon presents from stage-right; its wrist must not occupy Wukong's.
  return role === 'wukong' ? { x: 820, y: w.trial === 0 ? 445 : 430 }
    : { x: 910, y: w.trial === 0 ? 425 : 410 };
}
function staffGoal(w) {
  const actor = w.wukong;
  if (actor.staff.phase === 'lifted') return null;
  if (actor.staff.phase === 'gripped') {
    if (actor.staff.size !== 1) return null;
    // Every point in this visible circle clears the physical >36px lift.
    return { rod: 'body', point: { x: actor.body.x, y: Math.max(300, actor.gripBody.y - 58) }, radius: 20, hold: 0 };
  }
  const targets = getGripTargets(actor);
  const pose = solvePose(actor);
  if (['left', 'right'].some(id => distance(pose[id].shoulder, targets[id]) > 178)) {
    return { rod: 'body', point: { x: 740, y: 520 }, radius: RADIUS, hold: HOLD };
  }
  const errors = ['left', 'right'].map(id => ({ id, d: distance(actor.hands[id], targets[id]) }));
  const missed = errors.filter(item => item.d > 20).sort((a, b) => b.d - a.d);
  if (missed.length) return { rod: missed[0].id, point: targets[missed[0].id], radius: 20, hold: 0.28 };
  if (!canGrip(actor)) {
    const id = actor.contacts.left < actor.contacts.right ? 'left' : 'right';
    return { rod: id, point: targets[id], radius: 20, hold: 0.28 };
  }
  return null;
}

/** Goal points are BODY or WRIST world coordinates, never handle coordinates. */
function playerGoal(w) {
  const role = w.playerRole;
  const actor = getPlayer(w);
  const goal = (rod, point, hold = HOLD) => {
    if (rod !== 'body' && distance(solvePose(actor)[rod].shoulder, point) > 178) {
      return { rod: 'body', point: { x: role === 'dragon' ? 1020 : 740, y: 520 }, radius: RADIUS, hold: HOLD };
    }
    return { rod, point, radius: RADIUS, hold };
  };
  if (w.phase === 'arrival') return role === 'wukong'
    ? goal('body', { x: 430, y: 520 }) : goal('left', { x: 950, y: 430 });
  if (w.phase === 'request') return goal(role === 'wukong' ? 'right' : 'left', requestTarget(actor, role));
  if (w.phase === 'trial') {
    const body = { x: role === 'wukong' ? 650 : 1020, y: 520 };
    if (!near(actor.body, body)) return goal('body', body);
    return goal(role === 'wukong' ? 'right' : 'left', trialTarget(w, role));
  }
  if (w.phase === 'guide') return role === 'wukong'
    ? goal('body', { x: 740, y: 520 }) : goal('left', { x: 900, y: 430 });
  if (w.phase === 'staff') return role === 'wukong' ? staffGoal(w) : goal('left', { x: 925, y: 425 });
  if (w.phase === 'farewell') {
    if (role === 'wukong') return goal('body', { x: 260, y: actor.body.y });
    const targets = chestTargets(actor);
    const id = !w.flags.leftMoved || !near(actor.hands.left, targets.left) ? 'left' : 'right';
    return goal(id, targets[id]);
  }
  return null;
}

function humanCondition(w) {
  const a = getPlayer(w);
  const f = w.flags;
  // Once the player starts settling, small input jitter need not reset the
  // whole dwell. This changes admission only; no pose or wrist is snapped.
  const settledNear = (p, target) => near(p, target, RADIUS + (w.taskDwell > 0 ? 10 : 0));
  if (w.phase === 'arrival') return f.gestureSeen && (w.playerRole === 'wukong'
    ? settledNear(a.body, { x: 430, y: 520 }) : settledNear(a.hands.left, { x: 950, y: 430 }));
  if (w.phase === 'request') return f.gestureSeen && settledNear(a.hands[w.playerRole === 'wukong' ? 'right' : 'left'], requestTarget(a, w.playerRole));
  if (w.phase === 'trial') return f.gestureSeen && (w.playerRole === 'wukong'
    ? settledNear(a.body, { x: 650, y: 520 }) && settledNear(a.hands.right, trialTarget(w, 'wukong'))
    : settledNear(a.body, { x: 1020, y: 520 }) && settledNear(a.hands.left, trialTarget(w, 'dragon')));
  if (w.phase === 'guide') return f.gestureSeen && (w.playerRole === 'wukong'
    ? settledNear(a.body, { x: 740, y: 520 }) : settledNear(a.hands.left, { x: 900, y: 430 }));
  if (w.phase === 'staff') return w.playerRole === 'wukong'
    ? a.staff.phase === 'lifted' : f.gestureSeen && settledNear(a.hands.left, { x: 925, y: 425 });
  if (w.phase === 'farewell') {
    if (w.playerRole === 'wukong') return f.gestureSeen && a.body.x <= 300 && a.staff.phase === 'lifted';
    const targets = chestTargets(a);
    return f.leftMoved && f.rightMoved && settledNear(a.hands.left, targets.left) && settledNear(a.hands.right, targets.right);
  }
  return false;
}

export function moveDuet(w, rod, dx, dy) {
  if (w.phase === 'complete' || !['body', 'left', 'right'].includes(rod)) return false;
  const actor = getPlayer(w);
  const previousStaffPhase = actor.staff.phase;
  const before = copyPoint(rod === 'body' ? actor.body : actor.hands[rod]);
  if (!moveControl(actor, rod, dx, dy)) return false;
  const after = rod === 'body' ? actor.body : actor.hands[rod];
  if (distance(before, after) > 0.2) {
    w.actionCount += 1;
    if (rod === 'left') w.flags.leftMoved = true;
    if (rod === 'right') w.flags.rightMoved = true;
    const gestureRod = ['request', 'trial'].includes(w.phase)
      ? (w.playerRole === 'wukong' ? 'right' : 'left')
      : ['guide', 'staff', 'arrival'].includes(w.phase)
        ? (w.playerRole === 'wukong' ? 'body' : 'left') : rod;
    if (rod === gestureRod) w.flags.gestureSeen = true;
  }
  if (previousStaffPhase !== 'lifted' && actor.staff.phase === 'lifted') event(w, 'lift_staff', w.playerRole, 'human');
  if (!humanCondition(w)) { w.taskDwell = 0; w.taskProgress = 0; }
  return true;
}

function aim(actor, rod, target, dt, speed = rod === 'body' ? 105 : 155) {
  const p = rod === 'body' ? actor.body : actor.hands[rod];
  const d = distance(p, target);
  if (d < 1.5) return true;
  const amount = Math.min(d, speed * (partnerSpeeds.get(actor) || 1) * dt);
  moveControl(actor, rod, (target.x - p.x) / d * amount, (target.y - p.y) / d * amount);
  return near(rod === 'body' ? actor.body : actor.hands[rod], target, 2);
}
function sequence(actor, goals, dt) {
  for (const [rod, target] of goals) if (!near(rod === 'body' ? actor.body : actor.hands[rod], target, 3)) return aim(actor, rod, target, dt);
  return true;
}
function selectedHand(w, model) {
  const actor = w.wukong;
  const targets = getGripTargets(actor);
  const errors = Object.fromEntries(['left', 'right'].map(id => [id, distance(actor.hands[id], targets[id])]));
  let preferred = errors.left >= errors.right ? 'left' : 'right';
  if (model) {
    let samples = histories.get(w);
    if (!samples) { samples = []; histories.set(w, samples); }
    samples.push({ t: w.elapsed * 1000, state: cloneState(actor) });
    while (samples.length > 12) samples.shift();
    try {
      const prediction = predictMotion(samples, model);
      const candidate = prediction?.label?.startsWith('left_') ? 'left' : prediction?.label?.startsWith('right_') ? 'right' : null;
      if (candidate && errors[candidate] > 3) { preferred = candidate; w.ai.modelUsed = true; }
    } catch { /* A missing/incompatible optional classifier never bypasses geometry. */ }
  }
  return preferred;
}

function aiTakeStaff(w, dt, model) {
  const actor = w.wukong;
  if (!w.flags.staffInvited || w.taskDwell < HOLD - 1e-8 || !humanCondition(w)) {
    w.ai.status = w.flags.staffInvited ? '等待你重新指稳神铁；悟空暂停操杆' : '等待龙王指稳并说“请试神铁”';
    return false;
  }
  if (actor.staff.phase === 'lifted') { w.ai.status = '悟空已按真实握点、停稳、换片与提杆得棒'; return true; }
  if (actor.staff.phase === 'standing') {
    if (!near(actor.body, { x: 740, y: 520 }, 3)) {
      w.ai.status = '悟空用身杆走近神铁'; aim(actor, 'body', { x: 740, y: 520 }, dt); return false;
    }
    const targets = getGripTargets(actor);
    const hand = selectedHand(w, model);
    if (distance(actor.hands[hand], targets[hand]) > 3) {
      w.ai.status = `悟空逐杆对准${hand === 'left' ? '左' : '右'}手握点`;
      aim(actor, hand, targets[hand], dt); updateContacts(actor, dt); return false;
    }
    updateContacts(actor, dt);
    if (canGrip(actor) && gripStaff(actor)) {
      event(w, 'grip_staff', 'wukong', 'ai'); w.ai.status = '双手停稳，悟空合握神铁';
    } else w.ai.status = '悟空等待双手真实停稳0.28秒';
    return false;
  }
  if (actor.staff.size !== 1) {
    resizeStaff(actor, actor.staff.size === 0 ? -1 : 1);
    event(w, 'resize_staff', 'wukong', 'ai'); w.ai.status = '悟空换成合手的棒片'; return false;
  }
  w.ai.status = '悟空执身杆上提，双手与棒保持联动';
  aim(actor, 'body', { x: actor.body.x, y: Math.max(300, actor.gripBody.y - 46) }, dt);
  if (actor.staff.phase === 'lifted') event(w, 'lift_staff', 'wukong', 'ai');
  return actor.staff.phase === 'lifted';
}

function aiControl(w, dt, model) {
  const role = opposite(w.playerRole);
  const a = w[role];
  if (w.phase === 'arrival') {
    w.ai.status = role === 'wukong' ? '悟空执身杆入宫，等候龙王迎客' : '龙王抬手迎客，等候悟空拜见';
    return role === 'wukong' ? sequence(a, [['body', { x: 430, y: 520 }]], dt) : sequence(a, [['left', { x: 950, y: 430 }]], dt);
  }
  if (w.phase === 'request') {
    w.ai.status = role === 'wukong' ? '悟空作借器手势，等候龙王回应' : '龙王以手势回应，等待悟空开口';
    return sequence(a, [[role === 'wukong' ? 'right' : 'left', requestTarget(a, role)]], dt);
  }
  if (w.phase === 'trial') {
    w.ai.status = role === 'wukong' ? `悟空靠近试${w.trial ? '长柄兵器' : '刀'}，等待你呈递` : `龙王移身呈${w.trial ? '长柄兵器' : '刀'}，等待悟空试器`;
    if (role === 'wukong') {
      if (!near(a.body, { x: 650, y: 520 }, 3)) { aim(a, 'body', { x: 650, y: 520 }, dt); return false; }
      if (!humanCondition(w) || w.taskDwell < HOLD - 1e-8) {
        w.ai.status = '悟空在试器位等候龙王亲手呈递；未呈递不伸手试器'; return false;
      }
      return sequence(a, [['right', trialTarget(w, 'wukong')]], dt);
    }
    return sequence(a, [['body', { x: 1020, y: 520 }], ['left', trialTarget(w, 'dragon')]], dt);
  }
  if (w.phase === 'guide') {
    if (role === 'wukong' && (!humanCondition(w) || w.taskDwell < HOLD - 1e-8)) { w.ai.status = '悟空等待龙王亲手指稳神铁'; return false; }
    w.ai.status = role === 'wukong' ? '悟空顺着龙王的手势走近神铁' : '龙王举手指向海藏神铁';
    return role === 'wukong' ? sequence(a, [['body', { x: 740, y: 520 }]], dt) : sequence(a, [['left', { x: 900, y: 430 }]], dt);
  }
  if (w.phase === 'staff') {
    if (role === 'wukong') return aiTakeStaff(w, dt, model);
    w.ai.status = '龙王指示神铁，等候你亲手握稳、换片和提棒';
    return sequence(a, [['left', { x: 925, y: 425 }]], dt);
  }
  if (w.phase === 'farewell') {
    if (role === 'wukong') {
      if (!w.flags.farewellInvited) { w.ai.status = '悟空持棒候着，等待龙王收手接演辞宫交锋'; return false; }
      w.ai.status = '辞宫交锋已演完，悟空携棒离场';
      // aim() has a 1.5px arrival deadband. Aim fully inside the <=260 exit
      // boundary so historical fractional rod positions cannot stop at 260.x.
      aim(a, 'body', { x: 258, y: a.body.y }, dt);
      return a.body.x <= 260;
    }
    const target = chestTargets(a);
    w.ai.status = '龙王收手作难，等候悟空亲自携棒接演辞宫';
    return sequence(a, [['left', target.left], ['right', target.right]], dt);
  }
  w.ai.status = '合演完成；AI为目标策略操杆，不是真人演示';
  return true;
}

export function tickDuet(w, dt, model = null, {holdAI = false, partnerSpeed = 1} = {}) {
  if (!finite(dt) || dt <= 0 || w.phase === 'complete') return w;
  const step = Math.min(dt, 0.1); // A background-tab delay cannot teleport the AI.
  partnerSpeeds.set(w[opposite(w.playerRole)], finite(partnerSpeed) ? clamp(partnerSpeed, .6, 1.15) : 1);
  w.elapsed += step;
  w.phaseElapsed += step;
  if (w.phase === 'staff' && w.playerRole === 'wukong') updateContacts(w.wukong, step);
  const condition = humanCondition(w);
  w.taskDwell = condition ? Math.min(HOLD, w.taskDwell + step) : 0;
  // A recorded voice can hold the scene without freezing the human's dwell
  // measurements. The already-prepared partner must not move into a new cue.
  const ready = holdAI ? w.aiDwell >= 0.2 : aiControl(w, step, model);
  w.aiDwell = ready ? Math.min(HOLD, w.aiDwell + step) : 0;
  w.taskProgress = Math.min(1, w.taskDwell / HOLD);
  if (!holdAI && w.phase === 'farewell' && w.playerRole === 'dragon' && w.flags.farewellInvited && w.wukong.body.x <= 260 && w.phaseElapsed >= MIN_PHASE) enter(w, 'complete', 'complete');
  return w;
}

function canAction(w) {
  if (w.phase === 'complete' || w.phaseElapsed < MIN_PHASE || !humanCondition(w) || w.taskDwell < HOLD - 1e-8) return false;
  if (w.phase === 'staff' && w.playerRole === 'dragon') return !w.flags.staffInvited || w.wukong.staff.phase === 'lifted';
  if (w.phase === 'farewell' && w.playerRole === 'dragon') return !w.flags.farewellInvited;
  return w.aiDwell >= 0.2;
}

export function actionDuet(w) {
  if (!canAction(w)) return false;
  w.actionCount += 1;
  event(w, 'reply', w.playerRole, 'human');
  if (w.phase === 'arrival') enter(w, 'request');
  else if (w.phase === 'request') enter(w, 'trial');
  else if (w.phase === 'trial') {
    if (w.trial === 0) {
      w.trial = 1; w.phaseElapsed = 0; w.taskDwell = 0; w.taskProgress = 0; w.aiDwell = 0; w.flags = newFlags();
      event(w, 'trial_second');
    } else enter(w, 'guide');
  } else if (w.phase === 'guide') enter(w, 'staff');
  else if (w.phase === 'staff') {
    if (w.playerRole === 'dragon' && !w.flags.staffInvited) {
      w.flags.staffInvited = true; event(w, 'invite_staff', 'dragon', 'human');
    } else enter(w, 'farewell');
  } else if (w.phase === 'farewell') {
    if (w.playerRole === 'dragon') {
      w.flags.farewellInvited = true; event(w, 'farewell', 'dragon', 'human');
    } else enter(w, 'complete', 'complete');
  }
  return true;
}

export function gripDuet(w) {
  if (w.playerRole !== 'wukong' || w.phase !== 'staff' || !gripStaff(w.wukong)) return false;
  w.actionCount += 1; event(w, 'grip_staff', 'wukong', 'human'); return true;
}
export function resizeDuet(w, direction) {
  if (w.playerRole !== 'wukong' || w.phase !== 'staff' || !resizeStaff(w.wukong, direction)) return false;
  w.actionCount += 1; event(w, 'resize_staff', 'wukong', 'human'); return true;
}

const TITLES = {
  arrival: ['一 · 水晶宫前', '访龙宫'], request: ['二 · 说明来意', '借一件称手兵器'],
  trial: ['三 · 龙宫试器', '先试刀，再试长柄兵器'], guide: ['四 · 海藏神铁', '顺着手势看神铁'],
  staff: ['五 · 如意变化', '握稳、换片、提棒'], farewell: ['六 · 携宝辞宫', '悟空辞宫 · 龙王有异议'],
  complete: ['终 · 合演完成', '龙宫得宝'],
};

export function getDuetView(w) {
  const role = w.playerRole;
  const isMonkey = role === 'wukong';
  const [chapter, title] = TITLES[w.phase];
  const goal = playerGoal(w);
  let objective = '', actionLabel = '', line = '', speaker = role === 'wukong' ? '孙悟空' : '东海龙王';
  if (w.phase === 'arrival') {
    objective = isMonkey ? '执身杆到宫前，再停稳拜见龙王' : '亲手抬起左手迎客，让悟空走到宫前';
    actionLabel = isMonkey ? '拜见龙王' : '贵客请进';
    line = isMonkey ? '花果山孙悟空，特来拜访。' : '远客到来，请入水晶宫。';
  } else if (w.phase === 'request') {
    objective = isMonkey ? '亲手举右手作请求手势，停稳后说出来意' : '亲手抬左手回应，停稳后答应试器';
    actionLabel = isMonkey ? '想借一件称手的兵器' : '请试海藏兵器';
    line = isMonkey ? '愿借一件趁手兵器，烦请指点。' : '海藏尚有兵器，且请试上一试。';
  } else if (w.phase === 'trial') {
    const name = w.trial === 0 ? '刀' : '长柄兵器';
    objective = isMonkey ? `先移身靠近，再伸右手试${name}` : `先移身到呈递位，再用左手送出${name}`;
    actionLabel = isMonkey ? (w.trial === 0 ? '轻了些，再看一件' : '仍不称手，还有什么？') : (w.trial === 0 ? '再试一件长柄兵器' : '另有一块海藏神铁');
    line = isMonkey ? `这${name}，尚不称手。` : `这件${name}，大圣请试。`;
  } else if (w.phase === 'guide') {
    objective = isMonkey ? '亲手移身走近神铁，再回应龙王' : '左手指出神铁，停稳后请悟空近前';
    actionLabel = isMonkey ? '待我近前看看' : '请看这块神铁';
    line = isMonkey ? '这块神铁，容我近前试试。' : '海藏中另有神铁，大圣近前看看。';
  } else if (w.phase === 'staff') {
    if (isMonkey) {
      objective = w.wukong.staff.phase === 'standing' ? (canGrip(w.wukong) ? '双手已停稳，按握棒键合握' : '分别操两根手杆对位，并停稳0.28秒')
        : w.wukong.staff.phase === 'lifted' ? '棒已称手，停稳后开口辞行' : w.wukong.staff.size !== 1 ? '换成合手棒片，再执主杆向上提' : '主杆向上提超过36像素';
      actionLabel = '这棒称手，容我携去'; line = '小些，合手便好！';
    } else {
      objective = w.flags.staffInvited ? '继续指稳神铁；手离开光圈，悟空暂停' : '左手靠近神铁光圈，停稳0.24秒，再说“请试神铁”';
      actionLabel = !w.flags.staffInvited ? '请试神铁' : w.wukong.staff.phase === 'lifted' ? '原场接演：得棒后的交锋' : '继续指稳，等悟空提棒';
      line = w.flags.staffInvited ? '请试此铁，且看是否称手。' : '大圣若能取起，便请一试。';
    }
  } else if (w.phase === 'farewell') {
    objective = isMonkey ? '亲手执身杆携棒向左辞宫，再开口告辞' : '亲自把两手收回胸前，作难相拦，再接原场争宝对白';
    actionLabel = isMonkey ? '谢过龙王，告辞' : w.flags.farewellInvited ? '悟空正在携宝辞宫' : '接演辞宫交锋';
    line = isMonkey ? '多谢相赠，孙悟空告辞。' : '大圣请慢行。';
  } else {
    objective = '双方的操杆与台词共同完成了这一折'; actionLabel = '合演已完成'; line = '一人操一角，与目标策略AI合演。'; speaker = '落幕';
  }
  return {
    chapter, title, objective, speaker, line, actionLabel, actionEnabled: canAction(w),
    aiStatus: w.ai.status, prop: w.phase === 'trial' ? (w.trial === 0 ? 'fork' : 'halberd') : ['guide', 'staff', 'farewell', 'complete'].includes(w.phase) ? 'staff' : null,
    goal, progress: clamp(w.taskProgress, 0, 1),
    caption: '原著情节的舞台化精简改编；你亲自操一角，另一角由目标策略逐杆控制。',
    wukongLine: isMonkey ? line : w.phase === 'staff' && w.wukong.staff.phase === 'lifted' ? '好一件趁手的兵器！' : w.ai.status,
    dragonLine: !isMonkey ? line : w.ai.status,
  };
}

function fail(message) { throw new Error(`无效合演状态：${message}`); }
function safeData(value, depth = 0, seen = new Set(), budget = { count: 0 }) {
  if (depth > 16 || ++budget.count > 1800) fail('数据过大或过深');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') { if (!finite(value)) fail('非有限数'); return; }
  if (typeof value === 'string') { if (value.length > 2048) fail('字符串过长'); return; }
  if (!value || typeof value !== 'object') fail('只接受JSON数据');
  const proto = Object.getPrototypeOf(value);
  if (Array.isArray(value) ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) fail('非普通对象');
  if (seen.has(value)) fail('循环引用');
  seen.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length > 129) fail('字段过多');
  if (Array.isArray(value) && Object.keys(descriptors).length !== value.length + 1) fail('数组缺项');
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype', 'toJSON'].includes(key)) fail('危险属性');
    const descriptor = descriptors[key];
    if (!('value' in descriptor)) fail('不接受访问器');
    if (Array.isArray(value) && key !== 'length' && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) fail('数组额外属性');
    safeData(descriptor.value, depth + 1, seen, budget);
  }
  seen.delete(value);
}
function number(value, low, high, name) {
  if (!finite(value) || value < low || value > high) fail(name);
  return value;
}
function boolean(value, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') fail('布尔字段');
  return value;
}

export function validateDuet(raw) {
  safeData(raw);
  if (!raw || raw.format !== 'yiren-duet-world' || raw.version !== 1 || !ROLES.includes(raw.playerRole) || !DUET_PHASES.includes(raw.phase)) fail('格式、版本、角色或场次');
  const elapsed = number(raw.elapsed, 0, 86400, '总时间');
  const phaseElapsed = number(raw.phaseElapsed, 0, elapsed + 1e-6, '场次时间');
  if (![0, 1].includes(raw.trial)) fail('试器编号');
  if (!Number.isInteger(raw.actionCount) || raw.actionCount < 0 || raw.actionCount > 1e8) fail('动作次数');
  if (!raw.ai || typeof raw.ai.status !== 'string' || raw.ai.status.length > 180) fail('AI状态');
  if (raw.ai.policy !== undefined && raw.ai.policy !== 'goal-policy-v1') fail('AI策略标识');
  if (raw.ai.actor !== undefined && raw.ai.actor !== opposite(raw.playerRole)) fail('AI角色不能与真人相同');
  const wukong = validateState(raw.wukong), dragon = validateState(raw.dragon);
  if (dragon.staff.phase !== 'standing' || dragon.staff.x !== 850 || dragon.staff.y !== 455) fail('龙王不能持有悟空的神铁');
  if (['arrival', 'request', 'trial', 'guide'].includes(raw.phase) && wukong.staff.phase !== 'standing') fail('尚未到取棒场次');
  if (['farewell', 'complete'].includes(raw.phase) && wukong.staff.phase !== 'lifted') fail('尚未完成提棒');
  if (raw.flags !== undefined && (!raw.flags || typeof raw.flags !== 'object' || Array.isArray(raw.flags))) fail('手势标志');
  const flags = raw.flags || {};
  const normalizedFlags = Object.fromEntries(Object.keys(newFlags()).map(key => [key, boolean(flags[key])]));
  if (!Array.isArray(raw.events) || raw.events.length > 80) fail('剧情事件');
  let previousEventTime = -1;
  const events = raw.events.map(item => {
    if (!item || !DUET_PHASES.includes(item.phase) || ![0, 1].includes(item.trial) || typeof item.type !== 'string' || item.type.length > 64
      || !['wukong', 'dragon', 'system'].includes(item.actor) || !['human', 'ai', 'system'].includes(item.control)) fail('事件字段');
    if (item.control === 'human' && item.actor !== raw.playerRole || item.control === 'ai' && item.actor !== opposite(raw.playerRole)
      || item.control === 'system' && item.actor !== 'system') fail('操演者归属');
    const t = number(item.t, 0, elapsed + 1e-6, '事件时间');
    if (t < previousEventTime) fail('事件时间倒退');
    previousEventTime = t;
    return { t, phase: item.phase, trial: item.trial, type: item.type, actor: item.actor, control: item.control };
  });
  return {
    format: 'yiren-duet-world', version: 1, playerRole: raw.playerRole, wukong, dragon,
    phase: raw.phase, elapsed, phaseElapsed, trial: raw.trial,
    taskProgress: number(raw.taskProgress, 0, 1, '任务进度'), actionCount: raw.actionCount,
    taskDwell: number(raw.taskDwell ?? 0, 0, RECORDED_HOLD_MAX, '真人停稳时间'), aiDwell: number(raw.aiDwell ?? 0, 0, RECORDED_HOLD_MAX, 'AI停稳时间'),
    flags: normalizedFlags,
    ai: { status: raw.ai.status, policy: 'goal-policy-v1', actor: opposite(raw.playerRole), modelUsed: boolean(raw.ai.modelUsed) }, events,
  };
}
export function cloneDuet(w) { return validateDuet(w); }
