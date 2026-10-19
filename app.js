import {getHandles,canGrip} from './engine.js';
import {IdleRecordingGate} from './idle-recording.js?v=0.12.0';
import {getStageScene,markStageCue} from './scene-timeline.js?v=0.12.0';
import {StageInteraction,hasStageTimeline} from './stage-interaction.js?v=0.12.0';
import {createDuet,getPlayer,moveDuet,tickDuet,actionDuet,gripDuet,resizeDuet,getDuetView} from './duet.js?v=0.12.0';
import {createDuetRecording,captureDuet,sampleDuet,serializeDuet,parseDuet,truncateDuet,MAX_DURATION} from './duet-replay.js?v=0.12.0';
import {drawDuetTheatre,loadPuppetAtlas,drawPuppetPortrait} from './art.js?v=0.12.0';
import {loadCoachModel} from './coach-model.js';
import {snapshotSample,analyzeActionWindow,drawCoachOverlay} from './coach.js';
import {StageAudio,AUDIO_TRACKS,eventSignature} from './stage-audio.js?v=0.12.0';
import {getPerformanceScore,getCueForEvent,getScoreTimeline,getScoreCuesBetween} from './performance-score.js?v=0.4.0';
import {parseVocalPack,clipsForScene} from './vocal-pack.js?v=0.12.0';
import {VocalPlayer} from './vocal-player.js?v=0.12.0';
import {RodPerformance,readStageReplay} from './rod-performance.js?v=0.12.0';
import {getStageScript} from './stage-script.js?v=0.7.0';
import {appendVocalEvent} from './vocal-recording.js?v=0.7.0';
import {createEvidenceCoach} from './action-evidence.js?v=0.12.0';
import {PartnerTempo} from './partner-tempo.js?v=0.8.0';
import {BUILTIN_VOCALS,BUILTIN_VOCAL_URLS,MUSEUM_PAGE} from './builtin-vocals.js?v=0.12.0';

const $=id=>document.getElementById(id),canvas=$('stage'),ctx=canvas.getContext('2d');
const NAMES={wukong:'孙悟空',dragon:'东海龙王'},RODS={body:'身杆',left:'左手杆',right:'右手杆'};
const STORE='yiren-duet-saved-v1',AUTO='yiren-duet-current-v1';
let world=createDuet(),recording=createDuetRecording(world),selected='body',mode='perform',running=false,playing=false,started=false;
let cursor=0,recordOffset=0,lastFrame=performance.now(),lastCapture=-1,lastAuto=0,lastUI=0,backstage=false,guides=true,voice=false,model=null,pointer=null,toastTimer;
let observations=[],feedback=null,lastObservation=0,lastCoach=0,autoFailed=false,dirty=false,lastPhase='',focusUntil=0;
let seenAudioEvents=new Set(),replayAudioCursor=0,lyricKey='',lyricsVisible=true,speechEpoch=0;
const rods=[...document.querySelectorAll('[data-rod]')];
const music=new StageAudio({createAudio:()=>{const a=document.createElement('audio');a.hidden=true;a.dataset.stageAudio='true';$('stage-media').append(a);return a;},onStatus:s=>{
 const audible=s.bedAudible||s.accentAudible;
 $('music-toggle').textContent=s.error?'点此启声':`戏乐：${s.enabled?'开':'关'}`;
 $('music-toggle').setAttribute('aria-pressed',s.enabled);
 $('music-status').textContent=s.error||(s.vocalPriority?'原场唱白与原片伴奏 · 独立器乐让位':s.mode==='source'?(s.accentAudible?'短锣鼓过门 · 柔和起收':'原场声场 · 接唱时保留原片伴奏'):audible?(s.accentAudible?AUDIO_TRACKS[s.accent].title:AUDIO_TRACKS.quiet.title)+' · 连续器乐':'配乐随开戏与暂停启停');
 $('music-status').classList.toggle('sounding',audible);
}});
music.setMode('source');
const idleGate=new IdleRecordingGate();
let idleWake=false,replayVocalRunning=false;
function wakeRecording(){idleWake=true;}
function voiceCanStart(){return music.getState().vocalReady;}

let vocalUrls=[],vocalPack=null,pendingVocalAction=null,vocalGateState=null,vocalAnchorKey='',vocalAnchorAt=-Infinity,replayVocalKey='',replayHasVocalAnchors=false;
const partnerTempo=new PartnerTempo(),evidenceCoach=createEvidenceCoach();
const director=new RodPerformance({tempo:partnerTempo});
const stageInteraction=new StageInteraction();
let stageTimelineEnabled=true;
function currentScene(){return getStageScene(world,{media:vocals.state,legacy:!stageTimelineEnabled});}
function stageCue(cue){return world.events.some(e=>e.type===`stage_${cue}`&&e.phase===world.phase&&e.trial===world.trial);}
function trialVocalBeat(){const split=stageTimelineEnabled&&world.phase==='trial'&&vocalPack?.clips.some(c=>c.section==='trial'&&(c.trial??0)===world.trial&&['call','response'].includes(c.beat));return split?(world.trial===0&&!stageCue('weapon_called')?'call':'response'):undefined;}
function sceneVocalClips(scene=world){return clipsForScene(vocalPack,scene,{beat:trialVocalBeat()});}
function updateStageInteraction(dt){const before=stageCue('weapon_tried'),placedBefore=stageCue('weapon_placed');stageInteraction.update(world,currentScene(),dt,{legacy:!stageTimelineEnabled});if(!before&&stageCue('weapon_tried')&&pendingVocalAction){director.done=false;director.key='';director.humanReturned=false;}if(before!==stageCue('weapon_tried')||placedBefore!==stageCue('weapon_placed'))capture(true);}
let lastInputRod=null,lastInputAt=null;
let stageAnchorKey='',stageAnchorAt=-Infinity;
const vocals=new VocalPlayer({createAudio:()=>{const a=document.createElement(vocalPack?.mode==='remote-reference'?'video':'audio');a.hidden=a.tagName==='AUDIO';a.playsInline=true;a.dataset.vocalVoice='true';a.setAttribute('aria-label','皮影原场声画对照');$('vocal-media').replaceChildren(a);return a;},onState:s=>{music.setVocalPriority(s.busy&&s.enabled);$('vocal-status').textContent=s.error||(s.loading?'原场片段载入中…':s.clip&&!s.playing&&!voiceCanStart()?'过门渐收，原场准备接声…':s.clip?`${NAMES[s.clip.role]} · ${s.clip.kind||'真人接唱'} · ${Math.floor(s.offset)} / ${Math.ceil(s.clip.end-s.clip.start)}秒`:s.loaded?world.phase==='complete'?'原场唱白已收锣':`${vocalPack?.clips.length||0}段真人原声就绪 · 到位后接戏`:'原声已关闭');$('vocal-now').textContent=s.line?.text||'';$('vocal-resume').hidden=!s.busy||s.playing||mode==='replay'&&!s.error;$('vocal-toggle').hidden=!s.loaded;$('vocal-skip').hidden=!s.busy;$('vocal-toggle').textContent=s.enabled?'原声：开':'原声：关';$('vocal-toggle').setAttribute('aria-pressed',s.enabled);$('vocal-reference').hidden=vocalPack?.mode!=='remote-reference'||!s.clip;}});
function clearVocalAction(){pendingVocalAction=null;vocalGateState=null;director.reset();vocalAnchorKey='';vocalAnchorAt=-Infinity;stageAnchorKey='';stageAnchorAt=-Infinity;}
function activePerformance(){return mode==='replay'?readStageReplay(world):stageInteraction.state|| (pendingVocalAction?director.state:null);}
function currentGoal(){const p=activePerformance();return p?.active||p?.returning?p.goal||null:getDuetView(world).goal;}
function captureStageClock(force=false){if(mode!=='perform'||!started)return;const p=director.state;if(!pendingVocalAction||!p?.line||p.recorded){if(stageAnchorKey){vocalEvent('stage_stop');stageAnchorKey='';capture(true);}return;}const flag=running&&!p.waiting?'r':'p',key=`${p.line.id}_${flag}`;if(force||key!==stageAnchorKey||flag==='r'&&world.elapsed-stageAnchorAt>=2){vocalEvent(`stage_at_${p.line.id}_${Math.round(p.offset*1000)}_${flag}`,p.line);stageAnchorKey=key;stageAnchorAt=world.elapsed;capture(true);}}
function vocalEvent(type,clip){appendVocalEvent(world,type,clip);}
function captureVocalClock(force=false){if(mode!=='perform'||!started)return;const s=vocals.state,a=vocals.audio;if(!s.clip){if(vocalAnchorKey){vocalEvent('vocal_stop');vocalAnchorKey='';capture(true);}return;}if(!a||a.readyState<1||a.currentTime<s.clip.start-.05||!/^[a-z0-9]+$/.test(s.clip.id))return;const flag=!a.paused&&a.readyState>=3&&!a.seeking?'r':'p',key=`${s.clip.id}_${flag}`;if(force||key!==vocalAnchorKey||flag==='r'&&world.elapsed-vocalAnchorAt>=2){vocalEvent(`vocal_at_${s.clip.id}_${Math.round(s.offset*1000)}_${flag}`,s.clip);vocalAnchorKey=key;vocalAnchorAt=world.elapsed;capture(true);}}
function useBuiltinVocals(){clearVocalAction();vocalPack=BUILTIN_VOCALS;vocals.setPack(vocalPack,BUILTIN_VOCAL_URLS);vocalUrls.forEach(u=>URL.revokeObjectURL(u));vocalUrls=[];lyricKey='';$('vocal-remove').hidden=true;$('vocal-pack-note').textContent='六场接演均选取唐山皮影《龙宫借宝》真人原场唱白，按原戏顺序接入；取消无录音的新编对白。字幕为机器识别＋剧情初校，疑字保留，尚未人工听校。保留原声原画，当前为私有教学对照。';renderVocalSources();}
function renderVocalSources(){const list=$('vocal-scene-list');if(!list)return;const titles={arrival:'访宫',request:'借器',trial:'试器',guide:'寻铁',staff:'得棒',farewell:'辞宫'};list.replaceChildren(...vocalPack.clips.map(clip=>{const item=document.createElement('li'),name=document.createElement('b'),detail=document.createElement('span');name.textContent=`${titles[clip.section]||clip.section}${clip.section==='trial'?`·${clip.trial+1}`:''} · ${NAMES[clip.role]} · ${clip.title||clip.kind}`;detail.textContent=`原片 ${formatTime(clip.start*1000)}–${formatTime(clip.end*1000)} · ${clip.kind} · ${clip.lines.length}句`;item.append(name,detail);return item;}));}
function hasVocalAnchors(rec){return rec.frames.some(f=>f.world.events.some(e=>e.type.startsWith('vocal_at_')));}
function followReplayVocals(){if(!replayHasVocalAnchors)return;const e=[...world.events].reverse().find(e=>e.type==='vocal_stop'||e.type.startsWith('vocal_at_'));if(!e)return;const signature=`${e.t}|${e.type}`;if(signature===replayVocalKey){if(replayVocalRunning&&playing&&vocals.busy&&!vocals.error&&!vocals.state.playing&&voiceCanStart())vocals.resume();return;}replayVocalKey=signature;replayVocalRunning=false;if(e.type==='vocal_stop'){replayVocalRunning=false;vocals.stop();return;}const m=/^vocal_at_([a-z0-9]+)_(\d+)_([rp])$/.exec(e.type);if(!m)return;const clip=vocalPack&&[...vocalPack.clips,...(vocalPack.legacyClips||[])].find(c=>c.id===m[1]&&c.role===e.actor&&c.section===e.phase&&c.trial===e.trial);if(!clip){vocals.stop();return;}const offset=Number(m[2])/1000+(m[3]==='r'?Math.max(0,world.elapsed-e.t):0);if(offset>=clip.end-clip.start){vocals.pause();return;}if(vocals.state.clip?.id!==clip.id)vocals.seek(recording,cursor);else if(vocals.audio?.readyState>0&&Math.abs(vocals.state.offset-offset)>.7)vocals.seekWithinClip(offset);replayVocalRunning=m[3]==='r';if(!replayVocalRunning)vocals.pause();else if(playing&&voiceCanStart())vocals.resume();}
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,3800);}
function clearReference(){const frame=$('original-player');frame.src='about:blank';frame.hidden=true;$('load-original').hidden=false;}
function stopPreviews(){document.querySelectorAll('[data-audio-preview]').forEach(a=>a.pause());clearReference();}
function stopSpeech(){speechEpoch++;window.speechSynthesis?.cancel();music.setDucked(false);}
function resetAudioEvents(){replayVocalRunning=false;seenAudioEvents=new Set(world.events.map(eventSignature));replayAudioCursor=cursor;replayVocalKey='';}
function pause(reason='user'){idleGate.reset(world);idleWake=false;running=false;playing=false;pointer=null;captureStageClock(true);if(reason!=='complete'){music.stop();vocals.pause();stopSpeech();stopPreviews();resetAudioEvents();}}
function dialog(id){pause();$(id).showModal();renderUI();}
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
document.querySelectorAll('dialog').forEach(d=>d.addEventListener('cancel',()=>{if(!started&&d.id==='role-dialog')toast('选一位影人即可开戏');}));
document.querySelectorAll('dialog').forEach(d=>d.addEventListener('close',()=>{if(d.id==='music-dialog')stopPreviews();}));
function select(rod){selected=rod;rods.forEach(b=>{b.classList.toggle('selected',b.dataset.rod===rod);b.setAttribute('aria-pressed',b.dataset.rod===rod);});}
rods.forEach(b=>b.onclick=()=>{select(b.dataset.rod);canvas.focus({preventScroll:true});});
function capture(force=false){if(mode!=='perform'||!started)return true;const t=Math.min(MAX_DURATION,Math.max(recording.duration,Math.round(world.elapsed*1000-recordOffset)));if(force||t-lastCapture>=150){try{captureDuet(recording,world,t);lastCapture=t;dirty=true;}catch(e){pause();toast(e.message);return false;}}cursor=t;return true;}
function observe(now=performance.now()){if(mode!=='perform')return;observations.push(snapshotSample(getPlayer(world),now));observations=observations.filter(s=>s.t>=now-1200);lastObservation=now;}
function resetCoach(){lastObservation=performance.now();observations=[snapshotSample(getPlayer(world),lastObservation)];feedback=null;lastCoach=0;lastInputRod=null;lastInputAt=null;evidenceCoach.reset();}
function start(role){if(started&&recording.duration>0){capture(true);try{localStorage.setItem(AUTO,serializeDuet(recording));}catch{toast('上一场未能自动留存，请及时导出备份');}}music.stop();clearVocalAction();vocals.reset();stopSpeech();world=createDuet(role);idleGate.reset(world);idleWake=true;stageTimelineEnabled=true;stageInteraction.reset();markStageCue(world,'opening');partnerTempo.reset();music.reset(world);world.events.push({t:0,phase:'arrival',trial:0,type:'overture',actor:'system',control:'system'});recording=createDuetRecording(world);cursor=0;recordOffset=0;lastCapture=-1;mode='perform';running=true;playing=false;started=true;dirty=false;lastPhase='';seenAudioEvents=new Set();replayAudioCursor=0;select('body');resetCoach();$('role-dialog').close();music.setEnabled($('music-start').checked);dispatchLiveAudio();toast(`你演${NAMES[role]}，${NAMES[world.ai.actor]}与你接戏`);renderUI();canvas.focus({preventScroll:true});}
document.querySelectorAll('[data-role]').forEach(b=>b.onclick=()=>start(b.dataset.role));
$('roles').onclick=$('new-show').onclick=()=>dialog('role-dialog');
$('character').onclick=()=>{drawPuppetPortrait($('study-wukong').getContext('2d'),'wukong');dialog('character-dialog');};
$('help').onclick=()=>dialog('help-dialog');$('model-info').onclick=()=>dialog('model-dialog');
$('backstage').onclick=()=>{backstage=!backstage;$('backstage').textContent=backstage?'回到灯下影人':'看分件关节';$('backstage').setAttribute('aria-pressed',backstage);};
$('guides').onclick=()=>{guides=!guides;$('guides').textContent=guides?'引导开':'引导关';$('guides').setAttribute('aria-pressed',guides);};
$('voice').onclick=()=>{voice=!voice;$('voice').textContent=voice?'念白：开':'念白：关';$('voice').setAttribute('aria-pressed',voice);if(!voice)stopSpeech();else toast('接话时朗读新编词句；合成念白，并非戏曲实唱');};
$('music-toggle').onclick=()=>{music.setEnabled(music.error||!music.enabled);$('music-start').checked=music.enabled;renderUI();};
$('music-info').onclick=()=>dialog('music-dialog');
document.querySelectorAll('[name=music-mode]').forEach(input=>input.addEventListener('change',()=>{if(input.checked){music.setMode(input.value);$('music-mode-note').textContent=input.value==='source'?'保留原片自带伴奏，只加短锣鼓；避免两套旋律叠在一起。':'独立器乐连续铺底；原声整段接入时平滑让位，换角停等也不弹回。';renderUI();}}));
$('vocal-info').onclick=()=>dialog('vocal-dialog');
$('vocal-toggle').onclick=()=>{vocals.setEnabled(!vocals.enabled);if(!vocals.enabled){vocals.stop();captureVocalClock(true);clearVocalAction();resetCoach();toast('原声已关闭；可练习操杆，打开原声后再接戏');}else if(running&&!vocalGateState?.waiting&&voiceCanStart()){wakeRecording();vocals.resume();}renderUI();};
$('vocal-resume').onclick=()=>{if(!(mode==='perform'&&running||mode==='replay'&&playing)){toast('先继续操演或回放，再接原声');return;}if(vocals.error){wakeRecording();vocals.retry({manualStart:mode==='replay'||!!pendingVocalAction||!voiceCanStart()});return;}if(vocalGateState?.waiting){toast(vocalGateState.reason);return;}wakeRecording();if(!voiceCanStart()){toast('过门正渐收，稍候接原声');return;}vocals.resume();};
$('vocal-default').onclick=()=>{pause();useBuiltinVocals();renderUI();toast('已恢复默认两角原场声音，继续操演即可接戏');};
$('vocal-skip').onclick=()=>{vocals.stop();captureVocalClock(true);clearVocalAction();resetCoach();toast('本轮接戏已取消，场次保留；重新到位后可再接原声');renderUI();};
$('vocal-files').onchange=async e=>{const files=[...e.target.files];e.target.value='';const nextUrls=[];try{
 const manifest=files.filter(f=>f.name.toLowerCase().endsWith('.json'));if(manifest.length!==1)throw new Error('同时选择1个唱腔JSON清单和对应录音文件');if(manifest[0].size>256*1024)throw new Error('唱词清单超过256KiB');
 if(files.reduce((sum,f)=>sum+f.size,0)>100*1024*1024)throw new Error('一次录音包最多100MiB');if(new Set(files.map(f=>f.name)).size!==files.length)throw new Error('文件名重复');const pack=parseVocalPack(await manifest[0].text()),urls={};
 for(const name of new Set(pack.clips.map(c=>c.file))){const file=files.find(f=>f.name===name);if(!file)throw new Error(`缺少录音：${name}`);const url=URL.createObjectURL(file);nextUrls.push(url);urls[name]=url;
  await new Promise((resolve,reject)=>{const a=new Audio(),timer=setTimeout(()=>done(new Error(`录音读取超时：${name}`)),10000);function done(error){clearTimeout(timer);a.onloadedmetadata=a.onerror=null;a.removeAttribute('src');a.load();error?reject(error):resolve();}a.onloadedmetadata=()=>{const end=Math.max(...pack.clips.filter(c=>c.file===name).map(c=>c.end));done(!Number.isFinite(a.duration)||a.duration+.05<end?new Error(`词轴超过录音长度：${name}`):null);};a.onerror=()=>done(new Error(`无法解码录音：${name}`));a.src=url;});
 }
 pause();clearVocalAction();vocals.setPack(pack,urls);vocalUrls.forEach(url=>URL.revokeObjectURL(url));vocalUrls=nextUrls;vocalPack=pack;voice=false;$('voice').textContent='念白：关';$('voice').setAttribute('aria-pressed',false);lyricKey='';renderVocalSources();$('vocal-pack-note').textContent=`已装载：${pack.title} · ${pack.tradition} · ${pack.performer}。许可由资料包提供者声明，尚未经过本作人工核验。`;$('vocal-remove').hidden=false;toast('真人录音与词轴已装载；继续操演后，身段到位再接唱');renderUI();
 }catch(error){nextUrls.forEach(url=>URL.revokeObjectURL(url));toast(error.message);}};
$('vocal-remove').onclick=()=>{pause();useBuiltinVocals();renderUI();};
$('music-start').onchange=e=>{music.setEnabled(e.target.checked);};
$('music-volume').oninput=e=>{music.setVolume(Number(e.target.value)/100);$('volume-value').textContent=`${e.target.value}%`;};
$('lyrics-toggle').onclick=()=>{lyricsVisible=!lyricsVisible;$('lyrics-toggle').textContent=lyricsVisible?'收起唱词':'展开唱词';$('lyrics-toggle').setAttribute('aria-expanded',lyricsVisible);$('lyrics-body').hidden=!lyricsVisible;};
document.querySelectorAll('[data-audio-preview]').forEach(a=>a.addEventListener('play',()=>{music.stop();stopSpeech();clearReference();document.querySelectorAll('[data-audio-preview]').forEach(b=>{if(a!==b)b.pause();});}));
$('load-original').onclick=()=>{music.stop();stopSpeech();document.querySelectorAll('[data-audio-preview]').forEach(a=>a.pause());$('original-player').src='https://cdnapisec.kaltura.com/p/518251/embedPlaykitJs/uiconf_id/52424842?iframeembed=true&entry_id=1_u6ejeoar';$('original-player').hidden=false;$('load-original').hidden=true;};
function utterance(lines,role,epoch,onStart){const u=new SpeechSynthesisUtterance(lines.map(x=>x.text).join('，'));u.lang='zh-CN';u.rate=.8;u.pitch=role==='wukong'?1.12:.8;u.onstart=()=>{if(epoch===speechEpoch){music.setDucked(true);onStart?.();}};u.onend=u.onerror=()=>{if(epoch===speechEpoch)music.setDucked(false);};return u;}
function speakPair(score,context){if(!voice||!window.speechSynthesis)return;stopSpeech();const epoch=speechEpoch,human=score.lines.filter(x=>x.role===context.playerRole),other=score.lines.filter(x=>x.role!==context.playerRole);if(human.length)speechSynthesis.speak(utterance(human,context.playerRole,epoch));if(other.length)speechSynthesis.speak(utterance(other,context.aiRole,epoch,()=>{if(mode==='perform'&&epoch===speechEpoch){world.events.push({t:world.elapsed,phase:context.phase,trial:context.trial,type:'ai_reply',actor:context.aiRole,control:'ai'});if(world.events.length>80)world.events.shift();capture(true);}}));}
document.querySelectorAll('[data-recite]').forEach(b=>b.onclick=()=>{if(!window.speechSynthesis){toast('此浏览器未提供中文合成念白，可直接照词开口');return;}stopSpeech();const role=b.dataset.recite,lines=getPerformanceScore(world).lines.filter(x=>x.role===role);if(lines.length)speechSynthesis.speak(utterance(lines,role,speechEpoch));});
function dispatchLiveAudio(){const fresh=world.events.filter(e=>!seenAudioEvents.has(eventSignature(e)));for(const e of fresh){seenAudioEvents.add(eventSignature(e));if(e.type==='reply'&&fresh.some(x=>x.t===e.t&&x.phase===e.phase&&x.actor===e.actor&&['invite_staff','farewell'].includes(x.type)))continue;music.cue(e);}}
function renderScore(){const live=vocals.state,p=activePerformance(),raw=!!vocalPack?.audioOnly||!!live.clip&&(!p||p.recorded),score=getPerformanceScore(world),recorded=raw?(live.busy?vocals.queue:sceneVocalClips()):[],key=`${score.key}:${world.playerRole}:${raw?'recorded':'script'}:${recorded.map(c=>c.id).join(',')}:${vocalPack?.title||''}`;
 $('voice').disabled=!!vocalPack;$('voice').hidden=!!vocalPack;document.querySelectorAll('[data-recite]').forEach(b=>b.hidden=!!vocalPack);
 if(key!==lyricKey){lyricKey=key;$('score-title').textContent=`${getDuetView(world).title} · ${raw?'原场接演':'双角接演'}`;$('score-kind').textContent=raw?'真人原场唱白 · 字幕初校':'本地台本';for(const role of ['wukong','dragon']){const clips=recorded.filter(c=>c.role===role),lines=raw?clips.flatMap(c=>c.lines):getStageScript(world).lines.filter(x=>x.role===role);$(`lyric-${role}`).replaceChildren(...(lines.length?lines:[{text:world.phase==='complete'?'本折原声已演完':'本轮以身段应戏'}]).map(line=>{const el=document.createElement('p');el.textContent=line.text;return el;}));$(`lyric-card-${role}`).classList.toggle('your-lines',role===world.playerRole);$(`lyric-label-${role}`).textContent=`${NAMES[role]} · ${clips.length?`${clips.length}段原声`:role===world.playerRole?'你来演':'AI接演'}`;}$('score-complete').hidden=world.phase!=='complete';}
 const text=raw?live.line?.text:p?.line?.text;
 document.querySelectorAll('.lyric-card p').forEach(el=>el.classList.toggle('singing',!!text&&el.textContent===text));
 $('vocal-gate').textContent=live.error?'当前场次保留；点“继续原声”重试。':mode==='replay'&&p?.line?`${p.title} · 保存的${NAMES[p.role]}身段${p.waiting?' · 停等':' · 演出中'}`:p?.returning?p.reason:p?.active?`${p.title} · ${p.waiting?p.reason:p.human?p.poseWaiting&&p.gateMode==='turn'?'原声连续，跟随新光圈调整':'身段已稳，接住这一句':'AI正按手杆接演'}`:mode==='replay'&&live.clip?'原声跟随已保存的动作时轴':raw&&!vocals.enabled?'打开原声后接戏；关声时可自由练杆。':raw?world.phase==='complete'?'全折原场唱白已演完':`${recorded.length}段真人原声 · 先完成身段，再按空格接戏`:'';
 $('score-caption').textContent=live.error||(raw&&vocalPack!==BUILTIN_VOCALS&&!vocalPack?.clips.every(c=>c.gateMode==='turn')?'本地包按各段gateMode接演：未声明时逐句等候；字幕跟随实际音轨。':raw?'全折对白随原片选段调整：唱段、念白按原场标明。〔？〕为疑字；字幕与句界尚待听校。整段开口前停稳，段内连续唱白并提示新身段；换角交戏时重新等候。':'本地资料包按其词轴接演。');
}
function ensureMove(){if(!started){dialog('role-dialog');return false;}if(mode!=='perform'){toast('先点“从此接演”，再操杆');return false;}if(!running){toast('操演暂停，点“继续操演”后调杆');return false;}wakeRecording();return world.phase!=='complete';}
function nudge(dx,dy){if(!ensureMove())return;moveDuet(world,selected,dx,dy);lastInputRod=selected;lastInputAt=performance.now();observe(lastInputAt);capture(true);renderUI();}
function action(){if(!ensureMove())return;const stage=currentScene();if(stage.blocked){toast(stage.blockingReason);return;}if(stageInteraction.state){toast(stageInteraction.state.reason);return;}if(pendingVocalAction){if(director.advance()){captureStageClock(true);renderUI();}else toast(director.state?.reason||'这一句尚未停稳');return;}if(vocals.enabled&&vocals.busy){toast('原声正在接戏');return;}const v=getDuetView(world);if(!v.actionEnabled){toast(v.objective);return;}
 if(vocalPack?.audioOnly&&world.playerRole==='dragon'&&world.phase==='staff'&&!world.flags.staffInvited){if(actionDuet(world)){resetCoach();capture(true);renderUI();}return;}
 if(!trialVocalBeat()&&stageTimelineEnabled&&world.phase==='trial'&&world.trial===0&&stageCue('weapon_called')&&stageCue('weapon_tried')){if(actionDuet(world)){resetCoach();capture(true);renderUI();}return;}
 const scene={...world,flags:{...world.flags}},id=`${world.elapsed}|${world.phase}|${world.trial}`;
 const beat=trialVocalBeat();
 const recorded=!!(vocals.enabled&&vocalPack&&sceneVocalClips(scene).length);
 if(vocalPack?.audioOnly&&!recorded){toast(vocals.enabled?'本轮没有可用原声，场次保留。':'先打开原声，再接这一场。');return;}
 if(recorded&&!vocals.cue(scene,id,{manualStart:true,beat})){toast('原声队列未能建立，场次保留，请重试。');return;}
 pendingVocalAction={phase:world.phase,trial:world.trial,id,beat};director.begin(world,{recorded,recordedOnly:!!vocalPack?.audioOnly});
 vocalGateState=director.update(world,0,vocals.state);captureStageClock(true);capture(true);renderUI();}
function observePartnerTempo(dt){const p=activePerformance(),g=currentGoal(),v=getDuetView(world);partnerTempo.observe(world,dt,{goalId:p?.line?`${p.recorded?'v':'s'}:${p.line.id}:${p.cueIndex}`:p?.returning?`return:${g?.rod}`:`scene:${world.phase}:${world.trial}:${g?.rod||'task'}`,human:!pendingVocalAction||!!p?.human,ready:p?!p.poseWaiting&&p.ready:v.progress>=1,active:running&&mode==='perform'&&!!g});}
function updateVocalAction(dt){if(!pendingVocalAction)return;
 const legacyTrial=stageTimelineEnabled&&world.phase==='trial'&&world.trial===0&&!pendingVocalAction.beat;
 if(legacyTrial&&director.mediaComplete){if(markStageCue(world,'weapon_called'))capture(true);if(!stageCue('weapon_tried'))return;}
 if(stageInteraction.state)return;
 vocalGateState=director.update(world,dt,vocals.state);
 // The take-command is a separate turn. Its successful end admits the
 // carriers, then real rod testing admits Wukong's recorded response.
 if(stageTimelineEnabled&&world.phase==='trial'&&world.trial===0&&pendingVocalAction.beat==='call'&&(director.mediaComplete||director.done&&!vocalPack?.audioOnly)){
   markStageCue(world,'weapon_called');captureVocalClock(true);captureStageClock(true);vocalEvent('stage_stop');clearVocalAction();resetCoach();capture(true);renderUI();return;
 }
 if(director.recorded&&vocals.busy&&vocals.enabled){if(vocalGateState?.waiting){if(vocals.state.playing)vocals.pause();}else if(!vocals.state.playing&&!vocals.error&&voiceCanStart())vocals.resume();}
 if(legacyTrial&&(director.mediaComplete||director.done&&!vocalPack?.audioOnly)){if(markStageCue(world,'weapon_called'))capture(true);if(!stageCue('weapon_tried'))return;}
 if(director.done&&!currentScene().blocked){captureVocalClock(true);captureStageClock(true);vocalEvent('stage_stop');if(actionDuet(world)){clearVocalAction();resetCoach();capture(true);renderUI();}}
}

$('action').onclick=action;
$('grip').onclick=()=>{if(ensureMove()&&gripDuet(world)){capture(true);resetCoach();renderUI();}};
function resize(direction){if(ensureMove()&&resizeDuet(world,direction)){capture(true);resetCoach();renderUI();}}
$('smaller').onclick=()=>resize(-1);$('larger').onclick=()=>resize(1);
document.querySelectorAll('[data-nudge]').forEach(b=>b.onclick=()=>nudge(...b.dataset.nudge.split(',').map(Number)));
function stagePoint(e){const r=canvas.getBoundingClientRect();return{x:(e.clientX-r.left)*1280/r.width,y:(e.clientY-r.top)*720/r.height};}
canvas.addEventListener('pointerdown',e=>{if(!ensureMove())return;const p=stagePoint(e),h=getHandles(getPlayer(world));const nearest=Object.keys(h).sort((a,b)=>Math.hypot(p.x-h[a].x,p.y-h[a].y)-Math.hypot(p.x-h[b].x,p.y-h[b].y))[0];if(Math.hypot(p.x-h[nearest].x,p.y-h[nearest].y)>65){toast('请抓住幕面下方“身 / 左 / 右”圆柄');return;}select(nearest);pointer={id:e.pointerId,...p};canvas.setPointerCapture(e.pointerId);canvas.focus({preventScroll:true});e.preventDefault();});
canvas.addEventListener('pointermove',e=>{if(!pointer||pointer.id!==e.pointerId||!running)return;const p=stagePoint(e);moveDuet(world,selected,p.x-pointer.x,p.y-pointer.y);lastInputRod=selected;lastInputAt=performance.now();pointer={id:e.pointerId,...p};observe();capture();e.preventDefault();});
for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,()=>{if(pointer){pointer=null;capture(true);renderUI();}});
document.addEventListener('keydown',e=>{if(document.querySelector('dialog[open]')||/^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(e.target.tagName))return;const dirs={ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0]};if(['1','2','3'].includes(e.key)){select(['body','left','right'][+e.key-1]);e.preventDefault();}else if(dirs[e.key]){const step=e.altKey?2:e.shiftKey?24:10;nudge(...dirs[e.key].map(n=>n*step));e.preventDefault();}else if(e.key===' '){e.preventDefault();if(!e.repeat)action();}else if(e.key.toLowerCase()==='g'){e.preventDefault();$('grip').click();}});
$('focus').onclick=()=>{const g=currentGoal(),rod=feedback?.hand||g?.rod;if(rod){select(rod);focusUntil=performance.now()+4000;canvas.focus({preventScroll:true});}};
$('record').onclick=()=>{if(!started){dialog('role-dialog');return;}if(mode==='replay'){toast('回放中，点“从此接演”恢复操演');return;}if(world.phase==='complete'){toast('这场已落幕，可回看、保存或换角重演');return;}if(running){capture(true);pause();}else{running=true;idleGate.reset(world);wakeRecording();if((!pendingVocalAction||!vocalGateState?.waiting)&&voiceCanStart())vocals.resume();}resetCoach();renderUI();};
function enterReplay(t=0){if(!capture(true))return;pause();clearVocalAction();replayHasVocalAnchors=hasVocalAnchors(recording);mode='replay';stageTimelineEnabled=hasStageTimeline(recording);stageInteraction.reset();partnerTempo.reset();cursor=Math.max(0,Math.min(t,recording.duration));world=sampleDuet(recording,cursor);resetAudioEvents();music.sync(world,{active:false,seek:true});vocals.seek(recording,cursor);resetCoach();renderUI();}
$('play').onclick=()=>{if(recording.duration<1){toast('先操演一小段，再回看');return;}if(mode!=='replay')enterReplay(0);if(cursor>=recording.duration){music.stop();vocals.seek(recording,0);stopSpeech();cursor=0;world=sampleDuet(recording,0);music.sync(world,{active:false,seek:true});}playing=!playing;replayAudioCursor=cursor;if(!playing){music.stop();vocals.pause();stopSpeech();}else{if(replayHasVocalAnchors){replayVocalKey='';followReplayVocals();}else vocals.resume();}if(playing&&cursor===0)for(const cue of getScoreCuesBetween(recording,-1,0))music.cue(cue.sourceEvent);renderUI();};
$('timeline').oninput=e=>{enterReplay(Number(e.target.value));};
$('continue').onclick=()=>{music.stop();vocals.stop();clearVocalAction();stopSpeech();recording=truncateDuet(recording,cursor);world=sampleDuet(recording,cursor);recordOffset=world.elapsed*1000-cursor;lastCapture=cursor;mode='perform';idleGate.reset(world);wakeRecording();stageTimelineEnabled=hasStageTimeline(recording);stageInteraction.reset();partnerTempo.reset();running=world.phase!=='complete';playing=false;dirty=true;vocalEvent('stage_stop');vocalEvent('vocal_stop');capture(true);resetAudioEvents();resetCoach();renderUI();};
const stamp=()=>new Date().toLocaleString('zh-CN',{hour12:false});
function readSaved(){try{const rows=JSON.parse(localStorage.getItem(STORE)||'[]');return Array.isArray(rows)?rows.slice(0,5):[];}catch{return [];}}
function save(){if(!capture(true))return;if(recording.duration<1){toast('先留下几下操杆，再保存');return;}try{const text=serializeDuet(recording),rows=readSaved();rows.unshift({date:stamp(),role:recording.playerRole,duration:recording.duration,text});localStorage.setItem(STORE,JSON.stringify(rows.slice(0,3)));toast('已收进本机戏匣，也可导出备份');}catch{toast('本机空间不足，请点“导出”保存文件');}}
$('save').onclick=$('completion-save').onclick=save;
function download(){if(!capture(true))return;try{const blob=new Blob([serializeDuet(recording)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`龙宫得宝-${NAMES[recording.playerRole]}-${Date.now()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);}catch(e){toast(e.message);}}
$('download').onclick=download;
$('import').onclick=()=>{pause();$('file').click();renderUI();};
function loadRecord(rec){pause();clearVocalAction();vocals.reset();recording=rec;replayHasVocalAnchors=hasVocalAnchors(rec);started=true;mode='replay';stageTimelineEnabled=hasStageTimeline(rec);stageInteraction.reset();partnerTempo.reset();cursor=0;world=sampleDuet(rec,0);idleGate.reset(world);music.reset(world);music.sync(world,{active:false,seek:true});lastCapture=0;resetAudioEvents();resetCoach();renderUI();toast('合演已打开，点回看或拖时间轴');}
$('file').onchange=async e=>{const f=e.target.files[0];e.target.value='';if(!f)return;try{if(f.size>8*1024*1024)throw new Error('文件超过8 MiB');const text=await f.text();if(text.includes('yiren-shadow-play')&&!text.includes('yiren-duet-recording'))throw new Error('这是旧版单人录制，请从戏匣进入“旧版单人录制”查看');loadRecord(parseDuet(text));}catch(error){toast(error.message);}};
$('archive').onclick=()=>{const list=$('archive-list');list.replaceChildren();const rows=readSaved();let current;try{current=localStorage.getItem(AUTO);}catch{}if(current)rows.unshift({date:'最近自动留存',text:current});if(!rows.length){const p=document.createElement('p');p.textContent='戏匣还空着。操演后点“保存合演”。';list.append(p);}for(const row of rows){const b=document.createElement('button'),span=document.createElement('span'),small=document.createElement('small');span.textContent=row.date;small.textContent=row.role?`${NAMES[row.role]||'影人'} · ${formatTime(row.duration)}`:'恢复最近一场';b.append(span,small);b.onclick=()=>{try{loadRecord(parseDuet(row.text));$('archive-dialog').close();}catch{toast('这份本机记录无效，可导入备份');}};list.append(b);}dialog('archive-dialog');};
function formatTime(t){const n=Math.floor((t||0)/1000);return`${Math.floor(n/60).toString().padStart(2,'0')}:${(n%60).toString().padStart(2,'0')}`;}
function showEvidence(evidence, modelUsed=false){
 const rows=[];
 if(evidence&&Number.isFinite(evidence.distancePx))rows.push(`距目标 ${Math.round(evidence.distancePx)} 像素；横向 ${Math.round(Math.abs(evidence.dx||0))}、纵向 ${Math.round(Math.abs(evidence.dy||0))}。`);
 if(evidence&&Number.isFinite(evidence.windowMs))rows.push(`实际观察窗口 ${Math.round(evidence.windowMs)} 毫秒${evidence.sampleCount?`，${evidence.sampleCount} 个动作采样`:''}。`);
 if(evidence?.inputRod)rows.push(`刚才实际输入：${RODS[evidence.inputRod]}；目标杆：${RODS[evidence.targetRod]}。`);
 if(evidence&&Number.isFinite(evidence.stableMs))rows.push(`连续停稳 ${Math.round(evidence.stableMs)} / ${Math.round(evidence.requiredStableMs||180)} 毫秒。`);
 if(evidence?.exits||evidence?.reversals)rows.push(`本窗口离圈 ${evidence.exits||0} 次，独立反向 ${evidence.reversals||0} 次。`);
 if(!rows.length)rows.push(mode==='replay'?'当前为保存的历史动作，不作实时纠错。':'先完成当前身段，再记录下一步证据。');
 $('coach-evidence').replaceChildren(...rows.slice(0,4).map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));
 $('coach-source').textContent=mode==='replay'?'历史回放':modelUsed?'规则核验 · 模型辅助选手':'规则纠错 · 实际轨迹';
 const ts=partnerTempo.state;
 $('partner-tempo').textContent=mode==='replay'?'按保存的双方动作回放':ts.sampleCount?`规则节奏 · 最近${ts.sampleCount}次典型到位 ${ts.medianSeconds.toFixed(2)} 秒 · ${ts.speedScale<.95?'搭档放缓杆速':'搭档顺势接演'}`:'规则节奏 · 正在观察你的到位用时';
 $('partner-tempo').title=ts.explanation;
}
function coach(now){
 const v=getDuetView(world),a=getPlayer(world),p=activePerformance(),g=currentGoal();feedback=null;
 if(mode==='replay'&&world.playerRole==='wukong'&&world.phase==='staff'){
  observations=[];for(let t=Math.max(0,cursor-1200);t<cursor;t+=100)observations.push(snapshotSample(getPlayer(sampleDuet(recording,t)),t));observations.push(snapshotSample(a,cursor));
 }
 if(!observations.length)observations=[snapshotSample(a,now)];
 let evidence=null,modelUsed=false;
 const sceneKey=`${world.playerRole}:${world.phase}:${world.trial}:${p?.line?.id||''}:${p?.cueIndex??''}:${p?.returning?'return':''}`;
 const goal=g?{...g,id:sceneKey+':'+g.rod}:null;
 const currentEvidence=evidenceCoach.update(observations,goal,{role:world.playerRole,inputRod:lastInputRod,lastInputAt,paused:!running||idleGate.state.idle,replay:mode==='replay',sceneKey,settleMs:p?.returning&&g?.hold>0?g.hold*1000:p?.settleMs??(g?.hold>0?g.hold*1000:!p&&world.phase==='staff'&&world.playerRole==='wukong'?280:120)});
 if(!p&&world.playerRole==='wukong'&&world.phase==='staff'){
  feedback=analyzeActionWindow(observations,model,{paused:!running||idleGate.state.idle,replay:mode==='replay'});
  const useSpecific=g&&['wrong_rod','body_carry','overshoot','unreachable'].includes(currentEvidence.issue);
  const shown=useSpecific?currentEvidence:feedback;
  $('coach-title').textContent=shown.title;$('coach-hint').textContent=shown.hint;
  const f=feedback.hand&&feedback.hands[feedback.hand];
  $('goal-hand').textContent=shown.hand?RODS[shown.hand]:'双手';
  $('goal-fact').textContent=f?`距握点 ${Math.round(f.distance)} · 停稳 ${Math.round(f.progress*100)}%`:v.objective;
  $('goal-fill').style.width=`${f?f.progress*100:a.staff.phase!=='standing'?100:0}%`;
  evidence=useSpecific?currentEvidence.evidence:f?{distancePx:f.distance,dx:f.dx,dy:f.dy,windowMs:observations.at(-1).t-observations[0].t,sampleCount:observations.length,stableMs:f.contact*1000,requiredStableMs:280,exits:f.exits,reversals:f.reversals}:currentEvidence.evidence;
  const predictedHand=feedback.prediction?.label.startsWith('left_')?'left':feedback.prediction?.label.startsWith('right_')?'right':null;
  modelUsed=!useSpecific&&predictedHand===feedback.hand&&['left_align','right_align','left_unsteady','right_unsteady'].includes(feedback.issue);
  if(useSpecific)feedback={...feedback,hand:currentEvidence.hand};
 }else if(g&&(!p||p.human)&&mode==='perform'){
  feedback=currentEvidence;evidence=feedback.evidence;
  $('coach-title').textContent=feedback.title;$('coach-hint').textContent=feedback.hint;
  if(p?.recorded&&p.phraseReleased&&p.poseWaiting)$('coach-hint').textContent+=p.gateMode==='turn'?' 本段原声连续，跟光圈调整；换角时再停稳。':' 本句原声继续；下一句会等你重新停稳。';
  if(p?.stageInteraction)$('coach-hint').textContent=p.reason;
  $('goal-hand').textContent=RODS[g.rod];$('goal-fact').textContent=feedback.distancePx===null?'已暂停 · 不累计停稳':`相差 ${Math.round(feedback.distancePx)} · 停稳 ${Math.min(100,Math.round((evidence.stableMs||0)/(evidence.requiredStableMs||180)*100))}%`;
  $('goal-fill').style.width=`${Math.min(100,(evidence.stableMs||0)/(evidence.requiredStableMs||180)*100)}%`;
  if(p?.stageInteraction){$('goal-fact').textContent=p.progress>0?`试器停稳 ${Math.min(100,Math.round(p.progress*100))}%`:'轻动手杆一下，再松手稍停';$('goal-fill').style.width=`${Math.min(100,p.progress*100)}%`;}
 }else{
  $('coach-title').textContent=world.phase==='complete'?'这一折，你们共同演成了':mode==='replay'?'回看每一次操杆':p?`${NAMES[p.role]} · ${p.title}`:'身段已成，接下一句';
  $('coach-hint').textContent=mode==='replay'?'记录保留了双方实际动作。暂停、拖轴，或从此接演。':p?'搭档按你近期的到位用时接杆；原录音保持原速。你仍可随时调整自己的影人。':v.objective;
  $('goal-hand').textContent=mode==='replay'?'历史身段':p?'搭档接演':'当前身段';$('goal-fact').textContent=p?.line?.text||v.objective;$('goal-fill').style.width=`${(p?.progress||v.progress||0)*100}%`;
 }
 if(mode==='replay'&&feedback)$('coach-hint').textContent='当前为历史动作回放。核对双手的位置与握持状态；点“从此接演”才能继续操杆。';
 if(mode==='perform'&&running&&idleGate.state.idle){$('coach-title').textContent='等你接杆';$('coach-hint').textContent='空等不计入回放。沿光圈继续动杆，或按接戏按钮，录制会自动继续。';$('goal-fact').textContent='等你操杆 · 空等不录';}
 showEvidence(evidence,modelUsed);
 $('focus').disabled=mode==='replay'||!running||!(feedback?.hand||g?.rod);lastCoach=now;
}
function renderUI(){const v=getDuetView(world),a=getPlayer(world),p=activePerformance(),scene=currentScene();$('cast').textContent=`你 · ${NAMES[world.playerRole]}　/　AI · ${NAMES[world.ai.actor]}`;$('status').textContent=!started?'等你选角':mode==='replay'?(playing?'双人回放中':'回放已暂停'):world.phase==='complete'?'一折落幕':running?idleGate.state.idle?'等你操杆 · 空等不录':'正在操演 · 动作与唱腔录制中':'操演已暂停';$('chapter-title').textContent=v.title;$('objective').textContent=scene.blocked?scene.caption:p?.active||p?.returning?(p.human?p.reason:`${NAMES[p.role]}正在接演 · ${p.title}`):v.objective;$('step').textContent=['一','二','三','四','五','六','终'][['arrival','request','trial','guide','staff','farewell','complete'].indexOf(world.phase)];$('speaker').textContent=p?.line?`${p.role===world.playerRole?'你':'AI'} · ${NAMES[p.role]}${p.recorded?' · 原场唱白':' · 本地台本'}`:vocals.state.line?`${NAMES[vocals.state.clip.role]} · 原声回放`:vocalPack?.audioOnly?'身段提示':`你 · ${NAMES[world.playerRole]}`;$('line').textContent=p?.line?.text||vocals.state.line?.text||(vocalPack?.audioOnly?vocals.error||scene.caption||v.objective:v.line);$('action').textContent=scene.blocked?'上下场进行中…':p?.stageInteraction?'轻试兵器 · 停稳即到位':pendingVocalAction?(p?.returning?'收势接戏':p?.recorded?(p.waiting?p.gateMode==='turn'?'整段开口前对准光圈':'对准本句光圈后续声':'原声接戏中…'):p?.waiting?'先演好这一句的身段':'接下一句 ␣'):trialVocalBeat()&&world.phase==='trial'?(v.actionEnabled?(trialVocalBeat()==='call'?'龙王命取兵器 ␣':world.trial===0?'悟空试刀回应 ␣':'龙王引看海藏 ␣'):'移杆入圈，松手稍停'):vocalPack?.audioOnly&&world.playerRole==='dragon'&&world.phase==='staff'&&!world.flags.staffInvited?'指稳神铁 · 示意搭档取棒':vocalPack?.audioOnly&&world.phase!=='complete'?(v.actionEnabled?'接这一场原声 ␣':'完成身段后接原声'):v.actionLabel;$('action').disabled=!started||!running||mode!=='perform'||scene.blocked||!!p?.stageInteraction||(pendingVocalAction?!p?.ready||p.recorded||p.returning||p.offset<1.2:!v.actionEnabled||vocals.enabled&&vocals.busy||vocalPack?.audioOnly&&(!vocals.enabled||!sceneVocalClips().length&&!(world.playerRole==='dragon'&&world.phase==='staff'&&!world.flags.staffInvited)));$('partner-name').textContent=`AI · ${NAMES[world.ai.actor]}`;$('partner-status').textContent=v.aiStatus;$('completion').hidden=world.phase!=='complete';$('grip-controls').hidden=world.playerRole!=='wukong'||world.phase!=='staff';$('grip').disabled=mode!=='perform'||!running||!canGrip(a);$('smaller').disabled=mode!=='perform'||!running||a.staff.phase==='standing'||a.staff.size===2;$('larger').disabled=mode!=='perform'||!running||a.staff.phase==='standing'||a.staff.size===0;$('staff-size').textContent=['神铁原长','合手长度','过短'][a.staff.size];$('record-label').textContent=mode==='replay'?'回放模式':running?'暂停操演':'继续操演';$('record').classList.toggle('active',running);$('play').textContent=playing?'Ⅱ 暂停回看':'▶ 回看';$('continue').hidden=mode!=='replay';$('continue').disabled=world.phase==='complete';const shownDuration=mode==='perform'?Math.max(cursor,recording.duration):recording.duration;$('timeline').max=shownDuration;$('timeline').value=cursor;$('timeline').disabled=!recording.duration;$('timeline').style.setProperty('--progress',`${recording.duration?cursor/recording.duration*100:0}%`);$('clock').textContent=`${formatTime(cursor)} / ${formatTime(shownDuration)}`;$('recording-meta').textContent=mode==='replay'?'按保存的动作与唱腔回放':idleGate.state.idle?`空等已略过 ${formatTime(idleGate.state.skippedSeconds*1000)} · 动杆自动续录`:'动作与唱腔保留 · 自动略过空等';$('record').classList.toggle('idle',mode==='perform'&&running&&idleGate.state.idle);document.querySelectorAll('[data-phase]').forEach(el=>el.classList.toggle('current',el.dataset.phase===world.phase));coach(performance.now());renderScore();music.sync(world,{active:started&&!document.hidden&&!document.querySelector("dialog[open]")&&(mode==="perform"?running&&!idleGate.state.idle:playing),allowTail:world.phase==="complete"&&(mode==="perform"||cursor>=recording.duration)});if(!started||document.hidden||document.querySelector('dialog[open]')||mode==='perform'&&!running&&world.phase!=='complete'||mode==='replay'&&!playing)vocals.pause();lastUI=performance.now();}
function loop(now){
 const dt=Math.min(.07,Math.max(0,(now-lastFrame)/1000));lastFrame=now;
 if(started&&mode==='perform'&&running){
   const localScriptPlaying=!!(pendingVocalAction&&director.state?.line&&!director.state.recorded&&!director.state.waiting);
   const gate=idleGate.update(world,dt,{media:vocals.state,scene:currentScene(),enabled:true,force:idleWake||localScriptPlaying});idleWake=false;
   if(gate.advance){
     if(world.elapsed*1000-recordOffset>=MAX_DURATION-100){capture(true);pause();toast('已达20分钟，先保存这一场');}
     else{
       if(pendingVocalAction){tickDuet(world,dt,model,{holdAI:true,partnerSpeed:partnerTempo.state.speedScale});updateStageInteraction(dt);updateVocalAction(dt);}
       else{tickDuet(world,dt,model,{partnerSpeed:partnerTempo.state.speedScale});updateStageInteraction(dt);}
       observePartnerTempo(dt);if(now-lastObservation>75)observe(now);capture();
       if(world.phase==='complete'){capture(true);pause('complete');renderUI();}
       if(`${world.phase}:${world.trial}`!==lastPhase){lastPhase=`${world.phase}:${world.trial}`;resetCoach();renderUI();}
     }
   }
 }else if(mode==='replay'&&playing){cursor=Math.min(recording.duration,cursor+dt*1000);world=sampleDuet(recording,cursor);for(const cue of getScoreCuesBetween(recording,replayAudioCursor,cursor)){music.cue(cue.sourceEvent,{offset:(cursor-cue.startMs)/1000});const ve=cue.sourceEvent;if(!replayHasVocalAnchors&&vocalPack?.mode!=='remote-reference'&&ve.control==='human'&&['reply','invite_staff','farewell'].includes(ve.type))vocals.cue({phase:ve.phase,trial:ve.trial,playerRole:world.playerRole},`${ve.t}|${ve.phase}|${ve.trial}`);if(!vocalPack&&voice&&cue.lines.length&&window.speechSynthesis){stopSpeech();speechSynthesis.speak(utterance(cue.lines,cue.actor,speechEpoch));}}replayAudioCursor=cursor;followReplayVocals();if(cursor>=recording.duration){playing=false;vocals.pause();if(world.phase!=='complete')stopSpeech();}observations=[snapshotSample(getPlayer(world),now)];}
 if(mode==='perform'&&started)dispatchLiveAudio();music.tick();vocals.tick();captureVocalClock();captureStageClock();const v=getDuetView(world),p=activePerformance(),vs=vocals.state,performances={wukong:{speaking:false,offset:world.elapsed,paused:!running||idleGate.state.idle,cueIndex:0},dragon:{speaking:false,offset:world.elapsed,paused:!running||idleGate.state.idle,cueIndex:0}};if(vs.clip)performances[vs.clip.role]={speaking:true,offset:vs.offset,paused:!vs.playing,cueIndex:Math.max(0,vs.clip.lines.findLastIndex(l=>l.start<=vs.offset))};else if(p?.line)performances[p.role]={speaking:true,offset:p.offset,paused:p.waiting||mode==='perform'&&!running||mode==='replay'&&!playing,cueIndex:p.cueIndex};drawDuetTheatre(ctx,world,{time:now,scene:currentScene(),backstage,selected,showGuides:guides&&mode==='perform',goal:currentGoal(),speaker:vs.clip?.role||p?.role||null,performance:performances});if(guides&&!p&&world.playerRole==='wukong'&&world.phase==='staff'&&feedback&&mode==='perform')drawCoachOverlay(ctx,feedback,now,{focus:now<focusUntil});if(now-lastCoach>180)coach(now);if(now-lastUI>180)renderUI();if(dirty&&mode==='perform'&&now-lastAuto>30000){lastAuto=now;try{localStorage.setItem(AUTO,serializeDuet(recording));dirty=false;}catch{if(!autoFailed){autoFailed=true;toast('本机自动留存空间不足，请导出备份');}}}requestAnimationFrame(loop);}
document.addEventListener('visibilitychange',()=>{if(document.hidden){pause();capture(true);renderUI();window.speechSynthesis?.cancel();}});
loadCoachModel().then(m=>{model=m;}).catch(()=>{$('model-info').textContent='模型未载入 · 几何陪练仍可用';});
loadPuppetAtlas().then(()=>{for(const role of ['wukong','dragon'])drawPuppetPortrait($(`portrait-${role}`).getContext('2d'),role);document.querySelectorAll('[data-role]').forEach(b=>b.disabled=false);$('asset-status').textContent='镂刻分件影人 · 选角后即可亲手操演';renderUI();}).catch(e=>{$('asset-status').textContent=e.message;toast(e.message);});
renderUI();$('role-dialog').showModal();requestAnimationFrame(loop);

useBuiltinVocals();
