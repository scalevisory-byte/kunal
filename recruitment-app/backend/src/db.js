import Database from 'better-sqlite3';
import { config } from './config.js';
import { log } from './logger.js';
import { ALL_STAGES, REJECTED } from '../../shared/stages.js';
import { matchScore } from '../../shared/match.js';

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/*
 * Seven tables, one per thing that really exists: a job to fill, a person, the
 * link between them, what they scored, when they were seen, what the recruiter
 * still has to do, and what was earned. Everything else is a view of these.
 *
 * Text columns hold what was typed rather than a code wherever a human wrote
 * it - "1-3 yrs", "Bhayli, Vadodara" - because that is what comes off a
 * WhatsApp message, and shared/match.js knows how to read it.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS vacancies (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    ref_no          TEXT NOT NULL UNIQUE,
    title           TEXT NOT NULL,
    client_company  TEXT,
    -- What the public sees instead of the client's name. Client names stay
    -- out of anything shareable.
    public_company  TEXT,
    industry        TEXT,
    category        TEXT,
    location        TEXT,
    work_mode       TEXT,
    employment_type TEXT,
    experience_band TEXT,
    education       TEXT,
    gender_pref     TEXT NOT NULL DEFAULT 'Any',
    positions       INTEGER NOT NULL DEFAULT 1,
    salary_min      TEXT,
    salary_max      TEXT,
    skills          TEXT,
    description     TEXT,
    responsibilities TEXT,
    requirements    TEXT,
    benefits        TEXT,
    status          TEXT NOT NULL DEFAULT 'draft',
    created_by      TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS candidates (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    ref_no             TEXT NOT NULL UNIQUE,
    name               TEXT NOT NULL,
    phone              TEXT NOT NULL,
    email              TEXT,
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
  -- is the only thing a candidate reliably gives the same way twice.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_candidate_phone ON candidates(phone);

  CREATE TABLE IF NOT EXISTS applications (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    vacancy_id    INTEGER NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE,
    candidate_id  INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    match_score   INTEGER NOT NULL DEFAULT 0,
    stage         TEXT NOT NULL DEFAULT 'New',
    test_score    INTEGER,
    test_status   TEXT,
    -- Every move appends {stage, on, by}; the timeline is read off this.
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

  CREATE TABLE IF NOT EXISTS followups (
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

  CREATE TABLE IF NOT EXISTS placements (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id  INTEGER NOT NULL UNIQUE REFERENCES applications(id) ON DELETE CASCADE,
    candidate_id    INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    vacancy_id      INTEGER NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE,
    joined_on       TEXT,
    ctc             REAL,
    fee_percent     REAL,
    fee_basis       TEXT,
    fee_amount      REAL,
    gst_amount      REAL,
    invoice_status  TEXT NOT NULL DEFAULT 'not raised',
    replacement_until TEXT,
    status          TEXT NOT NULL DEFAULT 'active',
    notes           TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

/* ---------------- migrations ---------------- */

/**
 * Columns added after a database already existed. Kept as a list rather than
 * numbered migration files: this app has one table shape per thing and the
 * additions are always "a column that used to be missing".
 */
const addColumn = (table, column, decl) => {
  const has = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!has) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
    log.info(`Migration: added ${table}.${column}`);
  }
};

addColumn('placements', 'fee_basis', 'TEXT');

/* ---------------- reference numbers ---------------- */

/**
 * REQ-001, CAN-001. The uuid-ish integer id is what everything joins on; this
 * is the number a recruiter says out loud, so it has to be stable and gapless
 * enough to read over a phone.
 */
export function nextRef(table, prefix) {
  const row = db.prepare(`SELECT ref_no FROM ${table} ORDER BY id DESC LIMIT 1`).get();
  const last = row ? Number(String(row.ref_no).replace(/\D/g, '')) : 0;
  return `${prefix}-${String((Number.isFinite(last) ? last : 0) + 1).padStart(3, '0')}`;
}

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

/** Only columns the table actually has, so a stray field cannot throw. */
const columnsOf = (table) =>
  new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));

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

/* ---------------- vacancies ---------------- */

export function listVacancies({ status, q } = {}) {
  const where = [];
  const params = {};
  if (status) {
    where.push('v.status = @status');
    params.status = status;
  }
  if (q) {
    where.push('(v.title LIKE @q OR v.ref_no LIKE @q OR v.location LIKE @q OR v.skills LIKE @q OR v.client_company LIKE @q)');
    params.q = `%${q}%`;
  }
  return db
    .prepare(
      `SELECT v.*,
              (SELECT COUNT(*) FROM applications a WHERE a.vacancy_id = v.id) AS applications,
              (SELECT COUNT(*) FROM applications a WHERE a.vacancy_id = v.id AND a.stage = 'Joined') AS joined
       FROM vacancies v
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY v.created_at DESC, v.id DESC`
    )
    .all(params);
}

export const getVacancy = (id) => db.prepare(`SELECT * FROM vacancies WHERE id = ?`).get(id);
export const getVacancyByRef = (ref) =>
  db.prepare(`SELECT * FROM vacancies WHERE ref_no = ? COLLATE NOCASE`).get(ref);

export function createVacancy(body) {
  const values = writable('vacancies', body);
  values.ref_no = nextRef('vacancies', 'REQ');
  if (!values.title) throw new Error('a vacancy needs a title');
  const id = insert('vacancies', values);
  return getVacancy(id);
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
    where = `WHERE (name LIKE @q OR phone LIKE @q OR ref_no LIKE @q OR skills LIKE @q OR location LIKE @q OR role LIKE @q)`;
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
  values.phone = normalisePhone(body.phone);
  if (!values.name) throw new Error('a candidate needs a name');
  if (!values.phone) throw new Error('a candidate needs a mobile number');
  values.ref_no = nextRef('candidates', 'CAN');
  const id = insert('candidates', values);
  return getCandidate(id);
}

export function updateCandidate(id, body) {
  const values = writable('candidates', body);
  if (values.phone !== undefined) values.phone = normalisePhone(values.phone);
  values.updated_at = nowIso();
  update('candidates', id, values);
  return getCandidate(id);
}

export const deleteCandidate = (id) =>
  db.prepare(`DELETE FROM candidates WHERE id = ?`).run(id).changes;

/**
 * The person behind an application: found by mobile, created if new, and
 * topped up with anything they have told us this time that we did not know.
 *
 * Never overwrites a filled field with a blank one - a quick apply that only
 * has a name and a number must not wipe the CV and salary from a fuller
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
  v.ref_no AS vacancy_ref, v.title AS job_title, v.client_company, v.public_company,
  v.location AS job_location, v.status AS vacancy_status
`;

export function listApplications({ vacancy_id, candidate_id, stage, q, limit = 500, offset = 0 } = {}) {
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
      `SELECT ${APPLICATION_COLUMNS}
       FROM applications a
       JOIN candidates c ON c.id = a.candidate_id
       JOIN vacancies v ON v.id = a.vacancy_id
       ${filter}
       ORDER BY a.match_score DESC, a.id DESC
       LIMIT @limit OFFSET @offset`
    )
    .all(params)
    .map((row) => ({ ...row, stage_log: json(row.stage_log, []) }));
  const total = db
    .prepare(
      `SELECT COUNT(*) AS n FROM applications a
       JOIN candidates c ON c.id = a.candidate_id
       JOIN vacancies v ON v.id = a.vacancy_id ${filter}`
    )
    .get(params).n;
  return { rows, total };
}

export function getApplication(id) {
  const row = db
    .prepare(
      `SELECT ${APPLICATION_COLUMNS}
       FROM applications a
       JOIN candidates c ON c.id = a.candidate_id
       JOIN vacancies v ON v.id = a.vacancy_id
       WHERE a.id = ?`
    )
    .get(id);
  return row ? { ...row, stage_log: json(row.stage_log, []) } : null;
}

/**
 * Apply. Scores on the way in, for ordering only.
 *
 * The same person cannot apply to the same vacancy twice - the unique index
 * says so, and this returns the existing application rather than an error,
 * because from the candidate's side pressing submit again is not a mistake
 * worth shouting about.
 */
export function createApplication({ vacancy_id, candidate_id, source, by }) {
  const vacancy = getVacancy(vacancy_id);
  const candidate = getCandidate(candidate_id);
  if (!vacancy) throw new Error('vacancy not found');
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
    test_score: null,
    test_status: null,
    stage_log: JSON.stringify([{ stage: 'New', on: at, by: by || source || 'apply' }]),
    stage_changed_at: at,
    notes: null,
  });
  return { application: getApplication(id), created: true };
}

/**
 * Move one application to a stage. A recruiter chose this; nothing calls it
 * on its own. The move is appended to the log so the timeline keeps every
 * step rather than only the latest one.
 */
export function moveApplication(id, stage, { by = 'recruiter', note } = {}) {
  if (!ALL_STAGES.includes(stage)) throw new Error(`unknown stage: ${stage}`);
  const current = getApplication(id);
  if (!current) return null;
  if (current.stage === stage) return current;

  const at = nowIso();
  const log = [...current.stage_log, { stage, on: at, by, ...(note ? { note } : {}) }];
  update('applications', id, {
    stage,
    stage_changed_at: at,
    stage_log: JSON.stringify(log),
  });
  return getApplication(id);
}

export function updateApplication(id, body) {
  const values = writable('applications', body, { skip: ['stage', 'stage_log', 'stage_changed_at'] });
  update('applications', id, values);
  return getApplication(id);
}

export const deleteApplication = (id) =>
  db.prepare(`DELETE FROM applications WHERE id = ?`).run(id).changes;

/** Re-score every application on a vacancy, after its details were edited. */
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
  const run = db.transaction(() => {
    for (const row of rows) set.run(matchScore(row, vacancy).total, row.id);
  });
  run();
  return rows.length;
}

/**
 * Candidates who are not on this vacancy yet, ordered by how well they fit.
 *
 * This is the other half of the queue: an agency's value is the people already
 * on its books, and a new requirement should start by looking at them.
 */
export function suggestForVacancy(vacancyId, { limit = 25 } = {}) {
  const vacancy = getVacancy(vacancyId);
  if (!vacancy) return [];
  const rows = db
    .prepare(
      `SELECT c.* FROM candidates c
       WHERE c.id NOT IN (SELECT candidate_id FROM applications WHERE vacancy_id = ?)`
    )
    .all(vacancyId);
  return rows
    .map((candidate) => {
      const { total, factors, missing } = matchScore(candidate, vacancy);
      return { candidate, match_score: total, factors, missing };
    })
    .sort((a, b) => b.match_score - a.match_score)
    .slice(0, limit);
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

  // The application carries the latest result so a pipeline board can sort on
  // it without a join. The test itself never moves anybody - it is one more
  // thing for the recruiter to weigh.
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

/* ---------------- interviews and follow-ups ---------------- */

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
      `SELECT i.*, c.name AS candidate_name, v.title AS job_title, v.ref_no AS vacancy_ref
       FROM interviews i
       JOIN applications a ON a.id = i.application_id
       JOIN candidates c ON c.id = a.candidate_id
       JOIN vacancies v ON v.id = a.vacancy_id
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

  // Scheduling one puts a reminder on the recruiter's own list for that day -
  // an interview nobody is reminded about is an interview that gets missed.
  const app = getApplication(values.application_id);
  if (app) {
    insert('followups', {
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

export function listFollowups({ status } = {}) {
  const params = {};
  let where = '';
  if (status) {
    where = 'WHERE f.status = @status';
    params.status = status;
  }
  return db
    .prepare(
      `SELECT f.*, c.name AS candidate_name, v.title AS job_title
       FROM followups f
       LEFT JOIN candidates c ON c.id = f.candidate_id
       LEFT JOIN vacancies v ON v.id = f.vacancy_id
       ${where}
       ORDER BY (f.due_on IS NULL), f.due_on ASC, f.id DESC`
    )
    .all(params);
}

export function createFollowup(body) {
  const values = writable('followups', body);
  if (!values.title) throw new Error('a follow-up needs a title');
  const id = insert('followups', values);
  return db.prepare(`SELECT * FROM followups WHERE id = ?`).get(id);
}

export function updateFollowup(id, body) {
  const values = writable('followups', body);
  if (values.status === 'done' && !values.done_at) values.done_at = nowIso();
  update('followups', id, values);
  return db.prepare(`SELECT * FROM followups WHERE id = ?`).get(id);
}

export const deleteFollowup = (id) =>
  db.prepare(`DELETE FROM followups WHERE id = ?`).run(id).changes;

/* ---------------- placements and the fee ---------------- */

/**
 * What the hiring company owes on a placement. The candidate pays nothing,
 * ever - that is a rule of the business, not a setting.
 */
export function feeFor({ ctc, fee_percent, basis = config.feeBasis, gst_percent = config.gstPercent }) {
  const annual = Number(ctc) || 0;
  const percent = Number(fee_percent ?? config.feePercent) || 0;
  // `ctc` is always the annual figure. A fee quoted on annual CTC charges the
  // percentage on the year; one quoted on the first month's salary charges it
  // on a twelfth - so 100% on 'monthly' is the one-month fee, and 8.33% on
  // 'annual' is the same number by the other route.
  const base = basis === 'monthly' ? annual / 12 : annual;
  const fee = Math.round((base * percent) / 100);
  const gst = Math.round((fee * (Number(gst_percent) || 0)) / 100);
  return { fee_amount: fee, gst_amount: gst, total: fee + gst };
}

export const listPlacements = () =>
  db
    .prepare(
      `SELECT p.*, c.name AS candidate_name, c.phone, v.title AS job_title,
              v.ref_no AS vacancy_ref, v.client_company
       FROM placements p
       JOIN candidates c ON c.id = p.candidate_id
       JOIN vacancies v ON v.id = p.vacancy_id
       ORDER BY p.joined_on DESC, p.id DESC`
    )
    .all();

export function createPlacement(body) {
  const app = getApplication(body.application_id);
  if (!app) throw new Error('placement needs an application');

  const joined = body.joined_on || nowIso().slice(0, 10);
  const { fee_amount, gst_amount } = feeFor({
    ctc: body.ctc,
    fee_percent: body.fee_percent,
    basis: body.fee_basis,
  });
  const until = new Date(`${joined}T00:00:00Z`);
  until.setUTCDate(until.getUTCDate() + (Number(body.replacement_days) || config.replacementDays));

  const values = writable('placements', body);
  Object.assign(values, {
    application_id: app.id,
    candidate_id: app.candidate_id,
    vacancy_id: app.vacancy_id,
    joined_on: joined,
    fee_percent: Number(body.fee_percent ?? config.feePercent),
    fee_basis: body.fee_basis || config.feeBasis,
    fee_amount: body.fee_amount ?? fee_amount,
    gst_amount: body.gst_amount ?? gst_amount,
    replacement_until: body.replacement_until || until.toISOString().slice(0, 10),
  });

  const existing = db.prepare(`SELECT id FROM placements WHERE application_id = ?`).get(app.id);
  if (existing) {
    update('placements', existing.id, values);
    return db.prepare(`SELECT * FROM placements WHERE id = ?`).get(existing.id);
  }
  const id = insert('placements', values);
  return db.prepare(`SELECT * FROM placements WHERE id = ?`).get(id);
}

export function updatePlacement(id, body) {
  update('placements', id, writable('placements', body));
  return db.prepare(`SELECT * FROM placements WHERE id = ?`).get(id);
}

/* ---------------- the overview ---------------- */

export function overview() {
  const one = (sql, params = {}) => db.prepare(sql).get(params);
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
    followups: {
      open: one(`SELECT COUNT(*) AS n FROM followups WHERE status = 'open'`).n,
      overdue: one(
        `SELECT COUNT(*) AS n FROM followups WHERE status = 'open' AND due_on IS NOT NULL AND due_on < date('now')`
      ).n,
    },
    placements: {
      total: one(`SELECT COUNT(*) AS n FROM placements`).n,
      feeEarned: one(`SELECT COALESCE(SUM(fee_amount), 0) AS n FROM placements`).n,
      feeReceived: one(
        `SELECT COALESCE(SUM(fee_amount), 0) AS n FROM placements WHERE invoice_status = 'paid'`
      ).n,
    },
  };
}

log.info(`Database ready at ${config.dbPath}`);
