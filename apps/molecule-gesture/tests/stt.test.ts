import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DeepgramTranscript, type DeepgramMessage } from '../src/voice/deepgramTranscript';
import { chemistryKeyterms, deepgramUrl, estimateTokens, originAllowed, TicketSigner } from '../server/sttConfig';

const res = (transcript: string, is_final: boolean, speech_final = false): DeepgramMessage => ({
  type: 'Results',
  is_final,
  speech_final,
  channel: { alternatives: [{ transcript }] },
});

test('deepgram: interim words are captions only; the phrase is handed on once the utterance is final', () => {
  const t = new DeepgramTranscript();
  assert.deepEqual(t.feed(res('show me', false)), { interim: 'show me' });
  assert.deepEqual(t.feed(res('show me cyclo', false)), { interim: 'show me cyclo' });
  // A final segment that is not the end of the utterance: still nothing to act on.
  assert.deepEqual(t.feed(res('show me', true)), { interim: 'show me' });
  assert.deepEqual(t.feed(res('cyclohexane', false)), { interim: 'show me cyclohexane' });
  assert.deepEqual(t.feed(res('cyclohexane', true, true)), { final: 'show me cyclohexane', interim: '' });
  // Next utterance starts clean.
  assert.deepEqual(t.feed(res('benzene', false)), { interim: 'benzene' });
});

test('deepgram: UtteranceEnd finishes a phrase that had no speech_final', () => {
  const t = new DeepgramTranscript();
  t.feed(res('add caffeine', true));
  assert.deepEqual(t.feed({ type: 'UtteranceEnd' }), { final: 'add caffeine', interim: '' });
  assert.deepEqual(t.feed({ type: 'UtteranceEnd' }), {}, 'nothing pending: nothing to report');
  assert.deepEqual(t.feed({ type: 'Metadata' }), {});
});

test('deepgram: chemistry keyterms include the hard names and stay under the 500-token cap', () => {
  const terms = chemistryKeyterms();
  for (const name of ['cyclohexane', 'benzene', 'ethanol', 'caffeine', 'buckminsterfullerene']) assert.ok(terms.includes(name), name);
  const tokens = terms.reduce((n, t) => n + estimateTokens(t), 0);
  assert.ok(tokens <= 220, `~${tokens} tokens`);
  assert.equal(new Set(terms).size, terms.length, 'no duplicates');
});

test('deepgram: streaming URL asks for Nova-3 with interim results, endpointing and every keyterm', () => {
  const u = new URL(deepgramUrl('wss://api.deepgram.com/v1/listen', 'en-US', ['benzene', 'acetic acid']));
  assert.equal(u.searchParams.get('model'), 'nova-3');
  assert.equal(u.searchParams.get('interim_results'), 'true');
  assert.equal(u.searchParams.get('language'), 'en-US');
  assert.ok(Number(u.searchParams.get('endpointing')) > 0);
  assert.deepEqual(u.searchParams.getAll('keyterm'), ['benzene', 'acetic acid']);
  assert.ok(u.toString().includes('keyterm=acetic+acid'), 'multi-word terms are encoded with +');
});

test('proxy: tickets expire, cannot be forged, and only the app origin is allowed', () => {
  const signer = new TicketSigner(undefined, 60_000);
  const { ticket } = signer.issue(1_000);
  assert.ok(signer.verify(ticket, 2_000));
  assert.ok(!signer.verify(ticket, 62_000), 'expired');
  assert.ok(!new TicketSigner().verify(ticket, 2_000), 'another server secret');
  const [exp, nonce, sig] = ticket.split('.');
  assert.ok(!signer.verify(`${Number(exp) + 999999}.${nonce}.${sig}`, 2_000), 'tampered expiry');
  assert.ok(!signer.verify(null) && !signer.verify('junk'));
  assert.ok(originAllowed('http://localhost:5173', ['http://localhost:5173']));
  assert.ok(!originAllowed('https://evil.example', ['http://localhost:5173']));
  assert.ok(!originAllowed(undefined, ['http://localhost:5173']));
});
