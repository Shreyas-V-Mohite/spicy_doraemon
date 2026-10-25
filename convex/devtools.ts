import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { embedTexts } from "./lib/embed";

// Development tools for tuning the similarity thresholds (scripts/eval.mjs).
// Internal only: not callable from a browser, and not used by the app.

// Cosine similarity of each pair of texts, as questions would be compared.
export const similarities = internalAction({
  args: { pairs: v.array(v.array(v.string())) },
  handler: async (_ctx, args) => {
    const vectors = await embedTexts(args.pairs.flat(), "query");
    const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
    const norm = (a: number[]) => Math.sqrt(dot(a, a));
    return args.pairs.map((_, i) => {
      const a = vectors[2 * i];
      const b = vectors[2 * i + 1];
      return dot(a, b) / (norm(a) * norm(b));
    });
  },
});
