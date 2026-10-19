import { getGripTargets, getHandles, solvePose, canGrip, cloneState } from './engine.js?v=0.2.0';
import { predictMotion } from './coach-model.js?v=0.2.0';

export const LABEL_TEXT = Object.freeze({ approach:'先移身接近', left_align:'左手对位', right_align:'右手对位', left_unsteady:'左手尚不稳定', right_unsteady:'右手尚不稳定', settle:'双手停稳中', ready:'可以合握', resize:'调节棒长', lift:'准备提棒', raised:'已经提起' });
const NAMES = {left:'左手',right:'右手',body:'身体'};
const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
const direction = (dx,dy) => `${Math.abs(dx)>7?(dx>0?'右':'左'):''}${Math.abs(dy)>7?(dy>0?'下':'上'):''}` || '轻轻微调';

export function handFacts(samples, current) {
  const targets = getGripTargets(current), pose = solvePose(current);
  return Object.fromEntries(['left','right'].map(hand => {
    const history = samples.filter((s,i) => !i || s.t>samples[i-1].t);
    let exits=0, reversals=0, travel=0, previousVelocity=null, activeMs=0;
    for(let i=1;i<history.length;i++) {
      const a=history[i-1],b=history[i],dt=b.t-a.t;
      if(dt<=0||dt>350) continue;
      const p=a.state.hands[hand],q=b.state.hands[hand],prevTarget=getGripTargets(a.state)[hand],target=getGripTargets(b.state)[hand];
      const v={x:(q.x-p.x)/dt*1000,y:(q.y-p.y)/dt*1000},speed=Math.hypot(v.x,v.y);
      travel+=distance(p,q); activeMs+=dt;
      if(distance(p,prevTarget)<=20 && distance(q,target)>20) exits++;
      if(previousVelocity && speed>10 && Math.hypot(previousVelocity.x,previousVelocity.y)>10 && v.x*previousVelocity.x+v.y*previousVelocity.y<0) reversals++;
      if(speed>10) previousVelocity=v;
    }
    const target=targets[hand],wrist=current.hands[hand],dx=target.x-wrist.x,dy=target.y-wrist.y;
    const speed=activeMs>0?travel/activeMs*1000:0;
    return [hand,{hand,name:NAMES[hand],dx,dy,distance:distance(wrist,target),direction:direction(dx,dy),target,wrist,
      reach:distance(pose[hand].shoulder,target),contact:current.contacts[hand],progress:clamp(current.contacts[hand]/0.28,0,1),exits,reversals,speed,
      unsteady:(exits>=2 || (reversals>=3 && speed>18)) && current.staff.phase==='standing'}];
  }));
}

/** Facts always gate the learned classification: the model never invents a target or a detached grip. */
export function analyzeActionWindow(samples, model, {paused=false,replay=false}={}) {
  if(!Array.isArray(samples)||!samples.length) throw new Error('需要至少一个动作帧');
  const current=samples[samples.length-1].state, hands=handFacts(samples,current);
  const targets=getGripTargets(current),handles=getHandles(current);
  const prediction=model?predictMotion(samples,model):null;
  let issue,hand=null,title,hint,bodyTarget=null;
  const held=current.staff.phase!=='standing';
  let bodyReversals=0,bodyTravel=0,lastBodyV=null,bodyOnly=samples.length>3;
  const initial=samples[0].state;
  for(let i=1;i<samples.length;i++) {
    const a=samples[i-1],b=samples[i],dt=b.t-a.t;
    if(dt<=0||dt>350) continue;
    const v={x:(b.state.body.x-a.state.body.x)/dt*1000,y:(b.state.body.y-a.state.body.y)/dt*1000},speed=Math.hypot(v.x,v.y);
    bodyTravel+=distance(a.state.body,b.state.body);
    if(lastBodyV && speed>10 && Math.hypot(lastBodyV.x,lastBodyV.y)>10 && v.x*lastBodyV.x+v.y*lastBodyV.y<0) bodyReversals++;
    if(speed>10) lastBodyV=v;
    for(const id of ['left','right']) if(Math.hypot((b.state.hands[id].x-b.state.body.x)-(initial.hands[id].x-initial.body.x),(b.state.hands[id].y-b.state.body.y)-(initial.hands[id].y-initial.body.y))>3) bodyOnly=false;
  }
  if(current.staff.phase==='lifted') { issue='raised'; title='棒已提起，双手仍在握点'; hint='这一棒已演成。接着用身体杆走位，或拖时间轴复盘。'; }
  else if(held && current.staff.size!==1) { issue='resize'; title=current.staff.size===0?'已合握，先让棒短些':'棒太短，调回合手长度'; hint=current.staff.size===0?'两手由合握辅助联动。按一次“小些”，再执身体杆上提。':'按一次“大些”，再向上提身体杆。'; }
  else if(held) { issue='lift';hand='body';title='双手已锁住，慢慢上提身体杆';hint=current.staff.lift>0?`已上提 ${Math.round(current.staff.lift)}，还差约 ${Math.max(1,Math.ceil(37-current.staff.lift))} 的幕面距离。继续向上，不必再动手杆。`:'棒长合手了。沿身体杆上方的光线缓缓上提。'; }
  else if(hands.left.reach>180 || hands.right.reach>180) {
    issue='approach';hand='body';bodyTarget={x:current.staff.x-110,y:520};
    title='先移身，手才够得到握点';hint=`身体杆往${direction(bodyTarget.x-current.body.x,bodyTarget.y-current.body.y)}移；现在${hands.left.reach>180&&hands.right.reach>180?'双手':hands.left.reach>180?'左手':'右手'}的握点超出手臂可达范围。`;
  } else if(canGrip(current)) {
    issue='ready';title='两只手都已停稳，可以合握';hint='按“握稳神铁”或 G。之后两手随身体杆联动。';
  } else {
    const unstable=['left','right'].filter(id=>hands[id].unsteady && hands[id].distance<55);
    const predictedHand=prediction?.label.startsWith('left_')?'left':prediction?.label.startsWith('right_')?'right':null;
    if(bodyOnly && bodyReversals>=3 && bodyTravel>10 && (hands.left.distance<55 || hands.right.distance<55)) {
      hand='body';issue='body_unsteady';title='先稳住身体杆，两只手正被它一起带动';hint=`身体杆最近反复 ${bodyReversals} 次，双手相对身体的位置没有变化。先停身杆，再单独微调没到位的手。`;
    } else if(unstable.length) {
      hand=unstable.includes(predictedHand)?predictedHand:unstable[0]; issue=`${hand}_unsteady`;
      title=`${NAMES[hand]}还没握稳，先停住这根杆`;
      hint=hands[hand].exits>=2?`最近1.2秒，${NAMES[hand]} ${hands[hand].exits} 次离开握点。先${hands[hand].distance>20?`往${hands[hand].direction}轻移回圈内，再`:''}停住片刻。`:`${NAMES[hand]}杆最近来回反向 ${hands[hand].reversals} 次。移入光圈后停住，别反复补偿。`;
    } else if(hands.left.distance>20 || hands.right.distance>20) {
      hand=predictedHand&&hands[predictedHand].distance>20?predictedHand:hands.left.distance>hands.right.distance?'left':'right';issue=`${hand}_align`;
      title=`${NAMES[hand]}未对准，往${hands[hand].direction}轻移`;
      const other=hand==='left'?'right':'left';
      hint=`调${NAMES[hand]}杆，沿虚线把手腕送进光圈。${hands[other].distance<=20?`${NAMES[other]}已经到位，保持不动。`:`${NAMES[other]}也未到位；先完成这一只手。`}`;
    } else if(!canGrip(current)) {
      hand=hands.left.contact<hands.right.contact?'left':'right';issue='settle';title='位置已对，两手再停稳片刻';
      hint=paused&&!replay?'录制暂停了。点“继续录制”，再保持两手不动，让停稳圈走满。':`${NAMES[hand]}还需停稳约 ${Math.max(0.01,0.28-hands[hand].contact).toFixed(2)} 秒。不要再来回拖杆。`;
    } else { issue='ready'; title='两只手都已停稳，可以合握'; hint='按“握稳神铁”或 G。之后两手随身体杆联动。'; }
  }
  let guide=null;
  if(hand==='body') {
    const to=bodyTarget?{x:handles.body.x+bodyTarget.x-current.body.x,y:handles.body.y+bodyTarget.y-current.body.y}:issue==='body_unsteady'?{...handles.body}:{x:handles.body.x,y:handles.body.y-70};
    guide={hand,from:handles.body,to,handle:handles.body,label:issue==='approach'?'先移身体杆':issue==='body_unsteady'?'先稳身体杆':'身体杆向上'};
  } else if(hand && !held) guide={hand,from:current.hands[hand],to:targets[hand],handle:handles[hand],label:`调${NAMES[hand]}杆`};
  return {issue,hand,title,hint,hands,guide,held,replay,prediction,modelAvailable:!!model};
}

export function snapshotSample(state,t) { return {t,state:cloneState(state)}; }

export function drawCoachOverlay(ctx, feedback, now, {focus=false}={}) {
  if(!feedback) return;
  const {guide,hands,held}=feedback;
  ctx.save();
  const colors={left:'#3f756e',right:'#a05238',body:'#466f64'};
  if(!held) for(const id of ['left','right']) {
    const fact=hands[id];
    ctx.beginPath();ctx.arc(fact.target.x,fact.target.y,23,0,Math.PI*2);ctx.strokeStyle=colors[id];ctx.lineWidth=1.4;ctx.setLineDash([2,4]);ctx.stroke();ctx.setLineDash([]);
    ctx.font='13px SimSun,serif';ctx.fillStyle=colors[id];ctx.textAlign='center';ctx.fillText(id==='left'?'左':'右',fact.target.x+(id==='left'?-33:33),fact.target.y+5);
  }
  if(guide) {
    const color=colors[guide.hand],dx=guide.to.x-guide.from.x,dy=guide.to.y-guide.from.y,d=Math.hypot(dx,dy);
    ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=focus?3:2;
    if(d>10) {
      const ux=dx/d,uy=dy/d,start={x:guide.from.x+ux*14,y:guide.from.y+uy*14},end={x:guide.to.x-ux*12,y:guide.to.y-uy*12};
      ctx.setLineDash([6,6]);ctx.beginPath();ctx.moveTo(start.x,start.y);ctx.lineTo(end.x,end.y);ctx.stroke();ctx.setLineDash([]);
      ctx.beginPath();ctx.moveTo(end.x,end.y);ctx.lineTo(end.x-ux*11-uy*5,end.y-uy*11+ux*5);ctx.lineTo(end.x-ux*11+uy*5,end.y-uy*11-ux*5);ctx.closePath();ctx.fill();
    }
    const h=guide.handle,r=31+(focus?Math.sin(now/150)*3:0);
    ctx.beginPath();ctx.arc(h.x,h.y,r,0,Math.PI*2);ctx.strokeStyle=color;ctx.lineWidth=focus?3:1.7;ctx.stroke();
    ctx.font='14px SimSun,serif';ctx.textAlign='center';ctx.fillStyle='#f2dfb6';ctx.strokeStyle='#423526';ctx.lineWidth=3;ctx.strokeText(guide.label,h.x,h.y-40);ctx.fillText(guide.label,h.x,h.y-40);
  }
  ctx.restore();
}
