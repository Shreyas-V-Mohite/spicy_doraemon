import { ConvexError } from "convex/values";

const CHEM_TIMEOUT_MS = 8000;

// Messages for the error codes the chemistry service returns.
const CHEM_ERRORS: Record<string, string> = {
  molecule_not_found: "Molecule not found",
  molecule_unparsable: "Molecule could not be read",
  unknown_group: "Unsupported functional group",
  group_not_in_molecule: "Can't verify: that group isn't in this molecule",
  pubchem_unavailable: "PubChem is unavailable right now",
};

export interface VerifiedHighlight {
  query: string;
  cid: number;
  smiles: string;
  sdf: string;
  groupId: string;
  label: string;
  indices: number[];
}

// Asks the chemistry service for RDKit-verified atom indices. Throws a
// ConvexError with a professor-readable message when it can't verify.
export async function fetchHighlight(
  query: string,
  groupId: string,
): Promise<VerifiedHighlight> {
  const base = process.env.CHEM_SERVICE_URL;
  if (!base) throw new ConvexError("Chemistry service is not configured");

  const url = new URL("/highlight", base);
  url.searchParams.set("query", query);
  url.searchParams.set("group_id", groupId);

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
  return visual;
}

// Narrows the service response; any index outside the SDF atom list is rejected.
function parseHighlight(body: unknown): VerifiedHighlight | null {
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
