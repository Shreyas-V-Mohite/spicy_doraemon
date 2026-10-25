/**
 * Builds the "molecules" index in Moss (semantic search) from the bundled
 * molecule pack, so the voice layer can resolve descriptions and other
 * names: "the molecule in coffee" → caffeine, "Tylenol" → acetaminophen,
 * "vitamin C" → ascorbic acid.
 *
 * Each document = a dictionary molecule: its name, PubChem's common
 * synonyms (brand names, other names) and the first sentences of PubChem's
 * description. Re-run after `npm run molecules`.
 *
 *   MOSS_PROJECT_ID=… MOSS_PROJECT_KEY=… npx tsx scripts/moss-index.ts
 *   (or put VITE_MOSS_PROJECT_ID / VITE_MOSS_PROJECT_KEY in .env.local)
 *
 * Then prints a few test queries with their scores, for tuning the
 * thresholds in src/voice/mossMatch.ts.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MossClient } from '@moss-js/moss';
import { compactName, type MoleculePack } from '../src/molecules/pack';
import { COMMON_MOLECULES } from '../src/voice/moleculeCommands';
import { MOSS_INDEX } from '../src/voice/mossMatch';

const root = join(import.meta.dirname, '..');
for (const f of ['.env.local', '.env']) if (existsSync(join(root, f))) process.loadEnvFile(join(root, f));
const projectId = process.env.MOSS_PROJECT_ID ?? process.env.VITE_MOSS_PROJECT_ID;
const projectKey = process.env.MOSS_PROJECT_KEY ?? process.env.VITE_MOSS_PROJECT_KEY;
if (!projectId || !projectKey) throw new Error('Set MOSS_PROJECT_ID and MOSS_PROJECT_KEY (or VITE_MOSS_* in .env.local). Get them at https://moss.dev');

const API = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug';
const pack = JSON.parse(readFileSync(join(root, 'public/molecules/pack.json'), 'utf8')) as MoleculePack;

// Dictionary name for each CID (what the voice layer looks up afterwards).
const nameOf = new Map<number, string>();
for (const n of COMMON_MOLECULES) {
  const cid = pack.names[compactName(n)];
  if (cid && !nameOf.has(cid)) nameOf.set(cid, n);
}
const cids = [...nameOf.keys()];

type Info = { CID: number; Synonym?: string[]; Description?: string };
async function info(kind: 'synonyms' | 'description'): Promise<Info[]> {
  const res = await fetch(`${API}/compound/cid/${cids.join(',')}/${kind}/JSON`);
  if (!res.ok) throw new Error(`PubChem ${kind}: HTTP ${res.status}`);
  return ((await res.json()) as { InformationList: { Information: Info[] } }).InformationList.Information;
}

/** Everyday names only: no CAS numbers, registry codes or long IUPAC strings. */
const readable = (s: string) => s.length <= 32 && !/\d{2,}|[[\]{}]|^[A-Z0-9-]{4,}$|UNII|CHEBI|DTXSID/.test(s);

const synonyms = new Map<number, string[]>();
for (const i of await info('synonyms')) synonyms.set(i.CID, (i.Synonym ?? []).filter(readable).slice(0, 12));
const descriptions = new Map<number, string>();
for (const i of await info('description')) {
  if (!i.Description || descriptions.has(i.CID)) continue;
  descriptions.set(i.CID, i.Description.split(/(?<=\.)\s+/).slice(0, 2).join(' '));
}

const docs = cids.map((cid) => {
  const m = pack.molecules[cid];
  const name = nameOf.get(cid)!;
  const also = [...new Set((synonyms.get(cid) ?? []).filter((s) => compactName(s) !== compactName(name)))];
  const text = [`${m.title} (${name})`, also.length ? `Also called ${also.join(', ')}.` : '', descriptions.get(cid) ?? ''].join(' ').trim();
  return { id: String(cid), text, metadata: { name, title: m.title } };
});
console.log(`${docs.length} documents, e.g.\n  ${docs.find((d) => d.metadata.name === 'caffeine')?.text}`);

const client = new MossClient(projectId, projectKey);
const existing = await client.listIndexes();
if (existing.some((i) => i.name === MOSS_INDEX)) {
  await client.deleteIndex(MOSS_INDEX);
  console.log(`deleted the old "${MOSS_INDEX}" index`);
}
const result = await client.createIndex(MOSS_INDEX, docs, { modelId: 'moss-minilm' });
console.log('created:', JSON.stringify(result));

// A few queries to see the scores (tune the thresholds in src/voice/mossMatch.ts).
await client.loadIndex(MOSS_INDEX);
for (const q of ['the molecule in coffee', 'tylenol', 'vitamin c', 'the sugar in milk', 'table sugar', 'nail polish remover', 'let us look at the ring', 'the electrons are delocalized']) {
  const r = await client.query(MOSS_INDEX, q, { topK: 2 });
  console.log(`${q.padEnd(32)} → ${r.docs.map((d) => `${d.metadata?.name} ${d.score.toFixed(2)}`).join(' | ')}`);
}
