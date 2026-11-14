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
  checkForm,
  DECISIONS,
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
  if (field.options) {
    return (
      <label className="field">
        {field.label}
        <select value={value ?? ''} onChange={(e) => set(e.target.value)}>
          {/* Blank is a real answer: "nobody asked" is not "No". */}
          <option value="">—</option>
          {field.options.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
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
      for (const key of ['decision', 'decision_remarks', 'next_round', 'next_interview_date',
        'next_interviewer', 'rejection_reason']) {
        prefill[key] = got.form?.[key] ?? '';
      }
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
  const problems = checkForm(form, { submitting: true });
  const decision = DECISIONS.find((d) => d.key === form.decision);
  const locked = data.form?.status === 'submitted';

  return (
    <div className="backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel wide interview-form">
        <header>
          <div>
            <h1>Interview form</h1>
            <p className="muted small">
              {locked ? 'Submitted — edits are recorded on the audit trail' : 'Not submitted yet'}
            </p>
          </div>
          <div className="row">
            <button onClick={() => window.print()}>Print</button>
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
                    value={field.key === 'languages' ? undefined : form[field.key]}
                    onChange={set}
                  />
                ))}
              </div>
            )}
          </Section>
        ))}

        {/* The decision is never folded away — it is the point of the form. */}
        <section className="iv-section open">
          <div className="iv-head static"><span className="iv-title">Result and next step</span></div>
          <div className="iv-body">
            <div className="iv-decisions">
              {DECISIONS.map((d) => (
                <button
                  key={d.key}
                  className={form.decision === d.key ? 'chip active' : 'chip'}
                  onClick={() => set('decision', d.key)}
                >
                  {d.label}
                </button>
              ))}
            </div>
            {decision ? <p className="muted small">{decision.hint}</p> : null}
            <div className="iv-grid">
              <label className="field wide">
                Decision remarks
                <textarea rows={2} value={form.decision_remarks ?? ''}
                  onChange={(e) => set('decision_remarks', e.target.value)} />
              </label>
              {form.decision === 'Rejected' ? (
                <label className="field wide">
                  Reason for rejection
                  <textarea rows={2} value={form.rejection_reason ?? ''}
                    onChange={(e) => set('rejection_reason', e.target.value)} />
                </label>
              ) : null}
              {form.decision === 'Next Round' ? (
                <>
                  <label className="field">
                    Next round
                    <input list="iv-rounds" value={form.next_round ?? ''}
                      onChange={(e) => set('next_round', e.target.value)} />
                    <datalist id="iv-rounds">
                      {ROUND_NAMES.map((r) => <option key={r} value={r} />)}
                    </datalist>
                  </label>
                  <label className="field">
                    Next interview date
                    <input type="date" value={form.next_interview_date ?? ''}
                      onChange={(e) => set('next_interview_date', e.target.value)} />
                  </label>
                  <label className="field">
                    Next interviewer
                    <input value={form.next_interviewer ?? ''}
                      onChange={(e) => set('next_interviewer', e.target.value)} />
                  </label>
                </>
              ) : null}
            </div>
          </div>
        </section>

        <footer className="iv-actions">
          {problems.length ? <span className="muted small">{problems[0]}</span> : null}
          <span className="spacer" />
          <button disabled={busy} onClick={() => save(false)}>Save draft</button>
          <button className="primary" disabled={busy || problems.length} onClick={() => save(true)}>
            {locked ? 'Save changes' : 'Submit interview'}
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

  const load = async () => {
    try {
      const got = await api.get(`/hiring/interviews/${interviewId}/evaluation`);
      setData(got);
      setForm({
        ratings: got.evaluation?.ratings || {},
        rating_remarks: got.evaluation?.rating_remarks || {},
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

  const review = async (to) => {
    setBusy(true);
    try {
      await api.post(`/hiring/evaluations/${data.evaluation.id}/review`, { to, remarks });
      onToast('Recorded');
      setRemarks('');
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
            <button onClick={() => window.print()}>Print</button>
            <button className="close" onClick={onClose}>Close</button>
          </div>
        </header>

        <Who context={data} />

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
            <div className="iv-decisions">
              {RECOMMENDATIONS.map((r) => (
                <button key={r.key} disabled={decided}
                  className={form.recommendation === r.key ? 'chip active' : 'chip'}
                  onClick={() => set('recommendation', r.key)}>{r.label}</button>
              ))}
            </div>
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
                  <div className="iv-decisions">
                    {moves.map((m) => (
                      <button key={m.to} className={m.to === 'approved' ? 'primary' : ''}
                        disabled={busy} onClick={() => review(m.to)}>{m.label}</button>
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
          {problems.length && !decided ? <span className="muted small">{problems[0]}</span> : null}
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
