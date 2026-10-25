import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
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
  args: visualFields,
  handler: async (ctx, args) => {
    const current = await ctx.db
      .query("published_visuals")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .unique();
    if (current) await ctx.db.replace("published_visuals", current._id, args);
    else await ctx.db.insert("published_visuals", args);
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
  },
  handler: async (ctx, args): Promise<void> => {
    await ctx.runQuery(internal.visuals.checkProfessor, {
      sessionId: args.sessionId,
      token: args.token,
    });
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
