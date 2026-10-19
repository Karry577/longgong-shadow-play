// Real instrumental demo recordings, used under the creator's public-domain
// dedication and explicit demo-track remix permission. See assets/audio/SOURCES.md.
export const AUDIO_TRACKS=Object.freeze({
 quiet:{title:'（仿）南音板面',number:'2001',src:'./assets/audio/quiet.mp3',credit:'钢弦箏：李劲持 · 琵琶：汤凯媛 · 箫：陈志江',page:'https://hkmusicminiatures.com/2025/03/05/mm2001/'},
 opening:{title:'（仿）发报鼓',number:'1001',src:'./assets/audio/opening.mp3',credit:'单皮鼓：林叶',page:'https://hkmusicminiatures.com/2025/02/15/mm1001/'},
 entrance:{title:'（仿）入场锣鼓',number:'1004',src:'./assets/audio/entrance.mp3',credit:'单皮鼓、小锣：林叶 · 虎锣：龙乐欣 · 钹：戴日辉',page:'https://hkmusicminiatures.com/2025/03/06/mm1004/'},
 martial:{title:'威风',number:'1055',src:'./assets/audio/martial.mp3',credit:'卜鱼、低音沙的：郭启煇 · 钹：林叶 · 高边锣：龙乐欣',page:'https://hkmusicminiatures.com/2025/03/02/mm1055/'},
 celebration:{title:'喜庆',number:'3023',src:'./assets/audio/celebration.mp3',credit:'箏：李劲持 · 琵琶：汤凯媛 · 笛：陈志江 · 二胡：李家谦',page:'https://hkmusicminiatures.com/2025/03/22/mm3023/'}
});
export const MUSIC_LICENSE='https://hkmusicminiatures.com/public-domain-dedication-statement-with-copyright-guidelines/';
export function audioCueForEvent(event){
 if(!event)return null;
 if(event.type==='overture')return{track:'opening',seconds:6};
 if(event.type==='complete')return{track:'celebration',seconds:12};
 // Instrumental mode keeps one continuous bed. Rod motion, gripping, size changes
 // and replies do not restart a musical passage. Only curtain cues interrupt it.
 return null;
}
export function eventSignature(e){return[e.t,e.phase,e.trial,e.type,e.actor,e.control].join('|');}
const smooth=value=>{const t=Math.max(0,Math.min(1,value));return t*t*(3-2*t);};

/** Instrumental mode: quiet looping strings plus short event-triggered passages.
 * Source mode: only short curtain percussion; the original film owns its music.
 * The optional now() clock returns monotonic seconds for mixer envelopes only.
 * No audio starts before setEnabled(), which the host invokes from a gesture.
 * sync() never emits an event cue merely because the current scene is rendered.
 */
export class StageAudio{
 constructor({createAudio=()=>new Audio(),onStatus=()=>{},now=()=>performance.now()/1000}={}){
  this.makeAudio=createAudio;this.onStatus=onStatus;this.now=now;this.mixClock=0;this.mode='instrumental';this.vocalPriority=false;this.priorityGain=1;this.priorityFade=null;this.priorityReleaseAt=null;this.enabled=false;this.volume=.55;this.ducked=false;this.error='';this.bed=null;this.accent=null;this.active=false;this.sceneTime=0;this.lastPhase='';this.lastState='';this.tokens={bed:0,accent:0};this.accentLimit=0;this.accentOffset=0;this.accentIsFinal=false;this.seenCues=new Set();this.pendingBedSeek=null;
 }
 media(track,channel){const a=this.makeAudio();a.src=new URL(AUDIO_TRACKS[track].src,import.meta.url).href;a.preload='metadata';a.loop=channel==='bed';a.addEventListener('error',()=>{if((channel==='bed'?this.bed:this.accent)?.audio!==a)return;this.error='配乐未能载入，点戏乐按钮重试';this.emit();});a.addEventListener('playing',()=>this.emit());a.addEventListener('pause',()=>this.emit());a.addEventListener('ended',()=>this.emit());return a;}
 emit(){const s=this.getState(),key=JSON.stringify(s);if(key!==this.lastState){this.lastState=key;this.onStatus(s);}}
 getState(){const bedPlaying=!!this.bed&&!this.bed.audio.paused,accentPlaying=!!this.accent&&!this.accent.audio.paused,bedAudible=bedPlaying&&this.bed.audio.volume>.001,accentAudible=accentPlaying&&this.accent.audio.volume>.001;return{enabled:this.enabled,mode:this.mode,vocalPriority:this.vocalPriority,vocalReady:!this.enabled||!bedPlaying&&!accentPlaying||this.volume===0||this.vocalPriority&&this.priorityGain<=.001&&!bedAudible&&!accentAudible,bed:this.bed?.track||null,bedPlaying,bedAudible,accent:this.accent?.track||null,accentPlaying,accentAudible,error:this.error};}
 halt(channel){this.tokens[channel]++;const item=this[channel];if(item){item.wantsPlay=false;item.audio.pause();}}
 async play(item,channel){const token=++this.tokens[channel];item.wantsPlay=true;try{await item.audio.play();if(!item.wantsPlay||item!==this[channel]||!this.enabled)item.audio.pause();else if(token===this.tokens[channel])this.error='';}catch(e){if(token===this.tokens[channel]&&e?.name!=='AbortError')this.error=e?.name==='NotAllowedError'?'点“戏乐”即可启声':'配乐未能播放，点戏乐按钮重试';}this.emit();}
 seek(item,seconds){const a=item.audio,revision=(item.seekRevision||0)+1;item.seekRevision=revision;const apply=()=>{if(item.seekRevision===revision&&(item===this.bed||item===this.accent)&&Number.isFinite(a.duration)&&a.duration>0){try{a.currentTime=Math.max(0,seconds)%a.duration;}catch{}}};if(a.readyState>0)apply();else a.addEventListener('loadedmetadata',apply,{once:true});}
 setEnabled(value){if(this.error){this.release('bed');this.release('accent');this.pendingBedSeek=this.sceneTime;}this.enabled=!!value;this.error='';if(!this.enabled){this.halt('bed');this.halt('accent');}else if(this.active)this.sync({phase:this.lastPhase,elapsed:this.sceneTime},{active:true});this.emit();}
 setVolume(value){if(!Number.isFinite(value))return;this.volume=Math.max(0,Math.min(1,value));this.gains();}
 setDucked(value){this.ducked=!!value;this.gains();}
 setMode(mode){if(!['source','instrumental'].includes(mode))throw new Error('戏乐模式须为source或instrumental');if(mode===this.mode)return;this.mode=mode;this.halt('accent');if(mode==='source')this.halt('bed');if(this.active&&this.enabled)this.sync({phase:this.lastPhase,elapsed:this.sceneTime},{active:true});this.gains();this.emit();}
 clock(){const value=this.now();if(Number.isFinite(value))this.mixClock=Math.max(this.mixClock,value);return this.mixClock;}
 updatePriority(){const time=this.clock();if(this.priorityReleaseAt!==null&&time>=this.priorityReleaseAt){this.priorityFade={start:this.priorityReleaseAt,from:this.priorityGain,to:1,seconds:1};this.priorityReleaseAt=null;}const fade=this.priorityFade;if(fade){const progress=(time-fade.start)/fade.seconds;this.priorityGain=fade.from+(fade.to-fade.from)*smooth(progress);if(progress>=1){this.priorityGain=fade.to;this.priorityFade=null;}}}
 // Reserve the complete original-voice queue, including loading and rod waits.
 // Keep instrumental media running silently: no seek/restart follows a hand.
 setVocalPriority(value){const reserved=!!value;this.updatePriority();if(reserved===this.vocalPriority){this.gains();this.emit();return;}this.vocalPriority=reserved;this.priorityReleaseAt=null;this.priorityFade=null;if(reserved)this.priorityFade={start:this.mixClock,from:this.priorityGain,to:0,seconds:.24};else this.priorityReleaseAt=this.mixClock+.65;this.gains();this.emit();}
 gains(){this.updatePriority();const gain=this.priorityGain;if(this.bed)this.bed.audio.volume=this.volume*(this.mode==='source'?0:this.ducked ? .16 : this.accent&&!this.accent.audio.paused ? .25 : .44)*gain;if(this.accent){const t=this.accent.audio.currentTime-this.accentOffset,fadeIn=this.mode==='source'?.16:.08,fadeOut=this.mode==='source'?.45:.4,fade=Math.min(smooth(t/fadeIn),smooth((this.accentLimit-t)/fadeOut));this.accent.audio.volume=this.volume*(this.mode==='source'?.52:this.ducked ? .38 : .88)*fade*gain;}}
 // Ordinary rendering never assigns currentTime. Only an explicit seek/reset
 // changes the bed's position; a phase's clock is not the whole performance clock.
 sync(world,{active=false,seek=false,allowTail=false}={}){
  this.active=!!active;this.sceneTime=Number.isFinite(world.elapsed)?Math.max(0,world.elapsed):Number.isFinite(world.phaseElapsed)?Math.max(0,world.phaseElapsed):0;this.lastPhase=world.phase;
  if(seek){this.halt('accent');this.seenCues.clear();this.pendingBedSeek=this.sceneTime;if(this.bed){this.seek(this.bed,this.pendingBedSeek);this.pendingBedSeek=null;}}
  if(!this.enabled||!active){this.halt('bed');if(!allowTail||!this.enabled||world.phase!=='complete'||!this.accentIsFinal)this.halt('accent');this.gains();this.emit();return;}
  if(this.mode==='instrumental'){
   // vocalReady may permit original voice immediately while music is paused.
   // Never create/resurrect a bed underneath that admitted voice. A bed that
   // was already playing continues its silent clock through the fade instead.
   if(!this.bed&&!this.vocalPriority){this.bed={track:'quiet',audio:this.media('quiet','bed')};if(this.pendingBedSeek!==null){this.seek(this.bed,this.pendingBedSeek);this.pendingBedSeek=null;}}
   this.gains();if(this.bed?.audio.paused&&!this.error&&!this.vocalPriority)this.play(this.bed,'bed');
  }else this.halt('bed');
  if(this.accent&&this.accent.audio.currentTime-this.accentOffset>=this.accentLimit)this.halt('accent');this.gains();this.emit();
 }
 cue(event,{offset=0}={}){let cue=audioCueForEvent(event);if(cue&&this.mode==='source')cue=event.type==='overture'?{track:'opening',seconds:3}:{track:'entrance',seconds:3.8};if(!this.enabled||this.error||!cue||!Number.isFinite(offset)||offset>=cue.seconds)return false;const signature=eventSignature(event);if(this.seenCues.has(signature))return false;this.seenCues.add(signature);if(this.vocalPriority)return false;
  // Several successful actions can arrive within the same musical passage. Let
  // it finish instead of repeatedly resetting the same recording to its start.
  if(this.accent?.track===cue.track&&!this.accent.audio.paused&&this.accent.audio.currentTime-this.accentOffset<this.accentLimit)return false;
  this.release('accent');const item={track:cue.track,audio:this.media(cue.track,'accent')};this.accent=item;this.accentIsFinal=event.type==='complete';this.accentLimit=cue.seconds;this.accentOffset=0;this.seek(item,Math.max(0,offset));this.gains();this.play(item,'accent');return true;}
 tick(){if(this.accent&&this.accent.audio.currentTime-this.accentOffset>=this.accentLimit)this.halt('accent');this.gains();this.emit();}
 stop(){this.active=false;this.halt('bed');this.halt('accent');this.emit();}
 release(channel){this.halt(channel);const item=this[channel];if(item){item.audio.removeAttribute('src');item.audio.load();item.audio.remove?.();this[channel]=null;}}
 // Host calls this only for a new performance/recording or an explicit restart.
 // stop() is a reversible pause and deliberately preserves position/history.
 reset(world={}){this.stop();this.release('bed');this.release('accent');this.seenCues.clear();this.sceneTime=Number.isFinite(world.elapsed)?Math.max(0,world.elapsed):Number.isFinite(world.phaseElapsed)?Math.max(0,world.phaseElapsed):0;this.lastPhase=world.phase||'';this.pendingBedSeek=this.sceneTime;this.accentLimit=0;this.accentOffset=0;this.accentIsFinal=false;this.vocalPriority=false;this.priorityGain=1;this.priorityFade=null;this.priorityReleaseAt=null;this.error='';this.emit();}
 destroy(){this.stop();this.release('bed');this.release('accent');this.seenCues.clear();this.pendingBedSeek=null;}
}
