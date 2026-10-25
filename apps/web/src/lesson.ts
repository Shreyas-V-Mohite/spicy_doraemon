// The demo lesson: three molecules and the three supported functional groups.
// Group ids must match the chemistry service's /groups whitelist.
export const DEMO_MOLECULES = ["ethanol", "acetic acid", "aspirin"];

export const GROUPS: { id: string; label: string }[] = [
  { id: "hydroxyl", label: "Hydroxyl (alcohol)" },
  { id: "carboxylic_acid", label: "Carboxylic acid" },
  { id: "ester", label: "Ester" },
];
