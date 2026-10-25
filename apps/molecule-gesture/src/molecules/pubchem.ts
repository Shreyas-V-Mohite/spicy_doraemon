/**
 * PubChem (NIH) as a molecule source: name → CID → 3D conformer SDF.
 * Free, no key, CORS-enabled. Synced molecule IDs look like "pubchem:2519",
 * so every client (teacher and students) resolves the same structure.
 *
 * Fast paths, in order (most requests never touch the network):
 *  1. the six built-in files;
 *  2. the bundled pack of ~140 common molecules (public/molecules/pack.json);
 *  3. this browser's cache of earlier lookups (localStorage);
 *  4. PubChem, with the name lookup and the 3D download sent in parallel.
 * Lookups are shared while in flight, so the voice layer can start one early
 * (on the interim transcript) and the final phrase just joins it.
 *
 * PubChem has 3D conformers for most small/medium organic molecules; large
 * biomolecules (proteins, DNA) and many salts/mixtures have none.
 */
import { BUILTIN_MOLECULES, registerMoleculeResolver, type MoleculeSource } from './registry';
import { compactName, loadMoleculePack, trimSdf, type PackedMolecule } from './pack';

const API = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug';

export interface PubChemHit {
  /** Synced molecule ID: a bundled one when available (works offline), else "pubchem:<cid>". */
  id: string;
  cid: number;
  title: string;
  formula: string;
}

export class MoleculeLookupError extends Error {}

/** Subscript digits for display: C8H10N4O2 → C₈H₁₀N₄O₂. */
export function prettyFormula(formula: string): string {
  return formula.replace(/\d/g, (d) => '₀₁₂₃₄₅₆₇₈₉'[Number(d)]);
}

// --- this browser's cache of earlier lookups ---------------------------------

const STORE = 'mgl:pubchem:v1:';
const MAX_STORED_SDF = 300_000;

function stored<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(STORE + key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}

function store(key: string, value: unknown) {
  try {
    localStorage.setItem(STORE + key, JSON.stringify(value));
  } catch {
    /* full or unavailable: only costs a network lookup next time */
  }
}

/** Structures known in memory this session, by CID. */
const molecules = new Map<number, PackedMolecule>();

async function knownByCid(cid: number): Promise<PackedMolecule | null> {
  const mem = molecules.get(cid);
  if (mem) return mem;
  const packed = (await loadMoleculePack())?.molecules[cid] ?? stored<PackedMolecule>(`cid:${cid}`);
  if (packed) molecules.set(cid, packed);
  return packed;
}

function remember(cid: number, m: PackedMolecule) {
  molecules.set(cid, m);
  if (m.sdf.length <= MAX_STORED_SDF) store(`cid:${cid}`, m);
}

// --- network -------------------------------------------------------------------

async function getJson(url: string): Promise<unknown | null> {
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new MoleculeLookupError(`PubChem request failed (HTTP ${res.status})`);
  return res.json();
}

async function getText(url: string): Promise<string | null> {
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new MoleculeLookupError(`PubChem request failed (HTTP ${res.status})`);
  return res.text();
}

type Props = { CID: number; Title?: string; MolecularFormula?: string };

async function propsBy(path: string): Promise<Props | null> {
  const j = (await getJson(`${API}/compound/${path}/property/Title,MolecularFormula/JSON`)) as {
    PropertyTable?: { Properties?: Props[] };
  } | null;
  return j?.PropertyTable?.Properties?.[0] ?? null;
}

/** The CID on the first line of a PubChem SDF record. */
function sdfCid(sdf: string): number {
  return Number(sdf.slice(0, sdf.indexOf('\n')).trim());
}

async function lookUpOnline(name: string): Promise<{ cid: number; m: PackedMolecule }> {
  const path = `name/${encodeURIComponent(name)}`;
  // One round trip: the properties and the 3D structure, in parallel.
  const [props, sdfByName] = await Promise.all([propsBy(path), getText(`${API}/compound/${path}/record/SDF?record_type=3d`).catch(() => null)]);
  if (!props) throw new MoleculeLookupError(`PubChem has no molecule called "${name}"`);
  const cid = props.CID;
  // A name can match several compounds; the structure must be the same one.
  let sdf = sdfByName && sdfCid(sdfByName) === cid ? sdfByName : null;
  if (!sdf) sdf = await getText(`${API}/compound/cid/${cid}/record/SDF?record_type=3d`);
  const title = props.Title ?? name;
  // Make sure it can actually be shown in 3D before switching everyone to it.
  if (!sdf) throw new MoleculeLookupError(`PubChem has no 3D structure for ${title} (too large or not a single molecule)`);
  return { cid, m: { title, formula: props.MolecularFormula ?? '', sdf: trimSdf(sdf) } };
}

// --- public API ------------------------------------------------------------------

const lookups = new Map<string, Promise<PubChemHit>>();

/** Find a molecule by (English) name and confirm a 3D structure exists. */
export function findMoleculeByName(name: string): Promise<PubChemHit> {
  const key = compactName(name.trim());
  let p = lookups.get(key);
  if (!p) {
    p = findUncached(name.trim(), key);
    p.catch(() => lookups.delete(key));
    lookups.set(key, p);
  }
  return p;
}

async function findUncached(clean: string, key: string): Promise<PubChemHit> {
  if (!clean) throw new MoleculeLookupError('Empty molecule name');
  // Bundled molecules need no network (works offline).
  const builtin = BUILTIN_MOLECULES.find((m) => compactName(m.name) === key);
  if (builtin) return { id: builtin.id, cid: 0, title: builtin.name, formula: builtin.formula };
  const cid = (await loadMoleculePack())?.names[key] ?? stored<number>(`name:${key}`);
  if (cid) {
    const m = await knownByCid(cid);
    if (m) return { id: `pubchem:${cid}`, cid, title: m.title, formula: m.formula };
  }
  const hit = await lookUpOnline(clean);
  remember(hit.cid, hit.m);
  store(`name:${key}`, hit.cid);
  return { id: `pubchem:${hit.cid}`, cid: hit.cid, title: hit.m.title, formula: hit.m.formula };
}

/** Warm the bundled pack in the background (call once at start-up). */
export function preloadMolecules(): void {
  void loadMoleculePack();
}

registerMoleculeResolver('pubchem', async (key): Promise<MoleculeSource> => {
  const cid = Number(key);
  if (!Number.isInteger(cid) || cid <= 0) throw new MoleculeLookupError(`Bad PubChem CID "${key}"`);
  let m = await knownByCid(cid);
  if (!m) {
    // A student whose teacher looked up something new: fetch both in parallel.
    const [sdf, props] = await Promise.all([getText(`${API}/compound/cid/${cid}/record/SDF?record_type=3d`), propsBy(`cid/${cid}`)]);
    if (!sdf) throw new MoleculeLookupError(`PubChem has no 3D structure for CID ${cid}`);
    m = { title: props?.Title ?? `CID ${cid}`, formula: props?.MolecularFormula ?? '', sdf: trimSdf(sdf) };
    remember(cid, m);
  }
  return {
    id: `pubchem:${cid}`,
    name: m.title,
    formula: prettyFormula(m.formula),
    description: `PubChem CID ${cid}`,
    format: 'sdf',
    data: m.sdf,
  };
});
