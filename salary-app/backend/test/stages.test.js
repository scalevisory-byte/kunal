import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_STAGES,
  MATCH_BANDS,
  REJECTED,
  STAGES,
  aging,
  isStage,
  matchBand,
  stageIndex,
  stageMeta,
} from '../../shared/stages.js';

test('the pipeline is the seven stages plus Rejected, in order', () => {
  assert.deepEqual(
    STAGES.map((s) => s.key),
    ['New', 'Under Review', 'Shortlisted', 'Interview', 'Offer Sent', 'Selected', 'Joined']
  );
  assert.equal(ALL_STAGES.length, 8);
  assert.equal(ALL_STAGES.at(-1), REJECTED);
  // Rejected is a decision, not a place in the queue.
  assert.equal(stageIndex(REJECTED), -1);
  assert.equal(stageIndex('Shortlisted'), 2);
  for (const s of STAGES) assert.ok(s.label && s.hint);
});

test('only a real stage is a stage', () => {
  assert.ok(isStage('Joined'));
  assert.ok(isStage(REJECTED));
  assert.ok(!isStage('Hired'));
  assert.ok(!isStage(''));
  assert.ok(stageMeta(REJECTED).label);
  assert.equal(stageMeta('nonsense'), null);
});

test('ageing says how long something has sat, and how badly', () => {
  const now = Date.parse('2026-10-31T12:00:00Z');
  assert.equal(aging('2026-10-31T09:00:00Z', now).tone, 'fresh');
  assert.equal(aging('2026-10-31T09:00:00Z', now).label, 'today');
  assert.equal(aging('2026-10-27T09:00:00Z', now).tone, 'warm');
  assert.equal(aging('2026-10-01T09:00:00Z', now).tone, 'stale');
  assert.equal(aging('2026-10-30T09:00:00Z', now).label, '1 day');
  // Nothing to go on is "don't know", never "fresh".
  assert.equal(aging(null, now).tone, 'none');
  assert.equal(aging('not a date', now).days, null);
});

test('the match bands are the ones the dashboard filters by', () => {
  assert.deepEqual(
    MATCH_BANDS.map((b) => b.key),
    ['strong', 'good', 'low']
  );
  assert.equal(matchBand(96), 'strong');
  assert.equal(matchBand(80), 'strong');
  assert.equal(matchBand(79), 'good');
  assert.equal(matchBand(60), 'good');
  assert.equal(matchBand(22), 'low');
  assert.equal(matchBand(undefined), 'low');
});
