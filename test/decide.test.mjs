import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLATFORMS, decide } from '../server/jev.js';
import { prefilter } from '../server/prefilter.js';

const noul = (p) => ({ type: 'noul', noul: p });
const li = (slop, corp, ai, category = 'genuine_update') => ({
  is_slop: noul(slop),
  is_corporate_slop: noul(corp),
  is_ai_written: noul(ai),
  category: { type: 'choice', choice: category, confidence: 0.8 },
});
const x = (slop, promo, ai) => ({
  is_slop: noul(slop),
  is_promo: noul(promo),
  is_ai_written: noul(ai),
});

test('linkedin: nothing over a stamp threshold is shown', () => {
  const v = decide(PLATFORMS.linkedin, li(0.3, 0.2, 0.4));
  assert.equal(v.verdict, 'show');
  assert.equal(v.kill, false);
  assert.deepEqual(v.scores, { is_corporate_slop: 0.2, is_slop: 0.3, is_ai_written: 0.4 });
});

test('linkedin: anything stamped is also killed', () => {
  const v = decide(PLATFORMS.linkedin, li(0.6, 0.1, 0.1));
  assert.equal(v.verdict, 'hide');
  assert.equal(v.kill, true);
  assert.equal(v.label, 'Bait');
  assert.equal(v.score, 0.6);
});

test('x: bait between stamp and kill is stamped, not killed', () => {
  const v = decide(PLATFORMS.x, x(0.7, 0.1, 0.1));
  assert.equal(v.verdict, 'hide');
  assert.equal(v.kill, false);
  assert.equal(v.label, 'Bait');
});

test('linkedin: corporate outranks bait for the label; score is the highest fired', () => {
  const v = decide(PLATFORMS.linkedin, li(0.65, 0.95, 0.1));
  assert.equal(v.label, 'Corp');
  assert.equal(v.score, 0.95);
  assert.equal(v.kill, true);
});

test('linkedin: humblebrag category turns a Bait stamp into Brag', () => {
  const v = decide(PLATFORMS.linkedin, li(0.7, 0.1, 0.1, 'humblebrag'));
  assert.equal(v.label, 'Brag');
});

test('linkedin: AI-only post gets an AI label and is killed', () => {
  const v = decide(PLATFORMS.linkedin, li(0.2, 0.1, 0.75));
  assert.equal(v.label, 'AI');
  assert.equal(v.kill, true);
});

test('x: promo is labelled Shill and has no category', () => {
  const v = decide(PLATFORMS.x, x(0.2, 0.92, 0.3));
  assert.equal(v.label, 'Shill');
  assert.equal(v.kill, true);
  assert.equal(v.reason, null);
});

test('x: every signal just under stamp shows the post', () => {
  const { signals } = PLATFORMS.x;
  const under = Object.fromEntries(signals.map((s) => [s.id, s.stamp - 0.01]));
  const v = decide(PLATFORMS.x, x(under.is_slop, under.is_promo, under.is_ai_written));
  assert.equal(v.verdict, 'show');
});

test('no signal kills below where it stamps', () => {
  for (const [name, platform] of Object.entries(PLATFORMS)) {
    for (const s of platform.signals) {
      assert.ok(s.kill >= s.stamp, `${name}.${s.id}: kill ${s.kill} < stamp ${s.stamp}`);
      assert.ok(platform.questions[s.id]?.type === 'noul', `${name}.${s.id} missing noul question`);
    }
  }
});

test('prefilter x: thread-bait with two hits and short lines is killed locally', () => {
  const v = prefilter("Most people won't get rich.\n\nNot lazy.\n\nNever learned this.\n\nA thread 🧵👇", 'x');
  assert.deepEqual(v, { verdict: 'hide', kill: true, label: 'Bait', reason: 'engagement_bait', source: 'local' });
});

test('prefilter x: two promo phrases are labelled Shill', () => {
  const v = prefilter('Presale is live. Airdrop for early wallets. Link in bio.', 'x');
  assert.equal(v.label, 'Shill');
  assert.equal(v.kill, true);
});

test('prefilter x: a normal 100-char tweet still goes to Jev', () => {
  const text = 'Spent three hours debugging a Postgres deadlock today. Sorting the IDs before the UPDATE fixed it.';
  assert.ok(text.length > 60);
  assert.equal(prefilter(text, 'x'), null);
});

test('prefilter linkedin: behaviour unchanged for short plain posts', () => {
  const v = prefilter('Quick one: the office is closed Friday for the holiday.', 'linkedin');
  assert.equal(v.verdict, 'show');
  assert.equal(v.source, 'local');
});

test('prefilter linkedin: corporate rule keeps the Corp label', () => {
  const v = prefilter('We are thrilled to announce... a testament to our team. We are hiring!', 'linkedin');
  assert.equal(v.label, 'Corp');
});
