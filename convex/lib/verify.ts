// A quote counts only if it appears word for word in the passage it names.
// Case and whitespace differences are ignored; ellipses are not allowed.

function normalize(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const MIN_QUOTE_CHARS = 12;

export function quoteAppears(quote: string, passage: string): boolean {
  if (/\.\.\.|…/.test(quote)) return false;
  const q = normalize(quote);
  return q.length >= MIN_QUOTE_CHARS && normalize(passage).includes(q);
}
