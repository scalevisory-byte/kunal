import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CATEGORIES,
  FILTERS,
  REPORTS,
  STATUS,
  accepts,
  catalogueTotals,
  reportsIn,
} from '../../shared/reportCatalog.js';

/*
 * The catalogue is the Reports screen's backbone, so what these pin is that it
 * cannot drift: no report in a category that does not exist, no status the
 * screen cannot render, no filter the bar does not know how to draw, and no
 * two reports sharing an id.
 */

test('every report lands in a real category with a real status', () => {
  const categories = new Set(CATEGORIES.map((c) => c.key));
  for (const r of REPORTS) {
    assert.ok(categories.has(r.category), `${r.id}: unknown category ${r.category}`);
    assert.ok(STATUS[r.status], `${r.id}: unknown status ${r.status}`);
    assert.ok(r.name && r.id, 'every report needs a name and an id');
  }
});

test('ids are unique, because the screen keys rows on them', () => {
  const ids = REPORTS.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('every filter a report asks for is one the bar can draw', () => {
  for (const r of REPORTS) {
    for (const f of r.filters) {
      assert.ok(FILTERS.includes(f), `${r.id}: unknown filter ${f}`);
    }
  }
});

test('a report that is not finished says why', () => {
  for (const r of REPORTS) {
    if (r.status === 'ready') continue;
    // Either it points at where it lives today, or it explains the gap.
    assert.ok(r.at || r.note, `${r.id}: unfinished and says nothing about it`);
  }
});

test('nothing claims to be ready with nowhere to reach it', () => {
  for (const r of REPORTS.filter((x) => x.status === 'ready')) {
    assert.ok(r.at, `${r.id}: ready but no panel, file or tab`);
  }
});

test('the specification is covered end to end — sixty reports, eight categories', () => {
  assert.equal(CATEGORIES.length, 8);
  const totals = catalogueTotals();
  assert.equal(totals.total, 60);
  assert.equal(totals.ready + totals.partial + totals.planned, 60);
  // Every category carries something; an empty heading is a hole in the spec.
  for (const c of CATEGORIES) {
    assert.ok(reportsIn(c.key).length > 0, `${c.key} has no reports`);
  }
});

test('phase 1 is the five essential categories, and only those', () => {
  const phase1 = new Set(REPORTS.filter((r) => r.phase === 1).map((r) => r.category));
  assert.deepEqual(
    [...phase1].sort(),
    ['attendance', 'employee', 'leave', 'payroll', 'statutory']
  );
  const phase2 = new Set(REPORTS.filter((r) => r.phase === 2).map((r) => r.category));
  assert.deepEqual([...phase2].sort(), ['assets', 'loans', 'mis']);
});

test('a category lists what works before what does not', () => {
  const rows = reportsIn('attendance');
  const ranks = rows.map((r) => ({ ready: 0, partial: 1, planned: 2 })[r.status]);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), 'ready first, planned last');
});

test('the bar only offers a filter the report accepts', () => {
  const payslip = REPORTS.find((r) => r.id === 'payslip');
  assert.equal(accepts(payslip, 'employee'), true);
  assert.equal(accepts(payslip, 'department'), false, 'one slip is not a department report');

  const byCompany = REPORTS.find((r) => r.id === 'payroll-by-company');
  assert.equal(accepts(byCompany, 'employee'), false, 'a company summary is not per employee');
  assert.equal(accepts(undefined, 'month'), false, 'and nothing is not a report');
});
