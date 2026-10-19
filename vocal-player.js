import {clipsForScene,lineAt} from './vocal-pack.js?v=0.12.0';
const smooth=value=>{const t=Math.max(0,Math.min(1,value));return t*t*(3-2*t);};

// Plays genuine uploaded recordings only. There is no synthesized voice fallback.
// Position and captions follow media.currentTime, never a guessed reading speed.
export class VocalPlayer {
 constructor({createAudio=()=>new Audio(),onState=()=>{}}={}){this.makeAudio=createAudio;this.onState=onState;this.pack=null;this.urls={};this.enabled=true;this.volume=.85;this.audio=null;this.sourceUrl=null;this.positioned=false;this.pendingOffset=0;this.mediaCleanup=null;this.queue=[];this.index=0;this.active=false;this.error='';this.epoch=0;this.playToken=0;this.seen=new Set();this.anchor=null;this.outcome='idle';this.requestId=null;}
 get busy(){return !!this.queue.length;}
 get state(){const clip=this.queue[this.index]||null;const positioned=!!clip&&this.positioned&&!this.audio?.seeking;const offset=clip&&this.audio&&positioned?Math.max(0,this.audio.currentTime-clip.start):this.pendingOffset;return{loaded:!!this.pack,enabled:this.enabled,busy:this.busy,loading:!!clip&&!positioned&&!this.error,playing:!!this.audio&&!this.audio.paused&&positioned,clip,offset,line:positioned?lineAt(clip,offset):null,error:this.error,outcome:this.outcome,completed:this.outcome==='completed',aborted:this.outcome==='aborted',failed:this.outcome==='error'||!!this.error,requestId:this.requestId};}
 emit(){this.onState(this.state);}
 setPack(pack,urls){this.stop();this.pack=pack;this.urls=urls;this.error='';this.seen.clear();this.outcome='idle';this.requestId=null;this.emit();}
 setEnabled(value){this.enabled=!!value;if(!this.enabled)this.pause();this.emit();}
 setVolume(value){if(Number.isFinite(value)){this.volume=Math.max(0,Math.min(1,value));this.gains();}}
 // Tiny boundary ramps soften a cut without changing its source clock, text,
 // playback rate or musical pitch. This is not loudness normalization.
 clipVolume(clip,offset){if(!clip)return 0;return this.volume*Math.min(smooth(offset/.06),smooth((clip.end-clip.start-offset)/.1));}
 gains(){const clip=this.queue[this.index];if(this.audio&&clip)this.audio.volume=this.clipVolume(clip,this.state.offset);}
 clearMediaWait(){clearTimeout(this.loadTimer);this.loadTimer=null;this.mediaCleanup?.();this.mediaCleanup=null;}
 release(){this.clearMediaWait();const a=this.audio;this.audio=null;this.sourceUrl=null;this.positioned=false;this.pendingOffset=0;if(a){a.pause();a.removeAttribute('src');a.load();}}
 stop(){this.epoch++;this.playToken++;this.active=false;this.release();this.queue=[];this.index=0;this.deferClips=false;this.anchor=null;this.outcome='aborted';this.emit();}
 reset(){this.stop();this.seen.clear();this.error='';this.outcome='idle';this.requestId=null;this.emit();}
 pause(){this.playToken++;this.active=false;this.audio?.pause();this.emit();}
 resume(){if(!this.enabled||!this.busy||this.error)return;if(this.active&&this.audio&&!this.audio.paused&&this.positioned&&!this.audio.seeking)return;this.active=true;this.outcome='queued';if(this.audio){if(this.audio.readyState>0){const clip=this.queue[this.index];if(!Number.isFinite(this.audio.duration)||this.audio.duration+.05<clip.end){this.error='唱段时间超出原录音，已停止';this.outcome='error';this.pause();return;}if(!this.positioned||this.audio.seeking)return;if(this.audio.currentTime>=clip.end-.015)this.next();else if(this.audio.currentTime<clip.start-.02)this.begin(this.pendingOffset);else this.play(this.epoch);}}else this.begin();}
 retry({manualStart=false}={}){if(!this.enabled||!this.busy)return;const offset=this.state.offset;this.error='';this.outcome='queued';this.active=!manualStart;this.begin(offset,{forceReload:true});}
 // Transport correction inside the current excerpt. Preserve the active/paused
 // intent, invalidate the previous seek target, and reuse the loaded source.
 // Callers must use this instead of assigning audio.currentTime directly.
 seekWithinClip(offset){const clip=this.queue[this.index];if(!clip||!this.audio||this.error||!Number.isFinite(offset)||offset<0||offset>=clip.end-clip.start)return false;this.begin(offset);return true;}
 async play(epoch){const a=this.audio,token=++this.playToken;if(!a||!this.positioned||a.seeking)return;this.gains();try{await a.play();
   // A reused media element can have a newer valid play request. An obsolete
   // promise must stop cancelled media, but must not pause its current turn.
   if(a!==this.audio||!this.active||!this.enabled||!this.positioned||a.seeking||this.error)a.pause();
  }catch(e){if(token===this.playToken&&epoch===this.epoch&&a===this.audio&&e?.name!=='AbortError'){this.error=e?.name==='NotAllowedError'?'点击“接唱”启声':'唱段无法播放，请检查音频文件';this.outcome='error';this.active=false;a.pause();}}this.emit();}
 begin(offset=0,{forceReload=false}={}){const clip=this.queue[this.index];if(!clip){this.release();this.queue=[];this.active=false;this.emit();return;}
  const url=this.urls[clip.file];this.playToken++;this.clearMediaWait();
  if(forceReload||!this.audio||this.sourceUrl!==url)this.release();
  const reused=!!this.audio,a=this.audio||this.makeAudio();this.audio=a;this.sourceUrl=url;
  a.pause();this.positioned=false;this.pendingOffset=Math.min(Math.max(0,offset),clip.end-clip.start);
  a.preload='auto';a.volume=this.clipVolume(clip,this.pendingOffset);a.loop=false;const epoch=++this.epoch;
  const current=()=>epoch===this.epoch&&a===this.audio;
  const fail=message=>{if(!current())return;this.error=message;this.outcome='error';this.pause();};
  const validate=()=>{if(!Number.isFinite(a.duration)||a.duration+.05<clip.end){fail('唱段时间超出原录音，已停止');return false;}return true;};
  const target=clip.start+this.pendingOffset;
  const positioned=()=>{if(!current()||this.error||a.seeking||Math.abs(a.currentTime-target)>.08)return;this.positioned=true;clearTimeout(this.loadTimer);this.loadTimer=null;if(this.active&&this.enabled)this.play(epoch);this.emit();};
  const ready=()=>{if(!current()||this.error||!validate())return;a.currentTime=target;positioned();};
  const seeking=()=>{if(!current())return;this.positioned=false;a.pause();this.emit();};
  const ended=()=>{if(current()&&this.positioned&&this.active&&this.enabled&&!a.seeking)this.next();};
  const error=()=>fail('真人唱段未能载入');
  const listeners=[['loadedmetadata',ready],['seeked',positioned],['seeking',seeking],['error',error],['ended',ended]];
  for(const [type,fn]of listeners)a.addEventListener(type,fn);
  this.mediaCleanup=()=>{for(const [type,fn]of listeners)a.removeEventListener(type,fn);};
  this.loadTimer=setTimeout(()=>{if(current()&&!this.positioned)fail('原声载入或定位超时，点击继续原声重试，或略过本次');},15000);this.loadTimer?.unref?.();
  if(!reused)a.src=url;
  if(a.readyState>0)ready();this.emit();
 }
 next(){if(!this.busy)return;this.index++;if(this.index>=this.queue.length){this.epoch++;this.playToken++;this.active=false;this.release();this.queue=[];this.index=0;this.outcome='completed';this.emit();return;}if(this.deferClips)this.active=false;this.begin();}
 // One successful physical action opens a role pair once, however many pointer
 // events or UI renders follow. Subsequent actions wait for this pair to finish.
 cue(world,id,{manualStart=false,beat}={}){if(!this.enabled||!this.pack||this.busy||this.seen.has(id))return false;const clips=clipsForScene(this.pack,world,{beat});if(!clips.length||clips.some(c=>!this.urls[c.file]||!Number.isFinite(c.start)||!Number.isFinite(c.end)||c.end<=c.start||!Array.isArray(c.lines)||!c.lines.length)){this.error='当前场次缺少可播放的原声片段';this.outcome='error';this.requestId=id;this.emit();return false;}this.seen.add(id);this.queue=clips;this.index=0;this.deferClips=manualStart;this.active=!manualStart;this.error='';this.outcome='queued';this.requestId=id;this.begin();return true;}
 tick(){this.gains();if(this.active&&this.positioned&&this.audio&&!this.audio.seeking&&this.busy&&this.audio.currentTime>=this.queue[this.index].end-.015)this.next();this.emit();}
 // Replay plans are anchored to saved successful reply events, not mouse motion.
 // A seek may locate a clip but never starts it until the transport resumes.
 seek(recording,timeMs){this.stop();this.seen.clear();this.error='';this.outcome='idle';this.requestId=`replay:${timeMs}`;if(!this.pack)return;const seen=new Set();let active=null;
  // New recordings save actual media offsets, including rod-induced waits and
  // network buffering. These anchors supersede the old guessed reply clock.
  let anchored=false, latest=null;
  for(const frame of recording.frames){if(frame.t>timeMs)break;for(const e of frame.world.events){
   const key=[e.t,e.type,e.actor,e.phase,e.trial].join('|');if(seen.has(key))continue;seen.add(key);
   if(e.type==='vocal_stop'){anchored=true;latest=null;continue;}
   const match=/^vocal_at_([a-z0-9]+)_(\d+)(?:_([rp]))?$/.exec(e.type);if(!match)continue;anchored=true;
  const allClips=[...this.pack.clips,...(Array.isArray(this.pack.legacyClips)?this.pack.legacyClips:[])];
  const clip=allClips.find(c=>c.id===match[1]&&c.role===e.actor&&c.section===e.phase&&c.trial===e.trial);
   const eventMs=e.t*1000+frame.t-frame.world.elapsed*1000;
   const offset=Number(match[2])/1000+(match[3]==='r'?Math.max(0,timeMs-eventMs)/1000:0);
   // Millisecond recording anchors can land mathematically on a source end
   // while subtraction leaves an extra 1e-14s. Do not revive an ended turn.
   latest=clip&&offset>=0&&clip.start+offset<clip.end-1e-6?{clip,offset}:null;
  }}
  if(anchored){if(latest){this.queue=[latest.clip];this.index=0;this.outcome='queued';this.begin(latest.offset);}this.emit();return;}
  // Remote source excerpts need real saved media anchors. A historical reply
  // event cannot establish which original excerpt actually played or its clock.
  if(this.pack.audioOnly&&this.pack.mode==='remote-reference'){this.emit();return;}
  seen.clear();
  for(const frame of recording.frames){if(frame.t>timeMs)break;for(const e of frame.world.events){if(e.type!=='reply'||e.control!=='human')continue;const id=[e.t,e.phase,e.trial,e.actor].join('|');if(seen.has(id))continue;seen.add(id);const clips=clipsForScene(this.pack,{phase:e.phase,trial:e.trial,playerRole:recording.playerRole});let start=frame.t;for(const clip of clips){const end=start+(clip.end-clip.start)*1000;if(start<=timeMs&&timeMs<end)active={clips,index:clips.indexOf(clip),offset:(timeMs-start)/1000};start=end;}}}
  if(active){this.queue=active.clips;this.index=active.index;this.outcome='queued';this.begin(active.offset);}this.emit();
 }
}
