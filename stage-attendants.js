/* Original cut-leather supporting players. Their hands share the weapon's
 * rigid transform; no independent floating prop is drawn during a carry. */
const TAU=Math.PI*2;
const finite=(v,fallback)=>Number.isFinite(v)?v:fallback;
const point=(p,fallback)=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)?p:fallback;
const ink='#38271e',gold='#e3b876',light='#f3d49c';

export function getWeaponSupportPoints(weapon={}){
  const x=finite(weapon.x,820),y=finite(weapon.y,445),a=finite(weapon.angle,0);
  const horizontal=1-Math.abs(Math.cos(a));
  // Carry at two distant points; when standing it upright, take lower grips
  // on the actual shaft. This leaves room for two separate bodies beside it
  // instead of bringing both heads, shoulders and elbows into one column.
  return [28-106*horizontal,48+18*horizontal].map(v=>({x:x-Math.sin(a)*v,y:y+Math.cos(a)*v}));
}
function elbow(a,b,bend=1,length=43){
  const dx=b.x-a.x,dy=b.y-a.y,d=Math.max(.001,Math.hypot(dx,dy));
  const h=Math.sqrt(Math.max(0,length*length-d*d/4));
  return{x:(a.x+b.x)/2-dy/d*h*bend,y:(a.y+b.y)/2+dx/d*h*bend};
}
function knee(hip,foot,facing,scale){
  const upper=36*scale,lower=40*scale,dx=foot.x-hip.x,dy=foot.y-hip.y,d=Math.max(.001,Math.hypot(dx,dy));
  const along=(upper*upper-lower*lower+d*d)/(2*d),height=Math.sqrt(Math.max(0,upper*upper-along*along));
  return{x:hip.x+dx/d*along+dy/d*height*facing,y:hip.y+dy/d*along-dx/d*height*facing};
}
function footStep(phase,facing,scale,amount){
  const cycle=((phase/TAU)%1+1)%1,stance=.58;
  const progress=cycle<stance?cycle/stance:(cycle-stance)/(1-stance);
  const swing=cycle>=stance;
  const smooth=progress*progress*(3-2*progress);
  const along=swing?1-2*smooth:-1+2*progress;
  return{x:-facing*along*11*scale*amount,lift:swing?Math.sin(progress*Math.PI)*8*scale*amount:0};
}

/** x/y are the hip/body-rod anchor. All returned points are stage coordinates. */
export function getAttendantPose(player={},support){
  const x=finite(player.x,840),y=finite(player.y,520),facing=player.facing===-1?-1:1;
  const scale=Math.max(.5,Math.min(1.2,finite(player.scale,1)));
  const phase=finite(player.walkPhase,0),amount=player.walking===false?0:Math.max(0,Math.min(1,finite(player.walkAmount,1)));
  const steps=[footStep(phase,facing,scale,amount),footStep(phase+Math.PI,facing,scale,amount)];
  const bob=Math.abs(Math.sin(phase))*2*scale*amount;
  const hip={x,y:y-bob},head={x:x+facing*2*scale,y:y-147*scale-bob};
  const leftShoulder={x:x-19*scale,y:y-85*scale-bob},rightShoulder={x:x+19*scale,y:y-85*scale-bob};
  const grip=point(support,null);
  const left=point(player.hands?.left,grip?{x:grip.x-7*scale,y:grip.y}:{x:x-34*scale,y:y-32*scale-bob});
  const right=point(player.hands?.right,grip?{x:grip.x+7*scale,y:grip.y}:{x:x+35*scale,y:y-40*scale-bob});
  const legHips=[{x:hip.x-10*scale,y:hip.y},{x:hip.x+10*scale,y:hip.y}];
  const feet=steps.map((step,i)=>({x:x+(i?23:-23)*scale+step.x,y:y+66*scale-step.lift}));
  return{hip,head,facing,scale,walking:amount>0,legHips,left:{shoulder:leftShoulder,elbow:elbow(leftShoulder,left,1,43*scale),wrist:left},right:{shoulder:rightShoulder,elbow:elbow(rightShoulder,right,-1,43*scale),wrist:right},knees:feet.map((foot,i)=>knee(legHips[i],foot,facing,scale)),feet};
}
function circle(c,x,y,r,fill,stroke=ink){c.beginPath();c.arc(x,y,r,0,TAU);if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.lineWidth=.9;c.stroke();}}
function curve(c,points,color,width=1){c.beginPath();c.moveTo(...points[0]);for(const p of points.slice(1))p.length===6?c.bezierCurveTo(...p):p.length===4?c.quadraticCurveTo(...p):c.lineTo(...p);c.strokeStyle=color;c.lineWidth=width;c.lineCap='round';c.lineJoin='round';c.stroke();}
function leaf(c,x,y,rx,ry,a=0){c.save();c.translate(x,y);c.rotate(a);c.moveTo(-rx,0);c.bezierCurveTo(-rx*.3,-ry*1.4,rx*.4,-ry*1.4,rx,0);c.bezierCurveTo(rx*.4,ry*1.4,-rx*.3,ry*1.4,-rx,0);c.closePath();c.restore();}
function petalHoles(c,x,y,r,n=8){for(let i=0;i<n;i++){const a=i*TAU/n;leaf(c,x+Math.cos(a)*r*.62,y+Math.sin(a)*r*.62,r*.31,r*.10,a);}c.moveTo(x+r*.13,y);c.arc(x,y,r*.13,0,TAU);c.closePath();}
function plate(c,outline,holes,fill){c.beginPath();outline(c);if(holes)holes(c);c.fillStyle=fill;c.fill('evenodd');c.strokeStyle=ink;c.lineWidth=1.35;c.stroke();}
function joint(c,p,scale=1){circle(c,p.x,p.y,3.3*scale,'#c39a58');circle(c,p.x,p.y,1.1*scale,ink,null);}
function limb(c,a,b,width,color){
  const length=Math.hypot(b.x-a.x,b.y-a.y);c.save();c.translate(a.x,a.y);c.rotate(Math.atan2(b.y-a.y,b.x-a.x));
  plate(c,c=>{c.moveTo(-4,-width*.4);c.quadraticCurveTo(length*.4,-width*.6,length+3,-width*.29);c.quadraticCurveTo(length+8,0,length+3,width*.29);c.quadraticCurveTo(length*.4,width*.6,-4,width*.4);c.closePath();},c=>{for(let x=12;x<length-10;x+=10){leaf(c,x,-width*.16,3,1.1,-.35);leaf(c,x+3,width*.16,3,1.1,.35);}},color);
  curve(c,[[5,-width*.31],[length-8,-width*.21]],gold,.65);c.restore();
}
function hand(c,p,scale=1){c.save();c.translate(p.x,p.y);c.scale(scale,scale);plate(c,c=>{c.moveTo(-7,-4);c.lineTo(5,-6);c.quadraticCurveTo(15,-7,14,-2);c.lineTo(10,0);c.quadraticCurveTo(15,4,10,6);c.lineTo(-5,5);c.closePath();},c=>leaf(c,4,1,5,1),'#b86a42');c.restore();}
function boot(c,p,facing,scale=1){c.save();c.translate(p.x,p.y);c.scale(facing*scale,scale);plate(c,c=>{c.moveTo(-8,-18);c.lineTo(8,-18);c.lineTo(10,-5);c.quadraticCurveTo(21,-8,24,-4);c.quadraticCurveTo(28,4,16,5);c.lineTo(-11,5);c.closePath();},c=>leaf(c,7,0,10,1.2),'#3c4435');curve(c,[[-7,-12],[6,-12]],gold,.8);c.restore();}
function head(c,type){
  if(type==='shrimp'){
    // A long serrated rostrum and swept antennae identify the shrimp soldier.
    plate(c,c=>{c.moveTo(-18,-18);c.quadraticCurveTo(2,-36,21,-17);c.lineTo(34,-9);c.lineTo(29,-2);c.lineTo(54,0);c.lineTo(47,6);c.lineTo(31,9);c.lineTo(24,22);c.lineTo(-4,24);c.lineTo(-18,8);c.closePath();},c=>{leaf(c,2,-14,8,2,-.2);leaf(c,8,14,9,1.6);leaf(c,-11,-2,4,7,-.1);},'#b45c3c');
    plate(c,c=>{c.moveTo(-20,-17);c.lineTo(-28,-32);c.lineTo(-17,-30);c.lineTo(-10,-44);c.lineTo(1,-34);c.lineTo(12,-43);c.lineTo(19,-29);c.lineTo(28,-25);c.lineTo(21,-15);c.quadraticCurveTo(-2,-26,-20,-17);c.closePath();},c=>{leaf(c,-9,-29,6,1.4,-.4);leaf(c,12,-28,6,1.4,.4);},'#713e2d');
    curve(c,[[10,-28],[29,-72,55,-77,70,-56]],ink,2.6);curve(c,[[10,-28],[29,-72,55,-77,70,-56]],'#b3653c',1.4);
    curve(c,[[2,-29],[9,-83,44,-93,56,-74]],ink,2.2);curve(c,[[2,-29],[9,-83,44,-93,56,-74]],gold,1.1);
    for(let i=0;i<4;i++)curve(c,[[33+i*4,0],[34+i*4,-5+i*.5]],ink,.8);
    circle(c,21,-3,5.2,light);circle(c,23,-3,2.7,ink,null);curve(c,[[15,-10],[23,-14],[29,-8]],ink,1.8);curve(c,[[31,13],[40,10]],ink,.9);
  }else{
    // Crab shell crown, eye stalks and pierced claw plates, all flat leather.
    plate(c,c=>{c.moveTo(-22,-21);c.lineTo(-30,-30);c.lineTo(-29,-41);c.lineTo(-13,-36);c.lineTo(-8,-48);c.lineTo(4,-38);c.lineTo(16,-47);c.lineTo(23,-34);c.lineTo(35,-38);c.lineTo(34,-23);c.lineTo(25,-16);c.quadraticCurveTo(0,-26,-22,-21);c.closePath();},c=>{petalHoles(c,3,-31,9,6);leaf(c,-20,-29,4,1.5,-.5);leaf(c,24,-28,4,1.5,.5);},'#934c32');
    plate(c,c=>{c.moveTo(-18,-20);c.quadraticCurveTo(3,-30,23,-15);c.lineTo(30,-3);c.lineTo(44,0);c.lineTo(43,7);c.lineTo(29,12);c.lineTo(24,23);c.lineTo(2,28);c.lineTo(-17,16);c.closePath();},c=>{leaf(c,-8,-2,5,8);leaf(c,10,16,10,1.4);},'#ba7042');
    curve(c,[[13,-14],[16,-26]],ink,3);circle(c,17,-27,4.5,'#cd8e4f');circle(c,18,-27,2.1,ink,null);
    curve(c,[[25,-8],[31,-19]],ink,3);circle(c,32,-21,4.8,'#cd8e4f');circle(c,33,-21,2.3,ink,null);
    curve(c,[[27,13],[37,12]],ink,1.2);curve(c,[[3,21],[14,25],[19,21]],ink,.9);
  }
}

export function drawAttendant(c,player={},support,{backstage=false}={}){
  const pose=getAttendantPose(player,support),type=player.type==='crab'?'crab':'shrimp';
  const scale=pose.scale;
  const pigment=type==='crab'?'#985032':'#a85b3b';
  c.save();c.lineJoin='round';c.shadowColor='rgba(61,34,18,.16)';c.shadowBlur=1.4;
  for(let i=0;i<2;i++){limb(c,pose.legHips[i],pose.knees[i],18*scale,i?'#9d5738':'#75452e');limb(c,pose.knees[i],pose.feet[i],13*scale,'#8f5738');boot(c,pose.feet[i],pose.facing,scale);joint(c,pose.knees[i],scale);}
  limb(c,pose.left.shoulder,pose.left.elbow,24*scale,'#79452f');limb(c,pose.left.elbow,pose.left.wrist,15*scale,'#8f5232');
  c.save();c.translate(pose.hip.x,pose.hip.y);c.scale(scale,scale);
  plate(c,c=>{c.moveTo(-22,-105);c.quadraticCurveTo(0,-116,23,-105);c.lineTo(32,-75);c.lineTo(23,-35);c.lineTo(32,7);c.lineTo(18,26);c.lineTo(0,19);c.lineTo(-20,25);c.lineTo(-33,8);c.lineTo(-23,-34);c.lineTo(-31,-76);c.closePath();},c=>{petalHoles(c,0,-75,16);for(let row=0;row<4;row++){const yy=-46+row*15;leaf(c,-14,yy,6,1.5,-.4);leaf(c,13,yy,6,1.5,.4);}leaf(c,0,10,8,2);},pigment);
  for(let row=0;row<4;row++)curve(c,[[-23,-37+row*13],[-4,-27+row*13,23,-37+row*13]],'#d5a464',.9);
  curve(c,[[-22,-101],[-12,-77,-22,-45],[-15,12]],gold,.9);curve(c,[[22,-101],[12,-77,22,-45],[15,12]],gold,.9);
  plate(c,c=>{c.moveTo(-26,-30);c.lineTo(26,-30);c.lineTo(27,-21);c.lineTo(-27,-21);c.closePath();},c=>{leaf(c,-12,-25,7,1);leaf(c,12,-25,7,1);},'#c09a56');circle(c,0,-25,4,'#486052');
  // Separate shoulder armour has actual transparent perforations.
  for(const side of [-1,1]){c.save();c.translate(side*24,-92);c.scale(side,1);plate(c,c=>{c.moveTo(-8,-8);c.quadraticCurveTo(15,-19,26,1);c.lineTo(20,16);c.lineTo(10,9);c.lineTo(0,13);c.closePath();},c=>{leaf(c,7,-2,6,1.7,.3);leaf(c,17,4,5,1.4,.6);},type==='crab'?'#72402e':'#79603a');c.restore();}
  c.restore();
  c.save();c.translate(pose.head.x,pose.head.y);c.scale(pose.facing*scale,scale);head(c,type);c.restore();
  limb(c,pose.right.shoulder,pose.right.elbow,24*scale,pigment);limb(c,pose.right.elbow,pose.right.wrist,16*scale,'#ad6740');
  for(const arm of [pose.left,pose.right]){joint(c,arm.shoulder,scale);joint(c,arm.elbow,scale);hand(c,arm.wrist,scale);joint(c,arm.wrist,scale);}
  // The supporting figures also have three fine sticks, like the main actors.
  for(const p of [pose.hip,pose.left.wrist,pose.right.wrist])curve(c,[[p.x,p.y],[p.x+(p===pose.hip?5:12),684]],backstage?'#704b2e':'rgba(104,73,38,.48)',p===pose.hip?1.9:1.1);
  c.restore();return pose;
}

export function drawStageAttendants(ctx,scene={},options={}){
  const players=Array.isArray(scene.attendants)?scene.attendants:[];
  const supports=getWeaponSupportPoints(scene.weapon);
  return players.map((player,i)=>drawAttendant(ctx,player,player.carrying&&scene.weapon?.visible?supports[i%2]:undefined,options));
}
