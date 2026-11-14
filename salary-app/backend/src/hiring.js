import { db, createEmployee, getEmployee, audit } from './db.js';
import { config } from './config.js';
import { log } from './logger.js';
import { ALL_STAGES, REJECTED } from '../../shared/stages.js';
import { matchScore } from '../../shared/match.js';
import { checkTestUrl, testFor } from '../../shared/hiringTest.js';
import { validateVacancy } from '../../shared/vacancyForm.js';
import { fromBand } from '../../shared/experienceBand.js';
import {
  CANDIDATE_FIELDS,
  QUESTION_KEYS,
  checkForm,
  sameAsCurrent,
  stageForDecision,
} from '../../shared/interviewForm.js';
import {
  PARAMETER_KEYS,
  canMove,
  checkEvaluation,
  stageOnApproval,
  summarise,
} from '../../shared/interviewEval.js';

/*
 * Hiring, for Dinesh's OWN companies.
 *
 * This is the fifth HRMS module and it is the one that feeds the other four:
 * an opening is raised against a company that already exists in this database,
 * and the moment somebody joins they become an employee row - so they land on
 * the salary sheet, the attendance grid and the statutory registers without
 * anybody typing their name a second time.
 *
 * There is no client, no placement fee and no GST anywhere in here. The
 * company doing the hiring is ours.
 *
 * Six tables: an opening, a person, the link between them, what they scored on
 * a test, when they were seen, and what the office still has to do.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS vacancies (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    ref_no          TEXT NOT NULL UNIQUE,
    company_id      INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    department      TEXT,
    reports_to      TEXT,
    location        TEXT,
    work_mode       TEXT,
    employment_type TEXT,
    experience_band TEXT,
    education       TEXT,
    positions       INTEGER NOT NULL DEFAULT 1,
    -- The budget band. Shown to candidates on purpose: a salary nobody states
    -- wastes a fortnight of both sides' time.
    salary_min      TEXT,
    salary_max      TEXT,
    skills          TEXT,
    description     TEXT,
    responsibilities TEXT,
    requirements    TEXT,
    benefits        TEXT,
    -- Why the seat is open, who it is replacing - never leaves the office.
    internal_notes  TEXT,
    -- The test for THIS job. A travel consultant and an accounts executive
    -- are not tested the same way, so the test follows the vacancy; blank
    -- falls back to the app-wide TEST_EMBED_URL.
    test_url        TEXT,
    test_pass_percent INTEGER,
    -- How long a candidate gets for ONE question. Null is no limit, never a
    -- limit of nought. This app does not enforce it - the clock runs inside
    -- the test system; this is where the rule is decided and published.
    test_seconds_per_question INTEGER,
    status          TEXT NOT NULL DEFAULT 'draft',
    opened_on       TEXT,
    needed_by       TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS candidates (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    ref_no             TEXT NOT NULL UNIQUE,
    name               TEXT NOT NULL,
    phone              TEXT NOT NULL,
    email              TEXT,
    dob                TEXT,
    gender             TEXT,
    location           TEXT,
    preferred_location TEXT,
    education          TEXT,
    experience         TEXT,
    current_company    TEXT,
    current_salary     TEXT,
    expected_salary    TEXT,
    notice_period      TEXT,
    role               TEXT,
    skills             TEXT,
    industry           TEXT,
    resume_path        TEXT,
    resume_name        TEXT,
    source             TEXT NOT NULL DEFAULT 'apply',
    referred_by        TEXT,
    notes              TEXT,
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
  );
  -- One person, one row. Everything matches on the mobile number because that
  -- is the only thing a candidate gives the same way twice.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_candidate_phone ON candidates(phone);

  CREATE TABLE IF NOT EXISTS applications (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    vacancy_id    INTEGER NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE,
    candidate_id  INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    match_score   INTEGER NOT NULL DEFAULT 0,
    stage         TEXT NOT NULL DEFAULT 'New',
    test_score    INTEGER,
    test_status   TEXT,
    -- What was agreed, so the offer message and the employee row say the same
    -- number the recruiter actually promised.
    offer_salary  REAL,
    joining_date  TEXT,
    -- Set when this person was turned into an employee. Non-null means they
    -- are on the payroll and this application is finished.
    employee_id   INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    stage_log     TEXT NOT NULL DEFAULT '[]',
    stage_changed_at TEXT NOT NULL DEFAULT (datetime('now')),
    notes         TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (vacancy_id, candidate_id)
  );
  CREATE INDEX IF NOT EXISTS idx_app_vacancy ON applications(vacancy_id, stage);

  CREATE TABLE IF NOT EXISTS tests (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    candidate_id   INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    application_id INTEGER REFERENCES applications(id) ON DELETE SET NULL,
    type           TEXT NOT NULL DEFAULT 'skills',
    score          REAL NOT NULL DEFAULT 0,
    max_score      REAL NOT NULL DEFAULT 0,
    percentage     REAL NOT NULL DEFAULT 0,
    passed         INTEGER NOT NULL DEFAULT 0,
    source         TEXT,
    answers        TEXT,
    taken_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS interviews (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id   INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    at               TEXT NOT NULL,
    mode             TEXT NOT NULL DEFAULT 'in-person',
    location_or_link TEXT,
    round            INTEGER NOT NULL DEFAULT 1,
    panel            TEXT,
    notes            TEXT,
    status           TEXT NOT NULL DEFAULT 'Scheduled',
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS hiring_tasks (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    title          TEXT NOT NULL,
    due_on         TEXT,
    priority       TEXT NOT NULL DEFAULT 'normal',
    status         TEXT NOT NULL DEFAULT 'open',
    application_id INTEGER REFERENCES applications(id) ON DELETE CASCADE,
    candidate_id   INTEGER REFERENCES candidates(id) ON DELETE CASCADE,
    vacancy_id     INTEGER REFERENCES vacancies(id) ON DELETE CASCADE,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    done_at        TEXT
  );
`);

/* ---------------- helpers ---------------- */

const nowIso = () => new Date().toISOString();

const json = (value, fallback) => {
  try {
    const parsed = JSON.parse(value);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

const columnsOf = (table) =>
  new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));

/** Only columns the table actually has, so a stray field cannot throw. */
function writable(table, body, { skip = [] } = {}) {
  const cols = columnsOf(table);
  const out = {};
  for (const [key, value] of Object.entries(body || {})) {
    if (!cols.has(key) || key === 'id' || key === 'ref_no' || key === 'created_at') continue;
    if (skip.includes(key)) continue;
    out[key] = value === undefined ? null : value;
  }
  return out;
}

function insert(table, values) {
  const keys = Object.keys(values);
  const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map((k) => `@${k}`).join(', ')})`;
  return db.prepare(sql).run(values).lastInsertRowid;
}

function update(table, id, values) {
  const keys = Object.keys(values);
  if (!keys.length) return 0;
  const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`;
  return db.prepare(sql).run({ ...values, id }).changes;
}

/*
 * The highest JOB-/CAN- number ever handed out. Kept, rather than worked out
 * from the rows, because the rows can be deleted and the number cannot be
 * taken back: JOB-002 is printed on an advert, on a WhatsApp forward and in
 * the note somebody wrote down, so handing it to a different job is how two
 * candidates end up quoting the same reference for different seats.
 *
 * The same rule the asset codes follow, for the same reason.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS hiring_seq (
    name TEXT PRIMARY KEY,
    last INTEGER NOT NULL DEFAULT 0
  );
`);

/**
 * JOB-001, CAN-001. The integer id is what everything joins on; this is the
 * number somebody reads out over a phone, so it has to be gapless enough to
 * say - and never reused.
 *
 * Seeded from whatever is already on file, so a database written before the
 * mark existed carries on from the right number rather than from one.
 */
export function nextRef(table, prefix) {
  const stored = db.prepare(`SELECT last FROM hiring_seq WHERE name = ?`).get(table)?.last || 0;
  const highest = db
    .prepare(`SELECT ref_no FROM ${table}`)
    .all()
    .reduce((top, r) => Math.max(top, Number(String(r.ref_no).replace(/\D/g, '')) || 0), 0);
  const next = Math.max(stored, highest) + 1;
  db.prepare(
    `INSERT INTO hiring_seq (name, last) VALUES (@name, @last)
     ON CONFLICT(name) DO UPDATE SET last = @last`
  ).run({ name: table, last: next });
  return `${prefix}-${String(next).padStart(3, '0')}`;
}

/*
 * The test used to be one address for the whole app. An opening now carries
 * its own, so older databases need the two columns adding.
 */
for (const [column, type] of [
  ['test_url', 'TEXT'],
  ['test_pass_percent', 'INTEGER'],
  ['test_seconds_per_question', 'INTEGER'],
  /*
   * Two the redesigned form asks for that no column held.
   *
   * `apply_by` is the last day to apply, which is NOT `needed_by` - that is
   * the day the seat has to be filled, and the two are weeks apart.
   *
   * `test_duration_minutes` is the whole paper, where
   * `test_seconds_per_question` is one question. Both are kept: the
   * per-question clock is the one the test system is already told about and
   * the one Dinesh set to 30, and a total is a different rule, not a
   * replacement for it. Neither is enforced here - the clock runs inside the
   * test system; this is where the rule is decided and published.
   */
  ['apply_by', 'TEXT'],
  ['test_duration_minutes', 'INTEGER'],
]) {
  if (!columnsOf('vacancies').has(column)) {
    db.exec(`ALTER TABLE vacancies ADD COLUMN ${column} ${type}`);
    log.info(`Migrated vacancies: added ${column}.`);
  }
}

/*
 * The bar a result was judged against, kept on the result.
 *
 * "Passed" with no bar recorded cannot be explained six months later, and the
 * opening's pass mark can be edited afterwards. Older rows have none, which
 * reads as "not recorded" rather than as nought.
 */
if (!columnsOf('tests').has('pass_percent')) {
  db.exec(`ALTER TABLE tests ADD COLUMN pass_percent INTEGER`);
  log.info('Migrated tests: added pass_percent.');
}

/*
 * The per-question limit the test was sat under, for the same reason as the
 * pass bar: the opening's limit can be edited afterwards, and "three questions
 * over the limit" means nothing without the limit it was over.
 */
if (!columnsOf('tests').has('seconds_per_question')) {
  db.exec(`ALTER TABLE tests ADD COLUMN seconds_per_question INTEGER`);
  log.info('Migrated tests: added seconds_per_question.');
}

/* ---------------- vacancies ---------------- */

const VACANCY_COLUMNS = `
  v.*, co.name AS company_name,
  (SELECT COUNT(*) FROM applications a WHERE a.vacancy_id = v.id) AS applications,
  (SELECT COUNT(*) FROM applications a WHERE a.vacancy_id = v.id AND a.employee_id IS NOT NULL) AS hired
`;

export function listVacancies({ status, company_id, q } = {}) {
  const where = [];
  const params = {};
  if (status) {
    where.push('v.status = @status');
    params.status = status;
  }
  if (company_id) {
    where.push('v.company_id = @company_id');
    params.company_id = company_id;
  }
  if (q) {
    where.push('(v.title LIKE @q OR v.ref_no LIKE @q OR v.location LIKE @q OR v.skills LIKE @q OR v.department LIKE @q)');
    params.q = `%${q}%`;
  }
  return db
    .prepare(
      `SELECT ${VACANCY_COLUMNS} FROM vacancies v
       JOIN companies co ON co.id = v.company_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY v.created_at DESC, v.id DESC`
    )
    .all(params);
}

export const getVacancy = (id) =>
  db
    .prepare(
      `SELECT ${VACANCY_COLUMNS} FROM vacancies v
       JOIN companies co ON co.id = v.company_id WHERE v.id = ?`
    )
    .get(id);

export const getVacancyByRef = (ref) =>
  db
    .prepare(
      `SELECT ${VACANCY_COLUMNS} FROM vacancies v
       JOIN companies co ON co.id = v.company_id WHERE v.ref_no = ? COLLATE NOCASE`
    )
    .get(ref);

/**
 * A test link is checked when it is SAVED, not when a candidate opens it.
 * Finding out it was never a web address three days later, from somebody who
 * could not take the test, is the version of this that wastes everybody's
 * time.
 */
function checkedTest(values) {
  if (!('test_url' in values)) return values;
  const text = String(values.test_url || '').trim();
  if (!text) return { ...values, test_url: null };
  const { url, problem } = checkTestUrl(text);
  if (problem) throw new Error(problem);
  return { ...values, test_url: url };
}

/*
 * The same rules the form checks, checked again here.
 *
 * Not belt and braces: the form is one way in and the API is another, and a
 * vacancy posted around the form with its salary range upside down scores
 * every candidate against nonsense. `shared/vacancyForm.js` holds the list
 * once so the two cannot disagree about what is allowed.
 *
 * Only the rules about the VALUES, though - the form's own "you must fill
 * this in" is a form's job. An existing row being patched is checked against
 * what it will become, never against the patch alone.
 */
function checkVacancy(values, { assessment }) {
  // The API is handed the BAND, not the two boxes, so it is read back out of
  // the band - otherwise "5-2 yrs" posted directly would sail through.
  const { min, max } = fromBand(values.experience_band);
  const problems = validateVacancy(
    { ...values, experience_min: min, experience_max: max },
    { assessment }
  );
  // Required-ness is said in this module's own words, which the tests and the
  // older callers already expect.
  delete problems.company_id;
  delete problems.title;
  delete problems.location;
  const [first] = Object.values(problems);
  if (first) throw new Error(first);
  return values;
}

export function createVacancy(body) {
  const values = checkedTest(writable('vacancies', body));
  if (!values.title) throw new Error('an opening needs a job title');
  // Every opening belongs to one of our own companies. Without that there is
  // nothing to put the person on the payroll of later.
  const company = db.prepare(`SELECT id FROM companies WHERE id = ?`).get(Number(values.company_id));
  if (!company) throw new Error('an opening needs a company');
  checkVacancy({ positions: 1, ...values }, { assessment: !!values.test_url });
  values.ref_no = nextRef('vacancies', 'JOB');
  values.opened_on = values.opened_on || nowIso().slice(0, 10);
  return getVacancy(insert('vacancies', values));
}

export function updateVacancy(id, body) {
  const values = checkedTest(writable('vacancies', body));
  // Checked against what the row WILL be, not against the patch: sending only
  // a new maximum salary has to be judged against the minimum already stored.
  const after = { ...(getVacancy(id) || {}), ...values };
  checkVacancy(after, { assessment: !!after.test_url });
  values.updated_at = nowIso();
  update('vacancies', id, values);
  return getVacancy(id);
}

export const deleteVacancy = (id) => db.prepare(`DELETE FROM vacancies WHERE id = ?`).run(id).changes;

/* ---------------- candidates ---------------- */

/** Digits only: "+91 98250 12345" and "9825012345" are one person. */
export const normalisePhone = (phone) => {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
};

export const getCandidate = (id) => db.prepare(`SELECT * FROM candidates WHERE id = ?`).get(id);
export const getCandidateByPhone = (phone) =>
  db.prepare(`SELECT * FROM candidates WHERE phone = ?`).get(normalisePhone(phone));

/**
 * A candidate row as the office may see it.
 *
 * `resume_path` is the name the file sits under on the server's disk. It is
 * not a secret worth much, but it is not the browser's business either, and
 * `has_cv` is the only thing any screen actually asks. Everything that sends
 * a candidate anywhere goes through here, so one route cannot start leaking
 * it again.
 */
export function forOffice(row) {
  if (!row) return row;
  const { resume_path, ...rest } = row;
  return { ...rest, has_cv: Boolean(resume_path) };
}

export function listCandidates({ q, limit = 500, offset = 0 } = {}) {
  const params = { limit, offset };
  let where = '';
  if (q) {
    where = `WHERE (c.name LIKE @q OR c.phone LIKE @q OR c.ref_no LIKE @q OR c.skills LIKE @q
             OR c.location LIKE @q OR c.role LIKE @q)`;
    params.q = `%${q}%`;
  }
  /*
   * `has_cv`, never `resume_path`.
   *
   * The list used to be `SELECT c.*`, which handed the browser the server's
   * own filename for every CV on the list. A screen that only has to say
   * whether there IS one has no business being told where it lives - the same
   * rule employee documents already follow, where the API strips `file_path`
   * from every response. The file itself is still only reachable through a
   * signed link bound to that candidate.
   *
   * `latest_stage` comes along because "where are they" is the question
   * somebody scanning this list is actually asking.
   */
  const rows = db
    .prepare(
      `SELECT c.*,
              (SELECT COUNT(*) FROM applications a WHERE a.candidate_id = c.id) AS applications,
              (SELECT a.stage FROM applications a WHERE a.candidate_id = c.id
                ORDER BY a.id DESC LIMIT 1) AS latest_stage
       FROM candidates c ${where} ORDER BY c.id DESC LIMIT @limit OFFSET @offset`
    )
    .all(params)
    .map(forOffice);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM candidates c ${where}`).get(params).n;
  return { rows, total };
}

export function createCandidate(body) {
  const values = writable('candidates', body);
  if (!values.name) throw new Error('a candidate needs a name');
  values.phone = normalisePhone(values.phone);
  if (!values.phone) throw new Error('a candidate needs a mobile number');
  values.ref_no = nextRef('candidates', 'CAN');
  return getCandidate(insert('candidates', values));
}

export function updateCandidate(id, body) {
  const values = writable('candidates', body);
  if (values.phone !== undefined && values.phone !== null) values.phone = normalisePhone(values.phone);
  values.updated_at = nowIso();
  update('candidates', id, values);
  return getCandidate(id);
}

export const deleteCandidate = (id) =>
  db.prepare(`DELETE FROM candidates WHERE id = ?`).run(id).changes;

/**
 * The person behind an application: found by mobile, created if new, topped up
 * with anything they have told us this time that we did not already know.
 *
 * Never overwrites a filled field with a blank one - a quick apply with only a
 * name and a number must not wipe the CV and the salary from a fuller
 * application the same person made last month.
 */
export function upsertCandidate(body) {
  const phone = normalisePhone(body.phone);
  const existing = phone ? getCandidateByPhone(phone) : null;
  if (!existing) return { candidate: createCandidate(body), created: true };

  const fill = {};
  for (const [key, value] of Object.entries(writable('candidates', body))) {
    if (value === null || value === '' || value === undefined) continue;
    if (existing[key] === null || existing[key] === '' || existing[key] === undefined) {
      fill[key] = value;
    }
  }
  const candidate = Object.keys(fill).length ? updateCandidate(existing.id, fill) : existing;
  return { candidate, created: false };
}

/* ---------------- applications: the pipeline ---------------- */

const APPLICATION_COLUMNS = `
  a.*,
  c.ref_no AS candidate_ref, c.name AS candidate_name, c.phone, c.email,
  c.location, c.preferred_location, c.education, c.experience, c.skills,
  c.expected_salary, c.current_salary, c.current_company, c.notice_period,
  c.role, (c.resume_path IS NOT NULL) AS has_cv, c.resume_name, c.source,
  v.ref_no AS vacancy_ref, v.title AS job_title, v.department,
  v.location AS job_location, v.status AS vacancy_status,
  v.company_id, co.name AS company_name
`;

const APPLICATION_FROM = `
  FROM applications a
  JOIN candidates c ON c.id = a.candidate_id
  JOIN vacancies v ON v.id = a.vacancy_id
  JOIN companies co ON co.id = v.company_id
`;

export function listApplications({ vacancy_id, candidate_id, company_id, stage, q, limit = 1000, offset = 0 } = {}) {
  const where = [];
  const params = { limit, offset };
  if (vacancy_id) {
    where.push('a.vacancy_id = @vacancy_id');
    params.vacancy_id = vacancy_id;
  }
  if (candidate_id) {
    where.push('a.candidate_id = @candidate_id');
    params.candidate_id = candidate_id;
  }
  if (company_id) {
    where.push('v.company_id = @company_id');
    params.company_id = company_id;
  }
  if (stage) {
    where.push('a.stage = @stage');
    params.stage = stage;
  }
  if (q) {
    where.push('(c.name LIKE @q OR c.phone LIKE @q OR v.title LIKE @q OR v.ref_no LIKE @q)');
    params.q = `%${q}%`;
  }
  const filter = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT ${APPLICATION_COLUMNS} ${APPLICATION_FROM} ${filter}
       ORDER BY a.match_score DESC, a.id DESC LIMIT @limit OFFSET @offset`
    )
    .all(params)
    .map((row) => ({ ...row, stage_log: json(row.stage_log, []) }));
  const total = db.prepare(`SELECT COUNT(*) AS n ${APPLICATION_FROM} ${filter}`).get(params).n;
  return { rows, total };
}

export function getApplication(id) {
  const row = db.prepare(`SELECT ${APPLICATION_COLUMNS} ${APPLICATION_FROM} WHERE a.id = ?`).get(id);
  return row ? { ...row, stage_log: json(row.stage_log, []) } : null;
}

/**
 * Apply. Scores on the way in, for ordering only.
 *
 * The same person cannot apply to the same opening twice - the unique index
 * says so - and this returns the existing application rather than an error,
 * because from the candidate's side pressing submit again is not a mistake
 * worth shouting about.
 */
export function createApplication({ vacancy_id, candidate_id, source, by }) {
  const vacancy = getVacancy(vacancy_id);
  const candidate = getCandidate(candidate_id);
  if (!vacancy) throw new Error('opening not found');
  if (!candidate) throw new Error('candidate not found');

  const existing = db
    .prepare(`SELECT id FROM applications WHERE vacancy_id = ? AND candidate_id = ?`)
    .get(vacancy_id, candidate_id);
  if (existing) return { application: getApplication(existing.id), created: false };

  const { total } = matchScore(candidate, vacancy);
  const at = nowIso();
  const id = insert('applications', {
    vacancy_id,
    candidate_id,
    match_score: total,
    stage: 'New',
    stage_log: JSON.stringify([{ stage: 'New', on: at, by: by || source || 'apply' }]),
    stage_changed_at: at,
  });
  return { application: getApplication(id), created: true };
}

/**
 * Move one application to a stage. A person chose this; nothing calls it on
 * its own. The move is appended to the log so the timeline keeps every step
 * rather than only the latest one.
 */
export function moveApplication(id, stage, { by = 'office', note } = {}) {
  if (!ALL_STAGES.includes(stage)) throw new Error(`unknown stage: ${stage}`);
  const current = getApplication(id);
  if (!current) return null;
  if (current.stage === stage) return current;

  const at = nowIso();
  const log = [...current.stage_log, { stage, on: at, by, ...(note ? { note } : {}) }];
  update('applications', id, { stage, stage_changed_at: at, stage_log: JSON.stringify(log) });
  return getApplication(id);
}

export function updateApplication(id, body) {
  const values = writable('applications', body, {
    skip: ['stage', 'stage_log', 'stage_changed_at', 'employee_id'],
  });
  update('applications', id, values);
  return getApplication(id);
}

export const deleteApplication = (id) =>
  db.prepare(`DELETE FROM applications WHERE id = ?`).run(id).changes;

/** Re-score every application on an opening, after its details were edited. */
export function rescoreVacancy(vacancyId) {
  const vacancy = getVacancy(vacancyId);
  if (!vacancy) return 0;
  const rows = db
    .prepare(
      `SELECT a.id, c.* FROM applications a JOIN candidates c ON c.id = a.candidate_id
       WHERE a.vacancy_id = ?`
    )
    .all(vacancyId);
  const set = db.prepare(`UPDATE applications SET match_score = ? WHERE id = ?`);
  db.transaction(() => {
    for (const row of rows) set.run(matchScore(row, vacancy).total, row.id);
  })();
  return rows.length;
}

/**
 * People already on file who are not on this opening yet, best fit first.
 *
 * Everybody who ever applied for anything stays on the books, so a new opening
 * starts by looking at them rather than at an empty page.
 */
export function suggestForVacancy(vacancyId, { limit = 25 } = {}) {
  const vacancy = getVacancy(vacancyId);
  if (!vacancy) return [];
  return db
    .prepare(
      `SELECT c.* FROM candidates c
       WHERE c.id NOT IN (SELECT candidate_id FROM applications WHERE vacancy_id = ?)`
    )
    .all(vacancyId)
    .map((candidate) => {
      const { total, factors, missing } = matchScore(candidate, vacancy);
      return { candidate, match_score: total, factors, missing };
    })
    .sort((a, b) => b.match_score - a.match_score)
    .slice(0, limit);
}

/* ---------------- the handover to payroll ---------------- */

/**
 * The point of putting hiring inside the HRMS: the person who joins becomes an
 * employee row, so they appear on the salary sheet, the attendance grid and the
 * PF/ESI registers without their name being typed a second time.
 *
 * The company comes from the opening, never from the form - an opening was
 * raised against one of our companies and that is who they work for.
 *
 * It is NOT automatic. Reaching "Joined" does not do this; somebody fills in
 * the salary and the joining date and presses the button, because a wrong
 * salary here is a wrong payslip at the end of the month.
 */
export function hireApplication(id, input = {}) {
  const application = getApplication(id);
  if (!application) throw new Error('application not found');
  if (application.employee_id) {
    return { employee: getEmployee(application.employee_id), application, created: false };
  }

  const candidate = getCandidate(application.candidate_id);
  const salary = Number(input.monthly_salary ?? application.offer_salary) || 0;
  if (salary <= 0) throw new Error('a monthly salary is needed before somebody goes on the payroll');
  const joined = input.joined_on || application.joining_date || nowIso().slice(0, 10);

  const employee = createEmployee({
    company_id: application.company_id,
    name: candidate.name,
    designation: input.designation || application.job_title,
    department: input.department || application.department || null,
    dob: candidate.dob || null,
    gender: candidate.gender || null,
    phone: candidate.phone,
    email: candidate.email || null,
    address: candidate.location || null,
    monthly_salary: salary,
    joined_on: joined,
    payment_mode: input.payment_mode || 'Bank',
    cl_quota: Number(input.cl_quota) || 0,
    sl_quota: Number(input.sl_quota) || 0,
    pl_quota: Number(input.pl_quota) || 0,
    pf: Number(input.pf) || 0,
    esi: Number(input.esi) || 0,
    code: input.code || null,
    religion: input.religion || null,
  });

  update('applications', id, {
    employee_id: employee.id,
    offer_salary: salary,
    joining_date: joined,
  });
  const moved = moveApplication(id, 'Joined', { by: input.by || 'office', note: 'Added to payroll' });
  log.info(`Hired ${candidate.name} into ${application.company_name} as employee ${employee.id}`);
  return { employee, application: moved || getApplication(id), created: true };
}

/* ---------------- tests ---------------- */

/** The rules this application's opening sets for its test. */
function rulesFor(applicationId) {
  const application = applicationId ? getApplication(applicationId) : null;
  const vacancy = application ? getVacancy(application.vacancy_id) : null;
  return testFor(vacancy, {
    url: config.testEmbedUrl,
    passPercent: config.testPassPercent,
    secondsPerQuestion: config.testSecondsPerQuestion,
  });
}

export function recordTest(body) {
  const values = writable('tests', body);
  if (!values.candidate_id) throw new Error('a test result needs a candidate');
  const max = Number(values.max_score) || 0;
  const score = Number(values.score) || 0;
  values.percentage = max > 0 ? Math.round((score / max) * 1000) / 10 : Number(body.percentage) || 0;

  /*
   * The bar is the OPENING's, falling back to the app-wide one.
   *
   * The test system is told the right figure when it fetches the test, so it
   * posts the right one back. A score typed in by hand carries none, and used
   * to be judged at the app-wide 50 even on a seat whose bar is 70 - the two
   * paths disagreeing about the same candidate.
   */
  const rules = rulesFor(values.application_id);
  const stated = Number(body.pass_percent);
  values.pass_percent = Number.isFinite(stated) && stated > 0 ? stated : rules.passPercent;
  values.passed = values.percentage >= values.pass_percent ? 1 : 0;

  // What the questions were timed against. The test system may state it; the
  // opening's rule otherwise. Null stays null - no limit is not nought.
  const statedLimit = Number(body.seconds_per_question);
  values.seconds_per_question =
    Number.isFinite(statedLimit) && statedLimit > 0 ? Math.round(statedLimit) : rules.secondsPerQuestion;
  const id = insert('tests', values);

  // The application carries the latest result so the board can sort on it
  // without a join. The test itself never moves anybody - it is one more thing
  // for a person to weigh.
  if (values.application_id) {
    update('applications', values.application_id, {
      test_score: Math.round(values.percentage),
      test_status: values.passed ? 'passed' : 'below threshold',
    });
  }
  /*
   * Mapped the same way listTests maps it. Handing back SQLite's raw 0/1 here
   * while the list hands back true/false means a POST echo and the list
   * disagree about the same row - the exact trap the asset services fell into.
   */
  const saved = db.prepare(`SELECT * FROM tests WHERE id = ?`).get(id);
  return { ...saved, passed: !!saved.passed };
}

export const listTests = (candidateId) =>
  db
    // id breaks the tie: taken_at is only to the second, so two sittings saved
    // in the same second came back in whichever order SQLite felt like.
    .prepare(`SELECT * FROM tests WHERE candidate_id = ? ORDER BY taken_at DESC, id DESC`)
    .all(candidateId)
    .map((t) => ({ ...t, passed: !!t.passed }));

/* ---------------- interviews and the office's own list ---------------- */

export function listInterviews({ application_id, upcoming } = {}) {
  const where = [];
  const params = {};
  if (application_id) {
    where.push('i.application_id = @application_id');
    params.application_id = application_id;
  }
  if (upcoming) where.push(`i.at >= datetime('now', '-1 day') AND i.status = 'Scheduled'`);
  return db
    .prepare(
      `SELECT i.*, c.name AS candidate_name, c.phone, v.title AS job_title, v.ref_no AS vacancy_ref,
              co.name AS company_name
       FROM interviews i
       JOIN applications a ON a.id = i.application_id
       JOIN candidates c ON c.id = a.candidate_id
       JOIN vacancies v ON v.id = a.vacancy_id
       JOIN companies co ON co.id = v.company_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY i.at ASC`
    )
    .all(params);
}

export function createInterview(body) {
  const values = writable('interviews', body);
  if (!values.application_id) throw new Error('an interview needs an application');
  if (!values.at) throw new Error('an interview needs a date and time');
  const id = insert('interviews', values);

  // Scheduling one puts a reminder on the office's list for that day - an
  // interview nobody is reminded about is an interview that gets missed.
  const app = getApplication(values.application_id);
  if (app) {
    insert('hiring_tasks', {
      title: `Interview: ${app.candidate_name} for ${app.job_title}`,
      due_on: String(values.at).slice(0, 10),
      priority: 'high',
      status: 'open',
      application_id: app.id,
      candidate_id: app.candidate_id,
      vacancy_id: app.vacancy_id,
    });
  }
  return db.prepare(`SELECT * FROM interviews WHERE id = ?`).get(id);
}

export function updateInterview(id, body) {
  update('interviews', id, writable('interviews', body));
  return db.prepare(`SELECT * FROM interviews WHERE id = ?`).get(id);
}

export const deleteInterview = (id) =>
  db.prepare(`DELETE FROM interviews WHERE id = ?`).run(id).changes;

export function listTasks({ status } = {}) {
  const params = {};
  let where = '';
  if (status) {
    where = 'WHERE t.status = @status';
    params.status = status;
  }
  return db
    .prepare(
      `SELECT t.*, c.name AS candidate_name, v.title AS job_title
       FROM hiring_tasks t
       LEFT JOIN candidates c ON c.id = t.candidate_id
       LEFT JOIN vacancies v ON v.id = t.vacancy_id
       ${where}
       ORDER BY (t.due_on IS NULL), t.due_on ASC, t.id DESC`
    )
    .all(params);
}

export function createTask(body) {
  const values = writable('hiring_tasks', body);
  if (!values.title) throw new Error('a task needs a title');
  return db.prepare(`SELECT * FROM hiring_tasks WHERE id = ?`).get(insert('hiring_tasks', values));
}

export function updateTask(id, body) {
  const values = writable('hiring_tasks', body);
  if (values.status === 'done' && !values.done_at) values.done_at = nowIso();
  update('hiring_tasks', id, values);
  return db.prepare(`SELECT * FROM hiring_tasks WHERE id = ?`).get(id);
}

export const deleteTask = (id) =>
  db.prepare(`DELETE FROM hiring_tasks WHERE id = ?`).run(id).changes;

/* ---------------- the overview ---------------- */

export function hiringOverview() {
  const one = (sql) => db.prepare(sql).get();
  const stageCounts = db
    .prepare(`SELECT stage, COUNT(*) AS n FROM applications GROUP BY stage`)
    .all()
    .reduce((acc, r) => ({ ...acc, [r.stage]: r.n }), {});

  return {
    vacancies: {
      open: one(`SELECT COUNT(*) AS n FROM vacancies WHERE status = 'published'`).n,
      draft: one(`SELECT COUNT(*) AS n FROM vacancies WHERE status = 'draft'`).n,
      total: one(`SELECT COUNT(*) AS n FROM vacancies`).n,
      positions: one(
        `SELECT COALESCE(SUM(positions), 0) AS n FROM vacancies WHERE status = 'published'`
      ).n,
      // Seats still unfilled: what was asked for, less who has actually joined.
      unfilled: one(
        `SELECT COALESCE(SUM(v.positions), 0) -
                COALESCE((SELECT COUNT(*) FROM applications a
                          JOIN vacancies vv ON vv.id = a.vacancy_id
                          WHERE a.employee_id IS NOT NULL AND vv.status = 'published'), 0) AS n
         FROM vacancies v WHERE v.status = 'published'`
      ).n,
    },
    candidates: {
      total: one(`SELECT COUNT(*) AS n FROM candidates`).n,
      withResume: one(`SELECT COUNT(*) AS n FROM candidates WHERE resume_path IS NOT NULL`).n,
      addedThisWeek: one(
        `SELECT COUNT(*) AS n FROM candidates WHERE created_at >= datetime('now', '-7 day')`
      ).n,
    },
    applications: {
      total: one(`SELECT COUNT(*) AS n FROM applications`).n,
      thisWeek: one(
        `SELECT COUNT(*) AS n FROM applications WHERE created_at >= datetime('now', '-7 day')`
      ).n,
      byStage: stageCounts,
      rejected: stageCounts[REJECTED] || 0,
    },
    interviews: {
      upcoming: one(
        `SELECT COUNT(*) AS n FROM interviews WHERE status = 'Scheduled' AND at >= datetime('now', '-1 day')`
      ).n,
    },
    tasks: {
      open: one(`SELECT COUNT(*) AS n FROM hiring_tasks WHERE status = 'open'`).n,
      overdue: one(
        `SELECT COUNT(*) AS n FROM hiring_tasks WHERE status = 'open' AND due_on IS NOT NULL AND due_on < date('now')`
      ).n,
    },
    hires: {
      total: one(`SELECT COUNT(*) AS n FROM applications WHERE employee_id IS NOT NULL`).n,
      thisMonth: one(
        `SELECT COUNT(*) AS n FROM applications a JOIN employees e ON e.id = a.employee_id
         WHERE a.employee_id IS NOT NULL AND e.joined_on >= date('now', 'start of month')`
      ).n,
      // Somebody at Selected who is not on the payroll yet is money the month
      // is about to miss, so it is counted on its own.
      awaitingPayroll: one(
        `SELECT COUNT(*) AS n FROM applications
         WHERE stage IN ('Selected', 'Joined') AND employee_id IS NULL`
      ).n,
    },
  };
}

/* ================= the physical interview form and its evaluation ========= */

/*
 * Two records per interview, never one.
 *
 * Dinesh asked for the information form and the interviewer's evaluation as
 * two separate forms, linked by candidate and interview. They are kept apart
 * because they answer different questions and are filled in by different
 * people at different moments: the first records what the candidate said, the
 * second what the interviewer made of it, and HR or management then review the
 * second without touching the first.
 *
 * Both hang off interviews.id, which already carries the round, the date, the
 * mode and the panel - so a second round is a second interview row and gets a
 * form and an evaluation of its own. Nothing is ever overwritten across rounds
 * because nothing is shared across them. UNIQUE on interview_id is what holds
 * that: one form and one evaluation per round, no more.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS interview_forms (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    interview_id   INTEGER NOT NULL UNIQUE REFERENCES interviews(id) ON DELETE CASCADE,
    application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    candidate_id   INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    status         TEXT NOT NULL DEFAULT 'draft',

    degree TEXT, specialisation TEXT, college TEXT, passing_year TEXT,
    additional_qualification TEXT, certifications TEXT,

    fresher TEXT, exp_years INTEGER, exp_months INTEGER,
    previous_responsibilities TEXT, relevant_experience TEXT,
    employment_status TEXT, reason_for_leaving TEXT,

    languages TEXT NOT NULL DEFAULT '[]',
    english_level TEXT, hindi_level TEXT, gujarati_level TEXT, communication_remarks TEXT,

    computer_level TEXT, word_level TEXT, excel_level TEXT, email_level TEXT,
    tally TEXT, erp TEXT, software_name TEXT, other_technical TEXT, additional_software TEXT,

    technical_skills TEXT, job_skills TEXT, other_skills TEXT,

    answers TEXT NOT NULL DEFAULT '{}',

    negotiable TEXT, recommended_salary REAL, last_working_date TEXT,
    available_from TEXT, join_immediately TEXT, joining_conditions TEXT,

    observations TEXT, additional_comments TEXT,

    decision TEXT, decision_remarks TEXT, next_round TEXT,
    next_interview_date TEXT, next_interviewer TEXT, rejection_reason TEXT,

    filled_by      TEXT,
    submitted_at   TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS interview_evaluations (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    interview_id   INTEGER NOT NULL UNIQUE REFERENCES interviews(id) ON DELETE CASCADE,
    application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    candidate_id   INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    status         TEXT NOT NULL DEFAULT 'draft',

    ratings        TEXT NOT NULL DEFAULT '{}',
    rating_remarks TEXT NOT NULL DEFAULT '{}',

    practical_level TEXT, understands_role TEXT, software_knowledge TEXT,
    can_handle_work TEXT, practical_test_required TEXT, practical_test_remarks TEXT,

    strengths TEXT, weaknesses TEXT, positive_observations TEXT,
    negative_observations TEXT, skill_gap TEXT,
    training_required TEXT, training_remarks TEXT,

    recommended_salary REAL, negotiable TEXT, suitable_for_role TEXT,
    suitable_for_other TEXT, alternative_position TEXT,

    recommendation TEXT, overall_remarks TEXT, recommendation_reason TEXT,
    additional_comments TEXT,

    next_action TEXT, next_round TEXT, next_interviewer TEXT, next_interview_date TEXT,

    evaluated_by   TEXT,
    submitted_at   TEXT,
    reviewed_by    TEXT, reviewed_at TEXT, review_remarks TEXT,
    approved_by    TEXT, approved_at TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS candidate_references (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    ref_type     TEXT,
    person_name  TEXT,
    organisation TEXT,
    designation  TEXT,
    phone        TEXT,
    relationship TEXT,
    remarks      TEXT,
    verification TEXT,
    verified_by  TEXT,
    verified_on  TEXT,
    verification_remarks TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_iform_candidate ON interview_forms(candidate_id);
  CREATE INDEX IF NOT EXISTS idx_ieval_candidate ON interview_evaluations(candidate_id);
  CREATE INDEX IF NOT EXISTS idx_ieval_status ON interview_evaluations(status);
  CREATE INDEX IF NOT EXISTS idx_cref_candidate ON candidate_references(candidate_id);
`);

/*
 * A round has a name as well as a number.
 *
 * "Round 2" does not say who is in the room, and the office schedules a
 * technical round and a final management round quite differently. The number
 * stays, because it orders the history and a name does not - "HR Round" twice
 * is a real thing that happens.
 *
 * And the interviewer is their own column rather than part of the panel: the
 * panel is who was there, the interviewer is who is answerable for the
 * evaluation, and the interviewer-wise report needs one name to group by.
 */
for (const [column, type] of [
  ['round_name', 'TEXT'],
  ['interviewer', 'TEXT'],
]) {
  if (!columnsOf('interviews').has(column)) {
    db.exec(`ALTER TABLE interviews ADD COLUMN ${column} ${type}`);
    log.info(`Migrated interviews: added ${column}.`);
  }
}

/*
 * Where somebody lives, on the CANDIDATE and not on the interview form.
 *
 * An address is a fact about a person, so three rounds must not produce three
 * addresses with nothing to say which is current. The form fetches it in,
 * corrects it in front of them, and writes it back here.
 *
 * Permanent is stored in full rather than as a "same as current" flag: a flag
 * would leave the columns blank and make every report, export and letter
 * reconstruct the rule, and the first one that forgot would print nothing.
 */
for (const which of ['current', 'permanent']) {
  for (const part of ['line1', 'line2', 'landmark', 'city', 'state', 'pin']) {
    const column = `${which}_${part}`;
    if (!columnsOf('candidates').has(column)) {
      db.exec(`ALTER TABLE candidates ADD COLUMN ${column} TEXT`);
    }
  }
}
log.info('Interview forms, evaluations and candidate addresses are ready.');

/**
 * Everything the two forms fetch rather than ask for.
 *
 * Dinesh: "Automatically fetch candidate details and interview information. Do
 * not ask for information already available in the candidate profile or
 * interview form." So this is the one place that assembles it, and both forms
 * read it - the header on screen, the print view and the server's own
 * validation cannot disagree about which candidate this is.
 */
export function interviewContext(interviewId) {
  const interview = db.prepare(`SELECT * FROM interviews WHERE id = ?`).get(interviewId);
  if (!interview) return null;
  const application = getApplication(interview.application_id);
  if (!application) return null;
  const candidate = getCandidate(application.candidate_id);
  return {
    interview,
    application,
    candidate: candidate ? forOffice(candidate) : null,
    // Named rather than left as ids, because this is what gets printed.
    position: application.job_title,
    department: application.department,
    company: application.company_name,
  };
}

/**
 * Write the person's own facts back to the person.
 *
 * The form fetches a date of birth and a notice period from the candidate and
 * lets the interviewer correct them in front of them. Those corrections belong
 * on the candidate record, not on one round's form - three rounds must not
 * produce three dates of birth with nothing to say which is right.
 *
 * A blank is never written over something already known. An interviewer who
 * skipped the email box did not say the candidate has no email, and the
 * uploaded-CV rule next door works the same way.
 */
function writeBackToCandidate(candidateId, body = {}) {
  const current = getCandidate(candidateId);
  if (!current) return;
  const patch = {};
  for (const { field, column } of CANDIDATE_FIELDS) {
    const value = body[field];
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (!text) continue;
    if (String(current[column] ?? '') === text) continue;
    patch[column] = value;
  }
  // The address comes as its own block and follows the same rule.
  for (const key of Object.keys(body.address || {})) {
    const value = body.address[key];
    if (value === undefined || value === null) continue;
    if (!columnsOf('candidates').has(key)) continue;
    patch[key] = value;
  }
  if (Object.keys(patch).length) updateCandidate(candidateId, patch);
}

const readForm = (row) =>
  row
    ? {
        ...row,
        languages: json(row.languages, []),
        answers: json(row.answers, {}),
      }
    : null;

export function getInterviewForm(interviewId) {
  const context = interviewContext(interviewId);
  if (!context) return null;
  const form = readForm(
    db.prepare(`SELECT * FROM interview_forms WHERE interview_id = ?`).get(interviewId)
  );
  return { ...context, form, references: listReferences(context.application.candidate_id) };
}

/**
 * Save the information form, as a draft or submitted.
 *
 * A DRAFT checks nothing and moves nobody - it is somebody half way through
 * typing with a candidate in front of them, and a form that refuses to save is
 * a form that gets written up from memory that evening.
 *
 * SUBMITTING is where the decision counts. Even then only a rejection moves
 * the application: see DECISIONS in shared/interviewForm.js for why "Selected"
 * deliberately moves nobody.
 */
export function saveInterviewForm(interviewId, body = {}, { by = 'office', submit = false } = {}) {
  const context = interviewContext(interviewId);
  if (!context) throw new Error('no such interview');

  const problems = checkForm(body, { submitting: submit });
  if (problems.length) {
    const error = new Error(problems[0]);
    error.problems = problems;
    throw error;
  }

  const existing = db
    .prepare(`SELECT * FROM interview_forms WHERE interview_id = ?`)
    .get(interviewId);

  const values = writable('interview_forms', body, {
    skip: ['interview_id', 'application_id', 'candidate_id', 'status', 'submitted_at', 'filled_by'],
  });
  // The repeating parts travel as JSON: a list of languages and ten answers
  // filed under keys that never change.
  values.languages = JSON.stringify(Array.isArray(body.languages) ? body.languages : []);
  values.answers = JSON.stringify(
    Object.fromEntries(
      QUESTION_KEYS.map((key) => [key, body.answers?.[key] ?? '']).filter(([, v]) => String(v).trim())
    )
  );
  values.updated_at = nowIso();

  let id;
  if (existing) {
    update('interview_forms', existing.id, values);
    id = existing.id;
  } else {
    id = insert('interview_forms', {
      ...values,
      interview_id: interviewId,
      application_id: context.application.id,
      candidate_id: context.application.candidate_id,
      status: 'draft',
      filled_by: by,
    });
  }

  writeBackToCandidate(context.application.candidate_id, body);

  if (submit) {
    const already = existing?.status === 'submitted';
    update('interview_forms', id, {
      status: 'submitted',
      submitted_at: existing?.submitted_at || nowIso(),
      filled_by: existing?.filled_by || by,
    });
    audit({
      who: by,
      action: already ? 'changed' : 'submitted',
      entity: 'interview_form',
      entity_id: id,
      label: `${context.candidate?.name} — ${context.position}, round ${context.interview.round}`,
      field: 'decision',
      from_value: existing?.decision || null,
      to_value: body.decision || null,
      note: body.decision_remarks || null,
    });

    const stage = stageForDecision(body.decision);
    if (stage && context.application.stage !== stage) {
      moveApplication(context.application.id, stage, {
        by,
        note: `interview round ${context.interview.round}: ${body.decision}${
          body.rejection_reason ? ` — ${body.rejection_reason}` : ''
        }`,
      });
    }
  }

  return getInterviewForm(interviewId);
}

/* ---------------- the interviewer's evaluation ---------------- */

const readEval = (row) =>
  row
    ? {
        ...row,
        ratings: json(row.ratings, {}),
        rating_remarks: json(row.rating_remarks, {}),
        summary: summarise(json(row.ratings, {})),
      }
    : null;

export function getEvaluation(interviewId) {
  const context = interviewContext(interviewId);
  if (!context) return null;
  const evaluation = readEval(
    db.prepare(`SELECT * FROM interview_evaluations WHERE interview_id = ?`).get(interviewId)
  );
  return { ...context, evaluation };
}

/**
 * Save the evaluation, as a draft or submitted by the interviewer.
 *
 * Submitting moves the PAPERWORK on - to HR or to management, whichever the
 * next action says - and moves the CANDIDATE nowhere. That is the rule this
 * whole module exists to hold, in Dinesh's own words: "interviewer
 * recommendation must not automatically mean final selection".
 *
 * Ratings outside 1 to 5 are refused rather than clamped: a 7 is a mistake,
 * and silently storing it as 5 invents an opinion nobody held. A rating left
 * blank is kept blank, and summarise() counts what was rated rather than all
 * ten.
 */
export function saveEvaluation(interviewId, body = {}, { by = 'office', submit = false } = {}) {
  const context = interviewContext(interviewId);
  if (!context) throw new Error('no such interview');

  const problems = checkEvaluation(body, { submitting: submit });
  if (problems.length) {
    const error = new Error(problems[0]);
    error.problems = problems;
    throw error;
  }

  const existing = db
    .prepare(`SELECT * FROM interview_evaluations WHERE interview_id = ?`)
    .get(interviewId);

  /*
   * A decided evaluation is not editable here.
   *
   * "After submission, lock the submitted version from unauthorised changes."
   * Once somebody has approved or rejected it, the thing they approved has to
   * stay the thing they approved - otherwise the trail cannot say what the
   * decision was made on.
   */
  if (existing && ['approved', 'rejected'].includes(existing.status)) {
    throw new Error('This evaluation has already been decided and can no longer be changed.');
  }

  const values = writable('interview_evaluations', body, {
    skip: [
      'interview_id', 'application_id', 'candidate_id', 'status', 'submitted_at',
      'evaluated_by', 'reviewed_by', 'reviewed_at', 'review_remarks',
      'approved_by', 'approved_at',
    ],
  });
  values.ratings = JSON.stringify(
    Object.fromEntries(
      PARAMETER_KEYS.map((key) => [key, body.ratings?.[key]])
        .filter(([, v]) => Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 5)
        .map(([k, v]) => [k, Number(v)])
    )
  );
  values.rating_remarks = JSON.stringify(
    Object.fromEntries(
      PARAMETER_KEYS.map((key) => [key, body.rating_remarks?.[key] ?? ''])
        .filter(([, v]) => String(v).trim())
    )
  );
  values.updated_at = nowIso();

  let id;
  if (existing) {
    update('interview_evaluations', existing.id, values);
    id = existing.id;
  } else {
    id = insert('interview_evaluations', {
      ...values,
      interview_id: interviewId,
      application_id: context.application.id,
      candidate_id: context.application.candidate_id,
      status: 'draft',
      evaluated_by: by,
    });
  }

  if (submit) {
    update('interview_evaluations', id, {
      status: 'submitted',
      submitted_at: existing?.submitted_at || nowIso(),
      evaluated_by: existing?.evaluated_by || by,
    });
    audit({
      who: by,
      action: 'submitted',
      entity: 'interview_evaluation',
      entity_id: id,
      label: `${context.candidate?.name} — ${context.position}, round ${context.interview.round}`,
      field: 'recommendation',
      to_value: body.recommendation || null,
      note: body.next_action ? `next: ${body.next_action}` : null,
    });
  }

  return getEvaluation(interviewId);
}

/**
 * Move an evaluation through the review workflow.
 *
 * `abilities` comes off the SIGNED-IN USER, never off the request body, so a
 * caller cannot award themselves the admin ability by typing it. The gate
 * itself lives in shared/interviewEval.js, so the browser can grey out a
 * button for exactly the reason the server would refuse it.
 *
 * An APPROVAL is the only thing in this file that may move a candidate, and
 * even then only where the next action names a stage - which today is a
 * rejection and nothing else, because sending an offer is a separate act.
 */
export function reviewEvaluation(id, { to, by = 'office', remarks, abilities = [] } = {}) {
  const row = db.prepare(`SELECT * FROM interview_evaluations WHERE id = ?`).get(id);
  if (!row) return null;

  const verdict = canMove(row, to, abilities);
  if (!verdict.ok) {
    const error = new Error(verdict.why);
    // Only a permission refusal is a 403. A step that does not exist is a bad
    // request however many abilities the caller has.
    error.status = verdict.code === 'forbidden' ? 403 : 400;
    throw error;
  }

  const now = nowIso();
  const patch = { status: to, updated_at: now };
  if (['approved', 'rejected'].includes(to)) {
    patch.approved_by = by;
    patch.approved_at = now;
  } else {
    patch.reviewed_by = by;
    patch.reviewed_at = now;
  }
  if (remarks !== undefined) patch.review_remarks = remarks || null;
  update('interview_evaluations', id, patch);

  const context = interviewContext(row.interview_id);
  audit({
    who: by,
    action: to === 'approved' ? 'approved' : to === 'rejected' ? 'rejected' : 'changed',
    entity: 'interview_evaluation',
    entity_id: id,
    label: `${context?.candidate?.name} — ${context?.position}, round ${context?.interview?.round}`,
    field: 'status',
    from_value: row.status,
    to_value: to,
    note: remarks || null,
  });

  const stage = stageOnApproval({ status: to, next_action: row.next_action });
  if (stage && context && context.application.stage !== stage) {
    moveApplication(context.application.id, stage, {
      by,
      note: `evaluation ${to}: ${row.next_action}${
        row.recommendation_reason ? ` — ${row.recommendation_reason}` : ''
      }`,
    });
  }

  return getEvaluation(row.interview_id);
}

/* ---------------- references ---------------- */

export const listReferences = (candidateId) =>
  db
    .prepare(`SELECT * FROM candidate_references WHERE candidate_id = ? ORDER BY id`)
    .all(candidateId);

/**
 * References live on the CANDIDATE, not on one round's form.
 *
 * Dinesh: "Reference verification should be optional during the interview and
 * can be completed later by HR." Finishing a verification a week later must
 * not mean editing a submitted interview record - those are meant to stay
 * exactly as they were submitted. So the reference is the person's and the
 * verification is a field on it.
 */
export function saveReference(candidateId, body = {}) {
  const values = writable('candidate_references', body, { skip: ['candidate_id'] });
  values.updated_at = nowIso();
  if (body.id) {
    update('candidate_references', Number(body.id), values);
    return db.prepare(`SELECT * FROM candidate_references WHERE id = ?`).get(Number(body.id));
  }
  const id = insert('candidate_references', { ...values, candidate_id: candidateId });
  return db.prepare(`SELECT * FROM candidate_references WHERE id = ?`).get(id);
}

export const deleteReference = (id) =>
  db.prepare(`DELETE FROM candidate_references WHERE id = ?`).run(id).changes;

/* ---------------- the history on the candidate ---------------- */

/**
 * Every round this person has sat, newest first, with both records.
 *
 * One row per interview, carrying whether a form and an evaluation exist and
 * where each got to - so the candidate's record can show the whole trail
 * without fetching every form in full. "Each interview round must have its own
 * separate information and evaluation records", and this is what proves it:
 * the rows cannot merge, because each hangs off its own interview.
 */
export function interviewHistory(candidateId) {
  return db
    .prepare(
      `SELECT i.id AS interview_id, i.at, i.round, i.round_name, i.mode, i.panel,
              i.interviewer, i.status AS interview_status,
              v.title AS job_title, co.name AS company_name,
              f.id AS form_id, f.status AS form_status, f.decision, f.decision_remarks,
              f.next_round, f.next_interview_date, f.rejection_reason, f.submitted_at AS form_submitted,
              e.id AS evaluation_id, e.status AS evaluation_status, e.recommendation,
              e.next_action, e.ratings, e.reviewed_by, e.approved_by, e.approved_at
         FROM interviews i
         JOIN applications a ON a.id = i.application_id
         JOIN vacancies v ON v.id = a.vacancy_id
         JOIN companies co ON co.id = v.company_id
         LEFT JOIN interview_forms f ON f.interview_id = i.id
         LEFT JOIN interview_evaluations e ON e.interview_id = i.id
        WHERE a.candidate_id = ?
        ORDER BY i.at DESC, i.id DESC`
    )
    .all(candidateId)
    .map((row) => ({
      ...row,
      ratings: undefined,
      summary: summarise(json(row.ratings, {})),
    }));
}
