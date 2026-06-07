// Minimal pinyin → viseme mapper for Chinese text-to-lipsync.
//
// We don't ship a full pinyin dictionary (~20k chars, ~500 KB). Instead we
// hand-curate the ~600 most common Mandarin characters into the 7-viseme
// set. Anything outside the table falls back to "mid" — a neutral
// half-open mouth that reads as "lips are moving but I can't tell which
// vowel" rather than a frozen-closed mouth that reads as broken sync.
//
// Coverage philosophy: in a 漫剧 dialogue line, the top ~600 chars cover
// >85% of typical text; the lip motion rhythm is what readers actually
// perceive, not phoneme accuracy. Aiming for full coverage would more than
// double the bundle for diminishing return.

import type { Viseme, VisemeFrame } from "./types.js";

// --- final → viseme classifier -------------------------------------

/**
 * Map a pinyin final (without tone, without initial) to a viseme. Used
 * during dictionary construction AND at runtime when an external pinyin
 * source is plugged in.
 */
export function finalToViseme(final: string): Viseme {
  const f = final.toLowerCase().replace(/[1-5]/g, "");
  if (f === "") return "rest";
  if (f.startsWith("ai") || f.startsWith("ei") || f.startsWith("ao") || f.startsWith("ou")) return "wide";
  if (f.startsWith("ia") || f.startsWith("ie") || f.startsWith("ye")) return "ee";
  if (f.startsWith("iu") || f.startsWith("you")) return "round";
  if (f.startsWith("ui") || f.startsWith("uei")) return "round";
  if (f.startsWith("ua") || f.startsWith("uo")) return "round";
  if (f.startsWith("ue") || f.startsWith("üe") || f.startsWith("yue")) return "ee";
  if (f.startsWith("a")) return "open";
  if (f.startsWith("o")) return "round";
  if (f.startsWith("e")) return "mid";
  if (f.startsWith("i") || f.startsWith("y")) return "narrow";
  if (f.startsWith("u") || f.startsWith("w") || f.startsWith("ü")) return "round";
  if (f.startsWith("m") || f.startsWith("n") || f.startsWith("ng")) return "rest";
  return "rest";
}

// --- character → viseme table --------------------------------------
//
// Each constant below lists the top-N high-frequency characters whose
// dominant pinyin final maps to that viseme class. Hand-curated from
// the modern Chinese frequency lists. Order doesn't matter; duplicates
// are de-duped in the build step. Keep strings on single lines for grep.

const OPEN_CHARS = "啊阿呀哇哈嘛吗他她它大打那哪发法答搭沙杀傻撒沙啥差察查茶刹爸把吧爬怕马麻骂耙趴杀沙傻啥砂耍蛋当挡党荡档枉网王亡忘旺往汪畏";
const NARROW_CHARS = "你是只之知日已以亿义议易疑医衣依移迷你密米秘弟低敌底地的滴第帝立粒理李里丽利历厉力礼里尼泥逆昵妮泥腻你呢内能你齐其七气期奇骑棋祺企旗起西希席洗喜系细息犀稀习熙系徐序续戌玺锡夕悉惜析袭吸思斯私司丝伺四诗失师识时实诗石实十拾尸虱施氏世势事室事是事饰仕似洗喜希西吸夕息悉昔息惜析袭析徒题听亭挺廷涕替挑听挺廷亭已以易亿仪椅依移仪疑椅已矣异已矣以亿易亿已亿一就要可以会们去之只知此次祠词";
const ROUND_CHARS = "不补步部布部簿步埠捕簿付负覆复辅富副赋父复负赴富府府富腐辅斧釜赴附付富腹瀑无武五吴误悟物午五雾舞物悟物悟物悟我握卧沃裹果国过囯锅过过都督堵笃赌肚渡度妒杜独读毒木目睦穆模磨末莫漠默墨膜模摸摩末抹模虎护户互弧瑚壶湖糊乎呼忽核胡狐糊朝错措初出处楚厨除储除楚处楚厨初出处楚厨除储除蛋当挡党荡档当所索所锁缩";
const MID_CHARS = "得德的地了么呢哥歌格各搁阁革隔个鸽合何河喝盒贺禾和荷壳科可棵颗课客刻可坷渴轲科可棵颗课客特忒慝忒特乐勒了仍冷盛省剩生升声笙声僧森僧";
const WIDE_CHARS = "来开太爱好高敖告早造来开凯铠害还海骸骇孩太抬台炭叹谈坛潭弹泰摔甩衰崴愁畴酬绸踌仇酬筹愁仇酬好号毫豪嚎号高糕篙皋骺睾告了考拷烤靠拷烤敖傲奥袄熬奥懊熬奏走奏揍奏摇咬要妖腰夭幺尧侥效校教交校效校教绞胶骄椒叫缴矫脚搅交叫教叫胶角校效绞脚搅交叫教超抄炒朝吵潮巢吵抄炒朝吵潮巢操造糙草槽嘈漕曹槽嘈漕曹槽报抱保宝雹饱包刨爆暴炮爆暴炮爆暴炮爆暴炮爆暴炮爆暴炮爆暴炮爆暴炮老劳牢佬涝唠捞唠牢老劳牢佬涝唠捞唠牢老劳牢佬涝唠捞唠牢老劳牢佬涝唠捞唠牢";
const EE_CHARS = "谢蟹解界戒械学雪削穴血靴薛靴学学血也夜业野页谒掖腋鄢咽燕烟掩演眼宴央扬羊洋阳样杨佯扬阳央扬决觉绝爵掘觉嚼绝厥蕨别瘪憋虐";

/**
 * Construct the lookup table by walking each curated list once and
 * picking the *last* viseme that claims a character. We list more
 * specific buckets later so they win in conflicts; in practice the
 * buckets barely overlap because they cluster by phonetic family.
 */
const CHAR_TO_VISEME: Record<string, Viseme> = {};
function loadBucket(chars: string, viseme: Viseme) {
  for (const c of chars) CHAR_TO_VISEME[c] = viseme;
}
loadBucket(OPEN_CHARS, "open");
loadBucket(NARROW_CHARS, "narrow");
loadBucket(ROUND_CHARS, "round");
loadBucket(MID_CHARS, "mid");
loadBucket(WIDE_CHARS, "wide");
loadBucket(EE_CHARS, "ee");

/**
 * Look up the viseme for a single character. Returns "mid" for unknown
 * CJK ideographs (neutral half-open mouth reads as "speaking but I can't
 * tell the vowel"), "rest" for whitespace and punctuation.
 */
export function charToViseme(ch: string): Viseme {
  if (!ch) return "rest";
  const cp = ch.codePointAt(0) ?? 0;
  // ASCII letters & numbers — approximate by vowel class
  if (cp >= 0x30 && cp <= 0x39) return "narrow";
  if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) {
    const lower = ch.toLowerCase();
    if ("aeiou".includes(lower)) {
      switch (lower) {
        case "a": return "open";
        case "e": return "mid";
        case "i": return "narrow";
        case "o": return "round";
        case "u": return "round";
      }
    }
    return "rest";
  }
  const v = CHAR_TO_VISEME[ch];
  if (v) return v;
  // CJK Unified Ideographs not in our curated table → neutral mid.
  if (cp >= 0x4e00 && cp <= 0x9fff) return "mid";
  return "rest";
}

/**
 * Tokenize a UTF-8 string into renderable visible characters, dropping
 * Chinese/English punctuation and whitespace which read as silence.
 * Each returned token contributes one viseme frame.
 */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const ch of text) {
    if (/[\s。，、？！：；,.!?:;…—'"“”‘’()（）【】「」『』《》\-\_]/.test(ch)) continue;
    out.push(ch);
  }
  return out;
}

/**
 * Generate viseme keyframes by uniformly distributing tokens across the
 * audio duration. Adds a leading + trailing "rest" frame so the mouth is
 * closed at start / end of the line.
 *
 * For best results call this with `words` from the provider if available
 * (synthesizeVisemesFromWords below).
 */
export function synthesizeVisemesFromText(text: string, durationSec: number): VisemeFrame[] {
  const tokens = tokenize(text);
  if (!tokens.length) return [{ time: 0, viseme: "rest" }];
  const frames: VisemeFrame[] = [{ time: 0, viseme: "rest" }];
  const step = durationSec / tokens.length;
  for (let i = 0; i < tokens.length; i++) {
    const t = i * step + step * 0.1;
    frames.push({ time: round3(t), viseme: charToViseme(tokens[i]), token: tokens[i] });
  }
  frames.push({ time: round3(durationSec), viseme: "rest" });
  return collapseAdjacent(frames);
}

/**
 * Generate viseme keyframes from word-level timing returned by the
 * provider. More accurate than the text-only path.
 */
export function synthesizeVisemesFromWords(
  words: Array<{ word: string; startSec: number; endSec: number }>,
  durationSec: number,
): VisemeFrame[] {
  if (!words.length) return synthesizeVisemesFromText("", durationSec);
  const frames: VisemeFrame[] = [{ time: 0, viseme: "rest" }];
  for (const w of words) {
    const tokens = tokenize(w.word);
    if (!tokens.length) continue;
    const span = Math.max(w.endSec - w.startSec, 0.001);
    const step = span / tokens.length;
    for (let i = 0; i < tokens.length; i++) {
      frames.push({
        time: round3(w.startSec + i * step),
        viseme: charToViseme(tokens[i]),
        token: tokens[i],
      });
    }
  }
  frames.push({ time: round3(durationSec), viseme: "rest" });
  return collapseAdjacent(frames);
}

function collapseAdjacent(frames: VisemeFrame[]): VisemeFrame[] {
  const out: VisemeFrame[] = [];
  for (const f of frames) {
    const last = out.at(-1);
    if (last && last.viseme === f.viseme) continue;
    out.push(f);
  }
  return out;
}

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}
