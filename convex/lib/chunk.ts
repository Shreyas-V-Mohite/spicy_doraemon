// Splits lesson text into passages for search. Pure code, so the upload
// screen can preview exactly what the server will store.

export interface Chunk {
  ordinal: number;
  // Nearest markdown heading above the passage, or "".
  heading: string;
  // Verbatim passage text. Quotes in answers are verified against this.
  text: string;
}

export const MAX_LESSON_WORDS = 50000;

const MIN_WORDS = 150;
const MAX_WORDS = 300;
const TINY_WORDS = 40;

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

// What gets embedded: the heading helps a short passage match a question.
export function embedText(chunk: Pick<Chunk, "heading" | "text">): string {
  return chunk.heading ? `${chunk.heading}\n\n${chunk.text}` : chunk.text;
}

// Breaks one oversized paragraph at sentence ends so no piece exceeds MAX_WORDS.
function splitLongParagraph(paragraph: string): string[] {
  const sentences = paragraph.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [
    paragraph,
  ];
  const pieces: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && countWords(current + sentence) > MAX_WORDS) {
      pieces.push(current.trim());
      current = "";
    }
    current += sentence;
  }
  if (current.trim()) pieces.push(current.trim());
  // A single sentence over the limit is split by words as a last resort.
  return pieces.flatMap((piece) => {
    const words = piece.split(/\s+/);
    if (words.length <= MAX_WORDS) return [piece];
    const out: string[] = [];
    for (let i = 0; i < words.length; i += MAX_WORDS) {
      out.push(words.slice(i, i + MAX_WORDS).join(" "));
    }
    return out;
  });
}

export function chunkLesson(text: string): Chunk[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");

  // Sections: a heading plus the body that follows it.
  const sections: { heading: string; body: string[] }[] = [
    { heading: "", body: [] },
  ];
  for (const line of lines) {
    const match = /^#{1,6}\s+(.*\S)\s*$/.exec(line);
    if (match) sections.push({ heading: match[1], body: [] });
    else sections[sections.length - 1].body.push(line);
  }

  const chunks: Chunk[] = [];
  for (const section of sections) {
    const paragraphs = section.body
      .join("\n")
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p !== "")
      .flatMap((p) => (countWords(p) > MAX_WORDS ? splitLongParagraph(p) : [p]));

    const pieces: string[] = [];
    let current: string[] = [];
    const flush = () => {
      if (current.length) pieces.push(current.join("\n\n"));
      current = [];
    };
    for (const paragraph of paragraphs) {
      const joined = [...current, paragraph].join("\n\n");
      if (current.length && countWords(joined) > MAX_WORDS) flush();
      current.push(paragraph);
      if (countWords(current.join("\n\n")) >= MIN_WORDS) flush();
    }
    flush();

    // A scrap at the end of a section joins the passage before it.
    if (
      pieces.length > 1 &&
      countWords(pieces[pieces.length - 1]) < TINY_WORDS
    ) {
      const last = pieces.pop()!;
      pieces[pieces.length - 1] += "\n\n" + last;
    }
    for (const piece of pieces) {
      chunks.push({ ordinal: chunks.length, heading: section.heading, text: piece });
    }
  }
  return chunks;
}
