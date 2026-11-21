import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { SECTIONS, fieldApplies } from '../../../shared/employeeMaster.js';
import {
  DECLARATION,
  EMPLOYEE_SECTIONS,
  THEIRS_TO_FILL,
} from '../../../shared/onboardingFlow.js';

/**
 * FILLING IN YOUR OWN JOINING FORM, before you are an employee.
 *
 * Dinesh's brief: the office invites, the person completes their details and
 * sends them in, the office checks and only then is there an employee.
 *
 * ---------------------------------------------------------------------------
 * NO PASSWORD, BECAUSE THERE IS NOBODY TO BE YET.
 *
 * The token in the link is the identity, exactly as the punch link and the
 * apply link work - and with the same honest limit, said on the page: a link
 * can be forwarded. What it can reach is deliberately tiny: one invitation,
 * read, saved, sent in. Nothing it sends can create an employee.
 *
 * THE FIELDS ARE THE MASTER'S OWN. `shared/employeeMaster.js` defines them
 * once; this form shows the ones that are theirs to fill (THEIRS_TO_FILL)
 * and shows the office's decisions as read-only facts. A second list of
 * fields here would drift from the master the first time one was added.
 * ---------------------------------------------------------------------------
 */
export default function JoinPage({ token }) {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState({});
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [declared, setDeclared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(EMPLOYEE_SECTIONS[0]);
  const timer = useRef(null);

  useEffect(() => {
    api
      .get(`/join/${token}`)
      .then((got) => {
        setData(got);
        setDraft(got.draft || {});
        setDeclared(!!got.declared);
      })
      .catch((err) => setError(err.message));
  }, [token]);

  /* Saved as they type, a beat after they stop - a joining form filled on a
     phone on a bus is not a form anybody presses Save on. */
  const set = (field, value) => {
    const next = { ...draft, [field]: value };
    setDraft(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const got = await api.patch(`/join/${token}`, { [field]: value });
        setData(got);
        setSaved('Saved');
        setTimeout(() => setSaved(''), 1500);
      } catch (err) {
        setError(err.message);
      }
    }, 700);
  };

  const sections = useMemo(
    () =>
      SECTIONS.filter((s) => EMPLOYEE_SECTIONS.includes(s.key)).map((s) => ({
        ...s,
        /*
          * THE SALARY SECTION IS NOT THE SALARY SECTION HERE.
          *
          * `THEIRS_TO_FILL` already leaves the pay out of it, so what is
          * left is the bank details - but the master's own heading says
          * "Salary & bank" and its note says "what they are paid", which on
          * this page reads as a form about to ask somebody their salary.
          */
        ...(s.key === 'salary'
          ? { title: 'Bank details', why: 'Where your salary will be paid. The amount is set by the office.' }
          : {}),
        fields: s.fields
          .map(([field, label, kind, opts = {}]) => ({ ...opts, field, label, kind }))
          .filter((f) => THEIRS_TO_FILL.includes(f.field) && fieldApplies(f, draft)),
      })),
    [draft]
  );

  const send = async () => {
    setBusy(true);
    setError('');
    try {
      clearTimeout(timer.current);
      await api.patch(`/join/${token}`, draft);
      const got = await api.post(`/join/${token}/submit`, { declared });
      setData(got);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (error && !data) {
    return (
      <div className="join-page">
        <div className="card">
          <h2>This link cannot be opened</h2>
          <p className="muted small">{error}</p>
        </div>
      </div>
    );
  }
  if (!data) return <p className="loading">…</p>;

  if (data.status === 'submitted') {
    return (
      <div className="join-page">
        <div className="card">
          <h2>Thank you, {data.name.split(' ')[0]}</h2>
          <p>
            Your details have been sent in. The office will check them and come back to you if
            anything needs correcting.
          </p>
          <p className="muted small">
            Nothing is final until they approve it — you are not on the payroll yet, and nothing
            has been counted for you.
          </p>
        </div>
      </div>
    );
  }

  const section = sections.find((s) => s.key === step) || sections[0];
  const office = data.office || {};

  return (
    <div className="join-page">
      <header className="join-head">
        <div>
          <h1>Welcome, {data.name.split(' ')[0]}</h1>
          <p className="muted small">
            {[office.company_name, office.designation, office.department].filter(Boolean).join(' · ')}
          </p>
        </div>
        <span className="grow" />
        <span className="muted small">{data.progress?.percent ?? 0}% filled in{saved ? ` · ${saved}` : ''}</span>
      </header>

      {data.status === 'returned' && data.remarks ? (
        <div className="ef-dup bad">
          <strong>The office has sent this back.</strong>
          <p>{data.remarks}</p>
          <p className="muted small">Correct it below and send it in again.</p>
        </div>
      ) : null}

      <div className="card">
        <h3>What the office has set</h3>
        <dl className="pf-facts">
          {[
            ['Company', office.company_name],
            ['Branch', office.branch_name],
            ['Department', office.department],
            ['Designation', office.designation],
            ['Type', office.employment_type],
            ['Joining date', office.joined_on],
            ['Reporting to', office.reports_to_name],
          ]
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div className="pf-fact" key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
        </dl>
        <p className="muted small">
          These were set when you were taken on, so they cannot be changed here. If one is wrong,
          tell the office — it is corrected on their side.
        </p>
      </div>

      <div className="ef-tabs" role="tablist">
        {sections.map((s, i) => (
          <button
            key={s.key}
            role="tab"
            aria-selected={step === s.key}
            className={step === s.key ? 'on' : undefined}
            onClick={() => setStep(s.key)}
          >
            <span className="ef-no">{i + 1}</span>
            {s.title}
          </button>
        ))}
      </div>

      <div className="card">
        <p className="muted small ef-why">{section.why}</p>
        <div className="form-grid ef-grid">
          {section.fields.map((f) => (
            <label key={f.field}>
              {f.label}
              {f.kind === 'textarea' ? (
                <textarea
                  rows={2}
                  value={draft[f.field] ?? ''}
                  onChange={(e) => set(f.field, e.target.value)}
                />
              ) : f.kind === 'select' ? (
                <select value={draft[f.field] ?? ''} onChange={(e) => set(f.field, e.target.value)}>
                  {(f.options || []).map((o) => (
                    <option key={o} value={o}>{o === '' ? 'Not said' : o}</option>
                  ))}
                </select>
              ) : f.kind === 'checkbox' ? (
                <input
                  type="checkbox"
                  checked={!!draft[f.field]}
                  onChange={(e) => set(f.field, e.target.checked)}
                />
              ) : (
                <input
                  type={f.kind === 'date' ? 'date' : f.kind === 'tel' ? 'tel' : f.kind === 'email' ? 'email' : 'text'}
                  placeholder={f.placeholder || ''}
                  value={draft[f.field] ?? ''}
                  onChange={(e) => set(f.field, e.target.value)}
                />
              )}
            </label>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>Send it in</h3>
        {data.progress?.missing?.length ? (
          <p className="muted small">Still wanted: {data.progress.missing.join(', ')}.</p>
        ) : (
          <p className="muted small">Everything needed is filled in.</p>
        )}
        <label className="ef-check">
          <input type="checkbox" checked={declared} onChange={(e) => setDeclared(e.target.checked)} />
          <span>{DECLARATION}</span>
        </label>
        <div className="row">
          <button className="primary" disabled={busy || !declared} onClick={send}>
            {busy ? 'Sending…' : 'Send it in'}
          </button>
          {error ? <span className="error">{error}</span> : null}
        </div>
        <p className="muted small">
          Your answers are saved as you type, so you can close this and come back to the same
          link. <strong>Nothing is final until the office approves it.</strong>
        </p>
      </div>

      <p className="muted small join-foot">
        This link is personal to you and expires on {data.expires_on || 'the date the office set'}.
        Anybody who has the link can open this form, so do not pass it on.
      </p>
    </div>
  );
}
