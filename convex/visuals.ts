import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { requireProfessor } from "./lib/auth";
import {
  fetchHighlight,
  fetchMolecule,
  type DetectedGroup,
} from "./lib/chem";
import { styleValidator, visualFields } from "./lib/visual";

const inputArgs = {
  kind: v.union(v.literal("name"), v.literal("smiles")),
  value: v.string(),
};

export const checkProfessor = internalQuery({
  args: { sessionId: v.id("sessions"), token: v.string() },
  handler: async (ctx, args) => {
    await requireProfessor(ctx, args.sessionId, args.token);
    return null;
  },
});

// Loads a molecule for the professor's own stage. Nothing is stored or shared;
// the groups come back so the page can offer them as chips.
export const load = action({
  args: { sessionId: v.id("sessions"), token: v.string(), ...inputArgs },
  handler: async (
    ctx,
    args,
  ): Promise<{
    query: string;
    cid: number | undefined;
    smiles: string;
    sdf: string;
    groups: DetectedGroup[];
  }> => {
    await ctx.runQuery(internal.visuals.checkProfessor, {
      sessionId: args.sessionId,
      token: args.token,
    });
    return await fetchMolecule({ kind: args.kind, value: args.value });
  },
});

export const replaceShared = internalMutation({
  args: { ...visualFields, toStage: v.boolean() },
  handler: async (ctx, { toStage, ...visual }) => {
    const current = await ctx.db
      .query("published_visuals")
      .withIndex("by_session", (q) => q.eq("sessionId", visual.sessionId))
      .unique();
    if (current) await ctx.db.replace("published_visuals", current._id, visual);
    else await ctx.db.insert("published_visuals", visual);
    // A view of the previous molecule would misplace the new one.
    await clearView(ctx, visual.sessionId);
    // An explicit share puts it on the stage; following the slides doesn't.
    if (toStage) await ctx.db.patch("sessions", visual.sessionId, { stageMode: "molecule" });
  },
});

async function clearView(ctx: MutationCtx, sessionId: Id<"sessions">) {
  const view = await ctx.db
    .query("stageViews")
    .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
    .unique();
  if (view) await ctx.db.delete(view._id);
}

// 3Dmol's setView array: model position (3), camera distance, rotation
// quaternion (4), then the on-screen offset the hand "move" gesture sets (2).
const VIEW_LENGTH = 10;

// The professor's camera on the shared molecule, sent several times a second
// while they rotate or zoom it (by hand or mouse) so students follow along.
export const setView = mutation({
  args: { sessionId: v.id("sessions"), token: v.string(), view: v.array(v.number()) },
  handler: async (ctx, args) => {
    await requireProfessor(ctx, args.sessionId, args.token);
    if (args.view.length !== VIEW_LENGTH || !args.view.every(Number.isFinite)) {
      throw new ConvexError("Invalid view");
    }
    const current = await ctx.db
      .query("stageViews")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .unique();
    if (current) await ctx.db.patch("stageViews", current._id, { view: args.view });
    else await ctx.db.insert("stageViews", { sessionId: args.sessionId, view: args.view });
    return null;
  },
});

// Public: the camera students' viewers should follow, or null for the default.
export const currentView = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const view = await ctx.db
      .query("stageViews")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .unique();
    return view?.view ?? null;
  },
});

// Shares a molecule with the class. The structure and highlight are fetched
// from the chemistry service again here, never taken from the browser, so
// students only ever see RDKit-verified atoms.
export const share = action({
  args: {
    sessionId: v.id("sessions"),
    token: v.string(),
    ...inputArgs,
    groupId: v.optional(v.string()),
    style: styleValidator,
    // False when the molecule just follows the slides (the stage stays on
    // the slides, with the molecule beside them). Defaults to true.
    toStage: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<void> => {
    await ctx.runQuery(internal.visuals.checkProfessor, {
      sessionId: args.sessionId,
      token: args.token,
    });
    const toStage = args.toStage ?? true;
    const input = { kind: args.kind, value: args.value };
    if (args.groupId !== undefined) {
      const hit = await fetchHighlight(input, args.groupId);
      await ctx.runMutation(internal.visuals.replaceShared, {
        sessionId: args.sessionId,
        query: hit.query,
        cid: hit.cid,
        smiles: hit.smiles,
        sdf: hit.sdf,
        groupId: hit.groupId,
        label: hit.label,
        indices: hit.indices,
        style: args.style,
        toStage,
      });
    } else {
      const mol = await fetchMolecule(input);
      await ctx.runMutation(internal.visuals.replaceShared, {
        sessionId: args.sessionId,
        query: mol.query,
        cid: mol.cid,
        smiles: mol.smiles,
        sdf: mol.sdf,
        label: mol.query,
        indices: [],
        style: args.style,
        toStage,
      });
    }
  },
});

export const unshare = mutation({
  args: { sessionId: v.id("sessions"), token: v.string() },
  handler: async (ctx, args) => {
    await requireProfessor(ctx, args.sessionId, args.token);
    const current = await ctx.db
      .query("published_visuals")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .unique();
    if (current) await ctx.db.delete(current._id);
    await clearView(ctx, args.sessionId);
  },
});

// Public: what students and the stage show.
export const current = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const visual = await ctx.db
      .query("published_visuals")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .unique();
    if (visual === null) return null;
    return {
      query: visual.query,
      smiles: visual.smiles,
      sdf: visual.sdf,
      groupId: visual.groupId ?? null,
      label: visual.label,
      indices: visual.indices,
      style: visual.style ?? "ball-and-stick",
    };
  },
});
