import { ConvexError } from "convex/values";

const CHEM_TIMEOUT_MS = 12000;
const MAX_INPUT_CHARS = 200;

// Messages for the error codes the chemistry service returns.
const CHEM_ERRORS: Record<string, string> = {
  molecule_not_found: "Molecule not found",
  molecule_unparsable: "That isn't a valid molecule",
  molecule_too_large: "That molecule is too large to draw",
  embedding_failed: "Couldn't build a 3D structure for that molecule",
  unauthorized: "The chemistry service rejected our key",
  unknown_group: "Unsupported functional group",
  group_not_in_molecule: "Can't verify: that group isn't in this molecule",
  pubchem_unavailable: "PubChem is unavailable right now",
};

// A molecule is given by name (looked up on PubChem) or as SMILES.
export type MoleculeInput = { kind: "name" | "smiles"; value: string };

export interface DetectedGroup {
  id: string;
  label: string;
  // Every atom of every match, as positions in the SDF.
  indices: number[];
}

export interface MoleculeData {
  query: string;
  cid: number | undefined;
  smiles: string;
  sdf: string;
  groups: DetectedGroup[];
}

export interface VerifiedHighlight extends MoleculeData {
  groupId: string;
  label: string;
  indices: number[];
}

export function cleanInput(input: MoleculeInput): MoleculeInput {
  const value = input.value.trim();
  if (value === "" || value.length > MAX_INPUT_CHARS) {
    throw new ConvexError(`Enter a molecule (up to ${MAX_INPUT_CHARS} characters)`);
  }
  if (input.kind === "smiles" && /\s/.test(value)) {
    throw new ConvexError("SMILES can't contain spaces");
  }
  return { kind: input.kind, value };
}

async function callChem(path: string, params: Record<string, string>): Promise<unknown> {
  const base = process.env.CHEM_SERVICE_URL;
  if (!base) throw new ConvexError("Chemistry service is not configured");
  const url = new URL(path, base);
  for (const [k, val] of Object.entries(params)) url.searchParams.set(k, val);

  // A hosted chemistry service can require a shared secret.
  const key = process.env.CHEM_API_KEY;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: key ? { "x-api-key": key } : undefined,
      signal: AbortSignal.timeout(CHEM_TIMEOUT_MS),
    });
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
  return body;
}

function inputParams(input: MoleculeInput): Record<string, string> {
  return input.kind === "smiles" ? { smiles: input.value } : { query: input.value };
}

// Narrows the service response. Every index must be a real atom position:
// anything else is rejected, so a bad response can never reach students.
function parseMolecule(body: unknown): MoleculeData | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const atoms = b.atoms;
  if (
    typeof b.query !== "string" ||
    typeof b.smiles !== "string" ||
    typeof b.sdf !== "string" ||
    !Array.isArray(atoms) ||
    typeof b.groups !== "object" ||
    b.groups === null ||
    typeof b.group_labels !== "object" ||
    b.group_labels === null ||
    !(b.cid === null || typeof b.cid === "number")
  ) {
    return null;
  }
  const labels = b.group_labels as Record<string, unknown>;
  const groups: DetectedGroup[] = [];
  for (const [id, matches] of Object.entries(b.groups as Record<string, unknown>)) {
    if (!Array.isArray(matches) || typeof labels[id] !== "string") return null;
    const all = new Set<number>();
    for (const match of matches) {
      if (!Array.isArray(match)) return null;
      for (const i of match) {
        if (typeof i !== "number" || !Number.isInteger(i) || i < 0 || i >= atoms.length) {
          return null;
        }
        all.add(i);
      }
    }
    if (all.size === 0) return null;
    groups.push({ id, label: labels[id] as string, indices: [...all].sort((x, y) => x - y) });
  }
  return {
    query: b.query,
    cid: b.cid === null ? undefined : (b.cid as number),
    smiles: b.smiles,
    sdf: b.sdf,
    groups,
  };
}

// The molecule and every functional group RDKit finds in it.
export async function fetchMolecule(input: MoleculeInput): Promise<MoleculeData> {
  const clean = cleanInput(input);
  const data = parseMolecule(await callChem("/molecule", inputParams(clean)));
  if (data === null) throw new ConvexError("Unexpected chemistry response");
  return data;
}

// The molecule with one verified group highlighted. Throws if RDKit can't
// find that group in it.
export async function fetchHighlight(
  input: MoleculeInput,
  groupId: string,
): Promise<VerifiedHighlight> {
  const clean = cleanInput(input);
  const data = parseMolecule(
    await callChem("/highlight", { ...inputParams(clean), group_id: groupId }),
  );
  const group = data?.groups.find((g) => g.id === groupId);
  if (data === null || group === undefined) {
    throw new ConvexError("Unexpected chemistry response");
  }
  return { ...data, groupId, label: group.label, indices: group.indices };
}
