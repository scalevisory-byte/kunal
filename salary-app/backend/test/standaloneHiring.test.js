import test from 'node:test';
import assert from 'node:assert/strict';

/*
 * Hiring in the single-file build.
 *
 * It used to be one card saying "needs the server" and nothing else, which is
 * what Dinesh was looking at when he said hiring was blank and that it was the
 * most important thing. Only two parts genuinely need a server - the apply
 * link a candidate opens, and the CV file - so the rest now runs offline
 * against localStore.js.
 *
 * The risk is the same one standalone.test.js exists for: the two halves
 * drifting. These tests drive localStore directly, the way the browser does,
 * and pin the behaviour that costs money or a person's record if it differs:
 * the reference numbers, the mobile number as the identity, the stage log,
 * what a test result is judged against, and the handover to payroll.
 */

/** A browser's localStorage, enough of one for the store. */
function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  };
}

/**
 * A fresh store per test. localStore caches the parsed store in a module
 * variable, so the module itself has to be re-imported, not just the storage
 * cleared - otherwise test two inherits test one's candidates.
 */
let nonce = 0;
async function freshStore() {
  globalThis.localStorage = fakeStorage();
  const mod = await import(`../../frontend/src/localStore.js?t=${nonce++}`);
  const api = (method, path, body) => mod.handle(method, path, body);
  // One company to hire into. An opening without one is refused, deliberately.
  const company = await api('POST', '/companies', { name: 'BOOKNFLY PRIVATE LIMITED' });
  return { api, mod, company };
}

const openOpening = (api, company, extra = {}) =>
  api('POST', '/hiring/vacancies', {
    company_id: company.id,
    title: 'Travel Consultant',
    location: 'Vadodara',
    skills: 'Ticketing, Amadeus, Excel',
    experience_band: '1-3 yrs',
    salary_min: '18000',
    salary_max: '25000',
    positions: 2,
    status: 'published',
    ...extra,
  });

const addCandidate = (api, extra = {}) =>
  api('POST', '/hiring/candidates', {
    name: 'Devanshi Trivedi',
    phone: '+91 98257 77888',
    location: 'Bhayli, Vadodara',
    experience: '2 years',
    expected_salary: '22000',
    skills: 'Ticketing, Amadeus, Excel',
    ...extra,
  });

test('an opening needs a title and one of our own companies', async () => {
  const { api, company } = await freshStore();
  await assert.rejects(
    () => api('POST', '/hiring/vacancies', { company_id: company.id }),
    /job title/
  );
  await assert.rejects(
    () => api('POST', '/hiring/vacancies', { title: 'Travel Consultant' }),
    /needs a company/
  );
  const v = await openOpening(api, company);
  assert.equal(v.ref_no, 'JOB-001');
  assert.equal(v.company_name, 'BOOKNFLY PRIVATE LIMITED');
});

test('reference numbers run on, and a deleted opening never hands its number back', async () => {
  const { api, company } = await freshStore();
  const first = await openOpening(api, company);
  const second = await openOpening(api, company, { title: 'Accounts Executive' });
  assert.deepEqual([first.ref_no, second.ref_no], ['JOB-001', 'JOB-002']);

  await api('DELETE', `/hiring/vacancies/${second.id}`);
  const third = await openOpening(api, company, { title: 'Office Assistant' });
  assert.equal(third.ref_no, 'JOB-003', 'JOB-002 was printed on something already');
});

test('a test link that is not a web address is refused when it is saved', async () => {
  const { api, company } = await freshStore();
  await assert.rejects(() => openOpening(api, company, { test_url: 'not a link' }), /./);
  const ok = await openOpening(api, company, { test_url: 'https://crm.zyntajobs.in/test?t=office-admin' });
  assert.equal(ok.test_url, 'https://crm.zyntajobs.in/test?t=office-admin');
});

test('the mobile number is the identity - the same number twice is refused', async () => {
  const { api } = await freshStore();
  const c = await addCandidate(api);
  assert.equal(c.ref_no, 'CAN-001');
  // Written the way a person would type it the second time.
  assert.equal(c.phone, '9825777888', 'the number is stored as its last ten digits');
  await assert.rejects(() => addCandidate(api, { phone: '09825777888' }), /already on file/);
});

test('an application scores on the way in, and applying twice is not an error', async () => {
  const { api, company } = await freshStore();
  const v = await openOpening(api, company);
  const c = await addCandidate(api);

  const first = await api('POST', '/hiring/applications', { vacancy_id: v.id, candidate_id: c.id });
  assert.equal(first.created, true);
  assert.ok(first.application.match_score > 0, 'a fitting candidate scores something');
  assert.equal(first.application.stage, 'New');
  assert.equal(first.application.candidate_name, 'Devanshi Trivedi');
  assert.equal(first.application.job_title, 'Travel Consultant');

  const again = await api('POST', '/hiring/applications', { vacancy_id: v.id, candidate_id: c.id });
  assert.equal(again.created, false);
  assert.equal(again.application.id, first.application.id);
  assert.equal((await api('GET', '/hiring/applications')).total, 1);
});

test('a stage move is logged and comes back with the message to send', async () => {
  const { api, company } = await freshStore();
  const v = await openOpening(api, company);
  const c = await addCandidate(api);
  const { application } = await api('POST', '/hiring/applications', {
    vacancy_id: v.id,
    candidate_id: c.id,
  });

  const moved = await api('POST', `/hiring/applications/${application.id}/stage`, {
    stage: 'Shortlisted',
  });
  assert.equal(moved.application.stage, 'Shortlisted');
  assert.equal(moved.application.stage_log.length, 2, 'the log keeps every step, not only the latest');
  assert.deepEqual(moved.application.stage_log.map((s) => s.stage), ['New', 'Shortlisted']);
  assert.ok(moved.notify?.text, 'a move usually means somebody needs telling');
  assert.match(moved.notify.whatsapp, /919825777888/);

  await assert.rejects(
    () => api('POST', `/hiring/applications/${application.id}/stage`, { stage: 'Nowhere' }),
    /unknown stage/
  );
});

test('a test result is judged against the OPENING’s bar, not the app’s', async () => {
  const { api, company } = await freshStore();
  // 70 to pass this seat, where the app-wide fallback is 50.
  const v = await openOpening(api, company, { test_pass_percent: 70 });
  const c = await addCandidate(api);
  const { application } = await api('POST', '/hiring/applications', {
    vacancy_id: v.id,
    candidate_id: c.id,
  });

  const { test, application: after } = await api('POST', `/hiring/applications/${application.id}/test`, {
    score: 13,
    max_score: 20,
  });
  assert.equal(test.percentage, 65);
  assert.equal(test.pass_percent, 70, 'the bar it was judged against is kept on the result');
  assert.equal(test.passed, false, '65 is a pass at 50 and a fail at 70');
  assert.equal(after.test_score, 65);
  assert.equal(after.test_status, 'below threshold');
  // And it moves nobody: a score is one more thing for a person to weigh.
  assert.equal(after.stage, 'New');
});

test('an unset pass mark falls back to the app’s, never to a bar of nought', async () => {
  const { api, company } = await freshStore();
  const v = await openOpening(api, company); // no test_pass_percent at all
  const c = await addCandidate(api);
  const { application } = await api('POST', '/hiring/applications', {
    vacancy_id: v.id,
    candidate_id: c.id,
  });
  const { test } = await api('POST', `/hiring/applications/${application.id}/test`, {
    score: 2,
    max_score: 20,
  });
  assert.equal(test.pass_percent, 50);
  assert.equal(test.passed, false, 'a bar of nought would pass everybody');
});

test('hiring somebody puts them on the payroll, once, with a salary', async () => {
  const { api, company } = await freshStore();
  const v = await openOpening(api, company);
  const c = await addCandidate(api);
  const { application } = await api('POST', '/hiring/applications', {
    vacancy_id: v.id,
    candidate_id: c.id,
  });

  // A wrong salary here is a wrong payslip at the end of the month.
  await assert.rejects(
    () => api('POST', `/hiring/applications/${application.id}/hire`, {}),
    /monthly salary/
  );

  const hired = await api('POST', `/hiring/applications/${application.id}/hire`, {
    monthly_salary: 22000,
    joined_on: '2026-11-10',
  });
  assert.equal(hired.created, true);
  assert.equal(hired.employee.name, 'Devanshi Trivedi');
  assert.equal(hired.employee.monthly_salary, 22000);
  assert.equal(hired.employee.designation, 'Travel Consultant');
  // The company comes from the opening, never from the form.
  assert.equal(hired.employee.company_id, company.id);
  assert.equal(hired.application.stage, 'Joined');
  assert.equal(hired.application.employee_id, hired.employee.id);

  // They are on the employee master now, which is the whole point.
  const { employees } = await api('GET', '/employees');
  assert.equal(employees.filter((e) => e.name === 'Devanshi Trivedi').length, 1);

  // Pressing it twice does not make a second employee.
  const twice = await api('POST', `/hiring/applications/${application.id}/hire`, {
    monthly_salary: 99000,
  });
  assert.equal(twice.created, false);
  assert.equal(twice.employee.id, hired.employee.id);
  assert.equal((await api('GET', '/employees')).employees.length, 1);
});

test('editing an opening re-scores everybody already on it', async () => {
  const { api, company } = await freshStore();
  const v = await openOpening(api, company);
  const c = await addCandidate(api);
  const { application } = await api('POST', '/hiring/applications', {
    vacancy_id: v.id,
    candidate_id: c.id,
  });
  const before = application.match_score;

  // Same person, a requirement they do not meet at all.
  await api('PATCH', `/hiring/vacancies/${v.id}`, {
    skills: 'SAP FICO, German',
    location: 'Chennai',
    experience_band: '10+ yrs',
  });
  const after = (await api('GET', `/hiring/applications/${application.id}`)).application;
  assert.ok(after.match_score < before, `expected the stale score ${before} to fall, got ${after.match_score}`);
});

test('scheduling an interview puts it on the office’s list for that day', async () => {
  const { api, company } = await freshStore();
  const v = await openOpening(api, company);
  const c = await addCandidate(api);
  const { application } = await api('POST', '/hiring/applications', {
    vacancy_id: v.id,
    candidate_id: c.id,
  });

  const { interview, notify } = await api('POST', '/hiring/interviews', {
    application_id: application.id,
    at: '2026-11-20T11:00',
    mode: 'in-person',
    location_or_link: 'Alkapuri office',
  });
  assert.equal(interview.status, 'Scheduled');
  assert.ok(notify?.text, 'the call text is written for you');

  const { tasks } = await api('GET', '/hiring/tasks?status=open');
  const reminder = tasks.find((t) => t.due_on === '2026-11-20');
  assert.ok(reminder, 'an interview nobody is reminded about is one that gets missed');
  assert.match(reminder.title, /Devanshi Trivedi/);

  // Scheduling does NOT move the application; the candidate confirming does.
  assert.equal((await api('GET', `/hiring/applications/${application.id}`)).application.stage, 'New');
});

test('suggestions offer people already on file, and never one already applied', async () => {
  const { api, company } = await freshStore();
  const v = await openOpening(api, company);
  const applied = await addCandidate(api);
  await addCandidate(api, { name: 'Krupa Shah', phone: '9825111222' });
  await api('POST', '/hiring/applications', { vacancy_id: v.id, candidate_id: applied.id });

  const { suggestions } = await api('GET', `/hiring/vacancies/${v.id}/suggestions`);
  assert.deepEqual(suggestions.map((s) => s.candidate.name), ['Krupa Shah']);
  assert.ok(Number.isFinite(suggestions[0].match_score));
});

test('the overview counts what the tab draws itself from', async () => {
  const { api, company } = await freshStore();
  const v = await openOpening(api, company); // 2 positions, published
  const c = await addCandidate(api);
  const { application } = await api('POST', '/hiring/applications', {
    vacancy_id: v.id,
    candidate_id: c.id,
  });

  let o = await api('GET', '/hiring/overview');
  assert.equal(o.vacancies.open, 1);
  assert.equal(o.vacancies.positions, 2);
  assert.equal(o.vacancies.unfilled, 2);
  assert.equal(o.candidates.total, 1);
  assert.equal(o.applications.total, 1);
  assert.equal(o.applications.byStage.New, 1);
  assert.equal(o.hires.total, 0);

  await api('POST', `/hiring/applications/${application.id}/hire`, { monthly_salary: 22000 });
  o = await api('GET', '/hiring/overview');
  assert.equal(o.hires.total, 1);
  assert.equal(o.vacancies.unfilled, 1, 'one of the two seats is filled');
});

test('the advert writes itself offline; the apply link says it cannot', async () => {
  const { api, company } = await freshStore();
  const v = await openOpening(api, company);
  const share = await api('GET', `/hiring/vacancies/${v.id}/share`);
  assert.ok(share.broadcast.length > 40, 'the text to paste into WhatsApp is worth having offline');
  assert.match(share.broadcast, /Travel Consultant/);
  assert.match(share.broadcast, /BOOKNFLY/i, 'the company is named on the advert');
  assert.equal(share.apply_url, null, 'there is no address, so none is invented');
  assert.equal(share.offline, true);

  // And what is deliberately never on an advert.
  const internal = await openOpening(api, company, {
    internal_notes: 'replacing Ashok who is leaving',
    reports_to: 'Hasmukh Upadhyay',
  });
  const second = await api('GET', `/hiring/vacancies/${internal.id}/share`);
  assert.doesNotMatch(second.broadcast, /Ashok|Hasmukh/);
  assert.equal(second.public.internal_notes, undefined);
});

test('a CV refuses honestly rather than pretending', async () => {
  const { api } = await freshStore();
  const c = await addCandidate(api);
  const detail = await api('GET', `/hiring/candidates/${c.id}`);
  assert.equal(detail.resume, null, 'null is what the server sends for no CV, so the screen knows it');
  await assert.rejects(
    () => api('POST', `/hiring/candidates/${c.id}/resume`, {}),
    /server version/
  );
});

test('deleting a candidate takes their applications with them', async () => {
  const { api, company } = await freshStore();
  const v = await openOpening(api, company);
  const c = await addCandidate(api);
  await api('POST', '/hiring/applications', { vacancy_id: v.id, candidate_id: c.id });
  assert.equal((await api('GET', '/hiring/applications')).total, 1);

  await api('DELETE', `/hiring/candidates/${c.id}`);
  assert.equal((await api('GET', '/hiring/applications')).total, 0);
  assert.equal((await api('GET', '/hiring/candidates')).total, 0);
});

test('both hiring exports come out as CSV, and the pipeline one carries the stage', async () => {
  const { api, mod, company } = await freshStore();
  const v = await openOpening(api, company);
  const c = await addCandidate(api);
  const { application } = await api('POST', '/hiring/applications', {
    vacancy_id: v.id,
    candidate_id: c.id,
  });
  await api('POST', `/hiring/applications/${application.id}/stage`, { stage: 'Shortlisted' });

  const pipeline = await (await mod.file('/hiring/export/pipeline.csv')).text();
  assert.match(pipeline, /Candidate/);
  assert.match(pipeline, /Devanshi Trivedi/);
  assert.match(pipeline, /Shortlisted/);

  const candidates = await (await mod.file('/hiring/export/candidates.csv')).text();
  assert.match(candidates, /CAN-001/);
  // The CV is never in an export - a spreadsheet of strangers' resumes is
  // exactly the file that gets forwarded by mistake.
  assert.doesNotMatch(candidates, /resume_path|\.pdf/i);
});

test('the store survives a reload - this is the only copy there is', async () => {
  globalThis.localStorage = fakeStorage();
  const first = await import(`../../frontend/src/localStore.js?t=reload-a${nonce++}`);
  const company = await first.handle('POST', '/companies', { name: 'BOOKNFLY' });
  await first.handle('POST', '/hiring/vacancies', {
    company_id: company.id,
    title: 'Ticketing Executive',
    status: 'published',
  });

  // Same localStorage, a fresh module: what the browser does on refresh.
  const second = await import(`../../frontend/src/localStore.js?t=reload-b${nonce++}`);
  const { vacancies } = await second.handle('GET', '/hiring/vacancies');
  assert.equal(vacancies.length, 1);
  assert.equal(vacancies[0].title, 'Ticketing Executive');
  assert.equal(vacancies[0].ref_no, 'JOB-001');
});
