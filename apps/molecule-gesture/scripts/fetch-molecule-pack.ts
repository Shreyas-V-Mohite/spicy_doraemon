/**
 * Downloads 3D structures for the voice dictionary's common molecules from
 * PubChem into one static file, public/molecules/pack.json, so saying
 * "show me caffeine" needs no network round trips at all.
 *
 *   npx tsx scripts/fetch-molecule-pack.ts
 *
 * Molecules without a PubChem 3D conformer are skipped (they still work via
 * the live PubChem lookup). Respects PubChem's 5 requests/second limit.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { COMMON_MOLECULES } from '../src/voice/moleculeCommands';
import { compactName, trimSdf, type MoleculePack } from '../src/molecules/pack';

const API = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug';
const out = join(import.meta.dirname, '..', 'public', 'molecules', 'pack.json');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastAt = 0;
async function get(url: string): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const wait = lastAt + 220 - Date.now();
    if (wait > 0) await sleep(wait);
    lastAt = Date.now();
    const res = await fetch(url);
    if ((res.status === 503 || res.status === 429) && attempt < 4) {
      await sleep(1000 * (attempt + 1));
      continue;
    }
    return res;
  }
}

/** Dictionary names PubChem files under another name ("xylene" is a mixture of isomers). */
const PUBCHEM_NAME: Record<string, string> = { xylene: 'p-xylene' };

const pack: MoleculePack = { version: 1, names: {}, molecules: {} };
const missing: string[] = [];
for (const name of COMMON_MOLECULES) {
  const pr = await get(`${API}/compound/name/${encodeURIComponent(PUBCHEM_NAME[name] ?? name)}/property/Title,MolecularFormula/JSON`);
  if (!pr.ok) {
    missing.push(`${name} (no compound)`);
    continue;
  }
  const p = ((await pr.json()) as { PropertyTable: { Properties: { CID: number; Title?: string; MolecularFormula?: string }[] } })
    .PropertyTable.Properties[0];
  const sr = await get(`${API}/compound/cid/${p.CID}/record/SDF?record_type=3d`);
  if (!sr.ok) {
    missing.push(`${name} (no 3D)`);
    continue;
  }
  pack.names[compactName(name)] = p.CID;
  pack.molecules[p.CID] = { title: p.Title ?? name, formula: p.MolecularFormula ?? '', sdf: trimSdf(await sr.text()) };
  process.stdout.write('.');
}
writeFileSync(out, JSON.stringify(pack));
const kb = Math.round(JSON.stringify(pack).length / 1024);
console.log(`\n${Object.keys(pack.names).length}/${COMMON_MOLECULES.length} molecules → ${out} (${kb} KB)`);
if (missing.length) console.log('skipped:', missing.join(', '));
