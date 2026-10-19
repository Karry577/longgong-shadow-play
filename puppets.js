/* Art rig atlas: generated for this project from the user's chosen museum head reference.
 * The reference itself is not redistributed here. Crops below are sprite-animation source rectangles.
 */
const atlasUrl = new URL('./assets/traditional-puppet-atlas.png', import.meta.url);
let atlas=null, loading=null, crops=[];
// The generated sheet has optical rather than equal-width columns. These
// inspected source rectangles keep a muzzle or a sleeve from being sliced off.
const REGIONS=[
 [0,0,375,314],[385,0,303,314],[735,0,189,310],[982,0,208,310],
 [57,315,220,313],[425,315,200,313],[738,310,69,323],[943,308,310,325],
 [0,625,328,321],[375,632,313,316],[704,633,224,309],[981,633,273,310],
 [54,946,232,308],[382,946,254,308],[733,946,125,308],[941,942,313,312]
];
export const PUPPET_NAMES={wukong:'孙悟空',dragon:'东海龙王'};
export function puppetsReady(){return !!atlas;}
export function loadPuppetAtlas(){
  if(loading)return loading;
  loading=new Promise((resolve,reject)=>{
    const im=new Image();im.onload=()=>{
      const c=document.createElement('canvas');c.width=im.naturalWidth;c.height=im.naturalHeight;
      const cx=c.getContext('2d',{willReadFrequently:true});cx.drawImage(im,0,0);
      const pixels=cx.getImageData(0,0,c.width,c.height).data;
      for(let i=0;i<16;i++){
        const [rx,ry,rw,rh]=REGIONS[i],x0=rx,x1=Math.min(c.width-1,rx+rw-1),y0=ry,y1=Math.min(c.height-1,ry+rh-1);
        let l=x1,r=x0,t=y1,b=y0;
        for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)if(pixels[(y*c.width+x)*4+3]>75){l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);b=Math.max(b,y);}
        crops[i]={x:Math.max(x0,l-1),y:Math.max(y0,t-1),w:Math.max(1,Math.min(x1,r+1)-Math.max(x0,l-1)+1),h:Math.max(1,Math.min(y1,b+1)-Math.max(y0,t-1)+1)};
      }
      atlas=im;resolve(im);
    };im.onerror=()=>{loading=null;reject(new Error('影人分件资源未能载入，请刷新重试'));};im.src=atlasUrl.href;
  });return loading;
}
function sprite(ctx,id,x,y,w,h,px=.5,py=.5){
  if(!atlas)return;
  const s=crops[id];ctx.drawImage(atlas,s.x,s.y,s.w,s.h,x-w*px,y-h*py,w,h);
}
function bone(ctx,id,a,b,width,{hand=false,flip=false}={}){
  const length=Math.hypot(b.x-a.x,b.y-a.y);
  ctx.save();ctx.translate(a.x,a.y);ctx.rotate(Math.atan2(b.y-a.y,b.x-a.x)-Math.PI/2);
  if(flip)ctx.scale(-1,1);
  // The hand extends beyond the wrist anchor; leather hinge points overlap.
  sprite(ctx,id,0,-5,width,length+(hand?22:10),.5,0);
  ctx.restore();
}
function hinge(ctx,p,r,backstage){
  ctx.save();ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.fillStyle='#b9873d';ctx.fill();ctx.lineWidth=.8;ctx.strokeStyle='#452d20';ctx.stroke();
  ctx.beginPath();ctx.arc(p.x,p.y,1.2,0,Math.PI*2);ctx.fillStyle='#e9c783';ctx.fill();
  if(backstage){ctx.beginPath();ctx.arc(p.x,p.y,r+4,0,Math.PI*2);ctx.strokeStyle='#b25535';ctx.stroke();}ctx.restore();
}
/** Pure accessory motion. performance.offset is the authoritative media/score
 * clock in seconds, including while paused or seeking. Never integrate RAF time
 * into it: drawing the same offset always yields the same leather-piece pose. */
export function getPuppetMotion(role,{time=0,speaking=false,performance}={}){
  const supplied=performance!==null&&typeof performance==='object';
  const active=supplied?performance.speaking===true:!!speaking;
  const raw=supplied?performance.offset:time/1000;
  const offset=Number.isFinite(raw)&&raw>=0&&raw<=1e9?raw:0;
  const cue=supplied&&Number.isFinite(performance.cueIndex)?Math.max(0,Math.floor(performance.cueIndex))%3:0;
  // paused deliberately does not reset the pose. A paused media clock stays at
  // its supplied offset; a seek while paused can still draw the new position.
  const strength=active?Math.min(1,offset/.14):0;
  const dragon=role==='dragon',beat=offset*(dragon?5.2:6.7),headAmplitude=(dragon ? .074 : .082)+cue*.003;
  return {
    headAngle:strength*headAmplitude*Math.sin(beat)+strength*.008*Math.sin(offset*11.3),
    waistAngle:strength*.012*Math.sin(offset*3.1-.2),
    tasselAngle:strength*.11*Math.sin(offset*4.1-.65),
    tailX:strength*5.5*Math.sin(offset*3.5-.8),
    tailY:strength*3*Math.sin(offset*3.5-1.2),
  };
}
function crownTassel(ctx,role,angle){
  const dragon=role==='dragon';
  ctx.save();ctx.translate(dragon?43:-68,dragon?-86:-79);ctx.rotate(angle);
  ctx.beginPath();ctx.moveTo(0,0);ctx.bezierCurveTo(dragon?12:-7,8,dragon?14:-16,21,dragon?23:-27,32);
  ctx.strokeStyle='#4c3323';ctx.lineWidth=3.8;ctx.lineCap='round';ctx.stroke();
  ctx.strokeStyle=dragon?'#c59d51':'#a33c2b';ctx.lineWidth=2.4;ctx.stroke();
  ctx.beginPath();ctx.moveTo(dragon?2:-2,1);ctx.bezierCurveTo(dragon?9:-9,12,dragon?19:-17,24,dragon?18:-22,35);
  ctx.strokeStyle='#d9ae60';ctx.lineWidth=1.2;ctx.stroke();ctx.restore();
}
export function drawPuppet(ctx,role,state,pose,{backstage=false,time=0,speaking=false,performance}={}){
  if(!atlas)return {body:{x:state.body.x,y:state.body.y-5},left:state.hands.left,right:state.hands.right};
  // A left-facing long-sleeved role folds its elbows below the shoulders.
  // Reflecting the two-link solution preserves both rigid lengths and wrists.
  if(role==='dragon')pose={...pose,...Object.fromEntries(['left','right'].map(id=>[id,{...pose[id],elbow:{x:pose[id].shoulder.x+pose[id].wrist.x-pose[id].elbow.x,y:pose[id].shoulder.y+pose[id].wrist.y-pose[id].elbow.y}}]))};
  const offset=role==='dragon'?8:0,b=state.body,hip={x:b.x,y:b.y-5};
  const motion=getPuppetMotion(role,{time,speaking,performance});
  const knees={left:{x:b.x-23,y:b.y+34},right:{x:b.x+25,y:b.y+34}},feet=pose.feet;
  ctx.save();ctx.globalAlpha=backstage?1:.95;ctx.globalCompositeOperation='multiply';
  ctx.shadowColor='rgba(67,38,13,.16)';ctx.shadowBlur=backstage?0:1.4;ctx.shadowOffsetX=1;
  for(const id of ['left','right']){
    bone(ctx,offset+4,hip,knees[id],role==='dragon'?33:30);
    bone(ctx,offset+5,knees[id],feet[id],role==='dragon'?45:39,{flip:id==='left'});
  }
  bone(ctx,offset+2,pose.left.shoulder,pose.left.elbow,role==='dragon'?35:27);
  bone(ctx,offset+3,pose.left.elbow,pose.left.wrist,role==='dragon'?28:22,{hand:true});
  if(role==='wukong'){
    ctx.beginPath();ctx.moveTo(b.x-25,b.y+5);ctx.bezierCurveTo(b.x-115,b.y-5,b.x-122+motion.tailX,b.y-90+motion.tailY,b.x-86+motion.tailX,b.y-79+motion.tailY);ctx.strokeStyle='#8c572d';ctx.lineWidth=7;ctx.lineCap='round';ctx.stroke();ctx.strokeStyle='#ddae5d';ctx.lineWidth=2;ctx.stroke();
    // Only the torso plate turns at the waist. Shoulder/wrist links and all rod
    // anchors keep their engine coordinates, under the overlapping leather.
    ctx.save();ctx.translate(hip.x,hip.y);ctx.rotate(motion.waistAngle);sprite(ctx,1,0,-55,91,125,.5,.15);ctx.restore();
    ctx.save();ctx.translate(b.x,b.y-65);ctx.rotate(motion.headAngle);crownTassel(ctx,role,motion.tasselAngle);sprite(ctx,0,0,0,158,139,.70,.93);ctx.restore();
  }else{
    ctx.save();ctx.translate(hip.x,hip.y);ctx.rotate(motion.waistAngle);sprite(ctx,9,0,-55,115,164,.5,.20);ctx.restore();
    ctx.save();ctx.translate(b.x,b.y-67);ctx.rotate(motion.headAngle);crownTassel(ctx,role,motion.tasselAngle);sprite(ctx,8,0,0,139,151,.53,.82);ctx.restore();
  }
  bone(ctx,offset+2,pose.right.shoulder,pose.right.elbow,role==='dragon'?36:29);
  bone(ctx,offset+3,pose.right.elbow,pose.right.wrist,role==='dragon'?29:23,{hand:true});
  for(const p of [pose.left.shoulder,pose.left.elbow,pose.right.shoulder,pose.right.elbow])hinge(ctx,p,3.7,backstage);
  if(backstage){for(const p of [hip,knees.left,knees.right,state.hands.left,state.hands.right,{x:b.x,y:b.y-(role==='dragon'?67:65)}])hinge(ctx,p,3.5,true);}
  ctx.restore();
  return {body:hip,left:state.hands.left,right:state.hands.right};
}
export function drawPuppetPortrait(ctx,role,{width=300,height=360,background=true}={}){
  ctx.clearRect(0,0,width,height);
  if(background){const g=ctx.createRadialGradient(width*.5,height*.4,5,width*.5,height*.5,height*.8);g.addColorStop(0,'#f6e8bf');g.addColorStop(1,'#c7a86c');ctx.fillStyle=g;ctx.fillRect(0,0,width,height);}
  if(!atlas){ctx.fillStyle='#8c7045';ctx.font='15px SimSun,serif';ctx.textAlign='center';ctx.fillText('影人分件载入中',width/2,height/2);return;}
  const id=role==='dragon'?15:7,s=crops[id],h=height*.92,w=Math.min(width*.94,h*s.w/s.h);
  ctx.save();ctx.globalCompositeOperation=background?'multiply':'source-over';sprite(ctx,id,width*.5,height*.51,w,h,.5,.5);ctx.restore();
}
