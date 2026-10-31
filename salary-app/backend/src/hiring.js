import { db, createEmployee, getEmployee } from './db.js';
import { config } from './config.js';
import { log } from './logger.js';
import { ALL_STAGES, REJECTED } from '../../shared/stages.js';
import { matchScore } from '../../shared/match.js';

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

/**
 * JOB-001, CAN-001. The integer id is what everything joins on; this is the
 * number somebody reads out over a phone, so it has to be gapless enough to say.
 */
export function nextRef(table, prefix) {
  const row = db.prepare(`SELECT ref_no FROM ${table} ORDER BY id DESC LIMIT 1`).get();
  const last = row ? Number(String(row.ref_no).replace(/\D/g, '')) : 0;
  return `${prefix}-${String((Number.isFinite(last) ? last : 0) + 1).padStart(3, '0')}`;
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

export function createVacancy(body) {
  const values = writable('vacancies', body);
  if (!values.title) throw new Error('an opening needs a job title');
  // Every opening belongs to one of our own companies. Without that there is
  // nothing to put the person on the payroll of later.
  const company = db.prepare(`SELECT id FROM companies WHERE id = ?`).get(Number(values.company_id));
  if (!company) throw new Error('an opening needs a company');
  values.ref_no = nextRef('vacancies', 'JOB');
  values.opened_on = values.opened_on || nowIso().slice(0, 10);
  return getVacancy(insert('vacancies', values));
}

export function updateVacancy(id, body) {
  const values = writable('vacancies', body);
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

export function listCandidates({ q, limit = 500, offset = 0 } = {}) {
  const params = { limit, offset };
  let where = '';
  if (q) {
    where = `WHERE (c.name LIKE @q OR c.phone LIKE @q OR c.ref_no LIKE @q OR c.skills LIKE @q
             OR c.location LIKE @q OR c.role LIKE @q)`;
    params.q = `%${q}%`;
  }
  const rows = db
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM applications a WHERE a.candidate_id = c.id) AS applications
       FROM candidates c ${where} ORDER BY c.id DESC LIMIT @limit OFFSET @offset`
    )
    .all(params);
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
  c.role, c.resume_path, c.resume_name, c.source,
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

export function recordTest(body) {
  const values = writable('tests', body);
  if (!values.candidate_id) throw new Error('a test result needs a candidate');
  const max = Number(values.max_score) || 0;
  const score = Number(values.score) || 0;
  values.percentage = max > 0 ? Math.round((score / max) * 1000) / 10 : Number(body.percentage) || 0;
  values.passed = values.percentage >= (Number(body.pass_percent) || config.testPassPercent) ? 1 : 0;
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
  return db.prepare(`SELECT * FROM tests WHERE id = ?`).get(id);
}

export const listTests = (candidateId) =>
  db
    .prepare(`SELECT * FROM tests WHERE candidate_id = ? ORDER BY taken_at DESC`)
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
