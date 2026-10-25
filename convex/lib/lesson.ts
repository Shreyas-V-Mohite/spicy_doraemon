// The demo lesson. Claude may only cite these excerpts, name these molecules
// and pick these functional groups; anything else is rejected.
export const EXCERPTS: Record<string, string> = {
  "ex-1":
    "A functional group is a specific group of atoms within a molecule that is responsible for the molecule's characteristic chemical reactions. Molecules with the same functional group tend to react in similar ways.",
  "ex-2":
    "A hydroxyl group is an oxygen bonded to a hydrogen (-OH) and attached to a saturated carbon. Compounds with this group are alcohols, such as ethanol. The O-H bond can form hydrogen bonds, which raises boiling points and helps small alcohols mix with water.",
  "ex-3":
    "A carboxylic acid has a carbonyl (C=O) and a hydroxyl on the same carbon (-COOH). Acetic acid is the simplest everyday example. Carboxylic acids are acidic because the O-H hydrogen can leave as H+, and the leftover carboxylate ion is stabilized by resonance: its negative charge is shared across both oxygens.",
  "ex-4":
    "An alcohol is a much weaker acid than a carboxylic acid. When an alcohol loses H+, the negative charge sits on a single oxygen with nowhere to spread, so the ion is less stable and the proton is held more tightly.",
  "ex-5":
    "An ester has a carbonyl carbon bonded to an oxygen that is itself bonded to another carbon (-COO-R). It is formed from a carboxylic acid and an alcohol and has no acidic O-H hydrogen. Aspirin contains both a carboxylic acid and an ester.",
};

export const MOLECULES = ["ethanol", "acetic acid", "aspirin"] as const;

// Must match the chemistry service's /groups whitelist.
export const GROUP_IDS = ["hydroxyl", "carboxylic_acid", "ester"] as const;

export interface Suggestion {
  explanation: string;
  sourceIds: string[];
  teachingAction: string;
  // Absent when there is nothing to highlight (for example an off-topic question).
  molecule?: string;
  groupId?: string;
}

// Used when Claude is slow or down, so the rehearsed demo never dead-ends.
// Matched by keyword on the question text; shown to the professor as "cached".
export const FALLBACKS: { keywords: string[]; suggestion: Suggestion }[] = [
  {
    keywords: ["acid", "ph", "proton", "h+"],
    suggestion: {
      explanation:
        "Acetic acid is acidic because its O-H hydrogen can leave as H+, and the carboxylate left behind shares its negative charge across two oxygens through resonance.",
      sourceIds: ["ex-3"],
      teachingAction:
        "Show the carboxyl group on acetic acid, then ask students which oxygen the negative charge would sit on.",
      molecule: "acetic acid",
      groupId: "carboxylic_acid",
    },
  },
  {
    keywords: ["alcohol", "hydroxyl", "ethanol", "oh", "hydrogen bond"],
    suggestion: {
      explanation:
        "Ethanol's hydroxyl group is an O-H attached to a saturated carbon, and it can form hydrogen bonds.",
      sourceIds: ["ex-2"],
      teachingAction: "Highlight the hydroxyl group on ethanol and compare it with the carboxyl group.",
      molecule: "ethanol",
      groupId: "hydroxyl",
    },
  },
  {
    keywords: ["ester", "aspirin"],
    suggestion: {
      explanation:
        "An ester has a carbonyl carbon bonded to an oxygen that is bonded to another carbon, and it has no acidic O-H. Aspirin contains both an ester and a carboxylic acid.",
      sourceIds: ["ex-5"],
      teachingAction: "Highlight the ester on aspirin, then the carboxylic acid, and ask students to tell them apart.",
      molecule: "aspirin",
      groupId: "ester",
    },
  },
];

// Last resort: no highlight, but the professor still gets something to act on.
const GENERIC_FALLBACK: Suggestion = {
  explanation:
    "The approved excerpts don't cover this question directly. The common thread is that a functional group, a specific arrangement of atoms, decides how a molecule behaves.",
  sourceIds: ["ex-1"],
  teachingAction:
    "Ask the student which atoms or group they are unsure about, then find that group on one of the demo molecules.",
};

export function pickFallback(question: string): Suggestion {
  const text = question.toLowerCase();
  for (const f of FALLBACKS) {
    if (f.keywords.some((k) => text.includes(k))) return f.suggestion;
  }
  return GENERIC_FALLBACK;
}
