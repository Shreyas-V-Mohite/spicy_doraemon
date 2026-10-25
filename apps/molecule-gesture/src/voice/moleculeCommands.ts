/**
 * Turning what the teacher said into molecule names PubChem understands.
 *
 * Speech recognition runs continuously, so a request is usually buried in a
 * longer phrase ("okay so show me caffeine"). We look for a request verb
 * ANYWHERE in the phrase, accept a known molecule name said on its own, fix
 * small mis-hearings against a dictionary of common molecules ("benzine" →
 * benzene, "asprin" → aspirin), and allow several at once ("benzene and
 * caffeine"). Ordinary lecturing doesn't match and is ignored.
 */

/** Common molecules in an organic-chemistry class (English, as PubChem names them). */
export const COMMON_MOLECULES = [
  'water', 'methane', 'ethane', 'propane', 'butane', 'isobutane', 'pentane', 'hexane', 'heptane', 'octane',
  'nonane', 'decane', 'cyclopropane', 'cyclobutane', 'cyclopentane', 'cyclohexane', 'cyclohexene', 'ethylene',
  'propylene', 'butadiene', 'isoprene', 'acetylene', 'benzene', 'toluene', 'xylene', 'styrene', 'naphthalene',
  'anthracene', 'phenol', 'aniline', 'pyridine', 'pyrrole', 'furan', 'thiophene', 'imidazole', 'indole', 'purine',
  'pyrimidine', 'methanol', 'ethanol', 'propanol', 'isopropanol', 'butanol', 'glycerol', 'ethylene glycol',
  'formaldehyde', 'acetaldehyde', 'benzaldehyde', 'acetone', 'butanone', 'cyclohexanone', 'formic acid',
  'acetic acid', 'propionic acid', 'butyric acid', 'benzoic acid', 'oxalic acid', 'lactic acid', 'citric acid',
  'salicylic acid', 'acetic anhydride', 'ethyl acetate', 'methyl acetate', 'methyl salicylate', 'diethyl ether',
  'tetrahydrofuran', 'dimethyl sulfoxide', 'chloroform', 'dichloromethane', 'carbon tetrachloride', 'nitrobenzene',
  'chlorobenzene', 'benzyl alcohol', 'methylamine', 'trimethylamine', 'urea', 'glycine', 'alanine', 'valine',
  'leucine', 'isoleucine', 'serine', 'threonine', 'cysteine', 'methionine', 'phenylalanine', 'tyrosine',
  'tryptophan', 'proline', 'aspartic acid', 'glutamic acid', 'lysine', 'arginine', 'histidine', 'glutamine',
  'asparagine', 'glucose', 'fructose', 'galactose', 'ribose', 'sucrose', 'lactose', 'maltose', 'cholesterol',
  'testosterone', 'estradiol', 'caffeine', 'nicotine', 'aspirin', 'ibuprofen', 'acetaminophen', 'paracetamol',
  'naproxen', 'morphine', 'codeine', 'dopamine', 'serotonin', 'adrenaline', 'epinephrine', 'melatonin',
  'histamine', 'menthol', 'vanillin', 'capsaicin', 'limonene', 'camphor', 'ascorbic acid', 'carbon dioxide',
  'ammonia', 'hydrogen peroxide', 'adenine', 'guanine', 'cytosine', 'thymine', 'uracil', 'penicillin G',
];

/** Korean (spaces removed) → English. */
export const KOREAN_MOLECULE_NAMES: Record<string, string> = {
  물: 'water', 메테인: 'methane', 메탄: 'methane', 에테인: 'ethane', 에탄: 'ethane', 프로페인: 'propane',
  프로판: 'propane', 뷰테인: 'butane', 부탄: 'butane', 펜테인: 'pentane', 펜탄: 'pentane', 헥세인: 'hexane',
  헥산: 'hexane', 사이클로헥세인: 'cyclohexane', 사이클로헥산: 'cyclohexane', 시클로헥산: 'cyclohexane',
  에틸렌: 'ethylene', 에텐: 'ethylene', 아세틸렌: 'acetylene', 벤젠: 'benzene', 톨루엔: 'toluene', 페놀: 'phenol',
  아닐린: 'aniline', 나프탈렌: 'naphthalene', 스타이렌: 'styrene', 스티렌: 'styrene', 피리딘: 'pyridine',
  메탄올: 'methanol', 에탄올: 'ethanol', 알코올: 'ethanol', 이소프로판올: 'isopropanol', 글리세롤: 'glycerol',
  글리세린: 'glycerol', 아세톤: 'acetone', 포름알데하이드: 'formaldehyde', 폼알데하이드: 'formaldehyde',
  아세트알데하이드: 'acetaldehyde', 아세트산: 'acetic acid', 초산: 'acetic acid', 포름산: 'formic acid',
  벤조산: 'benzoic acid', 젖산: 'lactic acid', 구연산: 'citric acid', 에테르: 'diethyl ether',
  클로로폼: 'chloroform', 클로로포름: 'chloroform', 요소: 'urea', 암모니아: 'ammonia', 이산화탄소: 'carbon dioxide',
  포도당: 'glucose', 글루코스: 'glucose', 과당: 'fructose', 설탕: 'sucrose', 수크로스: 'sucrose', 글리신: 'glycine',
  알라닌: 'alanine', 카페인: 'caffeine', 아스피린: 'aspirin', 이부프로펜: 'ibuprofen', 아세트아미노펜: 'acetaminophen',
  타이레놀: 'acetaminophen', 니코틴: 'nicotine', 도파민: 'dopamine', 세로토닌: 'serotonin', 아드레날린: 'epinephrine',
  멘톨: 'menthol', 바닐린: 'vanillin', 캡사이신: 'capsaicin', 콜레스테롤: 'cholesterol', 모르핀: 'morphine',
  비타민씨: 'ascorbic acid', 아스코르브산: 'ascorbic acid', 페니실린: 'penicillin G',
};

const compact = (s: string) => s.toLowerCase().replace(/[\s-]+/g, '');
const KNOWN = new Map<string, string>(COMMON_MOLECULES.map((n) => [compact(n), n]));
const HANGUL = /[가-힣]/;

function levenshtein(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** A dictionary molecule matching `name` exactly or within a small mis-hearing. */
export function knownMolecule(name: string): string | null {
  const key = compact(name);
  if (!key) return null;
  const ko = KOREAN_MOLECULE_NAMES[key];
  if (ko) return ko;
  const exact = KNOWN.get(key);
  if (exact) return exact;
  const allowed = key.length >= 7 ? 2 : key.length >= 4 ? 1 : 0;
  if (!allowed) return null;
  let best: string | null = null;
  let bestD = allowed + 1;
  for (const [k, n] of KNOWN) {
    const d = levenshtein(key, k);
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best;
}

export interface MoleculeRequest {
  /** What the speaker called it. */
  spoken: string;
  /** Name to look up in PubChem (English); '' = a Korean name we can't translate. */
  query: string;
  /** A guess (bare word that merely looks like a chemical name): fail silently. */
  silent: boolean;
  /** The name is in the dictionary (safe to act on before the phrase is final). */
  known?: boolean;
}

/** Clear requests: an unknown name is still looked up, and a miss is reported. */
const VERB_STRONG = '(?:(?:can|could) (?:you|we) )?(?:show(?: me| us)?|display|load|add|bring up|pull up|put up|draw)';
/** Phrases that also occur in normal lecturing: only act on known molecule names. */
const VERB_SOFT = "(?:give me|let'?s (?:see|look at|add)|look at|can (?:you|we|i) (?:see|get)|i (?:want|would like|'d like) to see|i want|we need)";
const OBJECT = '\\s+(?:the |a |an |some |another |one more )?(?:molecule (?:of )?|molecules |structure (?:of )?|model (?:of )?)?(.+)$';
const EN_STRONG = new RegExp(`\\b${VERB_STRONG}${OBJECT}`);
const EN_SOFT = new RegExp(`\\b${VERB_SOFT}${OBJECT}`);
const EN_MOLECULE = /\bmolecules?\s+(?!of\b)(.+)$/;
const KO_REQUEST = /(?:^|\s)(?:분자\s*)?([^\s].*?)\s*(?:을|를|으로|로)?\s*(?:보여\s*줘|보여\s*주세요|보여\s*줄래|띄워\s*줘|띄워\s*주세요|추가해\s*줘|추가)$/;
const KO_PREFIX = /분자\s+(.+)$/;
/** Words that end a molecule name inside a longer phrase. */
const STOP = /\s+(?:please|now|for (?:me|us)|then|so|okay|ok|right|here|there|on (?:the )?(?:screen|stage)|molecule|molecules|structure|model|too|also)\b.*$/;
/** Bare single words that look like chemical names. */
const CHEM_SUFFIX = /^[a-z]{4,}(?:ane|ene|yne|anol|enol|ol|al|one|ine|ide|ate|ose|amine|amide|oic acid)$/;

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,!?。"“”‘’]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Korean phrase before the verb: try its trailing words ("오늘은 카페인" → "카페인"). */
function knownKorean(spoken: string): string | null {
  const words = spoken.split(' ');
  for (let i = 0; i < words.length; i++) {
    const hit = knownMolecule(words.slice(i).join(''));
    if (hit) return hit;
  }
  return null;
}

/**
 * `soft`: the phrase only loosely sounded like a request ("let's look at …"),
 * so unknown names are dropped instead of looked up.
 */
function toRequests(namesPart: string, soft: boolean): MoleculeRequest[] {
  const cleaned = namesPart.replace(STOP, '').trim();
  const out: MoleculeRequest[] = [];
  for (const raw of cleaned.split(/\s*,\s*|\s+and\s+|\s+그리고\s+|\s*하고\s+/)) {
    const spoken = raw.replace(/^(?:the|a|an|some)\s+/, '').trim();
    if (!spoken) continue;
    const known = HANGUL.test(spoken) ? knownKorean(spoken) : knownMolecule(spoken);
    // "methane ethane" (recognisers rarely add commas): several known names in a row.
    const words = spoken.split(' ');
    const eachKnown = !known && words.length > 1 ? words.map((w) => knownMolecule(w)) : [];
    if (known) out.push({ spoken, query: known, silent: false, known: true });
    else if (eachKnown.length && eachKnown.every(Boolean)) {
      eachKnown.forEach((k, i) => out.push({ spoken: words[i], query: k!, silent: false, known: true }));
    }
    else if (soft) continue;
    else if (HANGUL.test(spoken)) out.push({ spoken, query: '', silent: false });
    else out.push({ spoken, query: spoken, silent: false });
  }
  return out;
}

/**
 * Parse one recognised phrase. Returns [] for anything that isn't a molecule
 * request (ordinary speech).
 */
export function parseMoleculeRequests(transcript: string): MoleculeRequest[] {
  const text = normalise(transcript);
  if (!text) return [];
  // Requests: use the LAST one in the phrase (the recogniser glues phrases together).
  const lastMatch = (re: RegExp) => {
    let m: RegExpMatchArray | null = null;
    for (let i = 0; i < text.length; ) {
      const rest = text.slice(i);
      const r = rest.match(re);
      if (!r || r.index === undefined) break;
      m = r;
      i += r.index + 1;
    }
    return m;
  };
  const strong = lastMatch(EN_STRONG) ?? text.match(KO_REQUEST) ?? text.match(KO_PREFIX) ?? lastMatch(EN_MOLECULE);
  if (strong) return toRequests(strong[1], false);
  const soft = lastMatch(EN_SOFT);
  if (soft) return toRequests(soft[1], true);

  // A molecule name said on its own (short phrase).
  const words = text.split(' ');
  if (words.length <= 4) {
    const bare = text.replace(/^(?:the|a|an)\s+/, '').replace(STOP, '');
    const known = knownMolecule(bare);
    if (known) return [{ spoken: bare, query: known, silent: false, known: true }];
    if (words.length === 1 && CHEM_SUFFIX.test(bare)) return [{ spoken: bare, query: bare, silent: true }];
  }
  return [];
}

/** Back-compat helper: the first request in a phrase, or null. */
export function parseMoleculeRequest(transcript: string): MoleculeRequest | null {
  return parseMoleculeRequests(transcript)[0] ?? null;
}
