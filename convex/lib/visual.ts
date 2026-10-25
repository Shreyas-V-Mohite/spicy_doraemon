import { v } from "convex/values";

export const styleValidator = v.union(
  v.literal("stick"),
  v.literal("ball-and-stick"),
  v.literal("spacefill"),
);

// A molecule shared with the class. `indices` are 0-based positions in the
// `sdf` atom block, produced by the chemistry service (RDKit); they are empty
// when no functional group is highlighted.
export const visualFields = {
  sessionId: v.id("sessions"),
  query: v.string(),
  cid: v.optional(v.number()),
  smiles: v.string(),
  sdf: v.string(),
  groupId: v.optional(v.string()),
  label: v.string(),
  indices: v.array(v.number()),
  style: v.optional(styleValidator),
};
