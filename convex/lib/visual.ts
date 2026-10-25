import { v } from "convex/values";

// A verified molecule highlight. `indices` are 0-based positions in the
// `sdf` atom block, produced by the chemistry service (RDKit SMARTS).
export const visualFields = {
  sessionId: v.id("sessions"),
  query: v.string(),
  cid: v.number(),
  smiles: v.string(),
  sdf: v.string(),
  groupId: v.string(),
  label: v.string(),
  indices: v.array(v.number()),
};
