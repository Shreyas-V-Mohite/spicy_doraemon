import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Throws unless the token belongs to this session's professor.
export async function requireProfessor(
  ctx: QueryCtx | MutationCtx,
  sessionId: Id<"sessions">,
  token: string,
) {
  const session = await ctx.db.get(sessionId);
  if (session === null || session.tokenHash !== (await sha256Hex(token))) {
    throw new ConvexError("Not authorized");
  }
  return session;
}
