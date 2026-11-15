import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * ARCHIVED, NEVER DELETED.
 *
 * Dinesh: "selected wale ko employee banne ka option, aur wo data archive me
 * chala jana chahiye". Somebody who has joined is finished with hiring and
 * must come off the working list - and everything about them has to stay
 * exactly where it is, because that is the file somebody asks for two years
 * later.
 */

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cand-archive-'));
process.env.LINK_SECRET = 'test-secret';

const hiring = await import('../src/hiring.js');
const { createCompany } = await import('../src/db.js');

const company = createCompany({ name: 'BOOKNFLY PVT LTD' });
const vacancy = hiring.createVacancy({
  company_id: company.id, title: 'Travel Consultant', openings: 1, status: 'published',
});

const applyFor = (name, phone) => {
  const candidate = hiring.createCandidate({ name, phone });
  const made = hiring.createApplication({ vacancy_id: vacancy.id, candidate_id: candidate.id });
  return { candidate, application: made.application ?? made };
};

test('the working list does not show archived people, and the archive shows only them', () => {
  const { candidate } = applyFor('Asha Mehta', '9100000001');
  assert.ok(hiring.listCandidates().rows.some((r) => r.id === candidate.id));

  hiring.archiveCandidate(candidate.id, { reason: 'joined' });
  assert.ok(
    !hiring.listCandidates().rows.some((r) => r.id === candidate.id),
    'this week’s hiring must not scroll past last year’s'
  );
  const archived = hiring.listCandidates({ archived: true }).rows;
  assert.ok(archived.some((r) => r.id === candidate.id));
  assert.ok(
    archived.every((r) => r.archived_at),
    'the archive is a place, not a list with live people mixed in'
  );
});

test('nothing about them is deleted, and Restore puts them back', () => {
  const { candidate } = applyFor('Kiran Rao', '9100000002');
  hiring.archiveCandidate(candidate.id, { reason: 'joined' });

  const still = hiring.getCandidate(candidate.id);
  assert.equal(still.name, 'Kiran Rao');
  assert.equal(still.phone, '9100000002');
  assert.ok(still.archived_at);
  assert.equal(still.archived_reason, 'joined');

  hiring.restoreCandidate(candidate.id);
  assert.equal(hiring.getCandidate(candidate.id).archived_at, null);
  assert.equal(hiring.getCandidate(candidate.id).archived_reason, null);
  assert.ok(hiring.listCandidates().rows.some((r) => r.id === candidate.id));
});

test('archiving twice is not an error and does not restamp the date', () => {
  const { candidate } = applyFor('Vikas Patel', '9100000003');
  const first = hiring.archiveCandidate(candidate.id, { reason: 'one' });
  const again = hiring.archiveCandidate(candidate.id, { reason: 'two' });
  assert.equal(again.archived_at, first.archived_at);
  assert.equal(again.archived_reason, 'one', 'the first reason is the reason');
});

test('putting somebody on the payroll takes them off the hiring list', () => {
  const { candidate, application } = applyFor('Riya Shah', '9100000004');
  const hired = hiring.hireApplication(application.id, { monthly_salary: 25000 });
  assert.equal(hired.created, true);
  assert.equal(hired.archived, true);

  assert.ok(
    !hiring.listCandidates().rows.some((r) => r.id === candidate.id),
    'they work here now - they are not a candidate'
  );
  const row = hiring.listCandidates({ archived: true }).rows.find((r) => r.id === candidate.id);
  assert.ok(row, 'but their file is still there');
  assert.match(row.archived_reason, /joined BOOKNFLY/);
  assert.equal(row.latest_stage, 'Joined');
});

test('a rejection does NOT archive itself', () => {
  const { candidate, application } = applyFor('Manish Jain', '9100000005');
  hiring.moveApplication(application.id, 'Rejected', { by: 'office' });
  assert.ok(
    hiring.listCandidates().rows.some((r) => r.id === candidate.id),
    'turning somebody down for one opening is how the next opening finds them'
  );
});

test('the stage filter answers "show me the selected ones"', () => {
  const { application } = applyFor('Neha Desai', '9100000006');
  hiring.moveApplication(application.id, 'Selected', { by: 'office' });

  const selected = hiring.listCandidates({ stage: 'Selected' }).rows;
  assert.ok(selected.length >= 1);
  assert.ok(selected.every((r) => r.latest_stage === 'Selected'));

  const rejected = hiring.listCandidates({ stage: 'Rejected' }).rows;
  assert.ok(rejected.every((r) => r.latest_stage === 'Rejected'));
  assert.ok(
    !rejected.some((r) => selected.some((x) => x.id === r.id)),
    'the two piles cannot overlap'
  );
});

test('the stage filter still never shows archived people', () => {
  const { candidate, application } = applyFor('Sonal Mehta', '9100000007');
  hiring.moveApplication(application.id, 'Selected', { by: 'office' });
  hiring.archiveCandidate(candidate.id, { reason: 'left it' });
  assert.ok(
    !hiring.listCandidates({ stage: 'Selected' }).rows.some((r) => r.id === candidate.id),
    'an archived person is archived whatever stage they stopped at'
  );
  assert.ok(
    hiring.listCandidates({ stage: 'Selected', archived: true }).rows.some((r) => r.id === candidate.id)
  );
});
