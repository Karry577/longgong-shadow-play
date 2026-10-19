/**
 * Short spoken exchanges for rod-controlled performance.
 * These are newly written prose lines, not a transcription or vocal recording.
 * The director owns turn timing, gestures and physical task completion.
 */
export const STAGE_SCRIPT_PROVENANCE = Object.freeze({
  title: '本剧新编台词',
  kind: '新编散白',
  storyBasis: '依据《西游记》第三回龙宫借器情节作舞台化精简改编。',
  traditionalLibretto: false,
  traditionalVocalRecording: false,
  humanVocalRecording: false,
  singing: false,
  audioStatus: '本剧新编台词·暂无线下真人音轨；这些散白不能算实唱。',
  license: 'MIT',
  licenseScope: '仅指本模块原创台词和代码；不涵盖另行接入的参考演出影音。',
  note: '可由参与者现场念演；不冒称传统原词、传承人审定词或真人唱腔。本模块不含馆方录音及机器待校转写。',
});

const scenes = {
  arrival: {
    title: '入宫叙话',
    lines: [
      { id: 'arrivald1', role: 'dragon', text: '宫门已经开了，大圣请入内叙话。', title: '开门相请', gesture: 'offer', duration: 6 },
      { id: 'arrivalw2', role: 'wukong', text: '承蒙龙王迎候，老孙这厢有礼。', title: '拱手答礼', gesture: 'salute', duration: 5.5 },
      { id: 'arrivald3', role: 'dragon', text: '水晶宫中，请大圣少坐片刻。', title: '引客入座', gesture: 'point', duration: 5 },
      { id: 'arrivalw4', role: 'wukong', text: '我见海藏广阔，果然不同山间。', title: '顾看宫室', gesture: 'inspect', duration: 5.5 },
      { id: 'arrivald5', role: 'dragon', text: '宫中所藏之物，且容我慢慢道来。', title: '抬手叙话', gesture: 'announce', duration: 6 },
      { id: 'arrivalw6', role: 'wukong', text: '既如此，便有一事向龙王请教。', title: '转身请教', gesture: 'announce', duration: 5.5 },
    ],
  },
  request: {
    title: '请借兵器',
    lines: [
      { id: 'requestw1', role: 'wukong', text: '老孙近来习武，想寻一件称手兵器。', title: '开言借器', gesture: 'announce', duration: 6 },
      { id: 'requestd2', role: 'dragon', text: '海藏尚有兵器，大圣不妨试试。', title: '允客试器', gesture: 'offer', duration: 5.5 },
      { id: 'requestw3', role: 'wukong', text: '有劳取来，待我试一试分量。', title: '拱手相请', gesture: 'salute', duration: 5 },
      { id: 'requestd4', role: 'dragon', text: '左右，将九股叉呈上殿来。', title: '吩咐取叉', gesture: 'point', duration: 4.5 },
      { id: 'requestw5', role: 'wukong', text: '这叉有些来历，且让我近前一看。', title: '近前看叉', gesture: 'inspect', duration: 6 },
      { id: 'requestd6', role: 'dragon', text: '合不合用，便由大圣亲自定夺。', title: '让客定夺', gesture: 'offer', duration: 5.5 },
    ],
  },
  trial0: {
    title: '初试九股叉',
    lines: [
      { id: 'trial0d1', role: 'dragon', text: '这柄九股叉，请大圣试试分量。', title: '呈叉相请', gesture: 'offer', duration: 5.5 },
      { id: 'trial0w2', role: 'wukong', text: '待我伸手一试，便知它轻重如何。', title: '伸手试叉', gesture: 'inspect', duration: 6 },
      { id: 'trial0d3', role: 'dragon', text: '海底练兵，此叉也曾派过用场。', title: '说叉来历', gesture: 'announce', duration: 5.5 },
      { id: 'trial0w4', role: 'wukong', text: '使来轻了些，恐怕不大称手。', title: '摇手辞叉', gesture: 'refuse', duration: 5 },
      { id: 'trial0d5', role: 'dragon', text: '既不合意，再取方天画戟来。', title: '再命取戟', gesture: 'offer', duration: 5 },
      { id: 'trial0w6', role: 'wukong', text: '烦劳龙王，且看下一件兵器。', title: '谢过待戟', gesture: 'thanks', duration: 5 },
    ],
  },
  trial1: {
    title: '再试方天画戟',
    lines: [
      { id: 'trial1d1', role: 'dragon', text: '方天画戟已到，大圣再试这一件。', title: '呈戟相请', gesture: 'offer', duration: 6 },
      { id: 'trial1w2', role: 'wukong', text: '比先前沉些，待我运转两下。', title: '运手试戟', gesture: 'inspect', duration: 5 },
      { id: 'trial1d3', role: 'dragon', text: '此戟留在海藏，已有许多年月。', title: '述说旧藏', gesture: 'announce', duration: 5.5 },
      { id: 'trial1w4', role: 'wukong', text: '还是轻了些，龙王可还有别物？', title: '辞戟再问', gesture: 'refuse', duration: 5.5 },
      { id: 'trial1d5', role: 'dragon', text: '后藏尚有神铁，只怕难作兵器。', title: '遥指后藏', gesture: 'point', duration: 5.5 },
      { id: 'trial1w6', role: 'wukong', text: '只要分量称手，形状倒也无妨。', title: '愿看神铁', gesture: 'announce', duration: 5.5 },
    ],
  },
  guide: {
    title: '引看神铁',
    lines: [
      { id: 'guided1', role: 'dragon', text: '请向后藏看去，那根便是神铁。', title: '指向神铁', gesture: 'point', duration: 5.5 },
      { id: 'guidew2', role: 'wukong', text: '这铁立得高大，值得近前一试。', title: '近前察看', gesture: 'inspect', duration: 5.5 },
      { id: 'guided3', role: 'dragon', text: '相传大禹治水，用它量过江海深浅。', title: '道出用途', gesture: 'announce', duration: 6 },
      { id: 'guidew4', role: 'wukong', text: '原来是旧时宝物，待我细细看它。', title: '细看铁身', gesture: 'inspect', duration: 6 },
      { id: 'guided5', role: 'dragon', text: '它在海藏多年，近来才放出光来。', title: '说起异光', gesture: 'point', duration: 6 },
      { id: 'guidew6', role: 'wukong', text: '有这等异事，老孙便试它一试。', title: '定意试铁', gesture: 'announce', duration: 5.5 },
    ],
  },
  staff: {
    title: '收取如意棒',
    lines: [
      { id: 'staffd1', role: 'dragon', text: '近前请试，看大圣可曾拿得动。', title: '让客试铁', gesture: 'offer', duration: 5.5 },
      { id: 'staffw2', role: 'wukong', text: '铁身沉稳，须待双手把它握牢。', title: '双手握牢', gesture: 'inspect', duration: 5.5 },
      { id: 'staffd3', role: 'dragon', text: '且看它的长短，是否合大圣心意。', title: '示意长短', gesture: 'point', duration: 6 },
      { id: 'staffw4', role: 'wukong', text: '小些，短些，待你变得合手些。', title: '唤铁缩小', gesture: 'announce', duration: 5.5 },
      { id: 'staffd5', role: 'dragon', text: '大圣既能使动，便请将它带去。', title: '允客携宝', gesture: 'offer', duration: 5.5 },
      { id: 'staffw6', role: 'wukong', text: '这件正合我意，谢龙王相赠。', title: '举棒谢赠', gesture: 'thanks', duration: 5 },
    ],
  },
  farewell: {
    title: '携宝辞别',
    lines: [
      { id: 'farewellw1', role: 'wukong', text: '宝物已在手中，老孙便要告辞。', title: '拱手辞别', gesture: 'thanks', duration: 5.5 },
      { id: 'farewelld2', role: 'dragon', text: '大圣携宝而归，路上慢行。', title: '回礼相送', gesture: 'salute', duration: 4.5 },
      { id: 'farewellw3', role: 'wukong', text: '这一回有了兵器，山中群猴也安心。', title: '举棒言归', gesture: 'announce', duration: 6 },
      { id: 'farewelld4', role: 'dragon', text: '老龙在此相送，请莫再惊动水府。', title: '送客出宫', gesture: 'salute', duration: 6 },
      { id: 'farewellw5', role: 'wukong', text: '承你好意，后会有期。', title: '回身作别', gesture: 'salute', duration: 3.5 },
      { id: 'farewelld6', role: 'dragon', text: '众将回宫，各守水府。', title: '收场回宫', gesture: 'close', duration: 3.5 },
    ],
  },
};

// Read a data field without executing getters supplied by an imported replay.
function ownData(object, key) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}

/** Return fresh ordered lines; a complete/unknown scene has no further dialogue. */
export function getStageScript(world) {
  const phase = ownData(world, 'phase');
  let key = phase;
  if (phase === 'trial') {
    const trial = ownData(world, 'trial');
    key = trial === 0 || trial === undefined ? 'trial0' : trial === 1 ? 'trial1' : undefined;
  }
  const scene = typeof key === 'string' && Object.hasOwn(scenes, key) ? scenes[key] : undefined;
  let lines = scene ? scene.lines.map(line => ({ ...line })) : [];
  // The dragon has two distinct physical actions here: invite first, then wait
  // for the AI to actually grip, shorten and lift. Do not replay the whole scene.
  if (phase === 'staff') {
    const role = ownData(world, 'playerRole'), flags = ownData(world, 'flags');
    const actor = ownData(world, 'wukong'), staff = ownData(actor, 'staff');
    const lifted = ownData(staff, 'phase') === 'lifted';
    if (role === 'dragon' && ownData(flags, 'staffInvited') === false && !lifted) lines = lines.slice(0, 2);
    else if (lifted) {
      const after = [
        '大圣已取起神铁，试来可还称心？',
        '双手握得稳当，这份分量正合我意。',
        '长短已合大圣心意，果真是件奇宝。',
        '方才唤它小些，便随我心意缩短。',
      ];
      lines = lines.map((line, i) => ({ ...line, text: after[i] || line.text }));
      if (role === 'dragon') lines = lines.slice(2);
    }
  }
  return {
    title: scene?.title ?? (phase === 'complete' ? '收锣落幕' : ''),
    lines,
    provenance: STAGE_SCRIPT_PROVENANCE,
  };
}
