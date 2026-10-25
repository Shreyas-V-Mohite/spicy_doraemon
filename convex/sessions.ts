import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { sha256Hex } from "./lib/auth";

// No 0/O/1/I so codes can be read aloud.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCode(): string {
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

// The professor token is generated in the browser; only its hash is stored.
export const create = mutation({
  args: { passcode: v.string(), token: v.string(), topic: v.string() },
  handler: async (ctx, args) => {
    if (args.passcode !== process.env.PROFESSOR_PASSCODE) {
      throw new ConvexError("Wrong passcode");
    }
    let code = randomCode();
    while (
      await ctx.db
        .query("sessions")
        .withIndex("by_code", (q) => q.eq("code", code))
        .unique()
    ) {
      code = randomCode();
    }
    const sessionId = await ctx.db.insert("sessions", {
      code,
      topic: args.topic,
      tokenHash: await sha256Hex(args.token),
    });
    return { sessionId, code };
  },
});

// Public: join code lookup. Returns public fields only.
export const getByCode = query({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_code", (q) => q.eq("code", args.code.toUpperCase()))
      .unique();
    if (session === null) return null;
    return { _id: session._id, code: session.code, topic: session.topic };
  },
});
