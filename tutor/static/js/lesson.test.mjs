// Run with: node --test tutor/static/js/lesson.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSignedInt, gradeChoice, gradeNumeric, nextStep, misconceptionOf } from './lesson.js';

const pack = JSON.parse(readFileSync(new URL('../../content/pack-v1.json', import.meta.url), 'utf8'));

const E05_SUB2_LEFT = { itemId: 'E05', kind: 'choice', stepId: 'SUB2_LEFT', correct: false };

test('parseSignedInt accepts ASCII, Tamil digits and U+2212', () => {
  assert.deepEqual(parseSignedInt(' 6 '), { ok: true, value: 6 });
  assert.deepEqual(parseSignedInt('-3'), { ok: true, value: -3 });
  assert.deepEqual(parseSignedInt('\u22123'), { ok: true, value: -3 });
  assert.deepEqual(parseSignedInt('௫'), { ok: true, value: 5 });
});

test('parseSignedInt rejects malformed input', () => {
  for (const bad of ['1+1', 'abc', '', '--3', '3.5', '12345']) {
    assert.deepEqual(parseSignedInt(bad), { ok: false, reason: 'invalid' }, bad);
  }
});

test('gradeChoice rejects unknown stepIds and grades known ones', () => {
  const item = { options: [{ stepId: 'SUB8_BOTH' }, { stepId: 'SUB8_LEFT' }], answer: 'SUB8_BOTH' };
  assert.deepEqual(gradeChoice(item, 'NOPE'), { ok: false, invalid: true });
  assert.equal(gradeChoice(item, 'SUB8_BOTH').correct, true);
  assert.equal(gradeChoice(item, 'SUB8_LEFT').correct, false);
});

test('gradeNumeric compares the parsed value to the answer', () => {
  const item = { answer: '-3' };
  assert.equal(gradeNumeric(item, '−3').correct, true);
  assert.equal(gradeNumeric(item, '3').correct, false);
  assert.deepEqual(gradeNumeric(item, 'x'), { ok: false, invalid: true });
});

test('diagnostic correct advances; SUB8_LEFT explains then probes', () => {
  const s = { mode: 'diagnostic' };
  assert.equal(nextStep(s, { itemId: 'E01', kind: 'choice', stepId: 'SUB8_BOTH', correct: true }).action, 'advance');
  const e = nextStep(s, { itemId: 'E01', kind: 'choice', stepId: 'SUB8_LEFT', correct: false });
  assert.equal(e.action, 'explain');
  assert.equal(e.explanation, 'balance');
  assert.equal(e.next.action, 'probe');
  assert.equal(e.next.item, 'E05');
});

test('probe: first choice with the committed E01 tag routes to repair; a correct probe returns to the fresh target', () => {
  const committed = [{ itemId: 'E01', stepId: 'SUB8_LEFT' }];
  const first = nextStep({ probeFailures: 0 }, E05_SUB2_LEFT, committed, pack);
  assert.deepEqual(first, { action: 'repair', item: 'E10' });
  const ok = nextStep({ probeFailures: 0 }, { itemId: 'E05', kind: 'choice', stepId: 'SUB2_BOTH', correct: true }, committed, pack);
  assert.deepEqual(ok, { action: 'return', item: 'E03' });
});

test('probe: the same untagged option repeated stays on the probe with generic retry', () => {
  const committed = [{ itemId: 'E01', stepId: 'SUB8_LEFT' }];
  const untagged = { itemId: 'E05', kind: 'choice', stepId: 'ADD2_BOTH', correct: false };
  assert.deepEqual(nextStep({}, untagged, committed, pack), { action: 'retry', item: 'E05' });
  assert.deepEqual(nextStep({}, untagged, committed, pack), { action: 'retry', item: 'E05' });
});

test('probe: a different untagged mistake after an untagged probe error stays on the probe', () => {
  const committed = [{ itemId: 'E01', stepId: 'SUB8_LEFT' }, { itemId: 'E05', stepId: 'ADD2_BOTH' }];
  const different = { itemId: 'E05', kind: 'choice', stepId: 'DIV3_BOTH', correct: false };
  assert.deepEqual(nextStep({}, different, committed, pack), { action: 'retry', item: 'E05' });
});

test('probe: a tagged match on a different item still routes to E10 after an untagged probe error', () => {
  const committed = [{ itemId: 'E01', stepId: 'SUB8_LEFT' }, { itemId: 'E05', stepId: 'ADD2_BOTH' }];
  assert.deepEqual(nextStep({}, E05_SUB2_LEFT, committed, pack), { action: 'repair', item: 'E10' });
});

test('probe: SUB8_LEFT on E01 then SUB2_LEFT on E05 routes to E10 on the first probe choice', () => {
  const committed = [{ itemId: 'E01', stepId: 'SUB8_LEFT' }];
  assert.deepEqual(nextStep({ probeFailures: 0 }, E05_SUB2_LEFT, committed, pack), { action: 'repair', item: 'E10' });
});

test('probe: an untagged mistake on the probe does not route to E10', () => {
  const committed = [{ itemId: 'E01', stepId: 'SUB8_LEFT' }];
  const untagged = { itemId: 'E05', kind: 'choice', stepId: 'DIV3_BOTH', correct: false };
  const r = nextStep({ probeFailures: 0 }, untagged, committed, pack);
  assert.equal(r.action, 'retry');
});

test('probe: a different tag on the probe does not route to E10', () => {
  const otherPack = {
    items: [
      { id: 'E01', options: [{ stepId: 'SUB8_LEFT', misconception: 'other_tag' }] },
      { id: 'E05', options: [{ stepId: 'SUB2_LEFT', misconception: 'one_side_subtraction' }] },
    ],
  };
  const committed = [{ itemId: 'E01', stepId: 'SUB8_LEFT' }];
  assert.equal(nextStep({ probeFailures: 0 }, E05_SUB2_LEFT, committed, otherPack).action, 'retry');
});

test('probe: repeated same-item event does not count as independent confirmation', () => {
  const committed = [{ itemId: 'E05', stepId: 'SUB2_LEFT' }];
  const r = nextStep({ probeFailures: 0 }, E05_SUB2_LEFT, committed, pack);
  assert.equal(r.action, 'retry');
});

test('probe: numeric-only error is untagged and does not trigger repair', () => {
  assert.equal(misconceptionOf(pack, 'E02', '6'), null);
  const committed = [{ itemId: 'E01', stepId: 'SUB8_LEFT' }];
  assert.deepEqual(nextStep({}, { itemId: 'E02', kind: 'numeric', correct: false }, committed, pack), {
    action: 'hint',
    generic: true,
  });
});

test('misconceptionOf resolves the tag from the pack for a historical event without a tag field', () => {
  const historical = { itemId: 'E01', kind: 'choice', stepId: 'SUB8_LEFT', correct: false };
  assert.equal(misconceptionOf(pack, historical.itemId, historical.stepId), 'one_side_subtraction');
  assert.equal(misconceptionOf(pack, 'E05', 'SUB2_LEFT'), 'one_side_subtraction');
  assert.equal(misconceptionOf(pack, 'E05', 'SUB2_BOTH'), null);
  assert.equal(misconceptionOf(pack, 'E05', 'DIV3_BOTH'), null);
});

test('numeric wrong answer gives a generic hint', () => {
  assert.deepEqual(nextStep({}, { itemId: 'E02', kind: 'numeric', correct: false }), { action: 'hint', generic: true });
});

test('no remaining items means exhausted with no progress increment', () => {
  assert.deepEqual(nextStep({ remaining: [] }, { itemId: 'E02', kind: 'numeric', correct: true }), {
    action: 'exhausted',
    progressDelta: 0,
  });
});
