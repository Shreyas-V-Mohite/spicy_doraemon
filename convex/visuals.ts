import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { requireProfessor } from "./lib/auth";
import { visualFields } from "./lib/visual";

const CHEM_TIMEOUT_MS = 8000;

// Messages for the error codes the chemistry service returns.
const CHEM_ERRORS: Record<string, string> = {
  molecule_not_found: "Molecule not found",
  molecule_unparsable: "Molecule could not be read",
  unknown_group: "Unsupported functional group",
  group_not_in_molecule: "Can't verify: that group isn't in this molecule",
  pubchem_unavailable: "PubChem is unavailable right now",
};

export const checkProfessor = internalQuery({
  args: { sessionId: v.id("sessions"), token: v.string() },
  handler: async (ctx, args) => {
    await requireProfessor(ctx, args.sessionId, args.token);
    return null;
  },
});

export const savePreview = internalMutation({
  args: visualFields,
  handler: async (ctx, args) => {
    return await ctx.db.insert("previews", args);
  },
});

// Asks the chemistry service for a verified highlight and stores it as a
// private preview. Nothing here is visible to students.
export const buildPreview = action({
  args: {
    sessionId: v.id("sessions"),
    token: v.string(),
    query: v.string(),
    groupId: v.string(),
  },
  handler: async (ctx, args): Promise<string> => {
    await ctx.runQuery(internal.visuals.checkProfessor, {
      sessionId: args.sessionId,
      token: args.token,
    });

    const base = process.env.CHEM_SERVICE_URL;
    if (!base) throw new ConvexError("Chemistry service is not configured");

    const url = new URL("/highlight", base);
    url.searchParams.set("query", args.query);
    url.searchParams.set("group_id", args.groupId);

    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(CHEM_TIMEOUT_MS) });
    } catch {
      throw new ConvexError("Chemistry service is unreachable");
    }

    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const detail =
        typeof body === "object" && body !== null && "detail" in body
          ? String(body.detail)
          : "";
      throw new ConvexError(CHEM_ERRORS[detail] ?? "Chemistry service error");
    }

    const visual = parseHighlight(body);
    if (visual === null) throw new ConvexError("Unexpected chemistry response");
    return await ctx.runMutation(internal.visuals.savePreview, {
      sessionId: args.sessionId,
      ...visual,
    });
  },
});

// Narrows the service response; any index outside the SDF atom list is rejected.
function parseHighlight(body: unknown) {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const h = b.highlight as Record<string, unknown> | undefined;
  const atoms = b.atoms;
  if (
    typeof b.query !== "string" ||
    typeof b.cid !== "number" ||
    typeof b.smiles !== "string" ||
    typeof b.sdf !== "string" ||
    !Array.isArray(atoms) ||
    typeof h !== "object" ||
    h === null ||
    typeof h.group_id !== "string" ||
    typeof h.label !== "string" ||
    !Array.isArray(h.indices) ||
    h.indices.length === 0
  ) {
    return null;
  }
  const indices = h.indices;
  if (
    !indices.every(
      (i): i is number =>
        typeof i === "number" && Number.isInteger(i) && i >= 0 && i < atoms.length,
    )
  ) {
    return null;
  }
  return {
    query: b.query,
    cid: b.cid,
    smiles: b.smiles,
    sdf: b.sdf,
    groupId: h.group_id,
    label: h.label,
    indices,
  };
}

export const listPreviews = query({
  args: { sessionId: v.id("sessions"), token: v.string() },
  handler: async (ctx, args) => {
    await requireProfessor(ctx, args.sessionId, args.token);
    return await ctx.db
      .query("previews")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("desc")
      .take(10);
  },
});

// Explicit publish: copies a preview to the public table, replacing the
// session's current visual.
export const publish = mutation({
  args: {
    sessionId: v.id("sessions"),
    token: v.string(),
    previewId: v.id("previews"),
  },
  handler: async (ctx, args) => {
    await requireProfessor(ctx, args.sessionId, args.token);
    const preview = await ctx.db.get(args.previewId);
    if (preview === null || preview.sessionId !== args.sessionId) {
      throw new ConvexError("Preview not found");
    }
    const { _id, _creationTime, ...visual } = preview;
    const current = await ctx.db
      .query("published_visuals")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .unique();
    if (current) {
      await ctx.db.replace("published_visuals", current._id, visual);
    } else {
      await ctx.db.insert("published_visuals", visual);
    }
  },
});

export const unpublish = mutation({
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

// Public: what students and the presentation view show.
export const current = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("published_visuals")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .unique();
  },
});
