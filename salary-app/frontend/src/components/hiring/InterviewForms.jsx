import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api.js';
import {
  ADDRESS_PARTS,
  MAX_REFERENCES,
  QUESTIONS,
  REFERENCE_TYPES,
  ROUND_NAMES,
  SECTIONS,
  VERIFICATION,
  DECLARATION,
  checkForm,
  roundLabel,
  sameAsCurrent,
} from '../../../../shared/interviewForm.js';
import {
  NEXT_ACTIONS,
  PARAMETERS,
  RATINGS,
  RECOMMENDATIONS,
  PRACTICAL,
  YES_NO,
  checkEvaluation,
  movesFrom,
  statusMeta,
  summarise,
} from '../../../../shared/interviewEval.js';

/**
 * The two interview forms.
 *
 * They share a header, a section shell and a save bar, so they are one file:
 * two copies of "who is this candidate and which round is this" would be two
 * places to fix when a field moves.
 *
 * Every field is built from the lists in shared/, never typed here, so the
 * server's validation and this form cannot drift about what exists.
 */

/**
 * Fetch a document the server wrote and hand it to the browser as a file.
 *
 * An anchor with `download` and an absolute href, never window.open: the route
 * answers an attachment, so there is nothing for a tab to show - and a tab
 * opened after an await is pop-up blocked without a word, which the CV button
 * learnt the hard way.
 */
const grab = (path) => {
  const a = document.createElement('a');
  a.href = `${window.location.origin}${path}`;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
};

/* ---------------- the shell ---------------- */

/**
 * A collapsible section.
 *
 * `useState`, deliberately NOT an uncontrolled <details>: the panel reloads
 * itself after every save and a <details> resets when React re-renders around
 * it, so an open section would shut under the person's hands halfway through
 * typing. That exact bug cost a morning on the roll call's uniform fold.
 */
function Section({ title, hint, children, open, onToggle, done }) {
  return (
    <section className={open ? 'iv-section open' : 'iv-section'}>
      <button className="iv-head" onClick={onToggle} aria-expanded={open}>
        <span className="iv-title">{title}</span>
        {done ? <span className="iv-done">{done}</span> : null}
        <span className="iv-chev">{open ? '–' : '+'}</span>
      </button>
      {open ? (
        <div className="iv-body">
          {hint ? <p className="muted small">{hint}</p> : null}
          {children}
        </div>
      ) : null}
    </section>
  );
}

/**
 * A short list of choices is TICKED, not opened.
 *
 * Dinesh asked for this on Languages and then "baaki jagah bhi dekho jahan pe
 * ye use kar sakte ho". Every list in this form is four options or fewer -
 * Basic/Average/Good/Excellent, Basic/Intermediate/Advanced, Yes/No - and a
 * dropdown for four things is two taps and a hidden menu where one tap would
 * do. With a candidate sitting opposite, that is the whole difference between
 * filling the form in as you talk and filling it in afterwards.
 *
 * Clicking the chosen one again clears it, because blank is a real answer
 * here: "nobody asked" is not "No", and a mis-tap must have a way back that
 * is not an opinion nobody holds.
 */
function Chips({ options, value, onPick, multi }) {
  const chosen = multi ? (Array.isArray(value) ? value : []) : [value];
  return (
    <span className="iv-chips">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          className={chosen.includes(o) ? 'chip active' : 'chip'}
          onClick={() =>
            multi
              ? onPick(chosen.includes(o) ? chosen.filter((x) => x !== o) : [...chosen, o])
              : onPick(value === o ? '' : o)
          }
        >
          {o}
        </button>
      ))}
    </span>
  );
}

function Field({ field, value, onChange }) {
  const set = (v) => onChange(field.key, v);
  if (field.readOnly) {
    return (
      <label className="field">
        {field.label}
        <input value={value ?? ''} readOnly disabled />
      </label>
    );
  }
  /*
   * Languages is a LIST, and it was rendering as a dropdown - so only one
   * could be chosen and it did not save as a list at all. Anybody here speaks
   * three.
   */
  if (field.type === 'tags' && field.options) {
    return (
      <label className="field wide">
        {field.label}
        <Chips options={field.options} value={value} onPick={set} multi />
      </label>
    );
  }
  if (field.options) {
    return (
      <label className="field">
        {field.label}
        {field.options.length <= 4 ? (
          <Chips options={field.options} value={value} onPick={set} />
        ) : (
          <select value={value ?? ''} onChange={(e) => set(e.target.value)}>
            <option value="">—</option>
            {field.options.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        )}
      </label>
    );
  }
  if (field.long) {
    return (
      <label className="field wide">
        {field.label}
        <textarea rows={2} value={value ?? ''} onChange={(e) => set(e.target.value)} />
      </label>
    );
  }
  return (
    <label className="field">
      {field.label}
      <input
        type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
        value={value ?? ''}
        onChange={(e) => set(e.target.value)}
      />
    </label>
  );
}

/** Who this is and which round — fetched, never asked for. */
function Who({ context }) {
  const { candidate, interview, position, department, company } = context;
  return (
    <div className="iv-who">
      <div>
        <strong>{candidate?.name}</strong>
        <span className="muted small"> · {candidate?.ref_no} · {candidate?.phone}</span>
      </div>
      <div className="muted small">
        {position}{department ? ` · ${department}` : ''} · {company}
      </div>
      <div className="muted small">
        {roundLabel(interview.round, interview.round_name)} ·{' '}
        {String(interview.at).replace('T', ' ').slice(0, 16)}
        {interview.interviewer ? ` · ${interview.interviewer}` : ''}
        {interview.location_or_link ? ` · ${interview.location_or_link}` : ''}
      </div>
    </div>
  );
}

/* ---------------- the information form ---------------- */

export function InterviewFormPanel({ interviewId, onClose, onSaved, onError, onToast }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState({});
  const [open, setOpen] = useState('basic');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const got = await api.get(`/hiring/interviews/${interviewId}/form`);
      setData(got);
      // Prefill: the stored form first, then the candidate's own record for
      // anything the form has not been given yet.
      const prefill = {};
      for (const section of SECTIONS) {
        for (const field of section.fields || []) {
          const stored = got.form?.[field.key];
          prefill[field.key] =
            stored ?? (field.from ? got.candidate?.[field.from] ?? '' : '');
        }
      }
      prefill.languages = got.form?.languages || [];
      prefill.answers = got.form?.answers || {};
      prefill.address = Object.fromEntries(
        ['current', 'permanent'].flatMap((w) =>
          ADDRESS_PARTS.map((p) => [`${w}_${p.key}`, got.candidate?.[`${w}_${p.key}`] ?? ''])
        )
      );
      setForm(prefill);
    } catch (err) {
      onError(err);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interviewId]);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const setAddress = (key, value) =>
    setForm((f) => ({ ...f, address: { ...f.address, [key]: value } }));

  const save = async (submit) => {
    setBusy(true);
    try {
      await api.put(
        `/hiring/interviews/${interviewId}/form${submit ? '?submit=true' : ''}`,
        form
      );
      onToast(submit ? 'Interview submitted' : 'Saved');
      await load();
      onSaved?.();
      if (submit) onClose();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  if (!data) return null;
  const problems = checkForm();
  const locked = data.form?.status === 'submitted';

  return (
    <div className="backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel wide interview-form">
        <header>
          <div>
            <h1>Interview form</h1>
            <p className="muted small">
              {locked
                ? 'Confirmed — edits are recorded on the audit trail'
                : 'Their particulars, filled in before the interview'}
              {data.form?.candidate_filled_at
                ? ' · the candidate filled this in themselves'
                : ''}
            </p>
          </div>
          <div className="row">
            {/*
              * Downloads the whole form as a document rather than printing
              * the panel. The panel is collapsible sections, so
              * window.print() printed whichever two were open and silently
              * dropped the rest - no use to anybody being handed it.
              */}
            <button onClick={() => grab(`/api/hiring/interviews/${interviewId}/form/print`)}>
              Print / PDF
            </button>
            <button className="close" onClick={onClose}>Close</button>
          </div>
        </header>

        <Who context={data} />

        {SECTIONS.map((section) => (
          <Section
            key={section.key}
            title={section.title}
            hint={section.hint}
            open={open === section.key}
            onToggle={() => setOpen(open === section.key ? '' : section.key)}
          >
            {section.questions ? (
              <div className="iv-questions">
                {QUESTIONS.map((q, i) => (
                  <label className="field wide" key={q.key}>
                    <span>{i + 1}. {q.q}</span>
                    <textarea
                      rows={2}
                      value={form.answers?.[q.key] ?? ''}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, answers: { ...f.answers, [q.key]: e.target.value } }))
                      }
                    />
                  </label>
                ))}
              </div>
            ) : section.address ? (
              <>
                <h4>Current address</h4>
                <div className="iv-grid">
                  {ADDRESS_PARTS.map((p) => (
                    <label className="field" key={p.key}>
                      {p.label}
                      <input
                        value={form.address?.[`current_${p.key}`] ?? ''}
                        onChange={(e) => setAddress(`current_${p.key}`, e.target.value)}
                      />
                    </label>
                  ))}
                </div>
                <h4>
                  Permanent address{' '}
                  <button
                    className="link"
                    onClick={() =>
                      setForm((f) => ({ ...f, address: sameAsCurrent(f.address || {}) }))
                    }
                  >
                    same as current
                  </button>
                </h4>
                <div className="iv-grid">
                  {ADDRESS_PARTS.map((p) => (
                    <label className="field" key={p.key}>
                      {p.label}
                      <input
                        value={form.address?.[`permanent_${p.key}`] ?? ''}
                        onChange={(e) => setAddress(`permanent_${p.key}`, e.target.value)}
                      />
                    </label>
                  ))}
                </div>
              </>
            ) : section.references ? (
              <References
                candidateId={data.application.candidate_id}
                rows={data.references}
                onChanged={load}
                onError={onError}
              />
            ) : (
              <div className="iv-grid">
                {(section.fields || []).map((field) => (
                  <Field
                    key={field.key}
                    field={field}
                    value={field.key === 'languages' ? form.languages : form[field.key]}
                    onChange={set}
                  />
                ))}
              </div>
            )}
          </Section>
        ))}

        {/*
          * No decision here any more.
          *
          * Dinesh: this form is filled in BEFORE the interview, by the
          * candidate - so a verdict and the interviewer's notes had no
          * business on it. Both live on the evaluation, where the interviewer
          * records them afterwards.
          */}
        <p className="muted small iv-declaration">{DECLARATION}</p>

        <footer className="iv-actions">
          {/*
            * No blocker line here. checkForm() returns nothing by design -
            * submitting these particulars means "confirmed", not "complete",
            * because half of what is asked may genuinely not apply to
            * somebody. A line that can never render only misleads whoever
            * reads this next.
            */}
          <span className="spacer" />
          <button disabled={busy} onClick={() => save(false)}>Save draft</button>
          <button className="primary" disabled={busy} onClick={() => save(true)}>
            {locked ? 'Save changes' : 'Confirm these details'}
          </button>
        </footer>
      </div>
    </div>
  );
}

/* ---------------- references ---------------- */

/**
 * Up to two, and they belong to the CANDIDATE.
 *
 * Verification is HR's to finish later, which is exactly why these are not on
 * the form: finishing one next week must not mean editing a submitted
 * interview record.
 */
function References({ candidateId, rows = [], onChanged, onError }) {
  const save = async (row) => {
    try {
      await api.put(`/hiring/candidates/${candidateId}/references`, row);
      onChanged();
    } catch (err) {
      onError(err);
    }
  };
  const blank = rows.length < MAX_REFERENCES ? [{}] : [];
  return (
    <>
      {[...rows, ...blank].map((row, i) => (
        <RefRow key={row.id || `new-${i}`} row={row} onSave={save} />
      ))}
    </>
  );
}

function RefRow({ row, onSave }) {
  const [draft, setDraft] = useState(row);
  useEffect(() => setDraft(row), [row.id, row.updated_at]);
  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  return (
    <div className="iv-ref">
      <div className="iv-grid">
        <label className="field">
          Type
          <select value={draft.ref_type ?? ''} onChange={(e) => set('ref_type', e.target.value)}>
            <option value="">—</option>
            {REFERENCE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="field">Name
          <input value={draft.person_name ?? ''} onChange={(e) => set('person_name', e.target.value)} /></label>
        <label className="field">Company
          <input value={draft.organisation ?? ''} onChange={(e) => set('organisation', e.target.value)} /></label>
        <label className="field">Designation
          <input value={draft.designation ?? ''} onChange={(e) => set('designation', e.target.value)} /></label>
        <label className="field">Contact number
          <input value={draft.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></label>
        <label className="field">Relationship
          <input value={draft.relationship ?? ''} onChange={(e) => set('relationship', e.target.value)} /></label>
        <label className="field wide">Remarks
          <input value={draft.remarks ?? ''} onChange={(e) => set('remarks', e.target.value)} /></label>
        <label className="field">
          Verification
          <select value={draft.verification ?? ''} onChange={(e) => set('verification', e.target.value)}>
            <option value="">Not started</option>
            {VERIFICATION.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label className="field">Verified by
          <input value={draft.verified_by ?? ''} onChange={(e) => set('verified_by', e.target.value)} /></label>
        <label className="field">Verified on
          <input type="date" value={draft.verified_on ?? ''} onChange={(e) => set('verified_on', e.target.value)} /></label>
      </div>
      <button onClick={() => onSave(draft)} disabled={!String(draft.person_name || '').trim()}>
        {draft.id ? 'Save reference' : 'Add reference'}
      </button>
    </div>
  );
}

/* ---------------- the evaluation ---------------- */

export function EvaluationPanel({ interviewId, abilities = [], onClose, onSaved, onError, onToast }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ ratings: {}, rating_remarks: {} });
  const [open, setOpen] = useState('ratings');
  const [busy, setBusy] = useState(false);
  const [remarks, setRemarks] = useState('');
  const [head, setHead] = useState('');

  const load = async () => {
    try {
      const got = await api.get(`/hiring/interviews/${interviewId}/evaluation`);
      setData(got);
      setForm({
        ratings: got.evaluation?.ratings || {},
        rating_remarks: got.evaluation?.rating_remarks || {},
        // Defaults to whoever the interview was booked against, because that
        // is usually right - but it is typed and it is required.
        evaluated_by: got.evaluation?.evaluated_by || got.interview?.interviewer || '',
        ...Object.fromEntries(
          ['practical_level', 'understands_role', 'software_knowledge', 'can_handle_work',
            'practical_test_required', 'practical_test_remarks', 'strengths', 'weaknesses',
            'positive_observations', 'negative_observations', 'skill_gap', 'training_required',
            'training_remarks', 'recommended_salary', 'negotiable', 'suitable_for_role',
            'suitable_for_other', 'alternative_position', 'recommendation', 'overall_remarks',
            'recommendation_reason', 'additional_comments', 'next_action', 'next_round',
            'next_interviewer', 'next_interview_date',
          ].map((k) => [k, got.evaluation?.[k] ?? ''])
        ),
      });
    } catch (err) {
      onError(err);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interviewId]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const rate = (key, value) =>
    setForm((f) => ({
      ...f,
      // Clicking the rating you already gave clears it: "I did not assess
      // this" has to be reachable after a mis-click, or the only way back is
      // an opinion nobody holds.
      ratings: { ...f.ratings, [key]: f.ratings[key] === value ? undefined : value },
    }));

  const save = async (submit) => {
    setBusy(true);
    try {
      await api.put(
        `/hiring/interviews/${interviewId}/evaluation${submit ? '?submit=true' : ''}`,
        form
      );
      onToast(submit ? 'Evaluation submitted' : 'Saved');
      await load();
      onSaved?.();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  const review = async (to, head_name) => {
    setBusy(true);
    try {
      await api.post(`/hiring/evaluations/${data.evaluation.id}/review`, {
        to,
        remarks,
        head_name,
      });
      onToast('Recorded');
      setRemarks('');
      setHead('');
      await load();
      onSaved?.();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  if (!data) return null;
  const live = summarise(form.ratings || {});
  const problems = checkEvaluation(form, { submitting: true });
  const status = data.evaluation?.status || 'draft';
  const decided = ['approved', 'rejected'].includes(status);
  const moves = data.evaluation ? movesFrom(status, abilities) : [];
  const action = NEXT_ACTIONS.find((a) => a.key === form.next_action);

  return (
    <div className="backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel wide interview-form">
        <header>
          <div>
            <h1>Interviewer’s evaluation</h1>
            <p className="muted small">{statusMeta(status)?.label} — {statusMeta(status)?.hint}</p>
          </div>
          <div className="row">
            <button onClick={() => grab(`/api/hiring/interviews/${interviewId}/evaluation/print`)}>
              Print / PDF
            </button>
            <button className="close" onClick={onClose}>Close</button>
          </div>
        </header>

        <Who context={data} />

        {/*
          * Who did this interview, typed and required.
          *
          * Not taken from the login: this office signs in as one or two people
          * and the person in the room is often neither of them, so the login
          * name would put Dinesh's name on Priya's judgement.
          */}
        <label className="field iv-evaluator">
          Evaluated by *
          <input
            value={form.evaluated_by ?? ''}
            placeholder="Who did this interview?"
            disabled={decided}
            onChange={(e) => set('evaluated_by', e.target.value)}
          />
        </label>

        <Section
          title="Interview evaluation"
          hint="Rate only what you actually assessed — the score counts what you rated, not all ten"
          open={open === 'ratings'}
          onToggle={() => setOpen(open === 'ratings' ? '' : 'ratings')}
          done={live.rated ? `${live.rated} of ${live.of}` : null}
        >
          <table className="sheet hiring-table iv-rate">
            <thead>
              <tr>
                <th className="grow">Parameter</th>
                {RATINGS.map((r) => <th key={r.value} title={r.label}>{r.value}</th>)}
                <th className="grow">Remarks</th>
              </tr>
            </thead>
            <tbody>
              {PARAMETERS.map((p) => (
                <tr key={p.key}>
                  <td>{p.label}</td>
                  {RATINGS.map((r) => (
                    <td key={r.value} className="num">
                      <button
                        className={Number(form.ratings?.[p.key]) === r.value ? 'dot on' : 'dot'}
                        title={r.label}
                        disabled={decided}
                        onClick={() => rate(p.key, r.value)}
                      />
                    </td>
                  ))}
                  <td>
                    <input
                      value={form.rating_remarks?.[p.key] ?? ''}
                      disabled={decided}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          rating_remarks: { ...f.rating_remarks, [p.key]: e.target.value },
                        }))
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/*
            * The totals, stated beside the recommendation and never instead of
            * it. Dinesh: "Do not use the score alone to make the selection
            * decision. The final recommendation must remain a human decision."
            */}
          <div className="iv-summary">
            {live.total === null ? (
              <span className="muted small">Nothing rated yet.</span>
            ) : (
              <>
                <span><strong>{live.total}</strong> of {live.out_of}</span>
                <span>average <strong>{live.average}</strong></span>
                {live.strongest.length ? <span>strongest: {live.strongest.join(', ')}</span> : null}
                {live.weakest.length ? <span>needs work: {live.weakest.join(', ')}</span> : null}
                <span className="muted small">
                  {live.rated} of {live.of} rated — the score is a note, not the decision
                </span>
              </>
            )}
          </div>
        </Section>

        <Section title="Practical knowledge" open={open === 'practical'}
          onToggle={() => setOpen(open === 'practical' ? '' : 'practical')}>
          <div className="iv-grid">
            <Pick label="Practical knowledge" options={PRACTICAL} value={form.practical_level} onChange={(v) => set('practical_level', v)} />
            <Text label="Understanding of job responsibilities" value={form.understands_role} onChange={(v) => set('understands_role', v)} long />
            <Text label="Relevant software knowledge" value={form.software_knowledge} onChange={(v) => set('software_knowledge', v)} long />
            <Text label="Ability to handle assigned work" value={form.can_handle_work} onChange={(v) => set('can_handle_work', v)} long />
            <Pick label="Practical test required" options={YES_NO} value={form.practical_test_required} onChange={(v) => set('practical_test_required', v)} />
            <Text label="Practical test remarks" value={form.practical_test_remarks} onChange={(v) => set('practical_test_remarks', v)} long />
          </div>
        </Section>

        <Section title="Interviewer’s inspection" open={open === 'inspection'}
          onToggle={() => setOpen(open === 'inspection' ? '' : 'inspection')}>
          <div className="iv-grid">
            <Text label="Key strengths" value={form.strengths} onChange={(v) => set('strengths', v)} long />
            <Text label="Weaknesses / areas of concern" value={form.weaknesses} onChange={(v) => set('weaknesses', v)} long />
            <Text label="Positive observations" value={form.positive_observations} onChange={(v) => set('positive_observations', v)} long />
            <Text label="Negative observations" value={form.negative_observations} onChange={(v) => set('negative_observations', v)} long />
            <Text label="Skill gap identified" value={form.skill_gap} onChange={(v) => set('skill_gap', v)} long />
            <Pick label="Training required" options={YES_NO} value={form.training_required} onChange={(v) => set('training_required', v)} />
            <Text label="Training requirements" value={form.training_remarks} onChange={(v) => set('training_remarks', v)} long />
          </div>
        </Section>

        <Section title="Salary and role suitability" open={open === 'suitability'}
          onToggle={() => setOpen(open === 'suitability' ? '' : 'suitability')}>
          <p className="muted small">
            They asked for {data.candidate?.expected_salary || '—'}.
          </p>
          <div className="iv-grid">
            <Text label="Recommended salary" value={form.recommended_salary} onChange={(v) => set('recommended_salary', v)} type="number" />
            <Pick label="Salary negotiable" options={YES_NO} value={form.negotiable} onChange={(v) => set('negotiable', v)} />
            <Pick label="Suitable for the applied position" options={YES_NO} value={form.suitable_for_role} onChange={(v) => set('suitable_for_role', v)} />
            <Pick label="Suitable for another position" options={YES_NO} value={form.suitable_for_other} onChange={(v) => set('suitable_for_other', v)} />
            <Text label="Suggested alternative position" value={form.alternative_position} onChange={(v) => set('alternative_position', v)} />
          </div>
        </Section>

        <section className="iv-section open">
          <div className="iv-head static"><span className="iv-title">Recommendation and next action</span></div>
          <div className="iv-body">
            {/*
              * TWO QUESTIONS, and they get a label each.
              *
              * They used to be two unlabelled rows of chips under one heading.
              * Dinesh picked a recommendation, reasonably believed he had
              * answered the section, and then could not work out why Submit
              * was dead - the missing answer was the row below, which looked
              * like more of the same question.
              */}
            <p className="ask">What do you recommend?</p>
            <div className="iv-decisions">
              {RECOMMENDATIONS.map((r) => (
                <button key={r.key} disabled={decided}
                  className={form.recommendation === r.key ? 'chip active' : 'chip'}
                  onClick={() => set('recommendation', r.key)}>{r.label}</button>
              ))}
            </div>
            <p className="ask">
              And what should happen next?
              {!form.next_action && !decided ? <span className="still"> still to answer</span> : null}
            </p>
            <div className="iv-decisions">
              {NEXT_ACTIONS.map((a) => (
                <button key={a.key} disabled={decided}
                  className={form.next_action === a.key ? 'chip active' : 'chip'}
                  onClick={() => set('next_action', a.key)}>{a.label}</button>
              ))}
            </div>
            <p className="muted small">
              A recommendation is not a selection — submitting this sends the paperwork on and
              moves the candidate nowhere.
            </p>
            <div className="iv-grid">
              <Text label="Overall interview remarks" value={form.overall_remarks} onChange={(v) => set('overall_remarks', v)} long />
              <Text label="Reason for the recommendation" value={form.recommendation_reason} onChange={(v) => set('recommendation_reason', v)} long />
              <Text label="Additional comments" value={form.additional_comments} onChange={(v) => set('additional_comments', v)} long />
              {action?.needs?.includes('next_round') ? (
                <>
                  <Text label="Next round" value={form.next_round} onChange={(v) => set('next_round', v)} />
                  <Text label="Suggested interviewer" value={form.next_interviewer} onChange={(v) => set('next_interviewer', v)} />
                  <Text label="Suggested date" value={form.next_interview_date} onChange={(v) => set('next_interview_date', v)} type="date" />
                </>
              ) : null}
            </div>
          </div>
        </section>

        {/* The review workflow, with only the steps this login may actually take. */}
        {data.evaluation && status !== 'draft' ? (
          <section className="iv-section open">
            <div className="iv-head static"><span className="iv-title">Review</span></div>
            <div className="iv-body">
              <p className="muted small">
                {data.evaluation.evaluated_by ? `Submitted by ${data.evaluation.evaluated_by}. ` : ''}
                {data.evaluation.reviewed_by ? `Reviewed by ${data.evaluation.reviewed_by}. ` : ''}
                {data.evaluation.approved_by
                  ? `${status === 'approved' ? 'Approved' : 'Rejected'} by ${data.evaluation.approved_by}.`
                  : ''}
              </p>
              {moves.length ? (
                <>
                  <label className="field wide">
                    Remarks
                    <input value={remarks} onChange={(e) => setRemarks(e.target.value)} />
                  </label>
                  {/*
                    * The department head is a STEP, not a login.
                    *
                    * 115 people do not have accounts and auth was to be left
                    * alone, so the head's name is typed exactly as the
                    * evaluator's is. The app records who it went to; it does
                    * not police who clicks. Said here rather than implied,
                    * because a lock with no door behind it is worse than an
                    * honest note.
                    */}
                  {moves.some((m) => m.asks === 'head') ? (
                    <label className="field wide">
                      Department head
                      <input
                        value={head}
                        placeholder="Who is it going to?"
                        onChange={(e) => setHead(e.target.value)}
                      />
                      <span className="hint">
                        Typed, not a login — this records who it went to.
                      </span>
                    </label>
                  ) : null}
                  {status === 'pending_head' && data.evaluation?.head_name ? (
                    <p className="muted small">
                      With <strong>{data.evaluation.head_name}</strong>
                      {data.evaluation.reviewed_at
                        ? ` since ${String(data.evaluation.reviewed_at).slice(0, 10)}`
                        : ''}
                      .
                    </p>
                  ) : null}
                  <div className="iv-decisions">
                    {moves.map((m) => (
                      <button key={m.to} className={m.to === 'approved' ? 'primary' : ''}
                        disabled={busy || (m.asks === 'head' && !head.trim())}
                        title={m.asks === 'head' && !head.trim() ? 'Name the department head first' : undefined}
                        onClick={() => review(m.to, head.trim())}>{m.label}</button>
                    ))}
                  </div>
                </>
              ) : (
                <p className="muted small">
                  {decided
                    ? 'This evaluation has been decided.'
                    : 'Nothing for this login to do here — approving is an Admin’s.'}
                </p>
              )}
            </div>
          </section>
        ) : null}

        <footer className="iv-actions">
          {/*
            * This was a grey caption beside the button and read as a note
            * rather than the reason the button would not work. It now says
            * what it is waiting on, and lists EVERYTHING - a queue revealed
            * one sentence at a time is a button that stays dead three times.
            */}
          {problems.length && !decided ? (
            <span className="blocking small">
              Can’t submit yet — {problems.join(' ')}
            </span>
          ) : null}
          <span className="spacer" />
          <button disabled={busy || decided} onClick={() => save(false)}>Save draft</button>
          <button className="primary" disabled={busy || decided || problems.length}
            onClick={() => save(true)}>
            {status === 'draft' ? 'Submit evaluation' : 'Save changes'}
          </button>
        </footer>
      </div>
    </div>
  );
}

const Text = ({ label, value, onChange, long, type }) => (
  <label className={long ? 'field wide' : 'field'}>
    {label}
    {long ? (
      <textarea rows={2} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
    ) : (
      <input type={type || 'text'} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
    )}
  </label>
);

const Pick = ({ label, options, value, onChange }) => (
  <label className="field">
    {label}
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  </label>
);
