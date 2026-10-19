import { trimWorldEvents } from './event-history.js';

// Media events use the SAME ownership rules as the saved puppet actions.
// A partner's voice is an AI-controlled cue, never human annotation evidence.
export function appendVocalEvent(world,type,clip=null){
 const actor=clip?.role||world.playerRole;
 if(!['wukong','dragon'].includes(actor)||typeof type!=='string'||type.length>64)throw new Error('原声事件无效');
 const e={t:world.elapsed,phase:clip?.section||world.phase,trial:clip?.trial??world.trial??0,type,actor,control:actor===world.playerRole?'human':'ai'};
 world.events.push(e);trimWorldEvents(world);return e;
}
