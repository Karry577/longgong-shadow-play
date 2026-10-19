// A pack is a local manifest. Its declared licence is not independent clearance.
export const VOCAL_LICENSES = Object.freeze(['CC0-1.0', 'CC-BY-4.0', 'CC-BY-SA-4.0', 'CC-BY-NC-4.0', 'CC-BY-NC-SA-4.0']);
const SECTIONS = ['arrival', 'request', 'trial', 'guide', 'staff', 'farewell'];
const ROLES = ['wukong', 'dragon'];
const GESTURES = ['announce', 'salute', 'offer', 'point', 'inspect', 'refuse', 'thanks', 'close'];
const MAX_BYTES = 256 * 1024;
const fail = message => { throw new Error(`无效真人录音包：${message}`); };
function object(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('需要普通对象');
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`未知或危险字段 ${key}`);
}
function text(value, name, max = 160) {
  if (typeof value !== 'string' || !value.trim() || Array.from(value).length > max || /[\u0000-\u001f\u007f]/u.test(value)) fail(name);
  return value.trim();
}
function https(value, name) {
  const source = text(value, name, 2048);
  let url; try { url = new URL(source); } catch { fail(name); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) fail(`${name}须为HTTPS来源页`);
  return url.href;
}
function number(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) fail(name);
  return value;
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function filename(value) {
  const name = text(value, '本地音频文件名', 120);
  if (name !== value || /[\\/:?#%<>"|*]/u.test(name) || name.startsWith('.') || name.includes('..') || /[ .]$/u.test(name)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(name)
    || !/\.(mp3|wav|ogg|oga|m4a|aac|webm|flac)$/iu.test(name)) fail('只接受本地音频basename，不接受路径或远程音源');
  return name;
}

/** Parse JSON data only; no code, remote audio URLs, getters or mutable result. */
export function parseVocalPack(input) {
  if (typeof input !== 'string' || input.length > MAX_BYTES || new TextEncoder().encode(input).length > MAX_BYTES) fail('JSON须不超过256KiB');
  let raw; try { raw = JSON.parse(input); } catch { fail('JSON格式'); }
  object(raw, ['format', 'version', 'title', 'tradition', 'performer', 'sourceUrl', 'rights', 'clips', 'order', 'audioOnly']);
  if (raw.format !== 'yiren-shadow-vocals' || raw.version !== 1) fail('格式或版本');
  if (raw.order !== undefined && !['player', 'source'].includes(raw.order)) fail('播放顺序须为player或source');
  if (raw.audioOnly !== undefined && typeof raw.audioOnly !== 'boolean') fail('audioOnly须为布尔值');
  object(raw.rights, ['license', 'holder', 'url']);
  if (!VOCAL_LICENSES.includes(raw.rights.license)) fail('须声明允许改编的许可，不接受ND或无许可');
  if (!Array.isArray(raw.clips) || !raw.clips.length || raw.clips.length > 30) fail('录音片段数量须为1至30');
  const ids = new Set(), scenes = new Set(); let total = 0;
  const clips = raw.clips.map(clip => {
    object(clip, ['id', 'role', 'section', 'trial', 'file', 'start', 'end', 'lines', 'beat', 'gesture', 'gateMode']);
    const id = text(clip.id, '片段ID', 64);
    if (ids.has(id)) fail('片段ID重复'); ids.add(id);
    if (!ROLES.includes(clip.role) || !SECTIONS.includes(clip.section)) fail('角色或场次');
    const trial = clip.trial ?? 0;
    if (![0, 1].includes(trial) || clip.trial === null || (clip.section !== 'trial' && trial !== 0)) fail('试器编号，仅trial场次可用1');
    if (clip.beat !== undefined && !((clip.section === 'staff' && ['invite', 'taken'].includes(clip.beat))
      || (clip.section === 'trial' && ['call', 'response'].includes(clip.beat)))) fail('beat仅支持staff的invite/taken或trial的call/response');
    if (clip.gesture !== undefined && !GESTURES.includes(clip.gesture)) fail('片段身段无效');
    if (clip.gateMode !== undefined && !['phrase', 'turn'].includes(clip.gateMode)) fail('gateMode仅支持phrase或turn');
    const key = `${clip.section}|${trial}|${clip.role}|${clip.beat ?? ''}`;
    // Legacy imports retain their old uniqueness contract. A source-ordered
    // manifest explicitly opts into multiple actual turns by the same actor.
    if (raw.order !== 'source' && scenes.has(key)) fail('场次、试器编号与角色重复'); scenes.add(key);
    const start = number(clip.start, '片段起点'), end = number(clip.end, '片段终点');
    const duration = end - start;
    if (duration <= 0 || duration > 90) fail('片段时长');
    total += duration; if (total > 90 + 1e-9) fail('全部片段总长不得超过90秒');
    if (!Array.isArray(clip.lines) || !clip.lines.length || clip.lines.length > 100) fail('逐句字幕数量');
    let previousEnd = 0;
    const lines = clip.lines.map(line => {
      object(line, ['start', 'end', 'text', 'gesture']);
      const a = number(line.start, '字幕起点'), b = number(line.end, '字幕终点');
      if (b <= a || a < previousEnd || b > duration) fail('字幕须按相对时间排序、不重叠且不超出片段');
      previousEnd = b;
      if (line.gesture !== undefined && !GESTURES.includes(line.gesture)) fail('字幕身段无效');
      return { start: a, end: b, text: text(line.text, '每句字幕须为1至100字', 100), ...(line.gesture !== undefined ? { gesture: line.gesture } : {}) };
    });
    return { id, role: clip.role, section: clip.section, trial, file: filename(clip.file), start, end, lines, ...(clip.beat !== undefined ? { beat: clip.beat } : {}), ...(clip.gesture !== undefined ? { gesture: clip.gesture } : {}), ...(clip.gateMode !== undefined ? { gateMode: clip.gateMode } : {}) };
  });
  return freeze({ format: raw.format, version: 1, title: text(raw.title, '标题'), tradition: text(raw.tradition, '流派'), performer: text(raw.performer, '演唱者'), sourceUrl: https(raw.sourceUrl, '原始来源'), rights: { license: raw.rights.license, holder: text(raw.rights.holder, '权利人'), url: https(raw.rights.url, '许可来源') }, clips, ...(raw.order !== undefined ? { order: raw.order } : {}), ...(raw.audioOnly !== undefined ? { audioOnly: raw.audioOnly } : {}) });
}

/** Source order is the declared manifest order, independent of player choice.
 * Old packs without an order retain human-first playback for saved histories. */
export function clipsForScene(pack, world, { beat } = {}) {
  if (!pack || !Array.isArray(pack.clips) || !world || !ROLES.includes(world.playerRole) || !SECTIONS.includes(world.phase)) return Object.freeze([]);
  const trial = world.phase === 'trial' ? world.trial ?? 0 : 0;
  if (![0, 1].includes(trial)) return Object.freeze([]);
  if (beat !== undefined && (world.phase !== 'trial' || !['call', 'response'].includes(beat))) return Object.freeze([]);
  const staffBeat = world.wukong?.staff?.phase === 'lifted' ? 'taken' : world.flags?.staffInvited ? null : 'invite';
  const clips = pack.clips.filter(clip => clip.section === world.phase && (clip.trial ?? 0) === trial
    && (world.phase !== 'staff' || clip.beat === undefined || clip.beat === staffBeat)
    // Untagged historical packs remain a single call queue; splitting them must
    // never repeat the same source at the physical-trial response beat.
    && (world.phase !== 'trial' || beat === undefined || (clip.beat ?? 'call') === beat));
  if (pack.order !== 'source') clips.sort((a, b) => (a.role === world.playerRole ? 0 : 1) - (b.role === world.playerRole ? 0 : 1));
  return Object.freeze(clips);
}

/** Subtitle intervals are [start,end), relative to the selected clip's start. */
export function lineAt(clip, offsetSeconds) {
  if (!clip || !Number.isFinite(offsetSeconds) || offsetSeconds < 0 || offsetSeconds >= clip.end - clip.start) return null;
  return clip.lines.find(line => offsetSeconds >= line.start && offsetSeconds < line.end) || null;
}
