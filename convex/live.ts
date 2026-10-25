import { ConvexError, v } from "convex/values";
import { action, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireProfessor } from "./lib/auth";

// The live room: slides, what the shared stage shows, the professor's camera
// going on air, and the WebRTC signalling that carries it to students.

const MAX_SLIDES = 500;
const PROFESSOR = "professor";

// ---------- Slides ----------

export const generateSlidesUploadUrl = mutation({
  args: { sessionId: v.id("sessions"), token: v.string() },
  handler: async (ctx, args) => {
    await requireProfessor(ctx, args.sessionId, args.token);
    return await ctx.storage.generateUploadUrl();
  },
});

// Puts an uploaded PDF on the session, replacing any earlier deck. The page
// count comes from the professor's browser, which has just parsed the file.
export const attachSlides = mutation({
  args: {
    sessionId: v.id("sessions"),
    token: v.string(),
    fileId: v.id("_storage"),
    slideCount: v.number(),
  },
  handler: async (ctx, args) => {
    const session = await requireProfessor(ctx, args.sessionId, args.token);
    if (!Number.isInteger(args.slideCount) || args.slideCount < 1 || args.slideCount > MAX_SLIDES) {
      throw new ConvexError(`Slides must have 1-${MAX_SLIDES} pages`);
    }
    const meta = await ctx.db.system.get("_storage", args.fileId);
    if (meta === null) throw new ConvexError("Upload not found");
    if (meta.contentType && meta.contentType !== "application/pdf") {
      throw new ConvexError("Slides must be a PDF");
    }
    if (session.slidesFileId && session.slidesFileId !== args.fileId) {
      await ctx.storage.delete(session.slidesFileId);
    }
    await ctx.db.patch("sessions", args.sessionId, {
      slidesFileId: args.fileId,
      slideCount: args.slideCount,
      slideIndex: 0,
      stageMode: "slides",
    });
    return null;
  },
});

// Public: where everyone's browser downloads the deck from.
export const slidesUrl = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session?.slidesFileId) return null;
    return await ctx.storage.getUrl(session.slidesFileId);
  },
});

export const setSlide = mutation({
  args: { sessionId: v.id("sessions"), token: v.string(), slideIndex: v.number() },
  handler: async (ctx, args) => {
    const session = await requireProfessor(ctx, args.sessionId, args.token);
    const count = session.slideCount ?? 0;
    if (count === 0) throw new ConvexError("No slides uploaded");
    const slideIndex = Math.min(count - 1, Math.max(0, Math.round(args.slideIndex)));
    await ctx.db.patch("sessions", args.sessionId, { slideIndex });
    return null;
  },
});

// ---------- Stage ----------

export const setStageMode = mutation({
  args: {
    sessionId: v.id("sessions"),
    token: v.string(),
    stageMode: v.union(v.literal("slides"), v.literal("molecule")),
  },
  handler: async (ctx, args) => {
    await requireProfessor(ctx, args.sessionId, args.token);
    await ctx.db.patch("sessions", args.sessionId, { stageMode: args.stageMode });
    return null;
  },
});

export const setHandMode = mutation({
  args: { sessionId: v.id("sessions"), token: v.string(), on: v.boolean() },
  handler: async (ctx, args) => {
    await requireProfessor(ctx, args.sessionId, args.token);
    await ctx.db.patch("sessions", args.sessionId, { handMode: args.on });
    return null;
  },
});

// ---------- Camera on air ----------

export const setBroadcasting = mutation({
  args: { sessionId: v.id("sessions"), token: v.string(), on: v.boolean() },
  handler: async (ctx, args) => {
    const session = await requireProfessor(ctx, args.sessionId, args.token);
    await ctx.db.patch(
      "sessions",
      args.sessionId,
      args.on
        ? { broadcasting: true, liveEpoch: (session.liveEpoch ?? 0) + 1 }
        : { broadcasting: false },
    );
    return null;
  },
});

// ---------- ICE servers ----------

type IceServer = { urls: string | string[]; username?: string; credential?: string };
const STUN: IceServer = { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] };

// STUN, plus a TURN relay when one is configured, so the camera reaches
// students behind strict firewalls. Either:
//   TURN_URLS (comma-separated), TURN_USERNAME, TURN_CREDENTIAL, or
//   METERED_DOMAIN + METERED_API_KEY (credentials fetched from Metered).
export const iceServers = action({
  args: {},
  handler: async (): Promise<IceServer[]> => {
    const servers: IceServer[] = [STUN];
    const urls = process.env.TURN_URLS;
    if (urls && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
      servers.push({
        urls: urls.split(",").map((u) => u.trim()).filter(Boolean),
        username: process.env.TURN_USERNAME,
        credential: process.env.TURN_CREDENTIAL,
      });
    }
    const domain = process.env.METERED_DOMAIN;
    const key = process.env.METERED_API_KEY;
    if (domain && key) {
      try {
        const res = await fetch(
          `https://${domain}/api/v1/turn/credentials?apiKey=${encodeURIComponent(key)}`,
          { signal: AbortSignal.timeout(5000) },
        );
        if (res.ok) servers.push(...((await res.json()) as IceServer[]));
      } catch {
        // Fall back to STUN and the Convex relay.
      }
    }
    return servers;
  },
});

// ---------- Relay fallback (networks that block WebRTC) ----------

const RELAY_WINDOW_MS = 30_000;
const MAX_RELAY_BYTES = 200_000;

// A student who can't connect directly asks for the relay; it stays on for
// 30 s after the last ask. Only extended when close to running out, so many
// students asking don't each write.
export const requestRelay = mutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session?.broadcasting) return null;
    const now = Date.now();
    if ((session.relayUntil ?? 0) - now < RELAY_WINDOW_MS / 2) {
      await ctx.db.patch("sessions", args.sessionId, { relayUntil: now + RELAY_WINDOW_MS });
    }
    return null;
  },
});

export const pushRelay = mutation({
  args: {
    sessionId: v.id("sessions"),
    token: v.string(),
    kind: v.union(v.literal("video"), v.literal("audio")),
    seq: v.number(),
    data: v.bytes(),
  },
  handler: async (ctx, args) => {
    await requireProfessor(ctx, args.sessionId, args.token);
    if (args.data.byteLength > MAX_RELAY_BYTES) throw new ConvexError("Relay chunk too large");
    const current = await ctx.db
      .query("relay")
      .withIndex("by_session_and_kind", (q) => q.eq("sessionId", args.sessionId).eq("kind", args.kind))
      .unique();
    if (current) await ctx.db.patch("relay", current._id, { seq: args.seq, data: args.data });
    else await ctx.db.insert("relay", { sessionId: args.sessionId, kind: args.kind, seq: args.seq, data: args.data });
    return null;
  },
});

// Public: the latest relayed frame or audio chunk.
export const relay = query({
  args: { sessionId: v.id("sessions"), kind: v.union(v.literal("video"), v.literal("audio")) },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("relay")
      .withIndex("by_session_and_kind", (q) => q.eq("sessionId", args.sessionId).eq("kind", args.kind))
      .unique();
    return row ? { seq: row.seq, data: row.data } : null;
  },
});

// ---------- WebRTC signalling ----------

const kind = v.union(
  v.literal("join"),
  v.literal("offer"),
  v.literal("answer"),
  v.literal("ice"),
  v.literal("leave"),
);

// Only the professor's browser may speak or listen as "professor".
async function checkPeer(
  ctx: QueryCtx | MutationCtx,
  sessionId: Id<"sessions">,
  peer: string,
  token: string | undefined,
) {
  if (peer === PROFESSOR) {
    if (!token) throw new ConvexError("Not authorized");
    await requireProfessor(ctx, sessionId, token);
  } else if (peer.length === 0 || peer.length > 64) {
    throw new ConvexError("Invalid peer");
  }
}

export const sendSignal = mutation({
  args: {
    sessionId: v.id("sessions"),
    from: v.string(),
    to: v.string(),
    kind,
    payload: v.string(),
    token: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await checkPeer(ctx, args.sessionId, args.from, args.token);
    // Students only ever talk to the professor.
    if (args.from !== PROFESSOR && args.to !== PROFESSOR) {
      throw new ConvexError("Invalid recipient");
    }
    if (args.payload.length > 20_000) throw new ConvexError("Signal too large");
    await ctx.db.insert("rtcSignals", {
      sessionId: args.sessionId,
      from: args.from,
      to: args.to,
      kind: args.kind,
      payload: args.payload,
    });
    return null;
  },
});

// Signals waiting for one peer, oldest first.
export const inbox = query({
  args: { sessionId: v.id("sessions"), me: v.string(), token: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await checkPeer(ctx, args.sessionId, args.me, args.token);
    const rows = await ctx.db
      .query("rtcSignals")
      .withIndex("by_session_and_to", (q) => q.eq("sessionId", args.sessionId).eq("to", args.me))
      .take(200);
    return rows.map((r) => ({ _id: r._id, from: r.from, kind: r.kind, payload: r.payload }));
  },
});

// The recipient deletes signals it has handled.
export const ackSignals = mutation({
  args: {
    sessionId: v.id("sessions"),
    me: v.string(),
    token: v.optional(v.string()),
    ids: v.array(v.id("rtcSignals")),
  },
  handler: async (ctx, args) => {
    await checkPeer(ctx, args.sessionId, args.me, args.token);
    for (const id of args.ids.slice(0, 200)) {
      const row = await ctx.db.get(id);
      if (row && row.sessionId === args.sessionId && row.to === args.me) {
        await ctx.db.delete("rtcSignals", id);
      }
    }
    return null;
  },
});
