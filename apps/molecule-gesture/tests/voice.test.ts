import { test } from 'node:test';
import assert from 'node:assert/strict';
import { knownMolecule, parseMoleculeRequests } from '../src/voice/moleculeCommands';

const qs = (s: string) => parseMoleculeRequests(s).map((r) => r.query);
const q = (s: string) => qs(s)[0] ?? null;

test('voice: English requests', () => {
  assert.equal(q('Show me caffeine.'), 'caffeine');
  assert.equal(q('load aspirin'), 'aspirin');
  assert.equal(q('molecule benzene'), 'benzene');
  assert.equal(q('can you show the molecule ibuprofen please'), 'ibuprofen');
  assert.equal(q('add ethanol'), 'ethanol');
  assert.equal(q('bring up the structure of glucose'), 'glucose');
  assert.equal(q('display 2-methylpropane'), '2-methylpropane'); // not in the dictionary → PubChem
});

test('voice: a request buried in a longer phrase (continuous recognition)', () => {
  assert.equal(q('okay so show me caffeine'), 'caffeine');
  assert.equal(q('alright everyone now let us show benzene on the screen'), 'benzene');
  assert.equal(q('this is the ring and next show me toluene'), 'toluene');
});

test('voice: several molecules at once', () => {
  assert.deepEqual(qs('show me benzene and caffeine'), ['benzene', 'caffeine']);
  assert.deepEqual(qs('add methane, ethane and propane'), ['methane', 'ethane', 'propane']);
});

test('voice: small mis-hearings are corrected against common molecules', () => {
  assert.equal(knownMolecule('benzine'), 'benzene');
  assert.equal(knownMolecule('asprin'), 'aspirin');
  assert.equal(knownMolecule('cafeine'), 'caffeine');
  assert.equal(knownMolecule('ethenol'), 'ethanol');
  assert.equal(q('show me benzine'), 'benzene');
  assert.equal(knownMolecule('ring'), null);
});

test('voice: a known name said on its own', () => {
  assert.equal(q('benzene'), 'benzene');
  assert.equal(q('Caffeine.'), 'caffeine');
  assert.equal(q('the acetic acid'), 'acetic acid');
});

test('voice: soft phrases only act on known molecules', () => {
  assert.equal(q("let's look at benzene"), 'benzene');
  assert.deepEqual(qs("let's look at the ring"), []);
  assert.deepEqual(qs('we need to look at the electrons'), []);
});

test('voice: ordinary lecture speech is ignored', () => {
  assert.deepEqual(qs('so the electrons are delocalized around the ring'), []);
  assert.deepEqual(qs('today we will talk about aromatic compounds'), []);
  assert.deepEqual(qs('오늘은 방향족 화합물에 대해서 배워볼 거예요'), []);
});

test('voice: Korean requests', () => {
  assert.equal(q('카페인 보여줘'), 'caffeine');
  assert.equal(q('오늘은 카페인 보여줘'), 'caffeine');
  assert.equal(q('에탄올을 보여 주세요'), 'ethanol');
  assert.equal(q('분자 아세트산'), 'acetic acid');
  assert.equal(q('카페인'), 'caffeine');
  assert.equal(parseMoleculeRequests('뭔가이상한분자 보여줘')[0]?.query, '');
});

test('voice: dictionary names are marked known (safe to act on before the phrase is final)', () => {
  assert.equal(parseMoleculeRequests('okay so show me caffeine')[0].known, true);
  assert.equal(parseMoleculeRequests('show me benzene and ethanol').every((r) => r.known), true);
  assert.ok(!parseMoleculeRequests('show me oseltamivir')[0].known, 'unknown names wait for the final phrase');
});

test('voice: the bundled pack covers every dictionary molecule', async () => {
  const { readFileSync } = await import('node:fs');
  const { compactName } = await import('../src/molecules/pack');
  const { COMMON_MOLECULES } = await import('../src/voice/moleculeCommands');
  const pack = JSON.parse(readFileSync(new URL('../public/molecules/pack.json', import.meta.url), 'utf8'));
  const missing = COMMON_MOLECULES.filter((n) => !pack.names[compactName(n)]);
  assert.deepEqual(missing, [], 'run `npm run molecules` after editing COMMON_MOLECULES');
  for (const cid of Object.values(pack.names) as number[]) assert.match(pack.molecules[cid].sdf, /M {2}END/);
});
