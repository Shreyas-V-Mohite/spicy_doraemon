// Follow-up questions ("why does that happen?", "what about ethanol?") only
// make sense given what came before. These helpers spot them and build a
// search text that carries the missing context.

const REFERS_BACK =
  /\b(it|its|this|that|these|those|they|them|the other|other one|same one|again|previous|earlier|above|former|latter)\b/i;
const OPENS_LIKE_FOLLOW_UP = /^\s*(and|but|so|then|what about|how about|why not)\b/i;
const MAX_STANDALONE_WORDS = 3;

// True when the question probably depends on earlier context. A false
// positive only costs that question its grouping and answer reuse.
export function looksContextual(question: string): boolean {
  const words = question.trim().split(/\s+/).filter(Boolean).length;
  return (
    words <= MAX_STANDALONE_WORDS ||
    REFERS_BACK.test(question) ||
    OPENS_LIKE_FOLLOW_UP.test(question)
  );
}

// The text to embed for a follow-up: what is on screen and what the student
// just asked, then the question itself.
export function contextualQuery(parts: {
  screen: string | null;
  previousQuestion: string | null;
  question: string;
}): string {
  return [parts.screen, parts.previousQuestion, parts.question]
    .filter((p): p is string => !!p && p.trim() !== "")
    .join(". ");
}
