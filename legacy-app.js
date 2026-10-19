import { STAGE, createState, getHandles, getGripTargets, solvePose, moveControl, updateContacts, canGrip, gripStaff, resizeStaff, cloneState } from './engine.js?v=0.2.0';
import { createRecording, capture, sample, truncate, serialize, parseRecording, updateDuration, MAX_DURATION } from './replay.js?v=0.2.0';
import { drawTheatre, drawCharacterStudy } from './art.js?v=0.12.0';
import { loadCoachModel } from './coach-model.js?v=0.2.0';
import { analyzeActionWindow, snapshotSample, drawCoachOverlay, LABEL_TEXT } from './coach.js?v=0.2.0';

const $ = id => document.getElementById(id);
const canvas = $('stage');
const ctx = canvas.getContext('2d');
const STORE = 'yiren-longgong-saved-v1';
const AUTO = 'yiren-longgong-current-v1';
let state = createState();
let recording = createRecording(state);
let time = 0, cursor = 0, mode = 'perform', running = false, playing = false;
let selected = 'body', backstage = false, pointer = null, toastTimer, lastFrame = performance.now();
let lastCapture = -100, lastAutoSave = 0, completed = false, completionVisible = false;
let soundEnabled = false, audio = null, lastTone = 0, dirty = false;
let coachModel = null, coachLoadError = false, coachEnabled = true, feedback = null, observations = [];
let lastObservation = -100, lastCoachUpdate = -1000, coachMode = 'perform', coachFocusUntil = 0;
let studyBackstage = false;
const rods = [...document.querySelectorAll('[data-rod]')];

loadCoachModel().then(model => { coachModel = model; lastCoachUpdate = -1000; }).catch(() => { coachLoadError = true; $('model-info').textContent = '模型未载入 · 对位辅助可用'; });
function resetCoach() { observations = []; lastObservation = -100; lastCoachUpdate = -1000; }
function observeMotion(now=performance.now()) {
  if(!coachEnabled || mode!=='perform') return;
  observations.push(snapshotSample(state,now)); observations=observations.filter(s=>s.t>=now-1200); lastObservation=now;
}
function drawStudy() { const study = $('character-study'); drawCharacterStudy(study.getContext('2d'), { width:900, height:700, backstage:studyBackstage }); }
$('character').onclick = () => { drawStudy(); showDialog('character-dialog'); };
$('study-backstage').onclick = () => { studyBackstage = !studyBackstage; $('study-backstage').setAttribute('aria-pressed', studyBackstage); $('study-backstage').textContent = studyBackstage ? '回到透光影人' : '查看分件关节'; drawStudy(); };
$('model-info').onclick = () => showDialog('model-dialog');
$('coach-toggle').onclick = () => { coachEnabled = !coachEnabled; $('coach-toggle').setAttribute('aria-pressed', coachEnabled); $('coach-toggle').setAttribute('aria-label', `AI动作陪练已${coachEnabled?'开启':'关闭'}`); $('coach-toggle').textContent = coachEnabled?'开':'关'; $('coach-rail').classList.toggle('coach-off', !coachEnabled); resetCoach(); if(!coachEnabled) { $('coach-title').textContent = '陪练已关闭，自由演一场'; $('coach-hint').textContent = '操杆、握持与录制照常工作。随时开启陪练，查看实时调整。'; $('coach-focus').disabled = true; } };
$('coach-focus').onclick = () => { if(feedback?.hand) { chooseRod(feedback.hand); coachFocusUntil = performance.now()+5000; canvas.focus({preventScroll:true}); } };

function updateCoach(now) {
  if(!coachEnabled) return;
  if(coachMode!==mode) { resetCoach(); coachMode=mode; }
  if(mode==='perform' && now-lastObservation>=70) observeMotion(now);
  if(now-lastCoachUpdate<180) return;
  lastCoachUpdate=now;
  if(mode==='perform') observeMotion();
  let samples=observations;
  if(mode==='replay') { samples=[]; for(let t=Math.max(0,cursor-1200);t<cursor;t+=80) samples.push(snapshotSample(sample(recording,t),t)); samples.push(snapshotSample(state,cursor)); }
  if(!samples.length) samples=[snapshotSample(state,now)];
  feedback=analyzeActionWindow(samples,coachModel,{paused:!running,replay:mode==='replay'});
  $('coach-title').textContent=feedback.title;
  $('coach-hint').textContent=feedback.hint;
  $('coach-focus').disabled=!feedback.hand; $('coach-focus').textContent=mode==='replay'?'标出这一刻的杆 ↗':'标出要调的杆 ↗';
  for(const id of ['left','right']) {
    const fact=feedback.hands[id];
    $(`${id}-error`).textContent=feedback.held?'合握联动':fact.reach>180?'需移身':fact.distance<=20?'已对准':`偏${Math.round(fact.distance)} · ${fact.direction}`;
    $(`${id}-dwell`).style.width=`${fact.progress*100}%`;
    $(`measure-${id}`).classList.toggle('in-position',fact.distance<=20&&fact.reach<=180);
    $(`${id}-stability`).textContent=feedback.held?'握点锁定 · 辅助联动':`停稳 ${fact.contact.toFixed(2)} / 0.28 秒${fact.exits?` · 滑出${fact.exits}次`:''}`;
  }
  const prediction=feedback.prediction;
  $('model-info').textContent=coachModel?(mode==='replay'?'本机模型 · 回放复盘':'本机动作模型 · 运行中'):coachLoadError?'模型未载入 · 对位辅助可用':'本机动作模型 · 载入中';
  $('model-prediction').textContent=prediction?LABEL_TEXT[prediction.label]||prediction.label:coachLoadError?'模型未载入':'正在载入';
  $('model-confidence').textContent=prediction?`分类置信度 ${(prediction.confidence*100).toFixed(1)}% · 非表演成绩`:'当前仅有几何对位提示';
  $('model-decision').textContent=`按实际动作核验后的建议：${feedback.title}。${prediction&&prediction.label!==feedback.issue?'初判与当前事实不一致时，以实际握持条件和轨迹证据为准。':''}`;
  $('model-facts').textContent=`真实偏差：左手 ${feedback.hands.left.distance.toFixed(1)}，右手 ${feedback.hands.right.distance.toFixed(1)}（幕面相对距离，≤20为进入握点）。握点中心距肩：左 ${feedback.hands.left.reach.toFixed(1)}、右 ${feedback.hands.right.reach.toFixed(1)}；臂长180。最近轨迹：${((samples[samples.length-1].t-samples[0].t)/1000).toFixed(2)}秒。${feedback.held?'双手已由合握辅助锁定。':`左手离圈 ${feedback.hands.left.exits} 次、右手 ${feedback.hands.right.exits} 次。`}`;
  $('coach-rail').dataset.issue=feedback.issue;
}

function fmt(ms) { const seconds = Math.floor(ms / 1000); return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }
function toast(message, duration = 3600) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, duration); }
function closeDialog(dialog) { if (dialog.open) dialog.close(); }
function showDialog(id) { $(id).showModal(); }
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => closeDialog(button.closest('dialog'))));
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDialog(dialog); } }));
$('help').onclick = () => showDialog('help-dialog');
$('sources').onclick = () => showDialog('sources-dialog');
$('files').onclick = () => { refreshArchive(); showDialog('files-dialog'); };

function tone(frequency = 220, volume = 0.04, length = 0.14) {
  if (!soundEnabled) return;
  try {
    if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    const oscillator = audio.createOscillator(), gain = audio.createGain();
    oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(frequency, audio.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.65, audio.currentTime + length);
    gain.gain.setValueAtTime(volume, audio.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + length);
    oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(); oscillator.stop(audio.currentTime + length);
  } catch { soundEnabled = false; $('sound').textContent = '声音不可用'; }
}
$('sound').onclick = () => { soundEnabled = !soundEnabled; $('sound').setAttribute('aria-pressed', soundEnabled); $('sound').textContent = `声音 ${soundEnabled ? '开' : '关'}`; tone(330); };
function toggleBackstage() { backstage = !backstage; $('backstage').setAttribute('aria-pressed', backstage); $('backstage').textContent = backstage ? '回到透光前幕' : '看幕后的杆'; $('view-label').textContent = backstage ? '幕后 · 分件与杆' : '透光前幕'; }
$('backstage').onclick = toggleBackstage;
function chooseRod(id) { selected = id; rods.forEach(button => { button.classList.toggle('selected', button.dataset.rod === id); button.setAttribute('aria-pressed', button.dataset.rod === id); }); }
rods.forEach(button => button.onclick = () => { chooseRod(button.dataset.rod); canvas.focus({ preventScroll: true }); });

function beginMovement() {
  if (mode !== 'perform') { toast('正在看回放。点击“从此处续演”，就能接着执杆。'); return false; }
  if (time >= MAX_DURATION) { toast('这一折已达20分钟，请保存后重新开演。'); return false; }
  running = true; dirty = true; completionVisible = false; return true;
}
function captureNow() {
  if (mode !== 'perform') return true;
  try { capture(recording, state, Math.round(time)); updateDuration(recording, Math.round(time)); lastCapture = time; return true; }
  catch (error) { running = false; toast(`录制已暂停，请先保存已有动作：${error.message}`, 6500); return false; }
}
function moveRod(id, dx, dy) {
  if (!beginMovement()) return;
  if (id !== 'body' && state.staff.phase !== 'standing') { toast('已双手合握。用身体杆带棒移动；回到合握前可重新调整手势。'); return; }
  moveControl(state, id, dx, dy);
  observeMotion();
  if(time-lastCapture>=33) captureNow();
  if (performance.now() - lastTone > 140 && Math.hypot(dx, dy) > 5) { tone(120 + Math.abs(dx) * 2, 0.008, 0.06); lastTone = performance.now(); }
}
function stagePoint(event) { const rect = canvas.getBoundingClientRect(); return { x: (event.clientX - rect.left) * STAGE.width / rect.width, y: (event.clientY - rect.top) * STAGE.height / rect.height }; }
canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0 || pointer) return;
  const point = stagePoint(event), handles = getHandles(state);
  let nearest = null, distance = event.pointerType === 'touch' ? 55 : 35;
  for (const [id, handle] of Object.entries(handles)) { const d = Math.hypot(point.x - handle.x, point.y - handle.y); if (d < distance) { distance = d; nearest = id; } }
  if (!nearest) { toast('请拖幕下标着“身、左、右”的圆形杆柄，也可选杆后按方向键。', 2600); return; }
  if (!beginMovement()) return;
  if (nearest !== 'body' && state.staff.phase !== 'standing') { toast('双手已合握，用身体杆提棒。'); return; }
  chooseRod(nearest); pointer = { id: event.pointerId, rod: nearest, point }; canvas.setPointerCapture(event.pointerId); canvas.classList.add('dragging'); canvas.focus({ preventScroll: true }); event.preventDefault();
});
canvas.addEventListener('pointermove', event => {
  if (!pointer || pointer.id !== event.pointerId) return;
  const point = stagePoint(event); moveRod(pointer.rod, point.x - pointer.point.x, point.y - pointer.point.y); pointer.point = point; event.preventDefault();
});
function releasePointer(event) { if (pointer?.id !== event.pointerId) return; pointer = null; canvas.classList.remove('dragging'); captureNow(); }
canvas.addEventListener('pointerup', releasePointer); canvas.addEventListener('pointercancel', releasePointer);

function grip() { if (mode !== 'perform') return; if (!canGrip(state)) { toast(coachEnabled&&feedback?`${feedback.title}。${feedback.hint}`:'两只手都要进入光圈，并停稳片刻。',5000); coachFocusUntil=performance.now()+5000; return; } if (!beginMovement()) return; if (gripStaff(state)) { observeMotion(); captureNow(); tone(294, 0.06, 0.5); setTimeout(() => tone(440, 0.03, 0.45), 100); toast('合握成功。说声“小些”，让神铁变得趁手。'); } }
$('grip').onclick = grip;
function resize(direction) { if (mode !== 'perform' || state.staff.phase === 'standing' || !beginMovement()) return; const before = state.staff.size; resizeStaff(state, direction); if (before !== state.staff.size) { observeMotion(); captureNow(); tone(state.staff.size === 1 ? 392 : 262, 0.04, 0.3); if (state.staff.size === 1) toast('长度合手了。向上拖身体杆，慢慢把棒提离海藏。'); } }
$('smaller').onclick = () => resize(-1); $('larger').onclick = () => resize(1);
document.addEventListener('keydown', event => {
  if (document.querySelector('dialog[open]') || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || event.ctrlKey || event.metaKey || event.altKey) return;
  if (['1', '2', '3'].includes(event.key)) { chooseRod({ 1: 'body', 2: 'left', 3: 'right' }[event.key]); event.preventDefault(); }
  else if (event.key.startsWith('Arrow')) { event.preventDefault(); const step = event.shiftKey ? 16 : 5; moveRod(selected, event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0, event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0); captureNow(); }
  else if (event.key.toLowerCase() === 'g') { event.preventDefault(); grip(); }
  else if (event.key.toLowerCase() === 'b') { event.preventDefault(); toggleBackstage(); }
  else if (event.code === 'Space' && event.target.tagName !== 'BUTTON') { event.preventDefault(); toggleRecord(); }
});

function toggleRecord() {
  if (mode === 'replay') { playing = !playing; if (cursor >= recording.duration) cursor = 0; return; }
  running = !running; if (running) dirty = true; else { captureNow(); autoSave(); }
}
$('record-toggle').onclick = toggleRecord;
function startReplay(fromStart = true) {
  captureNow(); running = false; mode = 'replay'; playing = true; cursor = fromStart || cursor >= recording.duration ? 0 : cursor; state = sample(recording, cursor); completionVisible = false; autoSave();
}
$('play').onclick = () => { if (mode === 'replay') { playing = !playing; if (cursor >= recording.duration) cursor = 0; } else startReplay(true); };
$('watch-complete').onclick = () => startReplay(true);
$('timeline').addEventListener('input', event => { captureNow(); running = false; mode = 'replay'; playing = false; cursor = Math.min(recording.duration, Number(event.target.value)); state = sample(recording, cursor); completionVisible = false; });
$('continue').onclick = () => { recording = truncate(recording, Math.round(cursor)); state = sample(recording, Math.round(cursor)); time = Math.round(cursor); mode = 'perform'; playing = false; running = true; completed = state.staff.phase === 'lifted'; completionVisible = false; lastCapture = time; dirty = true; resetCoach(); toast('从这一刻接着演。此后的旧动作已撤回。'); };

function writeStorage(key, value) { try { localStorage.setItem(key, value); return true; } catch { return false; } }
function autoSave() { if (!dirty || !recording.duration) return; try { const text = serialize(recording); writeStorage(AUTO, text); } catch { /* The manual save reports errors; autosave must not interrupt an action. */ } }
function archiveCurrent() { captureNow(); if (!recording.duration) return null; const text = serialize(recording); return { text, stored: writeStorage(STORE, text) }; }
function preserveBeforeSwitch() {
  if (!recording.duration || !dirty) return true;
  const archived = archiveCurrent();
  if (archived && !archived.stored) { toast('本机存档未写入，当前演出已保留。请先用“保存演出”下载文件，再切换。', 6000); return false; }
  return true;
}
$('save').onclick = () => {
  try {
    running = false;
    const saved = archiveCurrent(); if (!saved) return;
    const blob = new Blob([saved.text], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = `龙宫得宝-我的演出-${new Date().toISOString().slice(0, 10)}.json`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    dirty = false;
    toast(saved.stored ? '演出已存入本机，动作文件也已开始下载。可在“⋯”里重新打开。' : '动作文件已开始下载。本机空间不足，未写入浏览器存档。', 5000); refreshArchive();
  } catch (error) { toast(`保存未完成：${error.message}`, 6000); }
};
function refreshArchive() {
  try { const text = localStorage.getItem(STORE); const saved = text ? parseRecording(text) : null; $('restore').disabled = !saved; $('saved-meta').textContent = saved ? `《龙宫得宝》 · ${fmt(saved.duration)} · ${saved.frames.length}个动作帧` : '尚无手动保存的演出'; }
  catch { $('restore').disabled = true; $('saved-meta').textContent = '本机存档无法读取，请导入下载文件'; }
}
function openRecording(data) { recording = data; time = data.duration; cursor = 0; mode = 'replay'; running = false; playing = false; state = sample(recording, 0); completed = false; completionVisible = false; dirty = true; resetCoach(); closeDialog($('files-dialog')); toast('演出已打开。点击回放，或拖到某一刻续演。'); }
$('restore').onclick = () => { try { const restored = parseRecording(localStorage.getItem(STORE)); if (preserveBeforeSwitch()) openRecording(restored); } catch (error) { toast(`存档无法读取：${error.message}`); } };
$('import').onclick = () => $('file-input').click();
$('file-input').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try { if (file.size > 8 * 1024 * 1024) throw new Error('动作文件不能超过8MB'); const loaded = parseRecording(await file.text()); if (preserveBeforeSwitch()) openRecording(loaded); }
  catch (error) { toast(`导入未完成：${error.message}`, 6000); } finally { event.target.value = ''; }
});
$('new-performance').onclick = () => {
  const hadPrevious = recording.duration > 0;
  try { if (!preserveBeforeSwitch()) return; } catch (error) { toast(`请先下载当前演出：${error.message}`); return; }
  state = createState(); recording = createRecording(state); time = 0; cursor = 0; mode = 'perform'; running = false; playing = false; completed = false; completionVisible = false; lastCapture = -100; dirty = false; resetCoach(); chooseRod('body'); closeDialog($('files-dialog')); try { localStorage.removeItem(AUTO); } catch {} toast(hadPrevious ? '新一折已开幕。上一场已保留。' : '新一折已开幕，来试试三根杆。');
};
window.addEventListener('pagehide', () => { captureNow(); autoSave(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { running = false; playing = false; captureNow(); autoSave(); } lastFrame = performance.now(); });

function interfaceState() {
  const held = state.staff.phase !== 'standing', lifted = state.staff.phase === 'lifted';
  let step, title, detail, caption;
  if (lifted) { step = 3; title = '这一棒，由你提起'; detail = '继续执身体杆走位，或回放、保存你的这一折。'; caption = '悟空：好宝贝！正合俺老孙的心意。'; }
  else if (held) { step = 2; title = state.staff.size === 1 ? '握稳，向上提棒' : '神铁随心，变得趁手'; detail = state.staff.size === 1 ? '向上拖身体杆，让神铁缓缓离开海藏。' : state.staff.size === 0 ? '按一次“小些”，先让神铁变成合手的长度。' : '有些太小了。按一次“大些”，回到合手长度。'; caption = state.staff.size === 1 ? '龙王：此宝随心变化，大圣尽管试来。' : '悟空：再小些，再短些！'; }
  else if (state.body.x > 640) { step = 1; title = '两只手，各自寻到握点'; detail = canGrip(state) ? '两手已稳。按“握稳神铁”或 G，合握。' : '分别拖左右手杆，让双手进入两个光圈并停稳。'; caption = '悟空：待俺老孙，试一试这定海神珍。'; }
  else { step = 0; title = '把悟空领到神铁前'; detail = '拖身体杆向右，走近神铁；手杆可以独立摆动。'; caption = '悟空：老龙王，听说海藏有件趁手的兵器？'; }
  $('step-number').textContent = ['壹', '贰', '叁', '成'][step]; $('step-title').textContent = title; $('stage-instruction').textContent = detail; $('stage-caption').textContent = caption;
  const ready = canGrip(state), near = state.contacts.left > 0 && state.contacts.right > 0;
  $('grip').disabled = mode !== 'perform' || !ready; $('grip').innerHTML = held ? '双手已合握' : '握稳神铁 <kbd>G</kbd>';
  $('hand-contact').textContent = held ? '合握辅助已联动' : ready ? '双手到位，可以合握' : near ? '保持片刻…' : `${state.contacts.left > 0 ? '左手到位' : '左手未到'} · ${state.contacts.right > 0 ? '右手到位' : '右手未到'}`;
  $('hand-contact').classList.toggle('ready', ready || held);
  $('smaller').disabled = mode !== 'perform' || !held || state.staff.size === 2;
  $('larger').disabled = mode !== 'perform' || !held || state.staff.size === 0;
  $('size-label').textContent = ['神铁 · 太长', '如意 · 合手', '如意 · 太小'][state.staff.size];
  const active = mode === 'perform' ? running : playing;
  $('record-indicator').textContent = mode === 'replay' ? playing ? '回放中' : '回放已暂停' : running ? '录制中' : time ? '录制已暂停' : '待开演';
  $('record-indicator').classList.toggle('active', active); $('record-toggle').classList.toggle('active', active);
  $('record-text').textContent = mode === 'replay' ? playing ? '暂停回放' : '播放回放' : running ? '暂停录制' : time ? '继续录制' : '开始录制';
  $('live-time').textContent = fmt(mode === 'perform' ? time : cursor); $('cursor-time').textContent = fmt(mode === 'perform' ? time : cursor); $('duration').textContent = fmt(recording.duration);
  $('timeline').disabled = recording.duration === 0; $('timeline').max = Math.max(1, recording.duration); $('timeline').value = mode === 'perform' ? time : cursor;
  $('timeline').style.setProperty('--progress', `${recording.duration ? (mode === 'perform' ? time : cursor) / recording.duration * 100 : 0}%`);
  $('timeline-label').textContent = mode === 'replay' ? '你的动作 · 可拖动时间轴' : time ? '正在记下你的演出' : '拖杆即开演 · 记录你的每次动作';
  $('play').disabled = recording.duration === 0; $('play').textContent = mode === 'replay' && playing ? 'Ⅱ 暂停' : '▶ 回放'; $('save').disabled = recording.duration === 0; $('continue').hidden = mode !== 'replay';
  $('completion').hidden = !completionVisible;
  if (held) $('context-tip').firstChild.textContent = '合握后双手随身体杆联动，握点会一直贴住棒身。';
  else $('context-tip').firstChild.textContent = '拖动幕下的圆形杆柄，影人会随你的手一起动。';
}
function frame(now) {
  const dt = Math.min((now - lastFrame) / 1000, 0.08); lastFrame = now;
  if (mode === 'perform' && running) {
    time = Math.min(MAX_DURATION, time + dt * 1000); updateContacts(state, dt);
    if (time - lastCapture > 67) captureNow();
    if (state.staff.phase === 'lifted' && !completed) { completed = true; completionVisible = true; captureNow(); tone(523, 0.06, 0.8); toast('你亲手演成了“龙宫得宝”。点回放看看这一棒，再保存自己的演出。', 6500); }
    if (time >= MAX_DURATION) { running = false; captureNow(); autoSave(); toast('演出已达20分钟，录制已暂停。请保存这一折。'); }
  } else if (mode === 'replay') {
    if (playing) { cursor = Math.min(recording.duration, cursor + dt * 1000); if (cursor >= recording.duration) playing = false; }
    state = sample(recording, cursor);
  }
  if (now - lastAutoSave > 4000 && dirty) { autoSave(); lastAutoSave = now; }
  updateCoach(now);
  drawTheatre(ctx, state, solvePose(state), { time: now, backstage, selected, handles: getHandles(state), targets: getGripTargets(state), canGrip: canGrip(state), showGuides: mode === 'perform' });
  if(coachEnabled) drawCoachOverlay(ctx,feedback,now,{focus:now<coachFocusUntil});
  interfaceState(); requestAnimationFrame(frame);
}
try {
  const previous = localStorage.getItem(AUTO);
  if (previous) { const recovered = parseRecording(previous); if (recovered.duration > 500) { recording = recovered; time = recovered.duration; cursor = recovered.duration; mode = 'replay'; state = sample(recording, cursor); dirty=true; toast('已恢复上次离开时的演出。可回放，或从此处续演。', 6000); } }
} catch { toast('上次的临时记录未能恢复，可以在存档菜单导入文件。'); }
refreshArchive(); requestAnimationFrame(frame);
