/** Pure, deterministic 2D rod-puppet engine. Coordinates are stage/world pixels. */
export const STAGE = Object.freeze({ width: 1280, height: 720, floor: 590 });

const ARM = 90;
const REACH = ARM * 2;
const DWELL = 0.28;
const CONTACT_RADIUS = 20;
const EPS = 1e-7;
const PHASES = new Set(['standing', 'gripped', 'lifted']);
const LIMITS = { minX: 100, maxX: 1120, minY: 300, maxY: 520 };
const finite = value => typeof value === 'number' && Number.isFinite(value);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const point = value => ({ x: value.x, y: value.y });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function createState() {
  return {
    body: { x: 420, y: 520 },
    hands: { left: { x: 480, y: 450 }, right: { x: 530, y: 430 } },
    staff: { x: 850, y: 455, size: 0, phase: 'standing', lift: 0 },
    contacts: { left: 0, right: 0 },
    gripBody: null,
  };
}

function shoulders(body) {
  return {
    left: { x: body.x - 22, y: body.y - 58 },
    right: { x: body.x + 23, y: body.y - 63 },
  };
}

export function getGripTargets(s) {
  return {
    left: { x: s.staff.x - 8, y: s.staff.y + 30 },
    right: { x: s.staff.x + 8, y: s.staff.y - 28 },
  };
}

export function getHandles(s) {
  // Rod handles remain reachable even when a legal wrist approaches a stage edge.
  // Only the visible input handles are clamped; wrist and puppet geometry stay put.
  const visible = p => ({ x: clamp(p.x, 32, STAGE.width - 32), y: clamp(p.y, 95, 680) });
  return {
    body: visible({ x: s.body.x - 25, y: s.body.y + 115 }),
    left: visible({ x: s.hands.left.x - 40, y: s.hands.left.y + 165 }),
    right: visible({ x: s.hands.right.x + 45, y: s.hands.right.y + 175 }),
  };
}

function projectHand(target, shoulder) {
  const dx = target.x - shoulder.x;
  const dy = target.y - shoulder.y;
  const length = Math.hypot(dx, dy);
  if (length <= REACH) return point(target);
  return { x: shoulder.x + dx / length * REACH, y: shoulder.y + dy / length * REACH };
}

function armPose(shoulder, target, bend) {
  const wrist = projectHand(target, shoulder);
  const dx = wrist.x - shoulder.x;
  const dy = wrist.y - shoulder.y;
  const d = Math.hypot(dx, dy);
  // At zero distance the equal-length links fold without dividing by zero.
  const ux = d > EPS ? dx / d : 1;
  const uy = d > EPS ? dy / d : 0;
  const h = Math.sqrt(Math.max(0, ARM * ARM - d * d / 4));
  return {
    shoulder: point(shoulder),
    elbow: { x: shoulder.x + dx / 2 - uy * h * bend, y: shoulder.y + dy / 2 + ux * h * bend },
    wrist,
  };
}

export function solvePose(s) {
  const shoulder = shoulders(s.body);
  const footY = Math.min(STAGE.floor, s.body.y + 70);
  return {
    root: point(s.body),
    head: { x: s.body.x - 2, y: s.body.y - 126 },
    left: armPose(shoulder.left, s.hands.left, 1),
    right: armPose(shoulder.right, s.hands.right, 1),
    hip: { x: s.body.x, y: s.body.y + 18 },
    knees: {
      left: { x: s.body.x - 22, y: s.body.y + 45 },
      right: { x: s.body.x + 24, y: s.body.y + 45 },
    },
    feet: {
      left: { x: s.body.x - 35, y: footY },
      right: { x: s.body.x + 41, y: footY },
    },
  };
}

function syncGrips(s) {
  const grips = getGripTargets(s);
  s.hands.left = grips.left;
  s.hands.right = grips.right;
}

function gripsReachable(s, body = s.body) {
  const shoulder = shoulders(body);
  const target = getGripTargets(s);
  return ['left', 'right'].every(id => distance(shoulder[id], target[id]) <= REACH + EPS);
}

function feasibleBody(s, desired) {
  if (gripsReachable(s, desired)) return desired;
  // The intersection of both reachable disks and the body bounds is convex.
  // Search on the drag segment, preserving a legal starting pose.
  let low = 0;
  let high = 1;
  for (let i = 0; i < 35; i += 1) {
    const t = (low + high) / 2;
    const candidate = {
      x: s.body.x + (desired.x - s.body.x) * t,
      y: s.body.y + (desired.y - s.body.y) * t,
    };
    if (gripsReachable(s, candidate)) low = t;
    else high = t;
  }
  return {
    x: s.body.x + (desired.x - s.body.x) * low,
    y: s.body.y + (desired.y - s.body.y) * low,
  };
}

/** Mutates s. Returns false for unknown controls, invalid deltas, or locked hands. */
export function moveControl(s, id, dx, dy) {
  if (!finite(dx) || !finite(dy) || !['body', 'left', 'right'].includes(id)) return false;
  if (id !== 'body') {
    if (s.staff.phase !== 'standing') return false;
    const shoulder = shoulders(s.body)[id];
    // Bound arithmetic before adding, including hostile 1e308 deltas.
    s.hands[id] = projectHand({
      x: s.hands[id].x + clamp(dx, -STAGE.width * 2, STAGE.width * 2),
      y: s.hands[id].y + clamp(dy, -STAGE.height * 2, STAGE.height * 2),
    }, shoulder);
    s.contacts[id] = 0;
    return true;
  }

  let next = {
    x: clamp(s.body.x + clamp(dx, -STAGE.width * 2, STAGE.width * 2), LIMITS.minX, LIMITS.maxX),
    y: clamp(s.body.y + clamp(dy, -STAGE.height * 2, STAGE.height * 2), LIMITS.minY, LIMITS.maxY),
  };
  const locked = s.staff.phase !== 'standing';
  const carries = locked && (s.staff.size === 1 || s.staff.phase === 'lifted');
  if (locked && !carries) next = feasibleBody(s, next);
  if (carries) {
    // Keep the staff centre inside the stage while preserving attached offsets.
    next.x = clamp(next.x, Math.max(LIMITS.minX, s.body.x + 24 - s.staff.x),
      Math.min(LIMITS.maxX, s.body.x + STAGE.width - 24 - s.staff.x));
    next.y = clamp(next.y, Math.max(LIMITS.minY, s.body.y + 80 - s.staff.y),
      Math.min(LIMITS.maxY, s.body.y + 600 - s.staff.y));
  }
  const mx = next.x - s.body.x;
  const my = next.y - s.body.y;
  s.body = next;
  if (!locked) {
    for (const hand of ['left', 'right']) {
      s.hands[hand].x += mx;
      s.hands[hand].y += my;
      s.contacts[hand] = 0;
    }
  } else {
    if (carries) {
      s.staff.x += mx;
      s.staff.y += my;
      const raised = Math.max(0, s.gripBody.y - s.body.y);
      s.staff.lift = s.staff.phase === 'lifted' ? Math.max(s.staff.lift, raised) : raised;
      if (s.staff.size === 1 && s.staff.lift > 36) s.staff.phase = 'lifted';
    }
    syncGrips(s);
  }
  return true;
}

export function updateContacts(s, dt) {
  if (!finite(dt) || dt < 0) return;
  if (s.staff.phase !== 'standing') {
    s.contacts.left = DWELL;
    s.contacts.right = DWELL;
    return;
  }
  const targets = getGripTargets(s);
  for (const id of ['left', 'right']) {
    s.contacts[id] = distance(s.hands[id], targets[id]) <= CONTACT_RADIUS
      ? Math.min(DWELL, s.contacts[id] + Math.min(DWELL, dt)) : 0;
  }
}

export function canGrip(s) {
  if (s.staff.phase !== 'standing' || !gripsReachable(s)) return false;
  const target = getGripTargets(s);
  return ['left', 'right'].every(id => s.contacts[id] >= DWELL - EPS
    && distance(s.hands[id], target[id]) <= CONTACT_RADIUS);
}

export function gripStaff(s) {
  if (!canGrip(s)) return false;
  s.staff.phase = 'gripped';
  s.staff.lift = 0;
  s.gripBody = point(s.body);
  s.contacts.left = DWELL;
  s.contacts.right = DWELL;
  syncGrips(s);
  return true;
}

/** direction=-1 means smaller; the size index therefore increases. */
export function resizeStaff(s, direction) {
  if (s.staff.phase === 'standing' || ![-1, 1].includes(direction)) return false;
  const next = clamp(s.staff.size - direction, 0, 2);
  if (next === s.staff.size) return false;
  s.staff.size = next;
  if (s.staff.phase !== 'lifted') {
    s.gripBody = point(s.body);
    s.staff.lift = 0;
  }
  syncGrips(s);
  return true;
}

export function getStatus(s) {
  if (s.staff.phase === 'lifted') return {
    step: 3, title: '得宝亮相', detail: '金箍棒已随主杆提起。继续走位，录下悟空的亮相。',
  };
  if (s.staff.phase === 'gripped') return {
    step: 2,
    title: s.staff.size === 1 ? '向上提棒' : '道具换片',
    detail: s.staff.size === 1 ? '向上拖主杆超过36像素，让棒随身提起。' : '使用换片把棒调到合手大小，再提主杆。',
  };
  if (canGrip(s)) return { step: 1, title: '双手就位', detail: '两手已停稳，确认握棒。' };
  return { step: 0, title: '靠近试棒', detail: '先拖主杆靠近，再把两手杆移到握点并稍停。' };
}

function inspectJson(value, depth = 0, budget = { count: 0 }) {
  if (depth > 8 || (budget.count += 1) > 160) throw new Error('Replay state is too complex');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!finite(value)) throw new Error('Replay contains a non-finite number');
    return;
  }
  if (typeof value === 'string') {
    if (value.length > 2048) throw new Error('Replay string is too long');
    return;
  }
  if (typeof value !== 'object') throw new Error('Replay must contain JSON data only');
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null && proto !== Array.prototype) {
    throw new Error('Replay object has an unsafe prototype');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length > 64) throw new Error('Too many replay fields');
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key)) {
      throw new Error('Unsafe replay key');
    }
    const descriptor = descriptors[key];
    if (!('value' in descriptor)) throw new Error('Replay accessors are not allowed');
    inspectJson(descriptor.value, depth + 1, budget);
  }
}

function dataObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label}`);
  return value;
}

function numeric(value, low, high, label) {
  if (!finite(value) || value < low - EPS || value > high + EPS) throw new Error(`Invalid ${label}`);
  return value;
}

function readPoint(value, bounds, label) {
  dataObject(value, label);
  return {
    x: numeric(value.x, bounds[0], bounds[1], `${label}.x`),
    y: numeric(value.y, bounds[2], bounds[3], `${label}.y`),
  };
}

/** Rejects malformed/unphysical replay data; strips harmless unknown fields. */
export function validateState(raw) {
  inspectJson(raw);
  dataObject(raw, 'state');
  const bodyBounds = [LIMITS.minX, LIMITS.maxX, LIMITS.minY, LIMITS.maxY];
  const body = readPoint(raw.body, bodyBounds, 'body');
  const hands = dataObject(raw.hands, 'hands');
  const staff = dataObject(raw.staff, 'staff');
  const contacts = dataObject(raw.contacts, 'contacts');
  if (!Number.isInteger(staff.size) || staff.size < 0 || staff.size > 2 || !PHASES.has(staff.phase)) {
    throw new Error('Invalid staff size or phase');
  }
  const out = {
    body,
    hands: {
      left: readPoint(hands.left, [-120, 1400, 40, 720], 'hands.left'),
      right: readPoint(hands.right, [-120, 1400, 40, 720], 'hands.right'),
    },
    staff: {
      x: numeric(staff.x, 24, STAGE.width - 24, 'staff.x'),
      y: numeric(staff.y, 80, 600, 'staff.y'),
      size: staff.size,
      phase: staff.phase,
      lift: numeric(staff.lift, 0, LIMITS.maxY - LIMITS.minY, 'staff.lift'),
    },
    contacts: {
      left: numeric(contacts.left, 0, DWELL, 'contacts.left'),
      right: numeric(contacts.right, 0, DWELL, 'contacts.right'),
    },
    gripBody: raw.gripBody === null ? null : readPoint(raw.gripBody, bodyBounds, 'gripBody'),
  };
  const shoulder = shoulders(body);
  for (const id of ['left', 'right']) {
    if (distance(shoulder[id], out.hands[id]) > REACH + EPS * 2) throw new Error('Arm exceeds physical reach');
  }
  if (out.staff.phase === 'standing') {
    if (out.gripBody !== null || out.staff.lift !== 0 || out.staff.size !== 0) throw new Error('Invalid standing staff');
  } else {
    if (out.gripBody === null) throw new Error('Held staff requires a grip baseline');
    const target = getGripTargets(out);
    for (const id of ['left', 'right']) {
      if (distance(out.hands[id], target[id]) > 0.001) throw new Error('Held staff has detached hands');
    }
    if (out.staff.phase === 'gripped' && (out.staff.lift > 36 + EPS || (out.staff.size !== 1 && out.staff.lift !== 0))) {
      throw new Error('Invalid pre-lift state');
    }
    if (out.staff.phase === 'lifted' && out.staff.lift <= 36) throw new Error('Lift threshold not reached');
  }
  return out;
}

export function cloneState(s) {
  return validateState(s);
}
