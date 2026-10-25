/**
 * Molecule sources. The viewer only needs a MoleculeSource; where it came
 * from (bundled file, PubChem, a teammate's backend) is up to the resolver.
 *
 * Molecule IDs are strings shared through SpacetimeDB, e.g. "builtin:benzene".
 * To plug in another source, register a resolver for a new prefix:
 *
 *   registerMoleculeResolver('pubchem', async (cid) => ({
 *     id: `pubchem:${cid}`, name: ..., format: 'sdf', data: await fetchSdf(cid),
 *   }));
 */
export interface MoleculeSource {
  id: string;
  name: string;
  /** Any format 3Dmol.js understands: 'sdf', 'mol2', 'pdb', 'xyz', 'cif', ... */
  format: string;
  data: string;
  formula?: string;
  description?: string;
}

export interface MoleculeInfo {
  id: string;
  name: string;
  formula: string;
  description: string;
}

/** Bundled 3D conformers (PubChem 3D SDF, downloaded once and shipped as static files). */
export const BUILTIN_MOLECULES: MoleculeInfo[] = [
  { id: 'builtin:benzene', name: 'Benzene', formula: 'C₆H₆', description: 'Aromatic ring, planar, D6h symmetry' },
  { id: 'builtin:ethanol', name: 'Ethanol', formula: 'C₂H₅OH', description: 'Primary alcohol' },
  { id: 'builtin:butane', name: 'Butane', formula: 'C₄H₁₀', description: 'Alkane — classic conformer study' },
  { id: 'builtin:glucose', name: 'Glucose', formula: 'C₆H₁₂O₆', description: 'D-glucopyranose ring' },
  { id: 'builtin:aspirin', name: 'Aspirin', formula: 'C₉H₈O₄', description: 'Acetylsalicylic acid' },
  { id: 'builtin:caffeine', name: 'Caffeine', formula: 'C₈H₁₀N₄O₂', description: 'Purine alkaloid' },
];

export const DEFAULT_MOLECULE_ID = 'builtin:benzene';

export type MoleculeResolver = (key: string) => Promise<MoleculeSource>;

const resolvers = new Map<string, MoleculeResolver>();
const cache = new Map<string, Promise<MoleculeSource>>();

export function registerMoleculeResolver(prefix: string, resolver: MoleculeResolver): void {
  resolvers.set(prefix, resolver);
}

registerMoleculeResolver('builtin', async (key) => {
  const info = BUILTIN_MOLECULES.find((m) => m.id === `builtin:${key}`);
  if (!info) throw new Error(`Unknown built-in molecule "${key}"`);
  const res = await fetch(`${import.meta.env.BASE_URL}molecules/${key}.sdf`);
  if (!res.ok) throw new Error(`Failed to load ${key}.sdf (HTTP ${res.status})`);
  return { ...info, format: 'sdf', data: await res.text() };
});

export function resolveMolecule(id: string): Promise<MoleculeSource> {
  let p = cache.get(id);
  if (!p) {
    const sep = id.indexOf(':');
    const prefix = sep >= 0 ? id.slice(0, sep) : 'builtin';
    const key = sep >= 0 ? id.slice(sep + 1) : id;
    const resolver = resolvers.get(prefix);
    p = resolver ? resolver(key) : Promise.reject(new Error(`No molecule resolver for "${prefix}"`));
    p.catch(() => cache.delete(id));
    cache.set(id, p);
  }
  return p;
}

export function moleculeLabel(id: string): string {
  return BUILTIN_MOLECULES.find((m) => m.id === id)?.name ?? id;
}
