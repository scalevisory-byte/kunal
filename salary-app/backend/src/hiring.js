import { db, createEmployee, getEmployee, audit } from './db.js';
import { config } from './config.js';
import { log } from './logger.js';
import { ALL_STAGES, REJECTED, STAGES } from '../../shared/stages.js';
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
  canMoveOffer,
  checkOffer,
  offerFileName,
  offerLetterHtml,
} from '../../shared/offer.js';
import {
  checkScreening,
  eligibility,
  stageForVerdict,
} from '../../shared/screening.js';
import {
  checkPaper,
  checkQuestion,
  drawPaper,
  forCandidate,
  isOverdue,
  markAttempt,
  paperSize,
  secondsLeft,
} from '../../shared/questionBank.js';
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
                ORDER BY a.id DESC LIMIT 1) AS latest_stage,
              /*
               * ...and the id of that application, so the stage on the list
               * can be the way INTO it. Dinesh asked three times how to get a
               * candidate to interview while looking at a column that said
               * exactly where they were and could not be clicked.
               */
              (SELECT a.id FROM applications a WHERE a.candidate_id = c.id
                ORDER BY a.id DESC LIMIT 1) AS latest_application_id
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
      /*
       * The two form statuses ride along, because the list is where somebody
       * decides whether to fill one in. Without them the button could only
       * ever say "Fill form", so a round already written up looked untouched
       * and got written up twice.
       */
      `SELECT i.*, c.name AS candidate_name, c.phone, v.title AS job_title, v.ref_no AS vacancy_ref,
              co.name AS company_name,
              f.status AS form_status, f.decision,
              e.status AS evaluation_status, e.recommendation
       FROM interviews i
       LEFT JOIN interview_forms f ON f.interview_id = i.id
       LEFT JOIN interview_evaluations e ON e.interview_id = i.id
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

/* ================= the question bank and the papers drawn from it ======== */

/*
 * Four tables, and the one that matters is test_attempts.
 *
 * An attempt stores the QUESTIONS THAT WERE DRAWN and the order their options
 * were shown in, because every candidate gets a different paper. Without that
 * there is no way to say six months later what somebody was actually asked, a
 * result cannot be explained, and a disputed answer cannot be checked.
 *
 * It also stores started_at, which is the only clock that counts. The browser
 * runs a countdown for the person watching; the server decides whether a
 * submission is in time, because a clock on the candidate's machine is a clock
 * the candidate can change.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS question_bank (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    category    TEXT NOT NULL,
    question    TEXT NOT NULL,
    option_a    TEXT, option_b TEXT, option_c TEXT, option_d TEXT,
    correct     TEXT NOT NULL,
    marks       REAL NOT NULL DEFAULT 1,
    negative_marks REAL NOT NULL DEFAULT 0,
    difficulty  TEXT,
    active      INTEGER NOT NULL DEFAULT 1,
    created_by  TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS test_papers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    company_id  INTEGER REFERENCES companies(id) ON DELETE SET NULL,
    pass_percent     INTEGER NOT NULL DEFAULT 50,
    duration_minutes INTEGER NOT NULL DEFAULT 20,
    validity_days    INTEGER,
    instructions TEXT,
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS test_paper_sections (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    paper_id  INTEGER NOT NULL REFERENCES test_papers(id) ON DELETE CASCADE,
    category  TEXT NOT NULL,
    count     INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS test_attempts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    paper_id      INTEGER NOT NULL REFERENCES test_papers(id) ON DELETE CASCADE,
    candidate_id  INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    application_id INTEGER REFERENCES applications(id) ON DELETE SET NULL,
    token         TEXT NOT NULL UNIQUE,
    drawn         TEXT NOT NULL DEFAULT '[]',
    answers       TEXT NOT NULL DEFAULT '{}',
    assigned_at   TEXT NOT NULL DEFAULT (datetime('now')),
    assigned_by   TEXT,
    started_at    TEXT,
    submitted_at  TEXT,
    auto_submitted INTEGER NOT NULL DEFAULT 0,
    score         REAL, max_score REAL, percentage REAL, passed INTEGER,
    right_count   INTEGER, wrong_count INTEGER, skipped_count INTEGER,
    pass_percent  INTEGER,
    duration_minutes INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_qbank_cat ON question_bank(category, active);
  CREATE INDEX IF NOT EXISTS idx_psection_paper ON test_paper_sections(paper_id);
  CREATE INDEX IF NOT EXISTS idx_attempt_candidate ON test_attempts(candidate_id);
`);

/*
 * Which paper this opening uses.
 *
 * Null means the opening either points at an external test with its own URL -
 * the ZYNTA one that is set up and working - or has no test at all. Both
 * remain exactly as they were; nothing already configured changes because this
 * column appeared.
 */
if (!columnsOf('vacancies').has('test_paper_id')) {
  db.exec(`ALTER TABLE vacancies ADD COLUMN test_paper_id INTEGER REFERENCES test_papers(id) ON DELETE SET NULL`);
  log.info('Migrated vacancies: added test_paper_id.');
}

/* ---------------- the bank ---------------- */

export const listCategories = () =>
  db
    .prepare(
      `SELECT category,
              COUNT(*) AS total,
              SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) AS usable
         FROM question_bank GROUP BY category ORDER BY category`
    )
    .all();

export function listQuestions({ category, q, limit = 500 } = {}) {
  const where = [];
  const params = { limit: Number(limit) || 500 };
  if (category) { where.push('category = @category'); params.category = category; }
  if (q) { where.push('question LIKE @q'); params.q = `%${q}%`; }
  return db
    .prepare(
      `SELECT * FROM question_bank
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY category, id DESC LIMIT @limit`
    )
    .all(params);
}

export function saveQuestion(body = {}, { by = 'office' } = {}) {
  const problems = checkQuestion(body);
  if (problems.length) {
    const error = new Error(problems[0]);
    error.problems = problems;
    throw error;
  }
  const values = writable('question_bank', body, { skip: ['created_by'] });
  values.correct = String(values.correct).trim().toLowerCase();
  values.updated_at = nowIso();
  if (body.id) {
    update('question_bank', Number(body.id), values);
    return db.prepare(`SELECT * FROM question_bank WHERE id = ?`).get(Number(body.id));
  }
  const id = insert('question_bank', { ...values, created_by: by });
  return db.prepare(`SELECT * FROM question_bank WHERE id = ?`).get(id);
}

/*
 * Retired, not deleted, once it has ever been asked.
 *
 * An attempt stores the ids it drew, so deleting a question would leave a
 * finished paper unable to say what question three was - and a result nobody
 * can explain is a result nobody can defend.
 */
export function removeQuestion(id) {
  const asked = db
    .prepare(`SELECT COUNT(*) AS n FROM test_attempts WHERE drawn LIKE ?`)
    .get(`%"id":${Number(id)},%`).n;
  if (asked) {
    update('question_bank', Number(id), { active: 0, updated_at: nowIso() });
    return { retired: true };
  }
  db.prepare(`DELETE FROM question_bank WHERE id = ?`).run(Number(id));
  return { deleted: true };
}

/* ---------------- the papers ---------------- */

const sectionsOf = (paperId) =>
  db
    .prepare(`SELECT * FROM test_paper_sections WHERE paper_id = ? ORDER BY sort_order, id`)
    .all(paperId);

export function listPapers() {
  return db
    .prepare(
      `SELECT p.*, co.name AS company_name,
              (SELECT COUNT(*) FROM test_attempts a WHERE a.paper_id = p.id) AS attempts
         FROM test_papers p
         LEFT JOIN companies co ON co.id = p.company_id
        ORDER BY p.name`
    )
    .all()
    .map((p) => {
      const sections = sectionsOf(p.id);
      return { ...p, sections, questions: paperSize(sections) };
    });
}

export function getPaper(id) {
  const paper = db.prepare(`SELECT * FROM test_papers WHERE id = ?`).get(id);
  if (!paper) return null;
  const sections = sectionsOf(id);
  return { ...paper, sections, questions: paperSize(sections) };
}

export function savePaper(body = {}) {
  const sections = (body.sections || []).filter((s) => String(s.category || '').trim());
  const problems = checkPaper(body, sections);
  if (problems.length) {
    const error = new Error(problems[0]);
    error.problems = problems;
    throw error;
  }
  const values = writable('test_papers', body, { skip: ['sections'] });
  values.updated_at = nowIso();
  const id = body.id ? Number(body.id) : insert('test_papers', values);
  if (body.id) update('test_papers', id, values);

  db.prepare(`DELETE FROM test_paper_sections WHERE paper_id = ?`).run(id);
  sections.forEach((s, i) =>
    insert('test_paper_sections', {
      paper_id: id,
      category: String(s.category).trim(),
      count: Number(s.count) || 0,
      sort_order: i,
    })
  );
  return getPaper(id);
}

export const deletePaper = (id) =>
  db.prepare(`DELETE FROM test_papers WHERE id = ?`).run(Number(id)).changes;

/**
 * Can this paper actually be set right now?
 *
 * Reported on the office's screen BEFORE anybody is sent a link, because a
 * section the bank cannot fill is only discovered at the moment a candidate
 * opens the test otherwise - by which point it is their problem.
 */
export function paperReadiness(paperId) {
  const paper = getPaper(paperId);
  if (!paper) return null;
  const pool = db.prepare(`SELECT * FROM question_bank WHERE active = 1`).all();
  const { short } = drawPaper(pool, paper.sections);
  return { paper, short, ready: short.length === 0 };
}

/* ---------------- sitting the test ---------------- */

const readAttempt = (row) =>
  row ? { ...row, drawn: json(row.drawn, []), answers: json(row.answers, {}) } : null;

/**
 * Give one candidate a paper of their own.
 *
 * The draw happens HERE, once, and is stored - not at the moment they open the
 * link. Two reasons: the office can see what somebody was asked before they
 * sit down, and refreshing the page cannot deal a fresh, easier hand.
 *
 * The token is the whole of the candidate's identity on the public side. It
 * reaches one attempt and nothing else, which is why nothing in this app
 * accepts a candidate id from a public caller.
 */
export function assignTest(paperId, candidateId, { application_id, by = 'office' } = {}) {
  const paper = getPaper(paperId);
  if (!paper) throw new Error('no such test paper');
  const candidate = getCandidate(candidateId);
  if (!candidate) throw new Error('no such candidate');

  const pool = db.prepare(`SELECT * FROM question_bank WHERE active = 1`).all();
  const { questions, short } = drawPaper(pool, paper.sections);
  if (!questions.length) {
    throw new Error('There are no questions in the bank for this paper yet.');
  }
  if (short.length) {
    const first = short[0];
    throw new Error(
      `The bank has only ${first.have} usable ${first.category} questions and this paper asks for ${first.want}.`
    );
  }

  const token = `TST-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  const id = insert('test_attempts', {
    paper_id: paper.id,
    candidate_id: candidateId,
    application_id: application_id || null,
    token,
    // Everything needed to reproduce the paper exactly, answers included -
    // this row never leaves the server as it stands.
    drawn: JSON.stringify(
      questions.map((q) => ({
        id: q.id, question: q.question, correct: q.correct,
        marks: q.marks, negative_marks: q.negative_marks, order: q.order,
        option_a: q.option_a, option_b: q.option_b, option_c: q.option_c, option_d: q.option_d,
      }))
    ),
    assigned_by: by,
    pass_percent: paper.pass_percent,
    duration_minutes: paper.duration_minutes,
  });

  audit({
    who: by, action: 'created', entity: 'test_attempt', entity_id: id,
    label: `${candidate.name} — ${paper.name}`,
    note: `${questions.length} questions, ${paper.duration_minutes} minutes`,
  });
  return readAttempt(db.prepare(`SELECT * FROM test_attempts WHERE id = ?`).get(id));
}

export const listAttempts = (candidateId) =>
  db
    .prepare(
      `SELECT a.*, p.name AS paper_name FROM test_attempts a
         JOIN test_papers p ON p.id = a.paper_id
        WHERE a.candidate_id = ? ORDER BY a.id DESC`
    )
    .all(candidateId)
    .map(readAttempt);

/**
 * What the candidate's browser is sent.
 *
 * `forCandidate` strips the answers; this adds the clock and the name of the
 * person sitting it. Nothing else from the attempt row travels - not the
 * marks per question, which would say which ones carry the weight, and
 * certainly not `drawn` as stored.
 *
 * Opening it for the first time starts the clock. Opening it again does NOT
 * restart it: a refresh is not a second chance, and a candidate who found that
 * out would simply refresh at nineteen minutes for ever.
 */
export function openAttempt(token) {
  const row = db.prepare(`SELECT * FROM test_attempts WHERE token = ?`).get(String(token || ''));
  if (!row) return null;
  const attempt = readAttempt(row);
  const paper = getPaper(attempt.paper_id);
  const candidate = getCandidate(attempt.candidate_id);

  if (attempt.submitted_at) {
    return {
      done: true,
      name: candidate?.name,
      paper: paper?.name,
      submitted_at: attempt.submitted_at,
      // The score is shown back only if the office wanted it to be; what is
      // never shown is which answers were wrong, because the same paper may
      // be drawn for the next candidate.
      percentage: attempt.percentage,
      passed: attempt.passed === null ? null : Boolean(attempt.passed),
    };
  }

  if (!attempt.started_at) {
    update('test_attempts', attempt.id, { started_at: nowIso() });
    attempt.started_at = nowIso();
  }

  return {
    done: false,
    name: candidate?.name,
    paper: paper?.name,
    instructions: paper?.instructions || '',
    duration_minutes: attempt.duration_minutes,
    started_at: attempt.started_at,
    seconds_left: Math.max(0, secondsLeft(attempt.started_at, attempt.duration_minutes) ?? 0),
    questions: forCandidate(attempt.drawn),
  };
}

/**
 * Mark it, and write the result where everything downstream already looks.
 *
 * A submission after the clock ran out is still MARKED, and flagged as
 * auto-submitted rather than thrown away - the answers were given, and binning
 * a paper because the last request took a second too long is the harshest
 * possible reading of a rule that exists to stop somebody taking an hour.
 *
 * It cannot be submitted twice. The first answers are the answers.
 */
export function submitAttempt(token, answers = {}, { auto = false } = {}) {
  const row = db.prepare(`SELECT * FROM test_attempts WHERE token = ?`).get(String(token || ''));
  if (!row) return null;
  const attempt = readAttempt(row);
  if (attempt.submitted_at) {
    const error = new Error('This test has already been submitted.');
    error.status = 409;
    throw error;
  }

  const late = isOverdue(attempt.started_at, attempt.duration_minutes);
  const marked = markAttempt(attempt.drawn, answers, { passPercent: attempt.pass_percent });

  update('test_attempts', attempt.id, {
    answers: JSON.stringify(answers || {}),
    submitted_at: nowIso(),
    auto_submitted: auto || late ? 1 : 0,
    score: marked.score,
    max_score: marked.max_score,
    percentage: marked.percentage,
    passed: marked.passed === null ? null : marked.passed ? 1 : 0,
    right_count: marked.right,
    wrong_count: marked.wrong,
    skipped_count: marked.skipped,
  });

  /*
   * The result is also written to the `tests` table the app already had, so
   * the candidate card, the application panel and every existing report show
   * an in-house paper exactly as they show a ZYNTA one. Two places showing
   * scores would be two places to look.
   */
  recordTest({
    candidate_id: attempt.candidate_id,
    application_id: attempt.application_id,
    type: 'In-house test',
    score: marked.score,
    max_score: marked.max_score,
    percentage: marked.percentage,
    passed: marked.passed,
    source: 'question-bank',
    pass_percent: attempt.pass_percent,
    answers: JSON.stringify(marked.detail),
  });

  return { submitted: true, percentage: marked.percentage, passed: marked.passed, late };
}

/** The office's view of one attempt — this one DOES carry the answers. */
export function attemptReview(id) {
  const attempt = readAttempt(db.prepare(`SELECT * FROM test_attempts WHERE id = ?`).get(id));
  if (!attempt) return null;
  const marked = attempt.submitted_at
    ? markAttempt(attempt.drawn, attempt.answers, { passPercent: attempt.pass_percent })
    : null;
  return {
    attempt,
    candidate: getCandidate(attempt.candidate_id),
    paper: getPaper(attempt.paper_id),
    marked,
  };
}

/* ================= initial screening ===================================== */

/*
 * One screening per application, and the history is the audit trail.
 *
 * Not a row per look, deliberately. The question a screening answers is "where
 * does this application stand NOW" - two rows saying Eligible and Rejected
 * would need a rule about which one counted, and a rule like that is how two
 * screens come to disagree. A verdict that changes is recorded by name, time,
 * old value and new on the audit trail, which is where "who said this was
 * fine" has always been answered in this app.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS screenings (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER NOT NULL UNIQUE REFERENCES applications(id) ON DELETE CASCADE,
    candidate_id   INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    verdict        TEXT NOT NULL,
    remarks        TEXT,
    rejection_reason TEXT,
    hold_reason    TEXT,
    screened_on    TEXT,
    reviewed_by    TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_screening_verdict ON screenings(verdict);
`);

/*
 * The age range an opening asks for.
 *
 * Nullable at both ends, and an opening with neither is an opening that does
 * not care - the screening report simply leaves the line out rather than
 * inventing a range nobody set.
 */
for (const column of ['age_min', 'age_max']) {
  if (!columnsOf('vacancies').has(column)) {
    db.exec(`ALTER TABLE vacancies ADD COLUMN ${column} INTEGER`);
    log.info(`Migrated vacancies: added ${column}.`);
  }
}

export const getScreening = (applicationId) =>
  db.prepare(`SELECT * FROM screenings WHERE application_id = ?`).get(applicationId);

/**
 * The screening of one application, with the report beside it.
 *
 * The report is worked out fresh on every read rather than stored. It is a
 * comparison of two records that both move - an opening's salary band gets
 * edited, a candidate's CV arrives with their real experience on it - and a
 * stored copy would quietly go stale and be believed.
 */
export function screeningFor(applicationId) {
  const application = getApplication(applicationId);
  if (!application) return null;
  const candidate = getCandidate(application.candidate_id);
  const vacancy = getVacancy(application.vacancy_id);
  return {
    application,
    screening: getScreening(applicationId) || null,
    report: eligibility(candidate || {}, vacancy || {}),
  };
}

/**
 * Record a verdict.
 *
 * The eligibility report is NOT consulted here. A screener may take somebody
 * who misses every line of it and that has to go through without an argument -
 * people are hired against the criteria every day and are usually right to be.
 *
 * Eligible moves them to Shortlisted and a rejection moves them to Rejected,
 * because both are somebody deciding. A hold moves nobody: "retain the
 * candidate in the pipeline" is the whole point of a hold.
 */
export function saveScreening(applicationId, body = {}, { by = 'office' } = {}) {
  const problems = checkScreening(body);
  if (problems.length) {
    const error = new Error(problems[0]);
    error.problems = problems;
    throw error;
  }
  const application = getApplication(applicationId);
  if (!application) throw new Error('no such application');

  const existing = getScreening(applicationId);
  const values = writable('screenings', body, {
    skip: ['application_id', 'candidate_id'],
  });
  values.screened_on = body.screened_on || existing?.screened_on || nowIso().slice(0, 10);
  values.reviewed_by = by;
  values.updated_at = nowIso();

  /*
   * A reason belonging to a verdict that is no longer held is cleared.
   *
   * Somebody rejected in March and picked up in June must not keep "not enough
   * experience" sitting on their record under a verdict of Eligible, where the
   * rejection report would still count it.
   */
  if (body.verdict !== 'Rejected') values.rejection_reason = null;
  if (body.verdict !== 'On Hold') values.hold_reason = null;

  if (existing) update('screenings', existing.id, values);
  else {
    insert('screenings', {
      ...values,
      application_id: applicationId,
      candidate_id: application.candidate_id,
    });
  }

  const changed = existing && existing.verdict !== body.verdict;
  audit({
    who: by,
    action: existing ? 'changed' : 'created',
    entity: 'screening',
    entity_id: applicationId,
    label: `${application.candidate_name} — ${application.job_title}`,
    field: 'verdict',
    from_value: existing?.verdict || null,
    to_value: body.verdict,
    note: body.rejection_reason || body.hold_reason || body.remarks || null,
  });

  const stage = stageForVerdict(body.verdict);
  if (stage && application.stage !== stage && (!existing || changed)) {
    moveApplication(applicationId, stage, {
      by,
      note: `screening: ${body.verdict}${
        body.rejection_reason ? ` — ${body.rejection_reason}` : ''
      }${body.hold_reason ? ` — ${body.hold_reason}` : ''}`,
    });
  }
  return screeningFor(applicationId);
}

/**
 * The queue: applications nobody has screened yet, oldest first.
 *
 * Oldest first on purpose. A screening list sorted by match score puts the
 * strongest candidate on top for ever and leaves a merely good one from three
 * weeks ago at the bottom until they take another job.
 *
 * `Rejected` is left out - somebody already turned down does not need
 * screening - but every other stage is in, because an application can reach
 * Shortlisted by hand without ever being screened.
 */
export function screeningQueue({ company_id, vacancy_id } = {}) {
  const where = ['s.id IS NULL', `a.stage <> 'Rejected'`, 'a.employee_id IS NULL'];
  const params = {};
  if (company_id) { where.push('v.company_id = @company_id'); params.company_id = company_id; }
  if (vacancy_id) { where.push('a.vacancy_id = @vacancy_id'); params.vacancy_id = vacancy_id; }

  return db
    .prepare(
      `SELECT a.id AS application_id, a.stage, a.match_score, a.created_at,
              c.id AS candidate_id, c.ref_no, c.name, c.phone, c.dob, c.experience,
              c.expected_salary, c.education, c.skills, c.location, c.preferred_location,
              (c.resume_path IS NOT NULL) AS has_cv,
              v.id AS vacancy_id, v.title AS job_title, v.age_min, v.age_max,
              v.experience_band, v.salary_max, v.location AS job_location,
              v.skills AS job_skills, v.education AS job_education,
              co.name AS company_name
         FROM applications a
         JOIN candidates c ON c.id = a.candidate_id
         JOIN vacancies v ON v.id = a.vacancy_id
         JOIN companies co ON co.id = v.company_id
         LEFT JOIN screenings s ON s.application_id = a.id
        WHERE ${where.join(' AND ')}
        ORDER BY a.created_at ASC, a.id ASC`
    )
    .all(params)
    .map((row) => ({
      ...row,
      report: eligibility(row, {
        age_min: row.age_min, age_max: row.age_max,
        experience_band: row.experience_band, salary_max: row.salary_max,
        location: row.job_location, skills: row.job_skills, education: row.job_education,
      }),
    }));
}

/**
 * What screening has turned up, for the reports.
 *
 * Counts by verdict, and the rejection reasons tallied - which is the figure
 * the whole "reason is required" rule exists to produce. Six people writing
 * "exp less", "not enough experience" and "under qualified" cannot be counted,
 * which is why the form offers a list to pick from.
 */
export function screeningSummary({ company_id } = {}) {
  const where = [];
  const params = {};
  if (company_id) { where.push('v.company_id = @company_id'); params.company_id = company_id; }
  const filter = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const base = `FROM screenings s
     JOIN applications a ON a.id = s.application_id
     JOIN vacancies v ON v.id = a.vacancy_id ${filter}`;

  return {
    verdicts: db.prepare(`SELECT s.verdict, COUNT(*) AS n ${base} GROUP BY s.verdict`).all(params),
    rejection_reasons: db
      .prepare(
        `SELECT s.rejection_reason AS reason, COUNT(*) AS n ${base}
          ${filter ? 'AND' : 'WHERE'} s.verdict = 'Rejected' AND s.rejection_reason IS NOT NULL
          GROUP BY s.rejection_reason ORDER BY n DESC`
      )
      .all(params),
    hold_reasons: db
      .prepare(
        `SELECT s.hold_reason AS reason, COUNT(*) AS n ${base}
          ${filter ? 'AND' : 'WHERE'} s.verdict = 'On Hold' AND s.hold_reason IS NOT NULL
          GROUP BY s.hold_reason ORDER BY n DESC`
      )
      .all(params),
    waiting: screeningQueue({ company_id }).length,
  };
}

/* ================= the offer ============================================= */

/*
 * One offer per application, with the approval ON it.
 *
 * Not a separate "selection" row and an "offer" row: they would have to be
 * kept in step, and the first time they were not, nobody could say which
 * salary had actually been approved. One record, one approved figure, one
 * letter built from it.
 *
 * `salary` is the APPROVED monthly salary and the only figure the letter ever
 * prints. The candidate's expectation and the opening's band are elsewhere and
 * stay there - a letter that recalculated anything could disagree with what
 * was approved, and the person holding the letter would be right.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS job_offers (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER NOT NULL UNIQUE REFERENCES applications(id) ON DELETE CASCADE,
    candidate_id   INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    status         TEXT NOT NULL DEFAULT 'draft',

    salary         REAL,
    designation    TEXT,
    department     TEXT,
    location       TEXT,
    reports_to     TEXT,
    probation      TEXT,
    working_hours  TEXT,
    joining_date   TEXT,
    valid_till     TEXT,
    terms          TEXT,

    prepared_by    TEXT,
    approved_by    TEXT, approved_at TEXT, approval_remarks TEXT,
    sent_by        TEXT, sent_at TEXT,
    answered_at    TEXT, decline_reason TEXT,
    withdrawn_reason TEXT,

    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_offer_status ON job_offers(status);
`);

export const getOffer = (applicationId) =>
  db.prepare(`SELECT * FROM job_offers WHERE application_id = ?`).get(applicationId);

/**
 * The offer for one application, with everything the letter needs attached.
 *
 * The candidate's name and the company's come from their own records at read
 * time rather than being copied onto the offer: a name corrected after the
 * letter was approved should correct the letter, not leave a misspelling
 * frozen on it.
 */
export function offerFor(applicationId) {
  const application = getApplication(applicationId);
  if (!application) return null;
  const offer = getOffer(applicationId);
  return {
    application,
    offer: offer
      ? {
          ...offer,
          candidate_name: application.candidate_name,
          company_name: application.company_name,
        }
      : null,
    /*
     * What to put in the boxes when there is no offer yet. The opening already
     * knows the job title, the department and where the work is; asking again
     * is how a letter ends up disagreeing with the advert it came from.
     */
    suggested: offer
      ? null
      : {
          designation: application.job_title,
          department: application.department || '',
          location: application.job_location || '',
          salary: application.offer_salary || '',
          joining_date: application.joining_date || '',
        },
  };
}

/**
 * Write or rewrite the draft.
 *
 * Only a DRAFT is editable. Once somebody has approved it, the thing they
 * approved has to stay the thing they approved - otherwise the salary on the
 * letter and the salary that was agreed can part company, and the trail cannot
 * say which was which. Changing an approved offer means withdrawing it.
 */
export function saveOffer(applicationId, body = {}, { by = 'office' } = {}) {
  const application = getApplication(applicationId);
  if (!application) throw new Error('no such application');
  const existing = getOffer(applicationId);

  if (existing && existing.status !== 'draft') {
    const error = new Error(
      `This offer has been ${existing.status} and can no longer be edited. Withdraw it to start again.`
    );
    error.status = 409;
    throw error;
  }

  const values = writable('job_offers', body, {
    skip: [
      'application_id', 'candidate_id', 'status', 'prepared_by',
      'approved_by', 'approved_at', 'sent_by', 'sent_at', 'answered_at',
    ],
  });
  values.updated_at = nowIso();

  if (existing) update('job_offers', existing.id, values);
  else {
    insert('job_offers', {
      ...values,
      application_id: applicationId,
      candidate_id: application.candidate_id,
      status: 'draft',
      prepared_by: by,
    });
  }
  return offerFor(applicationId);
}

/**
 * Approve, send, or record the answer.
 *
 * `abilities` comes off the SIGNED-IN SESSION, never the body. The gate lives
 * in shared/offer.js, so a greyed-out button and a server refusal have one
 * reason behind them.
 *
 * Approving checks the offer is complete FIRST. An approval of a letter with
 * no salary on it is an approval of nothing, and the hole would only be found
 * when the letter printed "₹" and a blank.
 */
export function moveOffer(applicationId, to, { by = 'office', abilities = [], remarks } = {}) {
  const offer = getOffer(applicationId);
  if (!offer) throw new Error('there is no offer to move');

  const verdict = canMoveOffer(offer, to, abilities);
  if (!verdict.ok) {
    const error = new Error(verdict.why);
    error.status = verdict.code === 'forbidden' ? 403 : 400;
    throw error;
  }

  if (to === 'approved') {
    const problems = checkOffer(offer);
    if (problems.length) {
      const error = new Error(problems[0]);
      error.problems = problems;
      throw error;
    }
  }

  const now = nowIso();
  const patch = { status: to, updated_at: now };
  if (to === 'approved') {
    patch.approved_by = by;
    patch.approved_at = now;
    patch.approval_remarks = remarks || null;
    /*
     * The approved figure is written back onto the application.
     *
     * hireApplication and the WhatsApp offer message have always read
     * applications.offer_salary, and the panel used to have its own box for
     * it - two numbers for one fact, which is how a letter and a first
     * payslip come to disagree. The offer is now the only place it is typed
     * and this keeps the old readers correct without them changing.
     */
    update('applications', applicationId, {
      offer_salary: Number(offer.salary) || null,
      joining_date: offer.joining_date || null,
    });
  } else if (to === 'sent') {
    patch.sent_by = by;
    patch.sent_at = now;
  } else if (to === 'accepted' || to === 'declined') {
    patch.answered_at = now;
    if (to === 'declined') patch.decline_reason = remarks || null;
  } else if (to === 'withdrawn') {
    patch.withdrawn_reason = remarks || null;
  }
  update('job_offers', offer.id, patch);

  const application = getApplication(applicationId);
  audit({
    who: by,
    action: to === 'approved' ? 'approved' : 'changed',
    entity: 'job_offer',
    entity_id: offer.id,
    label: `${application?.candidate_name} — ${application?.job_title}`,
    field: 'status',
    from_value: offer.status,
    to_value: to,
    note: remarks || (to === 'approved' ? `₹${Math.round(offer.salary)} a month` : null),
  });

  /*
   * A DECLINE moves them to Rejected, because the application is closed and
   * that is the only terminal stage this pipeline has - but the offer record
   * keeps `declined` and the reason, so no report can confuse "we turned them
   * down" with "they turned us down". Those are different facts and only the
   * offer knows which happened.
   */
  if (verdict.move.stage && application && application.stage !== verdict.move.stage) {
    moveApplication(applicationId, verdict.move.stage, {
      by,
      note: `offer ${to}${remarks ? ` — ${remarks}` : ''}`,
    });
  }
  return offerFor(applicationId);
}

/**
 * The letter, as a file.
 *
 * Refuses outright while the offer is a draft. An unapproved letter that can
 * be downloaded is an unapproved letter that gets sent, and the whole of this
 * module exists to stop that.
 */
export function offerLetter(applicationId, { note } = {}) {
  const found = offerFor(applicationId);
  if (!found?.offer) return null;
  if (found.offer.status === 'draft') {
    const error = new Error('This offer has not been approved yet, so there is no letter to send.');
    error.status = 409;
    throw error;
  }
  return {
    filename: offerFileName(found.offer),
    html: offerLetterHtml(found.offer, { note }),
  };
}

/** Every offer that is still in the air, for the dashboard and the reports. */
export const openOffers = () =>
  db
    .prepare(
      `SELECT o.*, c.name AS candidate_name, v.title AS job_title, co.name AS company_name,
              a.stage
         FROM job_offers o
         JOIN applications a ON a.id = o.application_id
         JOIN candidates c ON c.id = o.candidate_id
         JOIN vacancies v ON v.id = a.vacancy_id
         JOIN companies co ON co.id = v.company_id
        WHERE o.status IN ('draft', 'approved', 'sent')
        ORDER BY o.updated_at DESC`
    )
    .all();

/* ================= the recruitment reports =============================== */

/*
 * Eleven reports off one function.
 *
 * Every one of them ASSEMBLES. Not a figure in here is worked out a second
 * time: a screening verdict, an interview decision, an evaluation's
 * recommendation and the approved salary were all decided on a screen and
 * stored, and these queries fetch them. A report that computes its own version
 * of a number is a report that will one day disagree with the screen the
 * number came from, and then nobody can say which is right.
 */

/** The filters that apply to an interview-shaped query. */
function interviewWhere(f = {}) {
  const where = [];
  const params = {};
  if (f.from) { where.push('i.at >= @from'); params.from = f.from; }
  if (f.to) { where.push('i.at <= @to'); params.to = `${f.to}T23:59`; }
  if (f.company_id) { where.push('v.company_id = @company_id'); params.company_id = f.company_id; }
  if (f.department) { where.push('v.department LIKE @department'); params.department = `%${f.department}%`; }
  if (f.vacancy_id) { where.push('v.id = @vacancy_id'); params.vacancy_id = f.vacancy_id; }
  if (f.interviewer) { where.push('i.interviewer LIKE @interviewer'); params.interviewer = `%${f.interviewer}%`; }
  if (f.round) { where.push('i.round = @round'); params.round = f.round; }
  if (f.status) { where.push('i.status = @status'); params.status = f.status; }
  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

const INTERVIEW_SELECT = `
  SELECT i.id, i.at, i.mode, i.location_or_link, i.round, i.round_name, i.interviewer,
         i.status, i.panel,
         a.id AS application_id, a.stage,
         c.ref_no, c.name AS candidate_name, c.phone,
         v.title AS job_title, v.department, co.name AS company_name,
         f.decision, f.next_round, f.next_interview_date, f.next_interviewer,
         e.recommendation, e.status AS evaluation_status
    FROM interviews i
    JOIN applications a ON a.id = i.application_id
    JOIN candidates c ON c.id = a.candidate_id
    JOIN vacancies v ON v.id = a.vacancy_id
    JOIN companies co ON co.id = v.company_id
    LEFT JOIN interview_forms f ON f.interview_id = i.id
    LEFT JOIN interview_evaluations e ON e.interview_id = i.id`;

/** "Round 2 — Technical Round", or just the number when it has no name. */
const withRound = (rows) =>
  rows.map((r) => ({ ...r, round_label: r.round_name ? `${r.round} — ${r.round_name}` : String(r.round) }));

const applicationWhere = (f = {}, alias = 'a') => {
  const where = [];
  const params = {};
  if (f.company_id) { where.push('v.company_id = @company_id'); params.company_id = f.company_id; }
  if (f.department) { where.push('v.department LIKE @department'); params.department = `%${f.department}%`; }
  if (f.vacancy_id) { where.push('v.id = @vacancy_id'); params.vacancy_id = f.vacancy_id; }
  if (f.from) { where.push(`${alias}.created_at >= @from`); params.from = f.from; }
  if (f.to) { where.push(`${alias}.created_at <= @to`); params.to = `${f.to}T23:59`; }
  return { where, params };
};

const daysBetween = (a, b) => {
  const from = Date.parse(String(a || '').slice(0, 10));
  const to = Date.parse(String(b || '').slice(0, 10));
  // Null, never 0. "Not known" and "the same day" are different facts.
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.round((to - from) / 86400000);
};

export function hiringReport(key, filters = {}) {
  const today = nowIso().slice(0, 10);

  switch (key) {
    case 'schedule': {
      const { clause, params } = interviewWhere(filters);
      return withRound(db.prepare(`${INTERVIEW_SELECT} ${clause} ORDER BY i.at DESC`).all(params));
    }

    case 'today': {
      const { clause, params } = interviewWhere({ ...filters, from: today, to: today });
      return withRound(db.prepare(`${INTERVIEW_SELECT} ${clause} ORDER BY i.at ASC`).all(params));
    }

    case 'upcoming': {
      const { clause, params } = interviewWhere({ ...filters, from: today, status: 'Scheduled' });
      return withRound(db.prepare(`${INTERVIEW_SELECT} ${clause} ORDER BY i.at ASC`).all(params));
    }

    case 'completed': {
      const { clause, params } = interviewWhere({ ...filters, status: filters.status || 'Done' });
      return withRound(db.prepare(`${INTERVIEW_SELECT} ${clause} ORDER BY i.at DESC`).all(params));
    }

    /*
     * Selected is read off the OFFER where there is one and off the stage
     * where there is not - somebody can be moved to Selected by hand without
     * an offer record ever existing, and a report that only looked at offers
     * would quietly lose them.
     */
    case 'selected': {
      const { where, params } = applicationWhere(filters);
      where.push(`(a.stage IN ('Selected', 'Joined') OR o.status = 'accepted')`);
      return db
        .prepare(
          `SELECT c.ref_no, c.name AS candidate_name, c.phone,
                  v.title AS job_title, v.department, co.name AS company_name,
                  a.stage, a.employee_id,
                  COALESCE(o.salary, a.offer_salary) AS salary,
                  COALESCE(o.joining_date, a.joining_date) AS joining_date,
                  o.status AS offer_status,
                  CASE WHEN a.employee_id IS NOT NULL THEN 'yes' ELSE 'not yet' END AS on_payroll
             FROM applications a
             JOIN candidates c ON c.id = a.candidate_id
             JOIN vacancies v ON v.id = a.vacancy_id
             JOIN companies co ON co.id = v.company_id
             LEFT JOIN job_offers o ON o.application_id = a.id
            WHERE ${where.join(' AND ')}
            ORDER BY COALESCE(o.joining_date, a.joining_date) ASC, c.name ASC`
        )
        .all(params);
    }

    /*
     * On hold happens in two places - at screening, and after an evaluation -
     * and both have to be in one list. Somebody holding a candidate does not
     * care which screen it was recorded on; they want to know who is parked.
     */
    case 'hold': {
      const { where, params } = applicationWhere({ ...filters, from: null, to: null });
      const base = where.length ? `AND ${where.join(' AND ')}` : '';
      const rows = db
        .prepare(
          `SELECT c.ref_no, c.name AS candidate_name, c.phone,
                  v.title AS job_title, co.name AS company_name,
                  'Screening' AS held_at, s.hold_reason AS reason,
                  s.screened_on AS since, s.reviewed_by AS by
             FROM screenings s
             JOIN applications a ON a.id = s.application_id
             JOIN candidates c ON c.id = a.candidate_id
             JOIN vacancies v ON v.id = a.vacancy_id
             JOIN companies co ON co.id = v.company_id
            WHERE s.verdict = 'On Hold' ${base}
            UNION ALL
           SELECT c.ref_no, c.name, c.phone, v.title, co.name,
                  'After the interview', e.review_remarks,
                  COALESCE(e.reviewed_at, e.submitted_at), COALESCE(e.reviewed_by, e.evaluated_by)
             FROM interview_evaluations e
             JOIN applications a ON a.id = e.application_id
             JOIN candidates c ON c.id = a.candidate_id
             JOIN vacancies v ON v.id = a.vacancy_id
             JOIN companies co ON co.id = v.company_id
            WHERE e.status = 'on_hold' ${base}`
        )
        .all(params);
      return rows.sort((x, y) => String(y.since || '').localeCompare(String(x.since || '')));
    }

    /*
     * Rejected, from three places, and the third one is the point: a candidate
     * who DECLINED our offer is in here marked as such. Counting their refusal
     * as our rejection would flatter the rejection reasons and hide the fact
     * that the money was wrong.
     */
    case 'rejected': {
      const { where, params } = applicationWhere({ ...filters, from: null, to: null });
      const base = where.length ? `AND ${where.join(' AND ')}` : '';
      const head = `SELECT c.ref_no, c.name AS candidate_name, c.phone,
                v.title AS job_title, co.name AS company_name`;
      const joins = `FROM applications a
             JOIN candidates c ON c.id = a.candidate_id
             JOIN vacancies v ON v.id = a.vacancy_id
             JOIN companies co ON co.id = v.company_id`;
      const rows = db
        .prepare(
          `${head}, 'Screening' AS held_at, s.rejection_reason AS reason,
                  s.screened_on AS since, s.reviewed_by AS by
             ${joins} JOIN screenings s ON s.application_id = a.id
            WHERE s.verdict = 'Rejected' ${base}
            UNION ALL
           ${head}, 'After the interview', f.rejection_reason,
                  DATE(f.submitted_at), f.filled_by
             ${joins} JOIN interview_forms f ON f.application_id = a.id
            WHERE f.decision = 'Rejected' AND f.status = 'submitted' ${base}
            UNION ALL
           ${head}, 'They declined the offer', o.decline_reason,
                  DATE(o.answered_at), o.sent_by
             ${joins} JOIN job_offers o ON o.application_id = a.id
            WHERE o.status = 'declined' ${base}`
        )
        .all(params);
      return rows.sort((x, y) => String(y.since || '').localeCompare(String(x.since || '')));
    }

    /*
     * An interview said "next round" and nothing has been booked since.
     *
     * The NOT EXISTS is what makes it a to-do list rather than a history:
     * once the next round is in the diary this row disappears by itself, so
     * nobody has to remember to tick it off.
     */
    case 'next_round': {
      const { clause, params } = interviewWhere({ ...filters, from: null, to: null });
      const extra = clause ? `${clause} AND` : 'WHERE';
      return withRound(
        db
          .prepare(
            `${INTERVIEW_SELECT}
             ${extra} f.decision = 'Next Round' AND f.status = 'submitted'
               AND NOT EXISTS (
                 SELECT 1 FROM interviews later
                  WHERE later.application_id = i.application_id AND later.round > i.round
               )
               AND a.stage NOT IN ('Rejected', 'Joined')
             ORDER BY i.at ASC`
          )
          .all(params)
      ).map((r) => ({ ...r, waiting_days: daysBetween(r.at, nowIso()) }));
    }

    case 'interviewers': {
      const { clause, params } = interviewWhere(filters);
      const rows = db
        .prepare(
          `SELECT COALESCE(NULLIF(TRIM(i.interviewer), ''), '(nobody named)') AS interviewer,
                  COUNT(*) AS total,
                  SUM(CASE WHEN i.status = 'Done' THEN 1 ELSE 0 END) AS done,
                  SUM(CASE WHEN i.status = 'No show' THEN 1 ELSE 0 END) AS no_show,
                  SUM(CASE WHEN i.status = 'Cancelled' THEN 1 ELSE 0 END) AS cancelled,
                  SUM(CASE WHEN i.status = 'Scheduled' THEN 1 ELSE 0 END) AS scheduled,
                  SUM(CASE WHEN f.id IS NOT NULL THEN 1 ELSE 0 END) AS forms,
                  SUM(CASE WHEN e.id IS NOT NULL THEN 1 ELSE 0 END) AS evaluations,
                  SUM(CASE WHEN e.recommendation LIKE '%Recommended%'
                            AND e.recommendation <> 'Not Recommended' THEN 1 ELSE 0 END) AS recommended,
                  SUM(CASE WHEN e.recommendation = 'Not Recommended' THEN 1 ELSE 0 END) AS not_recommended
             FROM interviews i
             JOIN applications a ON a.id = i.application_id
             JOIN vacancies v ON v.id = a.vacancy_id
             LEFT JOIN interview_forms f ON f.interview_id = i.id
             LEFT JOIN interview_evaluations e ON e.interview_id = i.id
             ${clause}
            GROUP BY interviewer ORDER BY total DESC, interviewer`
        )
        .all(params);
      return rows;
    }

    /*
     * The funnel.
     *
     * "Reached it" counts anybody who got AT LEAST this far, which is read off
     * the stage log rather than the current stage - somebody sitting at Offer
     * Sent was shortlisted and interviewed on the way, and a funnel that only
     * looked at where they are now would show one person at each step and
     * explain nothing.
     */
    case 'funnel': {
      const { where, params } = applicationWhere({ ...filters, from: null, to: null });
      const rows = db
        .prepare(
          `SELECT a.stage, a.stage_log FROM applications a
             JOIN vacancies v ON v.id = a.vacancy_id
             ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`
        )
        .all(params);

      const order = STAGES.map((s) => s.key);
      const reached = Object.fromEntries(order.map((s) => [s, 0]));
      const here = Object.fromEntries(order.map((s) => [s, 0]));
      for (const row of rows) {
        const log = json(row.stage_log, []);
        const seen = new Set(['New', ...log.map((l) => l.stage)]);
        // The current stage counts even if the log was never written to.
        seen.add(row.stage);
        for (const stage of order) if (seen.has(stage)) reached[stage] += 1;
        if (here[row.stage] !== undefined) here[row.stage] += 1;
      }
      /*
       * The through-rate is measured against the last step anybody ACTUALLY
       * reached, not the one immediately before.
       *
       * Screening writes Shortlisted straight from New, so nobody passes
       * through Under Review - and measuring against the step before gave
       * "Under Review 0%" followed by "Shortlisted -", which reads as a broken
       * report rather than as a step the office does not use. One skipped
       * stage must not break the whole chain.
       */
      let previous = null;
      return order.map((stage, i) => {
        const n = reached[stage];
        const against = i === 0 ? n : previous;
        const row = {
          stage,
          reached: n,
          here: here[stage],
          // Null, not 0, when there is nothing to measure against: "nothing
          // got through" and "nobody got this far" are different facts.
          through_pct: against ? Math.round((n / against) * 1000) / 10 : null,
        };
        if (n > 0) previous = n;
        return row;
      });
    }

    case 'time_to_hire': {
      const { where, params } = applicationWhere({ ...filters, from: null, to: null });
      where.push('a.employee_id IS NOT NULL');
      if (filters.from) { where.push('emp.joined_on >= @jfrom'); params.jfrom = filters.from; }
      if (filters.to) { where.push('emp.joined_on <= @jto'); params.jto = filters.to; }
      return db
        .prepare(
          `SELECT c.ref_no, c.name AS candidate_name, v.title AS job_title, co.name AS company_name,
                  DATE(a.created_at) AS applied_on, emp.joined_on, emp.monthly_salary AS salary
             FROM applications a
             JOIN candidates c ON c.id = a.candidate_id
             JOIN vacancies v ON v.id = a.vacancy_id
             JOIN companies co ON co.id = v.company_id
             JOIN employees emp ON emp.id = a.employee_id
            WHERE ${where.join(' AND ')}
            ORDER BY emp.joined_on DESC`
        )
        .all(params)
        .map((r) => ({ ...r, days: daysBetween(r.applied_on, r.joined_on) }));
    }

    default:
      throw new Error(`there is no “${key}” report`);
  }
}
