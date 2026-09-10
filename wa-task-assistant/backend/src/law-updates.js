/**
 * The law updates themselves, one row each.
 *
 * The digest came first and was a single block of text: five lines, written
 * once a morning, kept only so the page could show what had been sent. That is
 * the right shape for WhatsApp and the wrong shape for a team - you cannot
 * search a paragraph, mark one line of it reviewed, or come back in October to
 * find the notification you half-remember from September.
 *
 * So each update is now a record. The digest is still a digest: it is composed
 * from these rows rather than being the only place they exist.
 *
 * Two rules run through everything here, because this is legal information:
 *
 *   1. Nothing is invented. Every field is either read from the article or
 *      left empty, and a deadline that could not be confirmed is marked
 *      unconfirmed rather than dropped or asserted.
 *   2. Where it came from is part of the record. An official source and a news
 *      site are both useful and are not the same thing, so the source is
 *      classified from its own domain - not from what the model says about it.
 */
import { db, ensureColumns } from './db.js';
import { config } from './config.js';

/*
 * Today, on the user's calendar rather than the server's.
 *
 * SQLite's `date('now','localtime')` reads the machine's timezone, and the
 * machine is on UTC while the work is in India - so between midnight and 05:30
 * IST every "today" query silently asked about yesterday. Rows are stored under
 * the Indian date, so the questions have to be asked in it too.
 */
const localDay = (offsetDays = 0) => {
  const at = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(at);
};

/** The Monday-to-here window and the month, in the same calendar. */
const monthStart = () => `${localDay().slice(0, 8)}01`;

/* ---------------- categories ---------------- */

/*
 * The categories a firm actually files these under, each inside a small group.
 *
 * The list is long because the work is: a GST notification and a GST circular
 * are different things to a person looking for one. The groups exist so the
 * page can offer ten filters instead of forty-three - the precise category is
 * still stored, and still searched.
 */
export const CATEGORY_GROUPS = [
  {
    key: 'gst',
    label: 'GST',
    categories: ['GST Updates', 'GST Notifications', 'GST Circulars'],
  },
  {
    key: 'income_tax',
    label: 'Income Tax / TDS',
    categories: [
      'Income Tax Updates', 'TDS / TCS Updates', 'Income Tax Circulars',
      'Income Tax Notifications', 'Tax Audit Updates',
    ],
  },
  {
    key: 'mca',
    label: 'MCA / Companies',
    categories: [
      'ROC / MCA Updates', 'Companies Act Updates', 'LLP Updates', 'MCA Notifications',
    ],
  },
  {
    key: 'labour',
    label: 'PF / ESI / Labour',
    categories: [
      'PF / EPFO Updates', 'ESIC Updates', 'Labour Law Updates', 'Professional Tax Updates',
    ],
  },
  {
    key: 'audit',
    label: 'Audit & Accounting',
    categories: [
      'Accounting Standards Updates', 'ICAI Updates', 'Audit & Assurance Updates',
    ],
  },
  {
    key: 'case_law',
    label: 'Case law',
    categories: [
      'Case Laws – Income Tax', 'Case Laws – GST', 'Case Laws – Companies Act',
      'Supreme Court Judgments', 'High Court Judgments', 'Tribunal / ITAT Judgments',
      'Advance Rulings',
    ],
  },
  {
    key: 'financial',
    label: 'RBI / SEBI / FEMA',
    categories: ['RBI Updates', 'FEMA Updates', 'SEBI Updates'],
  },
  {
    key: 'trade',
    label: 'Customs / Trade',
    categories: ['Customs Updates', 'Import / Export Updates', 'DGFT Updates'],
  },
  {
    key: 'compliance',
    label: 'Compliance & Deadlines',
    categories: [
      'Compliance Deadline Changes', 'New Forms / Return Changes',
      'Penalty / Interest Changes', 'Rates / Threshold Limit Changes',
      'Circulars & Clarifications', 'Important Government Notifications',
    ],
  },
  {
    key: 'general',
    label: 'Budget & General',
    categories: [
      'Finance Act Updates', 'Union Budget Updates', 'Daily Tax News',
      'Weekly Tax Roundup', 'Important / Urgent Updates',
    ],
  },
];

export const CATEGORIES = CATEGORY_GROUPS.flatMap((g) => g.categories);

/*
 * The legal module's own categories - courts, areas of law, legislation.
 *
 * A separate list on purpose. A GST circular and an ITAT ruling on a GST
 * question are different kinds of thing to a firm: one is a compliance step,
 * the other is an argument. Sharing a category list would force one of them to
 * be filed as the other, which is why the two modules never see each other's.
 */
export const LEGAL_GROUPS = [
  {
    key: 'apex',
    label: 'Supreme Court',
    categories: ['Supreme Court Judgments'],
  },
  {
    key: 'high_court',
    label: 'High Courts',
    categories: ['High Court Judgments'],
  },
  {
    key: 'corporate_tribunal',
    label: 'NCLT / NCLAT',
    categories: ['NCLT Judgments & Orders', 'NCLAT Judgments & Orders'],
  },
  {
    key: 'tax_tribunal',
    label: 'ITAT / CESTAT / GSTAT',
    categories: ['ITAT Judgments', 'CESTAT Judgments', 'GSTAT / GST Appellate Tribunal Updates'],
  },
  {
    key: 'other_forums',
    label: 'Other forums',
    categories: [
      'District Court / Lower Court Updates', 'Consumer Court / NCDRC Updates',
      'Labour Court / Industrial Tribunal Updates',
    ],
  },
  {
    key: 'corporate_law',
    label: 'Corporate & insolvency',
    categories: [
      'Insolvency & Bankruptcy (IBC)', 'Companies Law / Corporate Litigation',
      'Competition Law', 'Banking & Finance Law', 'FEMA / Foreign Exchange',
    ],
  },
  {
    key: 'commercial_law',
    label: 'Commercial & civil',
    categories: [
      'Contract Law', 'Commercial Law', 'Civil Law', 'Property Law', 'Arbitration',
    ],
  },
  {
    key: 'employment_law',
    label: 'Labour & employment',
    categories: ['Labour & Employment Law'],
  },
  {
    key: 'rights_law',
    label: 'IPR, data & constitutional',
    categories: [
      'Intellectual Property Rights (IPR)', 'Data Protection / Cyber Law',
      'Constitutional Law', 'Criminal Law',
    ],
  },
  {
    key: 'legislation',
    label: 'Legislation',
    categories: [
      'New Acts', 'Acts & Amendments', 'Rules & Regulations', 'Ordinances',
      'Important Legal Notifications',
    ],
  },
  {
    key: 'landmark',
    label: 'Landmark & developments',
    categories: ['Landmark Judgments', 'Important Legal Precedents', 'Legal News & Developments'],
  },
];

export const LEGAL_CATEGORIES = LEGAL_GROUPS.flatMap((g) => g.categories);

const LEGAL_GROUP_OF = new Map(
  LEGAL_GROUPS.flatMap((g) => g.categories.map((c) => [c.toLowerCase(), g.key]))
);

/** How a judgment is placed in the line of cases before it. */
export const RULING_TYPES = [
  'new precedent',
  'precedent reaffirmed',
  'position changed / overruled',
  'referred to larger bench',
  'interim order',
  'final judgment',
  'amendment / legislative change',
];

export const groupsFor = (mod) => (mod === 'legal' ? LEGAL_GROUPS : CATEGORY_GROUPS);
export const categoriesFor = (mod) => (mod === 'legal' ? LEGAL_CATEGORIES : CATEGORIES);

const GROUP_OF = new Map(
  CATEGORY_GROUPS.flatMap((g) => g.categories.map((c) => [c.toLowerCase(), g.key]))
);

/** The group a category belongs to, or 'general' for one that does not fit. */
export const groupFor = (category, mod = 'tax') => (mod === 'legal'
  ? LEGAL_GROUP_OF.get(String(category || '').toLowerCase()) || 'landmark'
  : GROUP_OF.get(String(category || '').toLowerCase()) || 'general');

/* ---------------- sources ---------------- */

/*
 * Whose website it is, read off the domain.
 *
 * Deliberately not asked of the model. "Is this official?" is a question with a
 * factual answer sitting in the URL, and a model that guesses it wrong turns a
 * news write-up into a confirmed notification - which is exactly the failure
 * this page has to avoid.
 */
const OFFICIAL = [
  ['cbic.gov.in', 'CBIC'],
  ['gst.gov.in', 'GSTN'],
  ['gstcouncil.gov.in', 'GST Council'],
  ['incometax.gov.in', 'Income Tax Department'],
  ['incometaxindia.gov.in', 'Income Tax Department'],
  ['mca.gov.in', 'MCA'],
  ['epfindia.gov.in', 'EPFO'],
  ['esic.gov.in', 'ESIC'],
  ['esic.nic.in', 'ESIC'],
  ['finmin.nic.in', 'Ministry of Finance'],
  ['dea.gov.in', 'Ministry of Finance'],
  ['rbi.org.in', 'RBI'],
  ['sebi.gov.in', 'SEBI'],
  ['dgft.gov.in', 'DGFT'],
  ['sci.gov.in', 'Supreme Court of India'],
  ['main.sci.gov.in', 'Supreme Court of India'],
  ['itat.gov.in', 'ITAT'],
  ['icai.org', 'ICAI'],
  ['labour.gov.in', 'Ministry of Labour'],
  ['egazette.gov.in', 'Gazette of India'],
  ['egazette.nic.in', 'Gazette of India'],
  ['pib.gov.in', 'Press Information Bureau'],
  // Courts and tribunals, for the legal module.
  ['nclt.gov.in', 'NCLT'],
  ['nclat.nic.in', 'NCLAT'],
  ['cestat.gov.in', 'CESTAT'],
  ['ncdrc.nic.in', 'NCDRC'],
  ['ecourts.gov.in', 'eCourts'],
  ['indiacode.nic.in', 'India Code'],
  ['legislative.gov.in', 'Legislative Department'],
  ['lawmin.gov.in', 'Ministry of Law & Justice'],
];

/** `{ kind, authority }` for a link: official when the domain says so. */
export function classifySource(url, fallbackName = null) {
  let host = '';
  try {
    host = new URL(String(url)).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return { kind: 'secondary', authority: fallbackName || 'Unknown', host: '' };
  }

  for (const [domain, authority] of OFFICIAL) {
    if (host === domain || host.endsWith(`.${domain}`)) {
      return { kind: 'official', authority, host };
    }
  }
  // A high-court site is official too, and there are twenty-five of them.
  if (/(^|\.)(hcourt|highcourt|courts)\.gov\.in$/.test(host) || /\.gov\.in$/.test(host)) {
    return { kind: 'official', authority: fallbackName || host, host };
  }
  return { kind: 'secondary', authority: fallbackName || host, host };
}

/* ---------------- schema ---------------- */

db.exec(`
  CREATE TABLE IF NOT EXISTS law_updates (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    -- 'tax' is compliance work - GST, TDS, ROC, PF. A second module for court
    -- and legislative work sits beside it, and the two never share a category
    -- list. One table because everything around the categories - searching,
    -- reviewing, archiving, the digest - is the same work twice otherwise.
    module           TEXT NOT NULL DEFAULT 'tax',
    day              TEXT NOT NULL,
    fetched_at       TEXT NOT NULL DEFAULT (datetime('now')),
    published_at     TEXT,

    category         TEXT NOT NULL DEFAULT 'Daily Tax News',
    group_key        TEXT NOT NULL DEFAULT 'general',
    title            TEXT NOT NULL,
    summary          TEXT,
    what_changed     TEXT,
    previous_position TEXT,
    new_position     TEXT,
    applies_to       TEXT,
    action_required  TEXT,

    effective_date   TEXT,
    deadline         TEXT,
    deadline_confirmed INTEGER NOT NULL DEFAULT 0,

    doc_type         TEXT,
    doc_number       TEXT,

    source_name      TEXT,
    source_authority TEXT,
    source_kind      TEXT NOT NULL DEFAULT 'secondary',
    source_url       TEXT,

    ai_explanation   TEXT,
    priority         TEXT NOT NULL DEFAULT 'general',

    status           TEXT NOT NULL DEFAULT 'new',
    important        INTEGER NOT NULL DEFAULT 0,
    reviewed_by      TEXT,
    reviewed_at      TEXT,

    fingerprint      TEXT NOT NULL,
    model            TEXT
  );

  -- Two rows for the same notification are the same row. The URL is the strong
  -- key; the fingerprint catches the same circular arriving from two feeds
  -- under two headlines.
  CREATE INDEX IF NOT EXISTS idx_law_upd_url ON law_updates(source_url);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_law_upd_fp  ON law_updates(fingerprint);
  CREATE INDEX IF NOT EXISTS idx_law_upd_day   ON law_updates(module, day DESC);
  CREATE INDEX IF NOT EXISTS idx_law_upd_group ON law_updates(module, group_key, day DESC);
`);

/*
 * The URL index was UNIQUE and is not any more.
 *
 * A round-up article reporting two judgments is two updates, and the old index
 * refused the second silently. `CREATE INDEX IF NOT EXISTS` will not replace an
 * index that is already there under the same name, so the old one is dropped
 * first; SQLite rebuilds the non-unique one above on the next boot.
 */
try {
  const existing = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_law_upd_url'`)
    .get();
  if (existing?.sql && /UNIQUE/i.test(existing.sql)) {
    db.exec(`DROP INDEX idx_law_upd_url; CREATE INDEX idx_law_upd_url ON law_updates(source_url);`);
  }
} catch { /* a database that has never had the index at all */ }

ensureColumns('law_updates', [
  ['ai_explanation', 'ALTER TABLE law_updates ADD COLUMN ai_explanation TEXT'],
  ["module", "ALTER TABLE law_updates ADD COLUMN module TEXT NOT NULL DEFAULT 'tax'"],
  /*
   * What a judgment has that a circular does not.
   *
   * Columns rather than a second table, because everything around them -
   * searching, reviewing, archiving, composing a digest - is the same work
   * twice otherwise. A tax row leaves them null and never reads them.
   */
  ['court', 'ALTER TABLE law_updates ADD COLUMN court TEXT'],
  ['case_name', 'ALTER TABLE law_updates ADD COLUMN case_name TEXT'],
  ['case_number', 'ALTER TABLE law_updates ADD COLUMN case_number TEXT'],
  ['judgment_date', 'ALTER TABLE law_updates ADD COLUMN judgment_date TEXT'],
  ['legal_area', 'ALTER TABLE law_updates ADD COLUMN legal_area TEXT'],
  ['bench', 'ALTER TABLE law_updates ADD COLUMN bench TEXT'],
  ['petitioner', 'ALTER TABLE law_updates ADD COLUMN petitioner TEXT'],
  ['respondent', 'ALTER TABLE law_updates ADD COLUMN respondent TEXT'],
  ['act_section', 'ALTER TABLE law_updates ADD COLUMN act_section TEXT'],
  ['key_issue', 'ALTER TABLE law_updates ADD COLUMN key_issue TEXT'],
  ['decision', 'ALTER TABLE law_updates ADD COLUMN decision TEXT'],
  ['principle', 'ALTER TABLE law_updates ADD COLUMN principle TEXT'],
  ['implication', 'ALTER TABLE law_updates ADD COLUMN implication TEXT'],
  ['ruling_type', 'ALTER TABLE law_updates ADD COLUMN ruling_type TEXT'],
]);

/* ---------------- writing ---------------- */

const norm = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * What makes two updates the same update.
 *
 * A document number is the real identity when there is one - the same circular
 * headlined two ways is one circular. Without one, the first eight words of the
 * title do the job: enough to match a re-write, short enough not to be defeated
 * by a trailing date.
 */
export function fingerprintOf({ doc_number, case_number, title, source_url }) {
  // A case number is to a judgment what a circular number is to a circular:
  // the thing itself, however many sites write it up.
  const caseNo = norm(case_number);
  if (caseNo) return `case:${caseNo}`;
  const doc = norm(doc_number);
  if (doc) return `doc:${doc}`;
  /*
   * With no number to go on, the article is the identity - the same page read
   * twice is the same update, whatever headline the second read gave it.
   *
   * This used to be a unique index on the URL as well, which quietly asserted
   * that one article can only report one development. A round-up naming two
   * judgments, each with its own case number, lost the second one without a
   * word. The numbers above now decide identity and the URL is only the
   * fallback, so both are kept.
   */
  const url = String(source_url || '').trim();
  if (url) return `url:${url}`;
  const words = norm(title).split(' ').filter(Boolean).slice(0, 8).join(' ');
  return words ? `title:${words}` : `none:${Math.random()}`;
}

const clean = (value, max = 2000) => {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : null;
};

const PRIORITIES = new Set(['critical', 'important', 'general']);

/**
 * Store one update, or leave the one already there alone.
 *
 * Returns `{ id, created }`. A duplicate is not an error and not a second row:
 * the same notification reaching us from three feeds should read as one thing
 * that happened, which is the whole reason a fingerprint exists.
 */
export function saveUpdate(row) {
  const mod = row.module === 'legal' ? 'legal' : 'tax';
  const source = classifySource(row.source_url, row.source_name);
  const known = categoriesFor(mod);
  const category = known.includes(row.category)
    ? row.category
    : (mod === 'legal' ? 'Legal News & Developments' : 'Daily Tax News');
  const record = {
    module: mod,
    day: row.day,
    published_at: clean(row.published_at, 40),
    category,
    group_key: groupFor(category, mod),
    title: clean(row.title, 400) || 'Untitled update',
    summary: clean(row.summary),
    what_changed: clean(row.what_changed),
    previous_position: clean(row.previous_position),
    new_position: clean(row.new_position),
    applies_to: clean(row.applies_to, 400),
    action_required: clean(row.action_required),
    effective_date: clean(row.effective_date, 40),
    deadline: clean(row.deadline, 40),
    // Unconfirmed unless the article actually stated it. The page says which.
    deadline_confirmed: row.deadline && row.deadline_confirmed ? 1 : 0,
    doc_type: clean(row.doc_type, 40),
    doc_number: clean(row.doc_number, 120),
    source_name: clean(row.source_name, 120),
    source_authority: source.authority,
    source_kind: source.kind,
    source_url: clean(row.source_url, 600),
    ai_explanation: clean(row.ai_explanation, 4000),
    priority: PRIORITIES.has(row.priority) ? row.priority : 'general',
    fingerprint: fingerprintOf(row),
    model: clean(row.model, 60),

    // Legal-only. A tax row leaves every one of these null.
    court: clean(row.court, 160),
    case_name: clean(row.case_name, 300),
    case_number: clean(row.case_number, 160),
    judgment_date: clean(row.judgment_date, 40),
    legal_area: clean(row.legal_area, 120),
    bench: clean(row.bench, 300),
    petitioner: clean(row.petitioner, 300),
    respondent: clean(row.respondent, 300),
    act_section: clean(row.act_section, 300),
    key_issue: clean(row.key_issue),
    decision: clean(row.decision),
    principle: clean(row.principle),
    implication: clean(row.implication),
    ruling_type: RULING_TYPES.includes(row.ruling_type) ? row.ruling_type : null,
  };

  const info = db
    .prepare(
      `INSERT OR IGNORE INTO law_updates (
         module, day, published_at, category, group_key, title, summary, what_changed,
         previous_position, new_position, applies_to, action_required,
         effective_date, deadline, deadline_confirmed, doc_type, doc_number,
         source_name, source_authority, source_kind, source_url,
         ai_explanation, priority, fingerprint, model,
         court, case_name, case_number, judgment_date, legal_area, bench,
         petitioner, respondent, act_section, key_issue, decision, principle,
         implication, ruling_type
       ) VALUES (
         @module, @day, @published_at, @category, @group_key, @title, @summary, @what_changed,
         @previous_position, @new_position, @applies_to, @action_required,
         @effective_date, @deadline, @deadline_confirmed, @doc_type, @doc_number,
         @source_name, @source_authority, @source_kind, @source_url,
         @ai_explanation, @priority, @fingerprint, @model,
         @court, @case_name, @case_number, @judgment_date, @legal_area, @bench,
         @petitioner, @respondent, @act_section, @key_issue, @decision, @principle,
         @implication, @ruling_type
       )`
    )
    .run(record);

  if (info.changes === 1) return { id: info.lastInsertRowid, created: true };

  const existing = db.prepare(`SELECT id FROM law_updates WHERE fingerprint = ?`)
    .get(record.fingerprint);
  return { id: existing?.id ?? null, created: false };
}

/* ---------------- reading ---------------- */



/**
 * The updates, filtered the way a person actually looks for one.
 *
 * Every filter is optional and they compose; nothing here defaults to hiding
 * rows except `status`, where archived work leaves the list unless it is asked
 * for by name - the same rule tasks follow.
 */
export function listUpdates({
  module: mod = 'tax', group = null, category = null, priority = null, source = null,
  status = null, important = null, docType = null, deadlinesOnly = false,
  court = null, legalArea = null, rulingType = null,
  when = null, from = null, to = null, q = null, limit = 100, offset = 0,
} = {}) {
  const where = ['module = @module'];
  const args = { module: mod === 'legal' ? 'legal' : 'tax' };

  if (group) { where.push('group_key = @group'); args.group = group; }
  if (category) { where.push('category = @category'); args.category = category; }
  if (priority) { where.push('priority = @priority'); args.priority = priority; }
  if (source) { where.push('source_kind = @source'); args.source = source; }
  if (docType) { where.push('doc_type = @docType'); args.docType = docType; }
  if (court) { where.push('court LIKE @court'); args.court = `%${court}%`; }
  if (legalArea) { where.push('legal_area = @legalArea'); args.legalArea = legalArea; }
  if (rulingType) { where.push('ruling_type = @rulingType'); args.rulingType = rulingType; }
  if (deadlinesOnly) where.push('deadline IS NOT NULL');
  if (important) where.push('important = 1');

  if (status) {
    where.push('status = @status');
    args.status = status;
  } else {
    // Archived rows are still there and still searchable - they just stop
    // being in the way.
    where.push(`status != 'archived'`);
  }

  if (when === 'today') { where.push('day = @day0'); args.day0 = localDay(); }
  else if (when === 'yesterday') { where.push('day = @day1'); args.day1 = localDay(-1); }
  else if (when === 'week') { where.push('day >= @week'); args.week = localDay(-6); }
  else if (when === 'month') { where.push('day >= @month'); args.month = monthStart(); }

  if (from) { where.push('day >= @from'); args.from = from; }
  if (to) { where.push('day <= @to'); args.to = to; }

  if (q) {
    /*
     * One box, every field worth searching: a person looking for "GNL-1" is as
     * likely to type the form number as the heading it appeared under, and
     * "115BBE" only ever appears inside the text.
     */
    where.push(`(
      title LIKE @q OR summary LIKE @q OR what_changed LIKE @q OR doc_number LIKE @q
      OR category LIKE @q OR source_authority LIKE @q OR action_required LIKE @q
      OR ai_explanation LIKE @q OR new_position LIKE @q
      OR case_name LIKE @q OR case_number LIKE @q OR court LIKE @q OR bench LIKE @q
      OR act_section LIKE @q OR key_issue LIKE @q OR decision LIKE @q OR principle LIKE @q
    )`);
    args.q = `%${String(q).trim()}%`;
  }

  args.limit = Math.min(Number(limit) || 100, 300);
  args.offset = Math.max(Number(offset) || 0, 0);

  const clause = `WHERE ${where.join(' AND ')}`;
  const rows = db
    .prepare(
      `SELECT * FROM law_updates ${clause}
       ORDER BY
         CASE priority WHEN 'critical' THEN 0 WHEN 'important' THEN 1 ELSE 2 END,
         day DESC, id DESC
       LIMIT @limit OFFSET @offset`
    )
    .all(args);

  const total = db.prepare(`SELECT COUNT(*) n FROM law_updates ${clause}`).get(args).n;
  return { updates: rows, total };
}

export const getUpdate = (id) =>
  db.prepare(`SELECT * FROM law_updates WHERE id = ?`).get(Number(id)) || null;

/** How many are in each state, for the chips that offer them. */
export function updateCounts(mod = 'tax') {
  const m = mod === 'legal' ? 'legal' : 'tax';
  const one = (clause, ...args) =>
    db.prepare(`SELECT COUNT(*) n FROM law_updates WHERE module = ? AND ${clause}`).get(m, ...args).n;
  const live = `status != 'archived'`;
  return {
    today: one(`day = ? AND ${live}`, localDay()),
    yesterday: one(`day = ? AND ${live}`, localDay(-1)),
    week: one(`day >= ? AND ${live}`, localDay(-6)),
    month: one(`day >= ? AND ${live}`, monthStart()),
    unreviewed: one(`status = 'new'`),
    important: one(`important = 1 AND ${live}`),
    critical: one(`priority = 'critical' AND ${live}`),
    deadlines: one(`deadline IS NOT NULL AND ${live}`),
    archived: one(`status = 'archived'`),
    all: one('1 = 1'),
  };
}

/** Which groups have anything, so the filter offers only what exists. */
export function groupCounts(mod = 'tax') {
  const rows = db
    .prepare(
      `SELECT group_key, COUNT(*) n FROM law_updates
       WHERE module = ? AND status != 'archived' GROUP BY group_key`
    )
    .all(mod === 'legal' ? 'legal' : 'tax');
  return Object.fromEntries(rows.map((r) => [r.group_key, r.n]));
}

/* ---------------- the team's marks ---------------- */

const STATUSES = new Set(['new', 'reviewed', 'archived']);

/**
 * Reviewed, starred, archived - the three things a team does to a list like
 * this. Reviewing records who and when; un-reviewing clears both rather than
 * leaving a name against a state that is no longer true.
 */
export function markUpdate(id, { status, important, reviewedBy } = {}) {
  const update = getUpdate(id);
  if (!update) return null;

  const next = {
    status: STATUSES.has(status) ? status : update.status,
    important: important === undefined || important === null
      ? update.important
      : (important ? 1 : 0),
  };

  const reviewing = next.status === 'reviewed' && update.status !== 'reviewed';
  const unreviewing = next.status !== 'reviewed' && update.status === 'reviewed';

  db.prepare(
    `UPDATE law_updates
        SET status = @status,
            important = @important,
            reviewed_by = CASE WHEN @reviewing THEN @by WHEN @unreviewing THEN NULL ELSE reviewed_by END,
            reviewed_at = CASE WHEN @reviewing THEN datetime('now') WHEN @unreviewing THEN NULL ELSE reviewed_at END
      WHERE id = @id`
  ).run({
    id: Number(id),
    status: next.status,
    important: next.important,
    reviewing: reviewing ? 1 : 0,
    unreviewing: unreviewing ? 1 : 0,
    by: clean(reviewedBy, 80) || 'Team',
  });

  return getUpdate(id);
}

/* ---------------- passing it on ---------------- */

const dateText = (value) => {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime())
    ? String(value)
    : parsed.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
};

/**
 * A message about one update, written for somebody who is not in this office.
 *
 * Deliberately assembled here rather than asked of the model: the facts are
 * already in the row, and a second AI call to re-word them is a second chance
 * to get a legal fact wrong. Nothing about any particular client appears in it -
 * it is a general notice, ready to be sent to whoever it concerns.
 */
export function clientMessage(update, channel = 'whatsapp') {
  if (!update) return null;
  if (update.module === 'legal') return legalMessage(update, channel);
  const deadline = update.deadline
    ? `${dateText(update.deadline)}${update.deadline_confirmed ? '' : ' (to be confirmed)'}`
    : null;

  if (channel === 'email') {
    const lines = [
      `Subject: ${update.category} — ${update.title}`,
      '',
      'Dear Sir / Madam,',
      '',
      update.summary || update.title,
    ];
    if (update.what_changed) lines.push('', `What has changed: ${update.what_changed}`);
    if (update.applies_to) lines.push('', `Generally applies to: ${update.applies_to}`);
    if (update.effective_date) lines.push('', `Effective from: ${dateText(update.effective_date)}`);
    if (deadline) lines.push('', `Due date: ${deadline}`);
    if (update.action_required) lines.push('', `Action required: ${update.action_required}`);
    lines.push(
      '',
      update.source_url
        ? `Source (${update.source_authority || 'source'}): ${update.source_url}`
        : `Source: ${update.source_authority || 'not recorded'}`,
      '',
      'Please let us know if you would like us to review how this applies to you.',
      '',
      'Regards,',
      'Scale Visory'
    );
    return lines.join('\n');
  }

  const lines = [`📋 *${update.title}*`, ''];
  if (update.summary) lines.push(update.summary, '');
  if (update.what_changed) lines.push(`*Kya badla:* ${update.what_changed}`);
  if (update.applies_to) lines.push(`*Kis par lagu:* ${update.applies_to}`);
  if (update.effective_date) lines.push(`*Lagu tareekh:* ${dateText(update.effective_date)}`);
  if (deadline) lines.push(`📅 *Last date:* ${deadline}`);
  if (update.action_required) lines.push(`⚠️ *Karna kya hai:* ${update.action_required}`);
  if (update.source_url) {
    lines.push('', `Source (${update.source_authority || 'source'}): ${update.source_url}`);
  }
  lines.push('', '— Scale Visory');
  return lines.filter((l) => l !== undefined).join('\n');
}

/**
 * The same, for a judgment.
 *
 * A circular tells somebody what to do; a judgment tells them where they now
 * stand, which is a different message. It names the case and the court because
 * a professional's first question is which court said it, and it carries the
 * link to the order itself wherever there is one - a holding restated at second
 * hand is not a holding.
 */
function legalMessage(update, channel = 'whatsapp') {
  const heading = update.case_name || update.title;
  const where = [update.court, update.case_number].filter(Boolean).join(' · ');

  if (channel === 'email') {
    const lines = [
      `Subject: ${update.court || 'Court'} — ${heading}`,
      '',
      'Dear Sir / Madam,',
      '',
      update.summary || update.title,
    ];
    if (where) lines.push('', `Case: ${where}`);
    if (update.judgment_date) lines.push('', `Date of judgment / order: ${dateText(update.judgment_date)}`);
    if (update.act_section) lines.push('', `Relevant law: ${update.act_section}`);
    if (update.key_issue) lines.push('', `Issue: ${update.key_issue}`);
    if (update.decision) lines.push('', `What the court decided: ${update.decision}`);
    if (update.principle) lines.push('', `Principle: ${update.principle}`);
    if (update.implication) lines.push('', `Practical impact: ${update.implication}`);
    lines.push(
      '',
      update.source_url
        ? `Source (${update.source_authority || 'source'}): ${update.source_url}`
        : `Source: ${update.source_authority || 'not recorded'}`,
      '',
      'This is a note on a judgment of general interest, not advice on any particular matter.',
      'Please let us know if you would like us to look at how it applies to you.',
      '',
      'Regards,',
      'Scale Visory'
    );
    return lines.join('\n');
  }

  const lines = [`⚖️ *${heading}*`, ''];
  if (where) lines.push(`*Court:* ${where}`);
  if (update.judgment_date) lines.push(`*Date:* ${dateText(update.judgment_date)}`);
  if (update.act_section) lines.push(`*Law:* ${update.act_section}`);
  lines.push('');
  if (update.key_issue) lines.push(`*Sawal:* ${update.key_issue}`);
  if (update.decision) lines.push(`*Court ne kya kaha:* ${update.decision}`);
  if (update.principle) lines.push(`*Usool:* ${update.principle}`);
  if (update.implication) lines.push(`*Asar:* ${update.implication}`);
  if (update.source_url) {
    lines.push('', `Source (${update.source_authority || 'source'}): ${update.source_url}`);
  }
  lines.push('', '_Ye ek aam jaankari hai, kisi ek maamle par salah nahi._', '— Scale Visory');
  return lines.join('\n');
}

/* ---------------- the digest, built from the rows ---------------- */

/** The sections the WhatsApp digest is written in, in the order it reads. */
export const DIGEST_SECTIONS = [
  { key: 'gst', label: 'GST' },
  { key: 'income_tax', label: 'Income Tax / TDS' },
  { key: 'mca', label: 'MCA / ROC' },
  { key: 'labour', label: 'PF / ESI / Labour' },
  { key: 'case_law', label: 'Case law' },
];

/** The legal digest reads in its own order, by forum rather than by tax head. */
export const LEGAL_DIGEST_SECTIONS = [
  { key: 'apex', label: '⚖️ Supreme Court' },
  { key: 'high_court', label: '⚖️ High Courts' },
  { key: 'corporate_tribunal', label: '🏢 NCLT / NCLAT' },
  { key: 'tax_tribunal', label: '📊 ITAT / CESTAT / GSTAT' },
  { key: 'legislation', label: '📜 Legislation' },
];

const MAX_PER_SECTION = 3;

const short = (update) => {
  const text = update.module === 'legal'
    ? [update.case_name, update.decision || update.summary].filter(Boolean).join(' — ')
    : update.summary || update.what_changed || update.title;
  const trimmed = String(text).replace(/\s+/g, ' ').trim();
  return trimmed.length > 170 ? `${trimmed.slice(0, 167)}…` : trimmed;
};

/**
 * The morning message, composed from the day's rows.
 *
 * The same five sections as before, so nothing about the message a reader has
 * been getting changes shape - but each line now comes from a record that can
 * be opened, searched and marked, and the urgent ones are lifted to the top
 * instead of taking their turn by category.
 */
export function composeDigest(day, { heading, nothingNew, module: mod = 'tax' }) {
  const legal = mod === 'legal';
  const sections = legal ? LEGAL_DIGEST_SECTIONS : DIGEST_SECTIONS;
  const { updates } = listUpdates({ module: mod, from: day, to: day, limit: 60 });
  if (!updates.length) return { text: nothingNew, count: 0, ids: [] };

  const lines = [heading, ''];
  const used = new Set();

  const urgent = updates.filter((u) => u.priority === 'critical');
  if (urgent.length) {
    lines.push(legal ? '🔴 *Landmark / urgent*' : '🔴 *Urgent*');
    for (const u of urgent.slice(0, MAX_PER_SECTION)) {
      used.add(u.id);
      lines.push(`• ${short(u)}${u.source_url ? ` ${u.source_url}` : ''}`);
    }
    lines.push('');
  }

  for (const section of sections) {
    const all = updates.filter((u) => u.group_key === section.key);
    const mine = all.filter((u) => !used.has(u.id));
    if (!mine.length) {
      /*
       * "koi naya update nahi" has to mean it: a section whose only update was
       * lifted into Urgent above has an update, and saying otherwise in the
       * same message that just showed it is the kind of small lie that costs a
       * reader their trust in the whole digest.
       */
      lines.push(all.length
        ? `*${section.label}:* upar Urgent me diya hai`
        : `*${section.label}:* koi naya update nahi`);
      continue;
    }
    const listed = mine.slice(0, MAX_PER_SECTION);
    for (const u of listed) used.add(u.id);
    lines.push(`*${section.label}:*`);
    for (const u of listed) lines.push(`• ${short(u)}${u.source_url ? ` ${u.source_url}` : ''}`);
    if (mine.length > listed.length) lines.push(`  _…aur ${mine.length - listed.length} update._`);
  }

  if (legal) {
    /*
     * A judgment has no deadline to close on. What matters instead is whether
     * the ground moved - a position overruled or a matter sent to a larger
     * bench is the line a professional needs to have seen today.
     */
    const moved = updates.filter((u) =>
      ['position changed / overruled', 'referred to larger bench', 'new precedent'].includes(u.ruling_type));
    if (moved.length) {
      lines.push('', '⚠️ *Important developments*');
      for (const u of moved.slice(0, 4)) {
        lines.push(`• ${u.ruling_type} — ${u.case_name || u.title}`);
      }
    }

    const worth = updates.find((u) => u.implication && u.priority !== 'general');
    lines.push(
      '',
      `📣 *Client ko batane layak:* ${worth ? worth.implication : 'aaj kuch nahi'}`
    );
    return { text: lines.join('\n'), count: updates.length, ids: updates.map((u) => u.id) };
  }

  // Deadlines are the part somebody has to act on, so they close the message
  // rather than being buried in whichever section they came from. Only real
  // ones: a deadline the article did not confirm is not put in a client's face.
  const deadlines = updates.filter((u) => u.deadline && u.deadline_confirmed);
  if (deadlines.length) {
    lines.push('', '📅 *Deadlines*');
    for (const u of deadlines.slice(0, 4)) {
      lines.push(`• ${dateText(u.deadline)} — ${u.title}`);
    }
  }

  const action = updates.find((u) => u.action_required && u.priority !== 'general');
  lines.push(
    '',
    `⚠️ *Client ko batao:* ${action ? action.action_required : 'aaj kuch nahi'}`
  );

  return { text: lines.join('\n'), count: updates.length, ids: updates.map((u) => u.id) };
}
