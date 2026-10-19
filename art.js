/* Scene drawing and articulated leather-sprite renderer. */
import { drawPuppet, drawPuppetPortrait, loadPuppetAtlas, puppetsReady } from './puppets.js?v=0.7.0';
import { solvePose as rigPose, getHandles as rigHandles } from './engine.js?v=0.2.0';
import { drawStageAttendants } from './stage-attendants.js?v=0.12.0';
export { drawPuppetPortrait, loadPuppetAtlas, puppetsReady };

const WIDTH = 1280;
const HEIGHT = 720;
const palette = {
  ink: '#3c241d', oxblood: '#7d3024', red: '#a4472d', vermilion: '#c95b35',
  amber: '#d49a44', gold: '#efc678', light: '#f5dba5', darkWood: '#291b19',
  teal: '#355c57', paleTeal: '#678778', parchment: '#edce95',
};
let sceneryCache = null;
const sceneryCaches = new Map();
let grainCache = null;

const point = (p, fallback) => p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : fallback;
const mix = (a, b, n) => ({ x: a.x + (b.x - a.x) * n, y: a.y + (b.y - a.y) * n });
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function canvas(w, h) {
  let c;
  if (typeof OffscreenCanvas !== 'undefined') c = new OffscreenCanvas(w, h);
  else if (typeof document !== 'undefined') c = document.createElement('canvas');
  if (!c) return null;
  c.width = w;
  c.height = h;
  return c;
}

function line(ctx, pts, color, width = 1) {
  if (!pts.length) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function circle(ctx, x, y, r, fill, stroke = null, width = 1) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }
}

function label(ctx, text, x, y, size = 14, color = palette.ink, align = 'center') {
  ctx.font = `500 ${size}px "Noto Serif SC", "Songti SC", "SimSun", serif`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

function flower(ctx, x, y, radius, petals = 8, color = palette.light) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  for (let i = 0; i < petals; i++) {
    ctx.rotate(Math.PI * 2 / petals);
    ctx.beginPath();
    ctx.ellipse(radius * 0.61, 0, radius * 0.34, radius * 0.17, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  circle(ctx, 0, 0, radius * 0.17, color);
  ctx.restore();
}

function cloud(ctx, x, y, size, color, alpha = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size, size);
  ctx.globalAlpha *= alpha;
  ctx.beginPath();
  ctx.moveTo(-54, 12);
  ctx.bezierCurveTo(-69, 8, -65, -8, -51, -9);
  ctx.bezierCurveTo(-54, -25, -29, -31, -23, -16);
  ctx.bezierCurveTo(-16, -41, 14, -35, 13, -13);
  ctx.bezierCurveTo(37, -27, 55, -11, 45, 3);
  ctx.bezierCurveTo(70, 2, 71, 20, 46, 22);
  ctx.lineTo(-42, 22);
  ctx.bezierCurveTo(-62, 22, -66, 13, -54, 12);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-39, 10);
  ctx.bezierCurveTo(-12, 12, -12, -6, 0, -6);
  ctx.bezierCurveTo(16, -6, 11, 9, -2, 8);
  ctx.strokeStyle = palette.parchment;
  ctx.globalAlpha *= 0.62;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

function waveBand(ctx, y, alpha, color, amplitude = 12) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  for (let row = 0; row < 4; row++) {
    ctx.beginPath();
    for (let x = 64; x <= 1216; x += 4) {
      const yy = y + row * 9 + Math.sin(x / 40 + row * 0.6) * amplitude;
      if (x === 64) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function pillar(ctx, x, y, h, scale = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  const wash = ctx.createLinearGradient(-28, 0, 28, 0);
  wash.addColorStop(0, '#557567');
  wash.addColorStop(0.48, '#8b9c79');
  wash.addColorStop(1, '#4c7063');
  ctx.fillStyle = wash;
  ctx.strokeStyle = '#365b51';
  ctx.lineWidth = 2;
  ctx.fillRect(-22, 0, 44, h);
  ctx.strokeRect(-22, 0, 44, h);
  for (let i = 15; i < h - 5; i += 55) {
    ctx.beginPath();
    ctx.moveTo(-19, i);
    ctx.bezierCurveTo(34, i + 5, -34, i + 44, 19, i + 50);
    ctx.strokeStyle = '#c0b67e';
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  ctx.fillStyle = '#526b58';
  ctx.fillRect(-34, -12, 68, 15);
  ctx.fillRect(-31, h - 2, 62, 18);
  ctx.fillStyle = '#a29a67';
  ctx.fillRect(-37, -19, 74, 7);
  ctx.fillRect(-37, h + 16, 74, 7);
  ctx.restore();
}

function paintScenery(ctx, mode = 'palaceInside') {
  const bg = ctx.createRadialGradient(590, 278, 65, 640, 300, 790);
  bg.addColorStop(0, mode==='treasury'?'#f4dfaa':'#f9e8bc');
  bg.addColorStop(0.58, mode==='palaceOutside'?'#d9d2a8':'#ebcf96');
  bg.addColorStop(1, mode==='treasury'?'#8d794f':'#ae8552');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Translucent silk, lit from behind.
  ctx.save();
  ctx.globalAlpha = 0.045;
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#705332';
  for (let x = 78; x < 1210; x += 4) {
    ctx.beginPath(); ctx.moveTo(x, 55); ctx.lineTo(x, 621); ctx.stroke();
  }
  for (let y = 56; y < 620; y += 5) {
    ctx.beginPath(); ctx.moveTo(75, y); ctx.lineTo(1205, y); ctx.stroke();
  }
  ctx.restore();

  // Distant sea-palace roof and doorway, all original paths.
  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = '#668574';
  ctx.beginPath();
  ctx.moveTo(875, 204); ctx.lineTo(935, 174); ctx.lineTo(991, 136);
  ctx.quadraticCurveTo(1004, 122, 1011, 110);
  ctx.quadraticCurveTo(1018, 123, 1033, 135);
  ctx.lineTo(1100, 176); ctx.quadraticCurveTo(1128, 197, 1172, 198);
  ctx.lineTo(1148, 215); ctx.lineTo(902, 220); ctx.closePath(); ctx.fill();
  ctx.fillRect(936, 220, 183, 292);
  ctx.fillStyle = '#355d55';
  ctx.beginPath(); ctx.moveTo(975, 510); ctx.lineTo(975, 310);
  ctx.bezierCurveTo(975, 249, 1075, 249, 1075, 310); ctx.lineTo(1075, 510); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#ddc88f'; ctx.lineWidth = 3;
  for (let i = 0; i < 4; i++) ctx.strokeRect(985 + i * 21, 306, 17, 173);
  ctx.restore();
  if (mode === 'palaceOutside') {
    // Before the king appears, a distant closed gate stands across the water.
    ctx.save();ctx.globalAlpha=.31;
    ctx.fillStyle='#466b5b';ctx.fillRect(968,298,112,213);
    ctx.strokeStyle='#c9b786';ctx.lineWidth=2;
    for(let x=978;x<1080;x+=15)ctx.strokeRect(x,312,9,180);
    circle(ctx,1015,399,3,'#d4b06e');circle(ctx,1031,399,3,'#d4b06e');
    ctx.restore();
    pillar(ctx,1127,252,283,.91);
  } else if (mode === 'treasury') {
    // The treasury is a different cut scenery flat, with a rock opening and
    // shutter-like carved niches; the iron itself is revealed separately.
    ctx.save();ctx.globalAlpha=.26;ctx.fillStyle='#526c57';
    ctx.beginPath();ctx.moveTo(644,558);ctx.lineTo(666,258);ctx.lineTo(710,188);ctx.lineTo(797,157);ctx.lineTo(912,177);ctx.lineTo(1032,251);ctx.lineTo(1067,559);ctx.closePath();ctx.fill();
    ctx.fillStyle='#c8bb85';ctx.beginPath();ctx.ellipse(852,408,148,184,0,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='#355449';ctx.lineWidth=5;
    for(let x=340;x<620;x+=94){ctx.strokeRect(x,267,64,219);ctx.beginPath();ctx.moveTo(x+7,317);ctx.lineTo(x+57,317);ctx.moveTo(x+7,420);ctx.lineTo(x+57,420);ctx.stroke();}
    ctx.restore();pillar(ctx,1127,222,313,.91);pillar(ctx,157,232,310,.82);
  } else {
    pillar(ctx,1127,222,313,.91);pillar(ctx,157,232,310,.82);
    // Palace hall: a second rank of columns and pierced upper lattice.
    ctx.save();ctx.globalAlpha=.2;ctx.fillStyle='#617b61';ctx.fillRect(265,168,721,18);
    ctx.strokeStyle='#5e785e';ctx.lineWidth=2;
    for(let x=280;x<985;x+=31){ctx.beginPath();ctx.moveTo(x,190);ctx.lineTo(x+14,214);ctx.lineTo(x+28,190);ctx.stroke();}
    ctx.restore();
  }

  // Corals and rocks anchor the depth of the stage.
  ctx.save();
  ctx.globalAlpha = 0.27;
  ctx.strokeStyle = '#9c5c43'; ctx.lineWidth = 8; ctx.lineCap = 'round';
  for (const [x, h] of [[206, 84], [228, 57], [190, 51], [1160, 74], [1180, 44]]) {
    ctx.beginPath(); ctx.moveTo(x, 578); ctx.quadraticCurveTo(x - 8, 578 - h / 2, x, 578 - h);
    ctx.moveTo(x - 2, 558 - h / 3); ctx.lineTo(x - 19, 542 - h / 3);
    ctx.moveTo(x - 1, 556 - h / 2); ctx.lineTo(x + 15, 542 - h / 2); ctx.stroke();
  }
  ctx.restore();
  waveBand(ctx, 548, 0.24, '#315f59', 7);
  waveBand(ctx, 581, 0.33, '#315f59', 11);
  ctx.save();
  ctx.globalAlpha = 0.32;
  ctx.fillStyle = '#5d7b67';
  ctx.beginPath(); ctx.moveTo(70, 612); ctx.lineTo(91, 578); ctx.lineTo(128, 586);
  ctx.lineTo(150, 568); ctx.lineTo(182, 608); ctx.closePath(); ctx.fill();
  ctx.restore();

  drawProscenium(ctx,mode);
}

function drawProscenium(ctx,mode='palaceInside',foreground=false){
  // Carved wood frame, hanging curtains and a deep lower rail.
  ctx.fillStyle = palette.darkWood;
  ctx.fillRect(0, 0, WIDTH, 46);
  ctx.fillRect(0, 0, 54, HEIGHT);
  ctx.fillRect(1226, 0, 54, HEIGHT);
  ctx.fillRect(0, 626, WIDTH, 94);
  ctx.fillStyle = '#68412b';
  ctx.fillRect(52, 43, 1176, 9);
  ctx.fillRect(52, 620, 1176, 10);
  ctx.strokeStyle = '#bd8b4b'; ctx.lineWidth = 1;
  ctx.strokeRect(39, 35, 1202, 603);
  ctx.strokeRect(45, 40, 1190, 592);
  ctx.fillStyle = '#713027';
  for (const flip of [false, true]) {
    ctx.save();
    if (flip) { ctx.translate(1280, 0); ctx.scale(-1, 1); }
    ctx.beginPath(); ctx.moveTo(54, 51); ctx.lineTo(167, 51);
    ctx.bezierCurveTo(152, 113, 122, 132, 80, 137);
    ctx.bezierCurveTo(84, 251, 82, 359, 57, 403); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#b47741'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(66, 56); ctx.bezierCurveTo(76, 107, 107, 117, 142, 105);
    ctx.moveTo(75, 140); ctx.lineTo(63, 361); ctx.stroke();
    for (let y = 169; y < 350; y += 27) flower(ctx, 65, y, 4, 6, '#b07747');
    ctx.restore();
  }
  for (let x = 80; x < 1210; x += 45) {
    line(ctx, [{ x, y: 17 }, { x: x + 10, y: 17 }, { x: x + 10, y: 28 },
      { x: x + 25, y: 28 }, { x: x + 25, y: 13 }, { x: x + 35, y: 13 }], '#976b3d', 1.4);
  }
  if(!foreground){
    label(ctx, '水  晶  宫', 1025, 236, 15, '#32564c');
    label(ctx, mode==='palaceOutside'?'东海 · 宫前':mode==='treasury'?'东海 · 海藏':'水晶宫 · 殿内', 192, 88, 16, '#826444');
  }
  label(ctx, '一 人 一 台 戏', 640, 24, 16, '#d5ad72');
  label(ctx, '执杆入戏', 95, 683, 15, '#b28a59');
  label(ctx, '影 随 手 动', 1165, 683, 14, '#b28a59');
}

function buildCaches(mode = 'palaceInside') {
  if (!sceneryCaches.has(mode)) {
    const flat = canvas(WIDTH, HEIGHT);
    if (flat) { paintScenery(flat.getContext('2d'),mode);sceneryCaches.set(mode,flat); }
  }
  sceneryCache=sceneryCaches.get(mode)||null;
  if (!grainCache) {
    grainCache = canvas(WIDTH, HEIGHT);
    if (grainCache) {
      const g = grainCache.getContext('2d');
      let seed = 78419;
      const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      for (let i = 0; i < 16000; i++) {
        const x = rand() * WIDTH, y = 50 + rand() * 570;
        g.fillStyle = `rgba(62,39,17,${0.025 + rand() * 0.055})`;
        g.fillRect(x, y, rand() < 0.85 ? 1 : 2, 1);
      }
    }
  }
}

function drawPedestal(ctx, time) {
  ctx.save();
  ctx.translate(850, 590);
  ctx.shadowColor = '#dcaa4d'; ctx.shadowBlur = 14 + Math.sin(time * 0.0014) * 3;
  ctx.fillStyle = '#6b7660';
  ctx.beginPath(); ctx.ellipse(0, -9, 80, 15, 0, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#556858';
  ctx.beginPath(); ctx.moveTo(-79, -10); ctx.lineTo(-69, 9); ctx.quadraticCurveTo(0, 27, 69, 9);
  ctx.lineTo(79, -10); ctx.quadraticCurveTo(0, 7, -79, -10); ctx.fill();
  ctx.strokeStyle = '#d1b578'; ctx.lineWidth = 1.3;
  ctx.beginPath(); ctx.ellipse(0, -10, 70, 11, 0, 0, Math.PI * 2); ctx.stroke();
  // Fixed yin-yang seal; it never follows the iron's size or position.
  ctx.save(); ctx.translate(0, -11); ctx.scale(1, 0.29);
  circle(ctx, 0, 0, 32, '#c8b07a', '#b59862', 2);
  ctx.beginPath(); ctx.moveTo(0, -32); ctx.arc(0, 0, 32, -Math.PI / 2, Math.PI / 2);
  ctx.arc(0, 16, 16, Math.PI / 2, Math.PI * 1.5, true);
  ctx.arc(0, -16, 16, Math.PI / 2, -Math.PI / 2); ctx.fillStyle = '#486156'; ctx.fill();
  circle(ctx, 0, -16, 4.5, '#486156'); circle(ctx, 0, 16, 4.5, '#d0b780');
  ctx.restore();
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath(); ctx.moveTo(i * 24 - 9, 9);
    ctx.quadraticCurveTo(i * 24 - 1, -1, i * 24 + 8, 9);
    ctx.strokeStyle = '#d1b578'; ctx.lineWidth = 1; ctx.stroke();
  }
  ctx.restore();
}

function drawStaff(ctx, staff, time, backstage) {
  const x = Number.isFinite(staff.x) ? staff.x : 850;
  const y = Number.isFinite(staff.y) ? staff.y : 455;
  const size = clamp(Math.round(staff.size || 0), 0, 2);
  const tops = [-290, -145, -70];
  const widths = [35, 24, 16];
  const top = y + tops[size], bottom = y + 100, w = widths[size];
  ctx.save();
  if (staff.phase !== 'standing') {
    ctx.shadowColor = 'rgba(250,195,80,0.7)'; ctx.shadowBlur = 19;
  }
  const metal = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
  metal.addColorStop(0, '#302f29'); metal.addColorStop(0.38, '#655b42');
  metal.addColorStop(0.57, '#827251'); metal.addColorStop(1, '#332b22');
  ctx.fillStyle = metal; ctx.strokeStyle = '#57422a'; ctx.lineWidth = 1.5;
  ctx.fillRect(x - w / 2, top, w, bottom - top);
  ctx.strokeRect(x - w / 2, top, w, bottom - top);
  ctx.shadowBlur = 0;
  const cap = Math.max(18, Math.min(42, (bottom - top) * 0.13));
  for (const yy of [top, bottom - cap]) {
    ctx.fillStyle = '#c28b39'; ctx.fillRect(x - w / 2 - 2, yy, w + 4, cap);
    ctx.strokeStyle = '#f4d58e'; ctx.lineWidth = 1;
    ctx.strokeRect(x - w / 2 + 1, yy + 4, w - 2, cap - 8);
    line(ctx, [{ x: x - w / 2 - 2, y: yy + cap / 2 }, { x: x + w / 2 + 2, y: yy + cap / 2 }], '#7c5024', 1.5);
  }
  if (size === 0) {
    ctx.save(); ctx.translate(x, y - 116);
    for (let i = 0; i < 5; i++) label(ctx, '定海神珍铁'[i], 0, i * 23, 13, '#dec28b');
    ctx.restore();
  } else {
    ctx.save(); ctx.translate(x, top + cap + 17);
    const text = '如意金箍棒';
    const spacing = size === 1 ? 20 : 17;
    for (let i = 0; i < text.length; i++) label(ctx, text[i], 0, i * spacing, size === 1 ? 11 : 9, '#d3b675');
    ctx.restore();
  }
  if (backstage) {
    circle(ctx, x, y, 4, '#ffd995', '#f3c576');
    line(ctx, [{ x: x - 23, y }, { x: x + 23, y }], '#f4cf84', 1);
  }
  ctx.restore();
}

// Original flat leather-cut figure vocabulary: pigment fields, pierced voids,
// continuous vine borders, rigid overlapping pieces and small thread/rivet eyes.
const leatherInk = '#30251e';
const skinLight = '#f5d9a5';
const pathCache = new Map();
function artPath(d) {
  if (!pathCache.has(d)) {
    if (pathCache.size > 360) pathCache.clear();
    pathCache.set(d, new Path2D(d));
  }
  return pathCache.get(d);
}
function cutLeaf(cx, cy, rx, ry, angle = 0) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const p = (x, y) => `${(cx + x * c - y * s).toFixed(2)},${(cy + x * s + y * c).toFixed(2)}`;
  return `M${p(-rx, 0)} C${p(-rx * .25, -ry * 1.36)} ${p(rx * .45, -ry * 1.36)} ${p(rx, 0)} C${p(rx * .35, ry * 1.36)} ${p(-rx * .4, ry * 1.36)} ${p(-rx, 0)}Z `;
}
function roundCut(x, y, r) {
  return `M${x-r},${y}a${r},${r} 0 1 0 ${r*2},0a${r},${r} 0 1 0 ${-r*2},0Z `;
}
function rosetteCuts(x, y, r, n = 8) {
  let d = '';
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2;
    d += cutLeaf(x + Math.cos(a) * r * .66, y + Math.sin(a) * r * .66, r * .25, r * .095, a);
  }
  return d + roundCut(x, y, r * .12);
}
function leatherPiece(ctx, outline, holes, pigment, edge = leatherInk, weight = 1.25) {
  const path = artPath(outline + (holes || ''));
  ctx.fillStyle = pigment;
  ctx.fill(path, 'evenodd');
  ctx.strokeStyle = edge;
  ctx.lineWidth = weight;
  ctx.lineJoin = 'round';
  ctx.stroke(artPath(outline));
  if (holes) { ctx.lineWidth = weight * .46; ctx.stroke(artPath(holes)); }
}
function carvedLine(ctx, d, color = skinLight, width = .85) {
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round';
  ctx.stroke(artPath(d));
}
function vineBorder(ctx, d, color = '#e7bc79', width = 1) {
  carvedLine(ctx, d, color, width);
}
function localCloudCut(x, y, s = 1) {
  return `M${x-12*s},${y+3*s} C${x-20*s},${y+2*s} ${x-18*s},${y-6*s} ${x-11*s},${y-5*s} C${x-9*s},${y-15*s} ${x+2*s},${y-13*s} ${x+2*s},${y-5*s} C${x+10*s},${y-12*s} ${x+18*s},${y-4*s} ${x+12*s},${y+2*s} C${x+7*s},${y+7*s} ${x+2*s},${y+2*s} ${x-2*s},${y+3*s} C${x-5*s},${y+8*s} ${x-11*s},${y+7*s} ${x-12*s},${y+3*s}Z `;
}
function limb(ctx, a, b, width, color, backstage, decorations = true) {
  ctx.save(); ctx.translate(a.x, a.y);
  const len = Math.round(Math.hypot(b.x-a.x,b.y-a.y)*100)/100;
  ctx.rotate(Math.atan2(b.y-a.y,b.x-a.x));
  const w = width / 2;
  const outline = `M-5,${-w*.8} Q${len*.3},${-w*1.12} ${len-7},${-w*.63} Q${len+7},0 ${len-7},${w*.63} Q${len*.36},${w*1.05} -5,${w*.8} Q-11,0 -5,${-w*.8}Z `;
  let holes = '';
  if (decorations) {
    for (let x = 17; x < len-14; x += 13) {
      holes += cutLeaf(x,-w*.27,4.2,1.7,-.4) + cutLeaf(x+3,w*.27,4.2,1.7,.4);
    }
    holes += roundCut(3,0,2.2) + roundCut(len-2,0,2.0);
  }
  leatherPiece(ctx,outline,holes,color,leatherInk,1.3);
  if (decorations) {
    carvedLine(ctx,`M7,${-w*.63} Q${len*.5},${-w*.85} ${len-12},${-w*.42} M7,${w*.63} Q${len*.5},${w*.82} ${len-12},${w*.42}`,'#e1b275',.8);
    // A cuff is a separate coloured band, not metallic armour.
    ctx.fillStyle = '#234e45'; ctx.fillRect(Math.max(8,len-18),-w*.64,6,w*1.28);
    carvedLine(ctx,`M${len-17},${-w*.54}V${w*.54} M${len-13},${-w*.54}V${w*.54}`,'#efc985',.65);
  }
  ctx.restore();
  if (backstage) line(ctx,[a,b],'rgba(248,218,151,.56)',.7);
}
function joint(ctx, p, r, backstage) {
  const radius = Math.min(r,4.3);
  circle(ctx,p.x,p.y,radius,'#d1a667',leatherInk,.8);
  circle(ctx,p.x,p.y,Math.max(1.2,radius*.37),leatherInk);
  carvedLine(ctx,`M${p.x-1.5},${p.y-.6}l2.7,1.2`,'#f8dfad',.55);
  if (backstage) circle(ctx,p.x,p.y,radius+4.5,null,'rgba(247,207,121,.7)',.8);
}
function hand(ctx,wrist,elbow,color='#b85639') {
  ctx.save(); ctx.translate(wrist.x,wrist.y);
  ctx.rotate(Math.atan2(wrist.y-elbow.y,wrist.x-elbow.x));
  const outline = 'M-6,-6 L2,-7 Q8,-12 13,-10 L22,-4 Q25,-1 22,1 L16,0 L21,4 Q22,7 18,8 L9,6 Q4,11 -3,7 L-6,5Z ';
  const holes = cutLeaf(10,-4,4,1.25,.28) + cutLeaf(11,3,4.2,1.1,.25) + roundCut(0,0,1.8);
  leatherPiece(ctx,outline,holes,color,leatherInk,1.1);
  carvedLine(ctx,'M4,-1 Q10,-1 15,2 M5,6 Q7,1 6,-3','#f2d09a',.75);
  ctx.restore();
}
function drawHead(ctx,center,time,backstage) {
  ctx.save(); ctx.translate(center.x+3,center.y+3); ctx.scale(.82,.82);
  // Broad round forehead, flying brow and projecting monkey muzzle in profile.
  // The red cloth is tied behind the hair; it is deliberately NOT a headband.
  const silhouette = 'M-36,-24 Q-30,-50 -6,-55 Q24,-60 40,-43 Q51,-30 47,-10 Q48,-2 57,3 Q70,8 68,21 Q68,33 53,39 Q37,47 22,42 L15,53 L-5,50 L-9,33 Q-29,36 -37,22 Q-48,13 -44,-2 Q-46,-13 -36,-24Z ';
  let pierce = cutLeaf(-23,-27,9,2.5,-.8) + cutLeaf(-30,-12,7,2.2,-1.15) + cutLeaf(-19,32,7,2,.6);
  pierce += cutLeaf(10,-43,11,2.1,.02) + cutLeaf(27,-37,6,1.8,.6);
  leatherPiece(ctx,silhouette,pierce,'#c99755',leatherInk,1.55);
  // The crown of the head is an inked hair plate with etched, comb-like strands.
  const hair = 'M-38,-23 Q-35,-50 -9,-55 Q13,-59 28,-49 L19,-43 Q2,-48 -6,-38 L-12,-21 L-23,-6 L-32,0 L-41,-8Z ';
  leatherPiece(ctx,hair,cutLeaf(-18,-39,7,1.7,-.5)+cutLeaf(-28,-29,7,1.6,-.8),'#242e28',leatherInk,1);
  for (let i=0;i<7;i++) carvedLine(ctx,`M${-31+i*5},${-30-i*.8}q3,-10 10,-14`,'#d6ad70',.65);
  // A rear knot and pierced cloth tails replace the later tight fillet/crown.
  leatherPiece(ctx,'M-36,-34 Q-48,-47 -54,-40 L-53,-30 L-42,-22 L-35,-25Z ',cutLeaf(-46,-34,4,1.4,.6),'#912e29');
  leatherPiece(ctx,'M-48,-28 Q-65,-17 -59,5 L-65,18 L-51,12 Q-41,-5 -41,-22Z ',cutLeaf(-53,-5,11,2,-1.25),'#a83d2d');
  leatherPiece(ctx,'M-43,-26 Q-69,-27 -73,-11 L-62,-10 L-61,0 Q-47,-7 -40,-19Z ',cutLeaf(-58,-16,8,1.8,-.4),'#872c26');
  // Carved face fields. Negative spaces remain genuinely transparent.
  const face = 'M-9,-31 Q10,-46 32,-34 Q47,-27 44,-10 L47,0 Q39,5 31,9 L26,28 Q17,38 4,29 L-9,17 L-17,0Z ';
  const faceCuts = cutLeaf(20,-9,10,7,-.08) + cutLeaf(0,14,5.5,1.3,-.9) + cutLeaf(15,35,6,1.3,.15);
  leatherPiece(ctx,face,faceCuts,'#e4b469','#743b27',1.05);
  // Monkey cheek fur wraps round the face, instead of a smooth human jawline.
  leatherPiece(ctx,'M-22,-21 Q-5,-17 -6,-1 L1,9 L-4,21 L13,35 L10,43 Q-8,36 -20,28 L-29,21 L-24,12 L-32,1Z ',cutLeaf(-14,9,7,1.2,1.05)+cutLeaf(-11,24,6,1.2,.65),'#4a3b2b',leatherInk,.9);
  leatherPiece(ctx,'M-8,-48 Q16,-56 35,-40 L43,-25 L37,-20 Q21,-37 -1,-31 L-9,-21 L-18,-28Z ',cutLeaf(9,-43,9,1.2,.16)+cutLeaf(28,-34,7,1.2,.6),'#3b3929',leatherInk,.9);
  // One principal circular eye, not a front-facing cartoon pair.
  circle(ctx,22,-9,10.9,'#e5d9ad',leatherInk,1.1);
  circle(ctx,22,-9,8.7,'#4f7252',leatherInk,.65);
  circle(ctx,22,-9,6.6,'#eee0b1',leatherInk,.65);
  circle(ctx,24,-9,4.6,leatherInk);
  circle(ctx,25.5,-11,1.3,'#fff1cb');
  for(let i=0;i<13;i++){const a=-2.8+i*.29;carvedLine(ctx,`M${22+Math.cos(a)*12.4},${-9+Math.sin(a)*12.4}l${Math.cos(a)*3.5},${Math.sin(a)*3.5}`,'#613e29',.6);}
  leatherPiece(ctx,'M-5,-22 Q12,-39 34,-25 L43,-27 L38,-17 Q19,-29 2,-15 L-5,-15Z ',cutLeaf(16,-26,9,1.3,.04),'#255447',leatherInk,1);
  carvedLine(ctx,'M13,-18L9,-23 M19,-20L17,-26 M27,-19L28,-24 M33,-16L37,-20',leatherInk,.9);
  // Nostrils, curled upper lip and incised cheek lines make the monkey mask legible.
  leatherPiece(ctx,'M28,3 Q46,-4 60,5 Q72,12 66,27 Q60,40 43,37 Q27,37 21,24 Q19,12 28,3Z ',cutLeaf(43,33,8,1.1,.03),'#e3bd7b',leatherInk,1.15);
  // A short, broad, round-nostrilled muzzle; no human pointed nose or red lips.
  leatherPiece(ctx,'M43,5 Q51,1 59,6 Q64,12 55,14 Q46,14 42,10Z ',cutLeaf(48,8,2.2,1.3,-.1)+cutLeaf(57,9,2.2,1.3,.1),'#946738',leatherInk,.85);
  carvedLine(ctx,'M31,23 Q47,33 64,22 M37,30 Q48,35 59,28',leatherInk,1.05);
  for(let i=0;i<8;i++)carvedLine(ctx,`M${-3+i*4.7},${-35+i*.38}q1,-4 4,-6`,'#795632',.6);
  for(let i=0;i<7;i++)carvedLine(ctx,`M${7+i*4},${31-i*.22}l2.2,4.8`,'#7f532f',.6);
  carvedLine(ctx,'M6,-2 Q1,8 10,17 M12,27Q19,31 26,26 M-1,39L-1,47 M4,42L6,49','#f4d8a4',.85);
  for(let i=0;i<8;i++)carvedLine(ctx,`M${-11+i*6},${-32-i%3*2}q0,-7 4,-9`,'#d5b27a',.7);
  for(let i=0;i<6;i++)carvedLine(ctx,`M${-19+i*4},${19+i*2}l-3,4`,'#cda96e',.65);
  // Monkey ear, two red points and conch-like pierced inner line.
  leatherPiece(ctx,'M-29,-1 Q-44,-4 -43,12 Q-42,27 -28,29 Q-15,25 -19,12 Q-18,3 -29,-1Z ',cutLeaf(-30,13,5.5,8,-.2),'#c88b55',leatherInk,1.2);
  circle(ctx,-32,5,2.1,'#a03128'); circle(ctx,-32,22,2.1,'#a03128');
  carvedLine(ctx,'M-34,9 Q-27,2 -24,11 Q-22,20 -30,20','#f9dcaa',.85);
  if (backstage) joint(ctx,{x:4,y:59},4.8,true);
  ctx.restore();
}
function drawBoot(ctx,foot,backstage,far=false) {
  ctx.save(); ctx.translate(foot.x,foot.y);
  const outline='M-10,-19 L8,-20 L12,-7 Q22,-8 31,-12 Q37,-7 32,0 Q20,8 -13,6 L-14,0Z ';
  leatherPiece(ctx,outline,cutLeaf(10,-1,13,1.7,-.07),far?'#343e32':'#30392f',leatherInk,1.35);
  carvedLine(ctx,'M-9,-14L6,-15 M-10,3Q11,5 29,-2','#dfb575',1);
  for(let i=0;i<4;i++) carvedLine(ctx,`M${-7+i*4},-12l1.5,7`,'#c3975b',.65);
  if(backstage) joint(ctx,{x:0,y:-10},3.2,true);
  ctx.restore();
}
function drawMonkey(ctx,state,pose,time,backstage) {
  const b=point(state.body,{x:420,y:520});
  const pl=pose.left||{},pr=pose.right||{};
  const ls=point(pl.shoulder,{x:b.x-22,y:b.y-58}),rs=point(pr.shoulder,{x:b.x+23,y:b.y-63});
  const shoulder=mix(ls,rs,.5);
  const hip=point(pose.hip,{x:b.x,y:b.y+18});
  const head=point(pose.head,{x:b.x-2,y:b.y-126});
  const lw=point(pl.wrist,point(state.hands?.left,{x:b.x-70,y:b.y-30}));
  const rw=point(pr.wrist,point(state.hands?.right,{x:b.x+110,y:b.y-80}));
  const le=point(pl.elbow,mix(ls,lw,.5)),re=point(pr.elbow,mix(rs,rw,.5));
  const lk=point(pose.knees?.left||pose.leftKnee,{x:hip.x-22,y:hip.y+27});
  const rk=point(pose.knees?.right||pose.rightKnee,{x:hip.x+24,y:hip.y+27});
  const lf=point(pose.feet?.left||pose.leftFoot,{x:hip.x-35,y:hip.y+52});
  const rf=point(pose.feet?.right||pose.rightFoot,{x:hip.x+41,y:hip.y+52});
  ctx.save(); ctx.lineJoin='round';
  ctx.shadowColor='rgba(70,36,20,.19)';ctx.shadowBlur=backstage?0:1.8;ctx.shadowOffsetX=1.3;ctx.shadowOffsetY=1;
  // Separate cut leather tail; restrained contour, not a cartoon spiral.
  carvedLine(ctx,`M${hip.x-14},${hip.y-11} C${hip.x-61},${hip.y-4} ${hip.x-88},${hip.y-42} ${hip.x-71},${hip.y-70} Q${hip.x-59},${hip.y-88} ${hip.x-50},${hip.y-72}`,leatherInk,8);
  carvedLine(ctx,`M${hip.x-14},${hip.y-11} C${hip.x-61},${hip.y-4} ${hip.x-88},${hip.y-42} ${hip.x-71},${hip.y-70} Q${hip.x-59},${hip.y-88} ${hip.x-50},${hip.y-72}`,'#a85a39',5.2);
  // Far arm is a darker pigment plate and is deliberately behind the trunk.
  limb(ctx,ls,le,23,'#74382b',backstage);limb(ctx,le,lw,16,'#8e4530',backstage);hand(ctx,lw,le,'#a65b3b');
  for(const [k,f,far] of [[lk,lf,true],[rk,rf,false]]) {
    limb(ctx,{x:hip.x+(far?-7:7),y:hip.y-4},k,21,far?'#6b3f2b':'#9a4b31',backstage);
    limb(ctx,k,f,16,far?'#62412c':'#9b5938',backstage);
    drawBoot(ctx,f,backstage,far);joint(ctx,k,4,backstage);
  }
  ctx.save();ctx.translate(shoulder.x,shoulder.y);
  // Slender wrapped martial coat, continuous borders and a divided cloud skirt.
  const coat='M-17,-15 L-9,-27 L12,-24 L26,-9 Q32,8 25,34 L18,57 L30,70 L22,84 L-22,84 L-31,70 L-22,56 Q-26,31 -29,7 L-24,-8Z ';
  let coatHoles=rosetteCuts(0,24,14,8);
  for(let y=2;y<57;y+=12) coatHoles+=cutLeaf(-18,y,4.4,1.5,-.8)+cutLeaf(19,y+4,4,1.5,.8);
  coatHoles+=cutLeaf(-7,47,8,2,.7)+cutLeaf(7,48,8,2,-.7);
  leatherPiece(ctx,coat,coatHoles,'#a23e2d',leatherInk,1.7);
  vineBorder(ctx,'M-20,-9 Q-13,14 -18,36 L-13,55 M23,-8 Q16,14 19,34 L13,56','#d9a565',1.05);
  const collar='M-9,-26 L-17,-14 L-4,10 L3,15 L20,-17 L11,-25 L0,-3Z ';
  leatherPiece(ctx,collar,cutLeaf(-8,-12,5,1.3,1.05)+cutLeaf(10,-12,5,1.3,-1.05),'#255449',leatherInk,1.05);
  carvedLine(ctx,'M-14,-14L-2,9L17,-18','#eac58b',1.1);
  // Dense, conforming skirt pieces with pierced ruyi-clouds and leaf borders.
  for(const [x,angle,tint] of [[-23,.22,'#7a3028'],[20,-.18,'#b94c30'],[-2,0,'#96372b']]) {
    ctx.save();ctx.translate(x,58);ctx.rotate(angle);
    let holes=localCloudCut(0,17,.58)+cutLeaf(0,35,8,2.2,Math.PI/2);
    for(let y=5;y<46;y+=9) holes+=roundCut(-9,y,1.05)+roundCut(9,y,1.05);
    leatherPiece(ctx,'M-13,-1 L13,-1 L15,42 L8,51 L0,47 L-8,51 L-15,42Z ',holes,tint,leatherInk,1.15);
    carvedLine(ctx,'M-10,2L-12,40L-6,46 M10,2L12,40L6,46','#e6bc7c',.75);
    ctx.restore();
  }
  // Woven waist sash, narrow hanging ties: cloth, not gilded armour.
  leatherPiece(ctx,'M-25,54 Q0,48 27,54 L27,63 Q0,58 -25,64Z ',
    cutLeaf(-13,57,7,1.4,0)+cutLeaf(11,57,7,1.4,0),'#d4aa61',leatherInk,1.1);
  leatherPiece(ctx,'M23,59 Q38,75 38,98 L30,101 Q34,80 18,63Z ',cutLeaf(30,80,9,1.5,1.3),'#2e5748');
  leatherPiece(ctx,'M21,60 Q28,78 25,104 L17,101 Q22,80 15,62Z ',cutLeaf(21,81,10,1.2,1.5),'#b34a31');
  circle(ctx,0,57,4,'#4b3425','#e7c186',1);
  ctx.restore();
  // A separate neck tab joins head and trunk without moving the shoulder pivots.
  leatherPiece(ctx,`M${b.x-9},${b.y-88}L${b.x+10},${b.y-86}L${b.x+11},${b.y-69}L${b.x-8},${b.y-70}Z `,'','#9b4c32',leatherInk,1.2);
  drawHead(ctx,head,time,backstage);
  // Near sleeve crosses the trunk; the shoulder peg is a visible real overlap.
  limb(ctx,rs,re,27,'#ac452f',backstage);limb(ctx,re,rw,18,'#b95e38',backstage);hand(ctx,rw,re,'#c17646');
  for(const p of [ls,rs,le,re]) joint(ctx,p,4.3,backstage);
  for(const p of [lw,rw]) joint(ctx,p,3.4,backstage);
  if(backstage){joint(ctx,hip,4.5,true);line(ctx,[shoulder,hip],'rgba(248,218,151,.68)',.8);}
  ctx.restore();
  return {body:hip,left:lw,right:rw};
}
function dragonHead(ctx,backstage) {
  const outline='M21,-26 Q2,-43 -21,-27 L-33,-12 L-52,-7 L-62,0 L-59,11 L-39,15 L-31,25 L-10,28 L-3,46 L19,38 L21,11 Q36,-2 21,-26Z ';
  let holes=cutLeaf(-21,-6,8,6,-.2)+cutLeaf(6,-17,8,2,-.6)+cutLeaf(-14,18,10,2,-.1);
  leatherPiece(ctx,outline,holes,'#477968',leatherInk,1.55);
  // Long dragon nose, ink brow, nostril and small tooth: unmistakable profile.
  leatherPiece(ctx,'M-51,-7 L-58,-15 L-61,-4 L-69,-1 L-64,6 L-50,8Z ',roundCut(-59,0,1.6),'#68856a');
  leatherPiece(ctx,'M-35,-12 Q-25,-26 -10,-12 L-15,-7 Q-24,-17 -34,-5Z ',cutLeaf(-23,-15,5,1.2,.1),'#263d32');
  circle(ctx,-22,-7,4.2,leatherInk);circle(ctx,-23.5,-8,1.2,skinLight);
  leatherPiece(ctx,'M-39,13L-32,14L-35,23Z ','','#e8c993',leatherInk,.8);
  // Antlered sea-king cap is a separate head piece, with cut-out jewels.
  const crown='M-21,-27 L-33,-43 L-26,-48 L-12,-37 L-14,-62 L-7,-66 L2,-46 L8,-69 L16,-67 L17,-43 L29,-56 L36,-52 L24,-27Z ';
  leatherPiece(ctx,crown,roundCut(-9,-49,2.7)+roundCut(9,-51,3.1)+cutLeaf(22,-42,6,1.7,-.8),'#b38b4f',leatherInk,1.35);
  leatherPiece(ctx,'M-27,-29Q-1,-40 27,-29L24,-20Q0,-29 -22,-20Z ',rosetteCuts(1,-29,5.4,6),'#3b6150',leatherInk,1);
  // Beard is one pierced leather plate, edged with long, continuous carved hairs.
  const beard='M-38,21 Q-25,27 -13,20 L4,32 Q11,60 -1,91 L-10,77 L-16,94 L-22,75 L-32,85 L-34,65 L-44,70 Q-36,47 -47,32Z ';
  let cuts='';for(let i=0;i<5;i++) cuts+=cutLeaf(-34+i*7,48+i%2*6,18,1.25,1.5-i*.05);
  leatherPiece(ctx,beard,cuts,'#443b2b',leatherInk,1.2);
  for(let i=0;i<5;i++) carvedLine(ctx,`M${-39+i*8},30 Q${-28+i*8},48 ${-29+i*6},${72+i%2*9}`,'#c7ad79',.65);
  carvedLine(ctx,'M-51,10Q-72,20 -76,6Q-79,-1 -85,7 M-44,18Q-63,37 -77,27','#9d7d46',2.1);
  if(backstage)joint(ctx,{x:9,y:39},4,true);
}
function drawDragonKing(ctx,time,backstage,settings={}) {
  const x=settings.x??1042,y=settings.y??524,scale=settings.scale??1;
  ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);
  ctx.shadowColor='rgba(39,55,39,.16)';ctx.shadowBlur=backstage?0:1.6;
  // Layered robe skirts and separate dark boots.
  drawBoot(ctx,{x:-23,y:49},backstage,true);drawBoot(ctx,{x:21,y:49},backstage,false);
  const robe='M-23,-151 L19,-155 Q37,-129 33,-102 L43,-42 L51,38 Q9,54 -45,36 L-33,-34 L-37,-110Z ';
  let robeCuts='';
  for(let row=0;row<5;row++) {
    const yy=-118+row*31;
    robeCuts+=rosetteCuts(row%2?-10:10,yy,10.5,8);
    robeCuts+=cutLeaf(-23,yy+10,6,2,-.8)+cutLeaf(26,yy+12,6,2,.8);
  }
  robeCuts+=localCloudCut(-13,24,.55)+localCloudCut(19,24,.55);
  leatherPiece(ctx,robe,robeCuts,'#3d6756',leatherInk,1.65);
  vineBorder(ctx,'M-25,-134Q-12,-112 -25,-91T-20,-46T-26,3L-32,31 M26,-133Q10,-111 26,-90T23,-45T31,4L39,32','#d0b77a',1.1);
  carvedLine(ctx,'M-38,34Q2,46 44,35 M-35,29Q2,41 41,30','#dcc58c',.8);
  // Wide hanging sleeves are separately hinged cut plates.
  const rearShoulder={x:22,y:-130},rearElbow={x:53,y:-85},rearWrist={x:37,y:-49};
  limb(ctx,rearShoulder,rearElbow,33,'#385346',backstage);limb(ctx,rearElbow,rearWrist,24,'#46634d',backstage);hand(ctx,rearWrist,rearElbow,'#7a8d60');
  leatherPiece(ctx,'M-17,-151L-5,-123L13,-151L21,-144L2,-111L-8,-114L-25,-143Z ',cutLeaf(-12,-136,7,1.5,1.1)+cutLeaf(10,-136,7,1.5,-1.1),'#bba36b',leatherInk,1);
  leatherPiece(ctx,'M-33,-56Q0,-62 36,-55L37,-47Q0,-52 -34,-46Z ',cutLeaf(-16,-53,9,1.4)+cutLeaf(17,-52,9,1.4),'#b79b5c');
  circle(ctx,1,-53,5.5,'#3f6151','#e2ca91',1.1);
  ctx.save();ctx.translate(-1,-184);dragonHead(ctx,backstage);ctx.restore();
  const shoulder={x:-28,y:-129},elbow={x:-61,y:-84},wrist={x:-91,y:-107};
  limb(ctx,shoulder,elbow,32,'#4c7560',backstage);limb(ctx,elbow,wrist,22,'#597e61',backstage);hand(ctx,wrist,elbow,'#82956a');
  for(const p of [shoulder,elbow,wrist,rearShoulder,rearElbow])joint(ctx,p,4.2,backstage);
  ctx.restore();
  if(settings.label!==false)label(ctx,'东海龙王',x+8,y+74,13,'#526d55');
}

/** Full-size, independent artwork plate; uses the same live puppet drawing paths. */
export function drawCharacterStudy(ctx,{width=900,height=700,backstage=false}={}) {
  ctx.save();ctx.clearRect(0,0,width,height);ctx.scale(width/900,height/700);
  const paper=ctx.createRadialGradient(430,280,60,450,350,650);
  paper.addColorStop(0,'#f8e7be');paper.addColorStop(1,'#d5b77f');
  ctx.fillStyle=paper;ctx.fillRect(0,0,900,700);
  ctx.strokeStyle='rgba(98,66,35,.2)';ctx.lineWidth=.7;
  for(let yy=91;yy<660;yy+=6){ctx.beginPath();ctx.moveTo(32,yy);ctx.lineTo(868,yy);ctx.stroke();}
  label(ctx,'龙 宫 得 宝 · 原 创 数 字 影 人',450,40,21,'#573b2b');
  label(ctx,'侧面猴相  /  适形镂纹  /  刚性分件',450,73,13,'#856241');
  const body={x:0,y:0};
  const ls={x:-22,y:-58},rs={x:23,y:-63};
  const lw={x:35,y:-5},rw={x:117,y:-61};
  const elbow=(a,b,bend)=>{const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy),h=Math.sqrt(Math.max(0,8100-d*d/4));return{x:a.x+dx/2-dy/d*h*bend,y:a.y+dy/2+dx/d*h*bend};};
  const pose={root:body,head:{x:-2,y:-126},hip:{x:0,y:18},left:{shoulder:ls,elbow:elbow(ls,lw,1),wrist:lw},right:{shoulder:rs,elbow:elbow(rs,rw,1),wrist:rw},knees:{left:{x:-22,y:45},right:{x:24,y:45}},feet:{left:{x:-35,y:70},right:{x:41,y:70}}};
  ctx.save();ctx.translate(263,506);ctx.scale(1.86,1.86);
  drawMonkey(ctx,{body,hands:{left:lw,right:rw}},pose,0,backstage);ctx.restore();
  drawDragonKing(ctx,0,backstage,{x:713,y:548,scale:1.39,label:false});
  label(ctx,'孙悟空 · 取棒前的武服与红巾',265,665,15,'#743d2c');
  label(ctx,'东海龙王 · 纹袍与龙首分片',692,665,15,'#3d5b47');
  ctx.strokeStyle='#a5814f';ctx.strokeRect(16,14,868,672);
  ctx.restore();
}
function handleMap(options, b) {
  const h = options.handles || {};
  return {
    body: point(h.body || h.root || h.center || h.middle, { x: b.x, y: 677 }),
    left: point(h.left || h.leftHand, { x: b.x - 100, y: 677 }),
    right: point(h.right || h.rightHand, { x: b.x + 100, y: 677 }),
  };
}

function drawRods(ctx, anchors, handles, backstage, selected, { partner = false } = {}) {
  for (const [key, thickness] of [['left', 2.2], ['right', 2.6], ['body', 4.0]]) {
    const a = anchors[key], h = handles[key];
    ctx.save();
    ctx.shadowColor = 'rgba(30,26,17,0.2)'; ctx.shadowBlur = 2;
    line(ctx, [a, h], partner ? 'rgba(53,91,81,.56)' : backstage ? '#643a27' : 'rgba(91,66,34,0.76)', thickness * (partner ? .58 : 1));
    const offset = thickness > 3 ? 1 : 0.5;
    line(ctx, [{ x: a.x - offset, y: a.y }, { x: h.x - offset, y: h.y }], partner ? 'rgba(208,184,122,.42)' : '#d5af66', partner ? .42 : 0.7);
    if (!partner && selected === key) line(ctx, [a, h], 'rgba(255,215,126,0.62)', thickness + 1.5);
    ctx.restore();
  }
}

function drawTargets(ctx, state, options, time) {
  const targets = options.targets || {};
  if (options.showGuides === false) return;
  for (const [key, tint] of [['left', '#8c5627'], ['right', '#8c5627']]) {
    const t = point(targets[key], null);
    if (!t) continue;
    const raw = Number(state.contacts?.[key]) || 0;
    const progress = clamp(raw <= 0.3 ? raw / 0.28 : raw, 0, 1);
    ctx.save();
    ctx.setLineDash([3, 5]);
    circle(ctx, t.x, t.y, 18 + Math.sin(time * 0.004) * 1.4, null,
      options.canGrip ? '#6b7c3e' : tint, 1.5);
    ctx.setLineDash([]);
    if (progress > 0) {
      ctx.beginPath(); ctx.arc(t.x, t.y, 22, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
      ctx.strokeStyle = '#697e3d'; ctx.lineWidth = 3.5; ctx.stroke();
    }
    line(ctx, [{ x: t.x - 5, y: t.y }, { x: t.x + 5, y: t.y }], '#9b743d', 1);
    line(ctx, [{ x: t.x, y: t.y - 5 }, { x: t.x, y: t.y + 5 }], '#9b743d', 1);
    ctx.restore();
  }
}

function drawHandles(ctx, handles, selected, backstage) {
  const names = { left: '左手杆', body: '身杆', right: '右手杆' };
  for (const key of ['left', 'body', 'right']) {
    const p = handles[key];
    const active = selected === key || selected === `${key}Handle`;
    ctx.save();
    ctx.shadowColor = active ? 'rgba(248,179,72,0.45)' : 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = active ? 17 : 7;
    const knob = ctx.createRadialGradient(p.x - 5, p.y - 7, 1, p.x, p.y, 24);
    knob.addColorStop(0, active ? '#e6af60' : '#c38946');
    knob.addColorStop(1, active ? '#9f4c28' : '#734328');
    circle(ctx, p.x, p.y, key === 'body' ? 24 : 21, knob, active ? '#ffe1a1' : '#b78b50', active ? 2 : 1.5);
    ctx.shadowBlur = 0;
    circle(ctx, p.x, p.y, key === 'body' ? 18 : 15, null, '#e5bc78', 0.8);
    line(ctx, [{ x: p.x - 6, y: p.y - 3 }, { x: p.x + 6, y: p.y - 3 }], '#f4d9a2', 1.5);
    line(ctx, [{ x: p.x - 6, y: p.y + 3 }, { x: p.x + 6, y: p.y + 3 }], '#f4d9a2', 1.5);
    label(ctx, names[key], p.x, p.y + 33, 12, active ? '#ffe0a5' : '#c8a574');
    if (backstage) label(ctx, key === 'body' ? '移身' : '牵手', p.x, p.y - 34, 11, '#c7aa76');
    ctx.restore();
  }
}

/**
 * Draw at logical 1280 × 720 coordinates. The host owns resizing and input.
 * time accepts requestAnimationFrame milliseconds. No timers or mutations.
 */
export function drawTheatre(ctx, state = {}, pose = {}, options = {}) {
  const time = Number.isFinite(options.time) ? options.time : 0;
  const backstage = Boolean(options.backstage);
  const b = point(state.body, { x: 420, y: 520 });
  const staff = state.staff || { x: 850, y: 455, size: 0, phase: 'standing', lift: 0 };
  const handles = handleMap(options, b);
  const selected = options.selected?.key || options.selected?.type || options.selected || null;
  buildCaches();
  ctx.save();
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  if (sceneryCache) ctx.drawImage(sceneryCache, 0, 0); else paintScenery(ctx);
  if (backstage) {
    ctx.fillStyle = 'rgba(91,57,28,0.11)'; ctx.fillRect(55, 53, 1170, 565);
    label(ctx, '背幕后 · 看见影人的关节与三根操杆', 640, 88, 16, '#795332');
  }
  // A soft lantern bloom and gently travelling water rays.
  ctx.save();
  const light = ctx.createRadialGradient(650, 325, 20, 650, 325, 390);
  light.addColorStop(0, `rgba(255,247,204,${0.11 + Math.sin(time * 0.001) * 0.015})`);
  light.addColorStop(1, 'rgba(255,244,193,0)');
  ctx.fillStyle = light; ctx.fillRect(210, 70, 850, 545);
  ctx.beginPath(); ctx.rect(60, 55, 1160, 560); ctx.clip();
  for (let i = 0; i < 3; i++) {
    const x = 300 + i * 300 + Math.sin(time * 0.00015 + i) * 55;
    ctx.beginPath(); ctx.moveTo(x, 52); ctx.lineTo(x + 80, 52);
    ctx.lineTo(x + 230, 617); ctx.lineTo(x + 75, 617); ctx.closePath();
    ctx.fillStyle = 'rgba(255,246,209,0.06)'; ctx.fill();
  }
  ctx.restore();
  cloud(ctx, 730, 136, 0.9, '#82957b', 0.22);
  cloud(ctx, 332, 169, 0.65, '#82957b', 0.18);
  drawDragonKing(ctx, time, backstage);
  drawPedestal(ctx, time);
  drawStaff(ctx, staff, time, backstage);
  const anchors = drawMonkey(ctx, state, pose, time, backstage);
  // Rods remain visible across the lit screen and the dark lower rail.
  drawRods(ctx, anchors, handles, backstage, selected);
  drawTargets(ctx, state, options, time);
  if (grainCache) ctx.drawImage(grainCache, 0, 0);
  drawHandles(ctx, handles, selected, backstage);
  ctx.restore();
}

export default drawTheatre;

function drawTrialWeapon(ctx,type,placement={}){
  ctx.save();ctx.translate(Number.isFinite(placement.x)?placement.x:820,Number.isFinite(placement.y)?placement.y:445);ctx.rotate(Number.isFinite(placement.angle)?placement.angle:0);ctx.strokeStyle='#69502d';ctx.lineWidth=9;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(0,105);ctx.lineTo(0,-115);ctx.stroke();
  ctx.strokeStyle='#e3ba68';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-2,100);ctx.lineTo(-2,-112);ctx.stroke();
  ctx.fillStyle='#65877a';ctx.strokeStyle='#334c40';ctx.lineWidth=2;
  ctx.beginPath();if(type==='knife'){ctx.moveTo(-5,-165);ctx.quadraticCurveTo(37,-149,34,-102);ctx.quadraticCurveTo(31,-78,5,-65);ctx.lineTo(-8,-67);ctx.lineTo(-4,-118);}else if(type==='fork'){ctx.moveTo(-24,-150);ctx.lineTo(-18,-113);ctx.lineTo(-6,-105);ctx.lineTo(-4,-160);ctx.lineTo(3,-174);ctx.lineTo(8,-111);ctx.lineTo(20,-116);ctx.lineTo(26,-150);ctx.lineTo(29,-107);ctx.lineTo(9,-91);ctx.lineTo(-6,-91);ctx.lineTo(-27,-107);}else{ctx.moveTo(0,-168);ctx.lineTo(10,-142);ctx.lineTo(5,-90);ctx.lineTo(30,-108);ctx.quadraticCurveTo(54,-119,31,-158);ctx.quadraticCurveTo(64,-151,48,-105);ctx.lineTo(7,-75);ctx.lineTo(-6,-77);ctx.lineTo(-7,-145);}ctx.closePath();ctx.fill();ctx.stroke();if(type==='knife'){ctx.strokeStyle='#dfbd75';for(let y=-145;y<-82;y+=18){ctx.beginPath();ctx.arc(1,y,5,0,Math.PI*2);ctx.stroke();}}ctx.restore();
}
function goalMark(ctx,goal,actor,time){
  if(!goal)return;
  const isBody=goal.rod==='body',handles=rigHandles(actor),from=isBody?handles.body:actor.hands[goal.rod];
  const to=isBody?{x:goal.point.x-25,y:goal.point.y+115}:goal.point;
  ctx.save();ctx.strokeStyle='#346f67';ctx.fillStyle='#346f67';ctx.lineWidth=2;ctx.setLineDash([5,5]);ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(to.x,to.y);ctx.stroke();ctx.setLineDash([]);
  ctx.beginPath();ctx.arc(to.x,to.y,goal.radius||25,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.arc(handles[goal.rod].x,handles[goal.rod].y,30+Math.sin(time/200)*2,0,Math.PI*2);ctx.stroke();
  // Keep instruction text in the clear upper strip. The circle/leader still
  // uses the exact world target, without words covering a blade, face or hand.
  label(ctx,isBody?'身杆移向光圈':goal.rod==='left'?'左手杆移向光圈':'右手杆移向光圈',640,147,13,'#346f67');ctx.restore();
}
function rolePerformance(options,role){
  const supplied=options.performance?.[role];
  if(supplied!==null&&typeof supplied==='object')return supplied;
  const aliases=role==='wukong'?['wukong','孙悟空']:['dragon','东海龙王','龙王'];
  return {speaking:aliases.includes(options.speaker)};
}

function drawSceneBackdrop(ctx,scene){
  const raw=scene?.background,mode=typeof raw==='string'?raw:raw?.mode||'palaceInside';
  const from=raw?.fromMode||(mode==='treasury'?'palaceInside':'palaceOutside');
  const blend=Number.isFinite(raw?.transition)?clamp(raw.transition,0,1):1;
  if(blend<1&&from!==mode){
    buildCaches(from);if(sceneryCache)ctx.drawImage(sceneryCache,0,0);else paintScenery(ctx,from);
    ctx.save();ctx.globalAlpha=blend;buildCaches(mode);if(sceneryCache)ctx.drawImage(sceneryCache,0,0);else paintScenery(ctx,mode);ctx.restore();
  }else{buildCaches(mode);if(sceneryCache)ctx.drawImage(sceneryCache,0,0);else paintScenery(ctx,mode);}
  return mode;
}

function drawWaterLight(ctx,time,mode){
  // All water/light paths are a pure function of the show clock, so moving a
  // rod cannot restart the scenery and pause/replay draws the same instant.
  ctx.save();ctx.beginPath();ctx.rect(54,52,1172,568);ctx.clip();
  const light=ctx.createRadialGradient(640,350,20,640,350,600);
  light.addColorStop(0,`rgba(255,244,196,${.13+Math.sin(time*.0008)*.017})`);light.addColorStop(1,'rgba(255,244,196,0)');ctx.fillStyle=light;ctx.fillRect(54,52,1172,574);
  for(let i=0;i<4;i++){
    const x=80+i*305+Math.sin(time*.00013+i*.8)*43;
    ctx.beginPath();ctx.moveTo(x,53);ctx.lineTo(x+56,53);ctx.lineTo(x+219,616);ctx.lineTo(x+131,616);ctx.closePath();ctx.fillStyle='rgba(255,247,210,.055)';ctx.fill();
  }
  ctx.strokeStyle=mode==='treasury'?'rgba(50,90,75,.15)':'rgba(49,95,89,.18)';ctx.lineWidth=1.1;
  for(let row=0;row<3;row++){
    ctx.beginPath();for(let x=62;x<1220;x+=6){const y=579+row*13+Math.sin(x/52-time*.0005+row*.8)*5.5;if(x===62)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.stroke();
  }
  ctx.restore();
}

export function drawDuetTheatre(ctx,world,options={}){
  const scene=options.scene||null,time=Number.isFinite(scene?.timeMs)?scene.timeMs:options.time||0,backstage=!!options.backstage;
  ctx.clearRect(0,0,WIDTH,HEIGHT);const mode=drawSceneBackdrop(ctx,scene);
  ctx.save();ctx.beginPath();ctx.rect(54,52,1172,574);ctx.clip();
  drawWaterLight(ctx,time,mode);
  const staffVisible=scene?scene.staff?.visible===true:['guide','staff','farewell','complete'].includes(world.phase);
  if(staffVisible){
    ctx.save();ctx.globalAlpha=Number.isFinite(scene?.staff?.revealProgress)?clamp(scene.staff.revealProgress,0,1):1;
    drawPedestal(ctx,time);drawStaff(ctx,world.wukong.staff,time,backstage);ctx.restore();
  }
  const crewForeground=Boolean(scene?.attendants?.length);
  if(scene?.weapon?.visible&&!crewForeground)drawTrialWeapon(ctx,scene.weapon.type,scene.weapon);
  else if(!scene&&world.phase==='trial')drawTrialWeapon(ctx,world.trial===0?'knife':'halberd');
  const dp=rigPose(world.dragon),wp=rigPose(world.wukong);
  const dragonVisible=scene?scene.dragon?.visible!==false:true;
  const dx=Number.isFinite(scene?.dragon?.dx)?scene.dragon.dx:Number.isFinite(scene?.dragon?.offsetX)?scene.dragon.offsetX:0;
  const renderRole=role=>{
    const performance=options.performance?.[role];
    const speaking=rolePerformance(options,role).speaking;
    if(role==='dragon'&&!dragonVisible)return null;
    ctx.save();if(role==='dragon'&&dx)ctx.translate(dx,0);
    const anchors=drawPuppet(ctx,role,world[role],role==='dragon'?dp:wp,{time,backstage,speaking,performance});ctx.restore();
    return role==='dragon'&&dx?Object.fromEntries(Object.entries(anchors).map(([key,p])=>[key,{x:p.x+dx,y:p.y}])):anchors;
  };
  const da=renderRole('dragon'),wa=renderRole('wukong');
  // A carried prop and its smaller supporting players pass along the front
  // of the screen. The sea king's robe cannot hide an entire carrying role.
  if(crewForeground&&scene.weapon?.visible)drawTrialWeapon(ctx,scene.weapon.type,scene.weapon);
  const supporting=scene?drawStageAttendants(ctx,scene,{backstage}):[];
  ctx.restore();
  // The cut scenery and actors sit behind the stage's real front curtains.
  // Reusing the same plate masks water rays, antlers and carriers at the wing.
  drawProscenium(ctx,mode,true);
  const human=world.playerRole,actor=world[human],anchors=human==='wukong'?wa:da,handles=rigHandles(actor);
  const controlsVisible=Boolean(anchors)&&!(human==='dragon'&&dx>1);
  const partnerRole=human==='wukong'?'dragon':'wukong',partnerAnchors=partnerRole==='dragon'?da:wa;
  const partnerRodsVisible=backstage&&Boolean(partnerAnchors)&&!(partnerRole==='dragon'&&dx>1);
  if(partnerRodsVisible)drawRods(ctx,partnerAnchors,rigHandles(world[partnerRole]),true,null,{partner:true});
  if(controlsVisible)drawRods(ctx,anchors,handles,backstage,options.selected||'body');
  if(controlsVisible&&options.showGuides!==false)goalMark(ctx,options.goal,actor,time);
  if(grainCache)ctx.drawImage(grainCache,0,0);
  if(controlsVisible)drawHandles(ctx,handles,options.selected||'body',backstage);
  for(const role of ['wukong','dragon']){
    if(role==='dragon'&&(!dragonVisible||dx>1))continue;
    // Role labels belong on the wood header, outside the actors' working
    // area. Raising a body rod must not push a head through its own caption.
    const x=role==='wukong'?303:977;
    ctx.fillStyle=palette.darkWood;ctx.fillRect(x-109,11,218,27);
    label(ctx,`${role===human?'你在操演':'AI搭档'} · ${role==='wukong'?'孙悟空':'龙王'}`,x,24,12,role===human?'#efd2a0':'#add0be');
  }
  if(scene?.dragon?.waitingInWing&&human==='dragon')label(ctx,'龙王候场 · 待幕内现身后执杆',640,594,14,'#6d6242');
  if(backstage)label(ctx,'分件影人 · 三杆牵引 · 对手自主应答',640,108,14,'#805b36');
  return{backgroundMode:mode,timeMs:time,dragonVisible,staffVisible,partnerRodsVisible,attendants:supporting};
}
