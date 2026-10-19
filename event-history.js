const PERSISTENT_STAGE_CUES = new Set(['stage_weapon_called', 'stage_weapon_placed', 'stage_weapon_tried']);

/** Keep the bounded, chronological recording history while retaining the
 * current trial's three presentation facts. Otherwise a long pause with input
 * or media anchors could make a delivered weapon disappear or be tried twice.
 * Only the latest occurrence of each current cue is protected (at most three).
 */
export function trimWorldEvents(world) {
  if (!world || !Array.isArray(world.events)) throw new Error('剧情事件列表无效');
  const events = world.events;
  if (events.length <= 80) return events;
  const protectedEvents = new Set(), seenTypes = new Set();
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event?.phase === world.phase && event.trial === world.trial
      && PERSISTENT_STAGE_CUES.has(event.type) && !seenTypes.has(event.type)) {
      seenTypes.add(event.type); protectedEvents.add(event);
    }
  }
  while (events.length > 80) {
    const expendable = events.findIndex(event => !protectedEvents.has(event));
    events.splice(expendable < 0 ? 0 : expendable, 1);
  }
  return events;
}
