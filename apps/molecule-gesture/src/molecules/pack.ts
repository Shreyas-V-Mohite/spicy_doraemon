/**
 * The bundled molecule pack: 3D structures of the voice dictionary's common
 * molecules, downloaded once from PubChem (scripts/fetch-molecule-pack.ts)
 * and served as one static file, so they show up without any network lookup.
 */

export interface PackedMolecule {
  title: string;
  formula: string;
  /** PubChem 3D conformer, trimmed to the structure block. */
  sdf: string;
}

export interface MoleculePack {
  version: 1;
  /** compactName(name) → PubChem CID. */
  names: Record<string, number>;
  molecules: Record<number, PackedMolecule>;
}

/** Lookup key for names: lower case, no spaces or hyphens. */
export function compactName(name: string): string {
  return name.toLowerCase().replace(/[\s-]+/g, '');
}

/**
 * Keep only the first record's structure (atoms, bonds) and drop PubChem's
 * long property fields — about a third of the size, and all 3Dmol needs.
 */
export function trimSdf(sdf: string): string {
  const end = sdf.indexOf('M  END');
  return end < 0 ? sdf : sdf.slice(0, end) + 'M  END\n$$$$\n';
}

let packPromise: Promise<MoleculePack | null> | null = null;

/** Load the pack once (cheap to call repeatedly; null when it isn't there). */
export function loadMoleculePack(): Promise<MoleculePack | null> {
  if (!packPromise) {
    // (Also imported by the Node pack script, where import.meta.env doesn't exist.)
    const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
    packPromise = fetch(`${base}molecules/pack.json`)
      .then((r) => (r.ok ? (r.json() as Promise<MoleculePack>) : null))
      .catch(() => null);
  }
  return packPromise;
}
