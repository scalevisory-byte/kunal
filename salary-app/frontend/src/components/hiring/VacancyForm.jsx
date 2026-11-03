import { useEffect, useMemo, useState } from 'react';
import { fromBand, toBand } from '../../../../shared/experienceBand.js';
import { validateVacancy } from '../../../../shared/vacancyForm.js';

/*
 * Raising a vacancy.
 *
 * It was eighteen boxes in one `auto-fit` grid, in whatever order they had been
 * added over the weeks - the test link sat between "Salary to" and "Pass mark",
 * and "How many seats" came after the skills. Nothing was wrong with it; it
 * just could not be read.
 *
 * So the same boxes are in five named sections, in the order somebody actually
 * knows the answers: what the job is, what sort of job, what it pays and by
 * when, what it says, and - only if there is one - the test.
 *
 * What it deliberately does NOT do is change what is stored. Every box here
 * writes the column it always wrote, with two exceptions that are spelled out
 * where they happen: experience is two numbers over one text column, and two
 * genuinely new columns were added for two genuinely new questions.
 */

/* The order the eye reads, so a one-line summary names the first problem. */
const ORDER = [
  'company_id', 'title', 'location', 'positions',
  'experience_min', 'experience_max',
  'salary_min', 'salary_max', 'apply_by', 'needed_by',
  'test_url', 'test_pass_percent', 'test_seconds_per_question', 'test_duration_minutes',
];

export const blankVacancy = (companyId) => ({
  company_id: companyId || '',
  title: '',
  department: '',
  reports_to: '',
  location: '',
  positions: 1,
  employment_type: 'Full-time',
  work_mode: 'On-site',
  experience_min: '',
  experience_max: '',
  education: '',
  skills: '',
  salary_min: '',
  salary_max: '',
  apply_by: '',
  needed_by: '',
  description: '',
  responsibilities: '',
  requirements: '',
  benefits: '',
  internal_notes: '',
  test_url: '',
  test_pass_percent: '',
  test_seconds_per_question: '',
  test_duration_minutes: '',
});

/** A stored vacancy, opened back into these boxes. */
export const vacancyToDraft = (v = {}) => ({
  ...blankVacancy(v.company_id),
  ...v,
  ...fromBand(v.experience_band),
  positions: v.positions ?? 1,
  // Nulls read as the word "null" in a text box.
  ...Object.fromEntries(
    ['department', 'reports_to', 'location', 'education', 'skills', 'salary_min',
     'salary_max', 'apply_by', 'needed_by', 'description', 'internal_notes',
     'responsibilities', 'requirements', 'benefits',
     'test_url', 'test_pass_percent', 'test_seconds_per_question', 'test_duration_minutes']
      .map((k) => [k, v[k] ?? ''])
  ),
  experience_min: fromBand(v.experience_band).min,
  experience_max: fromBand(v.experience_band).max,
});

/**
 * @param onSave  (body, {publish}) => Promise. The caller decides what a
 *                draft and a published vacancy mean; this only says which.
 */
export default function VacancyForm({ companies, companyId, onSave, onCancel, busy }) {
  const [draft, setDraft] = useState(() => blankVacancy(companyId));
  /*
   * The toggle is not a column. A vacancy HAS an assessment when it carries a
   * link, so storing a separate flag would let the two disagree - switched on
   * with no link, or a link nobody can see. Opening an existing vacancy reads
   * it off the link for the same reason.
   */
  const [assessment, setAssessment] = useState(false);
  const [tried, setTried] = useState(false);
  const [failed, setFailed] = useState('');

  useEffect(() => {
    setDraft((d) => (d.company_id ? d : { ...d, company_id: companyId || '' }));
  }, [companyId]);

  const problems = useMemo(() => validateVacancy(draft, { assessment }), [draft, assessment]);
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  /* Only after the first press, so a blank form is not red before it is used. */
  const bad = (key) => (tried ? problems[key] : '');

  const submit = async (publish) => {
    setTried(true);
    setFailed('');
    if (Object.keys(problems).length) {
      const first = ORDER.find((k) => problems[k]) || Object.keys(problems)[0];
      document.querySelector(`[data-field="${first}"]`)?.scrollIntoView({ block: 'center' });
      return;
    }
    const { experience_min, experience_max, ...rest } = draft;
    const body = {
      ...rest,
      company_id: Number(draft.company_id),
      positions: Number(draft.positions) || 1,
      /*
       * Numbers, because the columns are INTEGER. A "70" posted as a string
       * works today - everything that reads it runs Number() first - but it
       * is the kind of difference that one day makes a === comparison lie.
       * Blank stays null: no pass mark is not a pass mark of nought.
       */
      test_pass_percent: wholeOrNull(draft.test_pass_percent),
      test_seconds_per_question: wholeOrNull(draft.test_seconds_per_question),
      test_duration_minutes: wholeOrNull(draft.test_duration_minutes),
      // Two boxes, one column, the same sentence match.js already reads.
      experience_band: toBand(experience_min, experience_max),
      // Switched off means the test fields are cleared, not merely hidden -
      // a pass mark left behind on a vacancy with no test is a trap.
      ...(assessment
        ? {}
        : { test_url: '', test_pass_percent: null, test_seconds_per_question: null, test_duration_minutes: null }),
    };
    try {
      await onSave(body, { publish });
    } catch (err) {
      setFailed(err?.message || 'Could not save it');
    }
  };

  return (
    <form
      className="card vacancy-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit(false);
      }}
    >
      <header className="vf-head">
        <h2>New vacancy</h2>
        <p className="muted small">
          Company, job title, location and how many seats are all it needs. Everything else
          sharpens the match score and the advert.
        </p>
      </header>

      {!companies.length ? (
        <div className="banner bad">
          There are no companies yet. Add one on the Employees tab first — a vacancy has to
          belong to a company, or there is nobody to put the person on the payroll of.
        </div>
      ) : null}

      <Section title="Job information">
        <Field label="Company" required error={bad('company_id')} name="company_id">
          <select value={draft.company_id} onChange={(e) => set({ company_id: e.target.value })}>
            <option value="">Choose…</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Job title" required error={bad('title')} name="title">
          <input value={draft.title} placeholder="Travel Consultant" onChange={(e) => set({ title: e.target.value })} />
        </Field>
        <Field label="Department" name="department">
          <input value={draft.department} placeholder="Operations" onChange={(e) => set({ department: e.target.value })} />
        </Field>
        <Field label="Reporting manager" hint="Office only — never on the advert" name="reports_to">
          <input value={draft.reports_to} onChange={(e) => set({ reports_to: e.target.value })} />
        </Field>
        <Field label="Job location" required error={bad('location')} name="location">
          <input value={draft.location} placeholder="Vadodara" onChange={(e) => set({ location: e.target.value })} />
        </Field>
        <Field label="Number of openings" required error={bad('positions')} name="positions">
          <input
            type="number"
            min="1"
            value={draft.positions}
            onChange={(e) => set({ positions: e.target.value })}
          />
        </Field>
      </Section>

      <Section title="Employment details">
        <Field label="Employment type" name="employment_type">
          <select value={draft.employment_type} onChange={(e) => set({ employment_type: e.target.value })}>
            {['Full-time', 'Part-time', 'Contract', 'Internship'].map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </Field>
        <Field label="Work mode" name="work_mode">
          <select value={draft.work_mode} onChange={(e) => set({ work_mode: e.target.value })}>
            {['On-site', 'Hybrid', 'Remote'].map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </Field>
        <Field
          label="Minimum experience"
          hint="Years. Nought means a fresher is welcome."
          error={bad('experience_min')}
          name="experience_min"
        >
          <input
            type="number"
            min="0"
            step="0.5"
            value={draft.experience_min}
            placeholder="1"
            onChange={(e) => set({ experience_min: e.target.value })}
          />
        </Field>
        <Field
          label="Maximum experience"
          hint="Blank means no ceiling"
          error={bad('experience_max')}
          name="experience_max"
        >
          <input
            type="number"
            min="0"
            step="0.5"
            value={draft.experience_max}
            placeholder="3"
            onChange={(e) => set({ experience_max: e.target.value })}
          />
        </Field>
        {/*
          * A list, like the ZYNTA jobs form, but still typable: "B.Com with
          * Tally" is a real requirement and a fixed dropdown would lose it.
          */}
        <Field label="Qualification" hint="Choose one or type your own" name="education">
          <input
            list="vf-education"
            value={draft.education}
            placeholder="Any graduate"
            onChange={(e) => set({ education: e.target.value })}
          />
          <datalist id="vf-education">
            {['Any', '10th pass', '12th pass', 'Diploma', 'Any graduate', 'B.Com', 'B.A.', 'B.Sc',
              'BBA', 'BCA', 'B.E. / B.Tech', 'M.Com', 'MBA', 'CA Inter', 'CA'].map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
        </Field>
        <Field label="Required skills" hint="Comma separated — each one is scored" name="skills" wide>
          <input
            value={draft.skills}
            placeholder="Ticketing, Amadeus, Excel"
            onChange={(e) => set({ skills: e.target.value })}
          />
        </Field>
        {/*
          * Said in the candidate's words, because it is what the advert will
          * carry and what every applicant is scored against.
          */}
        <p className="vf-note">
          Scored as <strong>{toBand(draft.experience_min, draft.experience_max) || 'not asked for'}</strong>
          {toBand(draft.experience_min, draft.experience_max)
            ? ' — somebody outside it is not refused, only scored lower.'
            : ' — experience cannot then count for or against anybody.'}
        </p>
      </Section>

      <Section title="Salary and timeline">
        <Field label="Minimum salary" hint="A month" error={bad('salary_min')} name="salary_min">
          <input value={draft.salary_min} placeholder="18000" onChange={(e) => set({ salary_min: e.target.value })} />
        </Field>
        <Field label="Maximum salary" hint="A month" error={bad('salary_max')} name="salary_max">
          <input value={draft.salary_max} placeholder="25000" onChange={(e) => set({ salary_max: e.target.value })} />
        </Field>
        <Field label="Application deadline" hint="Last day to apply" error={bad('apply_by')} name="apply_by">
          <input type="date" value={draft.apply_by} onChange={(e) => set({ apply_by: e.target.value })} />
        </Field>
        <Field
          label="Target joining date"
          hint="When the seat has to be filled"
          error={bad('needed_by')}
          name="needed_by"
        >
          <input type="date" value={draft.needed_by} onChange={(e) => set({ needed_by: e.target.value })} />
        </Field>
      </Section>

      <Section title="Job description" single>
        <Field label="About the job and what they will do" hint="This is what a candidate reads" name="description" wide>
          <textarea rows="5" value={draft.description} onChange={(e) => set({ description: e.target.value })} />
        </Field>
        {/*
          * Three columns `vacancies` has carried since the start, that the old
          * form never showed - so they could only ever be blank, and the
          * advert was the poorer for it. Dinesh's ZYNTA jobs form asks for all
          * three, one per line, and so does this now.
          */}
        <Field label="Responsibilities" hint="One per line" name="responsibilities" wide>
          <textarea
            rows="4"
            value={draft.responsibilities}
            placeholder={'Issue tickets and handle changes\nFollow up on payments'}
            onChange={(e) => set({ responsibilities: e.target.value })}
          />
        </Field>
        <Field label="Requirements" hint="One per line" name="requirements" wide>
          <textarea
            rows="4"
            value={draft.requirements}
            placeholder={'Amadeus or Galileo\nComfortable on the phone'}
            onChange={(e) => set({ requirements: e.target.value })}
          />
        </Field>
        <Field label="What we offer" hint="One per line" name="benefits" wide>
          <textarea rows="3" value={draft.benefits} onChange={(e) => set({ benefits: e.target.value })} />
        </Field>
        <Field
          label="Internal hiring notes"
          hint="Why the seat is open, who it replaces. Never shown to a candidate."
          name="internal_notes"
          wide
        >
          <textarea rows="3" value={draft.internal_notes} onChange={(e) => set({ internal_notes: e.target.value })} />
        </Field>
      </Section>

      <Section
        title="Online assessment"
        aside={
          <label className="vf-toggle">
            <input
              type="checkbox"
              checked={assessment}
              onChange={(e) => setAssessment(e.target.checked)}
            />
            <span>{assessment ? 'On' : 'Off'}</span>
          </label>
        }
      >
        {assessment ? (
          <>
            <Field
              label="Test link"
              required
              hint="The test for THIS job — an accounts seat is not tested like a travel seat"
              error={bad('test_url')}
              name="test_url"
              wide
            >
              <input
                value={draft.test_url}
                placeholder="https://crm.zyntajobs.in/test?t=office-admin"
                onChange={(e) => set({ test_url: e.target.value })}
              />
            </Field>
            <Field label="Passing marks %" hint="Blank = 50" error={bad('test_pass_percent')} name="test_pass_percent">
              <input
                type="number"
                min="1"
                max="100"
                value={draft.test_pass_percent}
                placeholder="50"
                onChange={(e) => set({ test_pass_percent: e.target.value })}
              />
            </Field>
            <Field
              label="Seconds per question"
              hint="Blank = 30. This is the clock the test system is actually given."
              error={bad('test_seconds_per_question')}
              name="test_seconds_per_question"
            >
              <input
                type="number"
                min="1"
                value={draft.test_seconds_per_question}
                placeholder="30"
                onChange={(e) => set({ test_seconds_per_question: e.target.value })}
              />
            </Field>
            <Field
              label="Test duration (minutes)"
              hint="The whole paper. Blank = no overall limit."
              error={bad('test_duration_minutes')}
              name="test_duration_minutes"
            >
              <input
                type="number"
                min="1"
                value={draft.test_duration_minutes}
                placeholder="30"
                onChange={(e) => set({ test_duration_minutes: e.target.value })}
              />
            </Field>
            <p className="vf-note">
              This app does not run the clock or mark the paper — the test system does, and
              these are the rules it is handed. A result is one more thing to weigh; it never
              moves anybody along on its own.
            </p>
          </>
        ) : (
          <p className="vf-note">
            No test for this vacancy. Switch it on to set a link, a pass mark and the timing.
          </p>
        )}
      </Section>

      {tried && Object.keys(problems).length ? (
        <div className="banner bad" role="alert">
          {Object.keys(problems).length === 1
            ? problems[ORDER.find((k) => problems[k]) || Object.keys(problems)[0]]
            : `${Object.keys(problems).length} things need fixing — they are marked in red above.`}
        </div>
      ) : null}
      {failed ? <div className="banner bad">{failed}</div> : null}

      <footer className="vf-actions">
        <button className="primary" type="button" disabled={busy || !companies.length} onClick={() => submit(true)}>
          Publish vacancy
        </button>
        <button type="submit" disabled={busy || !companies.length}>
          Save as draft
        </button>
        <button type="button" className="ghost" onClick={onCancel}>
          Cancel
        </button>
        <span className="muted small">
          A draft is not visible to candidates. Publishing is what puts it on the careers page
          and makes the apply link live.
        </span>
      </footer>
    </form>
  );
}

function wholeOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function Section({ title, aside, children, single }) {
  return (
    <section className="vf-section">
      <div className="vf-section-head">
        <h3>{title}</h3>
        {aside}
      </div>
      <div className={single ? 'vf-rows' : 'vf-grid'}>{children}</div>
    </section>
  );
}

function Field({ label, hint, error, required, name, wide, children }) {
  return (
    <label className={`vf-field${wide ? ' wide' : ''}${error ? ' bad' : ''}`} data-field={name}>
      <span className="vf-label">
        {label}
        {required ? <b aria-hidden="true"> *</b> : null}
      </span>
      {children}
      {error ? <span className="vf-error">{error}</span> : hint ? <span className="vf-hint">{hint}</span> : null}
    </label>
  );
}
