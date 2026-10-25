import Anthropic from "@anthropic-ai/sdk";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalMutation, internalQuery, query } from "./_generated/server";
import { requireProfessor } from "./lib/auth";

// Claude reads each slide (its picture and its text) and lists the molecules
// on it, so turning on hand gestures puts the one being taught on stage.
// The structure itself still comes from the chemistry service (PubChem/RDKit);
// Claude only names it.

const MODEL = "claude-opus-5-5";
const MAX_IMAGE_CHARS = 4_000_000; // base64 JPEG
const MAX_TEXT_CHARS = 8_000;

const SYSTEM = `You look at one lecture slide from a chemistry course and list the chemical compounds it shows or names: drawn structures, formulas and compound names all count.

Give each compound by the common name PubChem would recognise (e.g. "acetic acid", "ethanol", "benzoic acid"), and its SMILES if you are confident, else an empty string. List the compound the slide is mainly about first. Leave out functional groups, reaction types and general classes ("alcohols", "carboxylic acids") unless a specific compound is drawn or named for them. If the slide shows no specific compound, return an empty list. At most 5.`;

const SCHEMA = {
  type: "object",
  properties: {
    molecules: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, smiles: { type: "string" } },
        required: ["name", "smiles"],
        additionalProperties: false,
      },
    },
  },
  required: ["molecules"],
  additionalProperties: false,
} as const;

export const deckFor = internalQuery({
  args: { sessionId: v.id("sessions"), token: v.string(), slideIndex: v.number() },
  handler: async (ctx, args) => {
    const session = await requireProfessor(ctx, args.sessionId, args.token);
    if (!session.slidesFileId) throw new ConvexError("No slides uploaded");
    const existing = await ctx.db
      .query("slideMolecules")
      .withIndex("by_session_and_slideIndex", (q) =>
        q.eq("sessionId", args.sessionId).eq("slideIndex", args.slideIndex),
      )
      .unique();
    return {
      fileId: session.slidesFileId,
      done: existing !== null && existing.fileId === session.slidesFileId,
    };
  },
});

export const save = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    slideIndex: v.number(),
    fileId: v.id("_storage"),
    molecules: v.array(v.object({ name: v.string(), smiles: v.string() })),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("slideMolecules")
      .withIndex("by_session_and_slideIndex", (q) =>
        q.eq("sessionId", args.sessionId).eq("slideIndex", args.slideIndex),
      )
      .unique();
    if (existing) await ctx.db.replace("slideMolecules", existing._id, args);
    else await ctx.db.insert("slideMolecules", args);
    return null;
  },
});

// The professor's browser sends the rendered slide (JPEG, base64) and its
// text the first time each slide is shown.
export const detect = action({
  args: {
    sessionId: v.id("sessions"),
    token: v.string(),
    slideIndex: v.number(),
    image: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args): Promise<null> => {
    const deck = await ctx.runQuery(internal.slideAi.deckFor, {
      sessionId: args.sessionId,
      token: args.token,
      slideIndex: args.slideIndex,
    });
    if (deck.done) return null;
    if (args.image.length > MAX_IMAGE_CHARS) throw new ConvexError("Slide image too large");

    const client = new Anthropic({ maxRetries: 1, timeout: 60_000 });
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: SYSTEM,
      // A short extraction: low effort keeps it quick.
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: args.image } },
            {
              type: "text",
              text: `<slide_text>\n${args.text.slice(0, MAX_TEXT_CHARS)}\n</slide_text>\n\nList the compounds on this slide.`,
            },
          ],
        },
      ],
    });

    let molecules: { name: string; smiles: string }[] = [];
    const block = response.content.find((b) => b.type === "text");
    if (response.stop_reason === "end_turn" && block?.type === "text") {
      const out = JSON.parse(block.text) as { molecules: { name: string; smiles: string }[] };
      molecules = out.molecules
        .map((m) => ({ name: m.name.trim().slice(0, 120), smiles: m.smiles.trim().slice(0, 300) }))
        .filter((m) => m.name.length > 0)
        .slice(0, 5);
    }
    await ctx.runMutation(internal.slideAi.save, {
      sessionId: args.sessionId,
      slideIndex: args.slideIndex,
      fileId: deck.fileId,
      molecules,
    });
    return null;
  },
});

// Professor only: molecules found so far, by slide, for the current deck.
export const list = query({
  args: { sessionId: v.id("sessions"), token: v.string() },
  handler: async (ctx, args) => {
    const session = await requireProfessor(ctx, args.sessionId, args.token);
    if (!session.slidesFileId) return [];
    const rows = await ctx.db
      .query("slideMolecules")
      .withIndex("by_session_and_slideIndex", (q) => q.eq("sessionId", args.sessionId))
      .take(600);
    return rows
      .filter((r) => r.fileId === session.slidesFileId)
      .map((r) => ({ slideIndex: r.slideIndex, molecules: r.molecules }));
  },
});
