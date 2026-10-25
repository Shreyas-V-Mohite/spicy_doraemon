import { ConvexError } from "convex/values";

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";
export const EMBED_MODEL = "voyage-4-lite";
export const EMBED_DIMENSIONS = 1024;
const BATCH_SIZE = 128;
const TIMEOUT_MS = 20000;

async function embedBatch(
  texts: string[],
  inputType: "document" | "query",
  apiKey: string,
): Promise<number[][]> {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await fetch(VOYAGE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          input: texts,
          model: EMBED_MODEL,
          input_type: inputType,
          output_dimension: EMBED_DIMENSIONS,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      if (attempt === 0) continue;
      throw new ConvexError("Embedding service is unreachable");
    }
    lastStatus = res.status;
    if (res.status === 429 || res.status >= 500) continue;
    if (res.status === 401 || res.status === 403) {
      throw new ConvexError("Embedding key was rejected");
    }
    if (!res.ok) throw new ConvexError(`Embedding service error (${res.status})`);

    const body: unknown = await res.json().catch(() => null);
    const data =
      typeof body === "object" && body !== null && "data" in body
        ? (body.data as unknown)
        : null;
    if (!Array.isArray(data) || data.length !== texts.length) {
      throw new ConvexError("Unexpected embedding response");
    }
    const ordered = [...data].sort(
      (a: { index: number }, b: { index: number }) => a.index - b.index,
    );
    return ordered.map((row: { embedding: unknown }) => {
      const e = row.embedding;
      if (
        !Array.isArray(e) ||
        e.length !== EMBED_DIMENSIONS ||
        !e.every((n) => typeof n === "number")
      ) {
        throw new ConvexError("Unexpected embedding response");
      }
      return e as number[];
    });
  }
  throw new ConvexError(`Embedding service unavailable (${lastStatus || "no response"})`);
}

// Use "document" for stored passages and "query" for questions.
export async function embedTexts(
  texts: string[],
  inputType: "document" | "query",
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new ConvexError("Embeddings are not configured");
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    out.push(...(await embedBatch(texts.slice(i, i + BATCH_SIZE), inputType, apiKey)));
  }
  return out;
}
