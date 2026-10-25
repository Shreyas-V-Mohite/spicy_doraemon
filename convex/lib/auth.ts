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

// Throws unless the token belongs to this course's professor.
export async function requireCourseProfessor(
  ctx: QueryCtx | MutationCtx,
  courseId: Id<"courses">,
  token: string,
) {
  const course = await ctx.db.get(courseId);
  if (course === null || !course.tokenHashes.includes(await sha256Hex(token))) {
    throw new ConvexError("Not authorized");
  }
  return course;
}

// Throws unless the token belongs to this session's professor: the owner of
// its course, or (for sessions made before courses) the session's own token.
export async function requireProfessor(
  ctx: QueryCtx | MutationCtx,
  sessionId: Id<"sessions">,
  token: string,
) {
  const session = await ctx.db.get(sessionId);
  if (session === null) throw new ConvexError("Not authorized");
  if (session.courseId) {
    await requireCourseProfessor(ctx, session.courseId, token);
  } else if (
    session.tokenHash === undefined ||
    session.tokenHash !== (await sha256Hex(token))
  ) {
    throw new ConvexError("Not authorized");
  }
  return session;
}
