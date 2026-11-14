import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import {
  ADDRESS_PARTS,
  CANDIDATE_SECTIONS,
  QUESTIONS,
  DECLARATION,
  SECTIONS,
  sameAsCurrent,
} from '../../../../shared/interviewForm.js';

/**
 * The interview form, filled in by the candidate from a link.
 *
 * Dinesh: send the candidate this form to fill in when they come for the
 * interview. Most of it is facts only they know - where they studied, what
 * they earn, why they are leaving - and typing those while somebody sits
 * opposite is a slow way to find out.
 *
 * What is NOT on this page: the decision, the interviewer's notes and the
 * whole evaluation. They are not merely hidden here - the server never puts
 * them in the response, and it strips anything else this page might send
 * against an allow-list. This page is the convenience; that is the fence.
 *
 * No password. The token in their link is the identity, the same way the punch
 * link and the test work.
 */
export default function CandidateInterviewForm({ token }) {
  const [page, setPage] = useState(null);
  const [form, setForm] = useState({});
  const [answers, setAnswers] = useState({});
  const [address, setAddress] = useState({});
  const [languages, setLanguages] = useState([]);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [agreed, setAgreed] = useState(false);

  useEffect(() => {
    api.public
      .get(`/interview-form/${token}`)
      .then((got) => {
        setPage(got);
        setForm(got.form || {});
        setAnswers(got.answers || {});
        setAddress(got.address || {});
        setLanguages(got.languages || []);
      })
      .catch((err) => setError(err.message || 'This link does not work.'));
  }, [token]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setBusy(true);
    try {
      await api.public.post(`/interview-form/${token}`, { ...form, answers, address, languages });
      setSent(true);
      window.scrollTo(0, 0);
    } catch (err) {
      setError(err.message || 'That did not send. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (error && !page) {
    return (
      <div className="sit-page"><div className="sit-card">
        <h1>BOOKNFLY</h1>
        <p className="banner bad">{error}</p>
        <p className="muted small">Please tell our office this link is not opening.</p>
      </div></div>
    );
  }
  if (!page) return <div className="sit-page"><div className="sit-card">Loading…</div></div>;

  if (sent) {
    return (
      <div className="sit-page"><div className="sit-card">
        <h1>BOOKNFLY</h1>
        <h2>Thank you — we have your details.</h2>
        <p className="muted">
          Please bring your PAN card, Aadhaar card, bank passbook and your education certificates
          to the interview. You do not need to do anything else.
        </p>
      </div></div>
    );
  }

  const mine = SECTIONS.filter((s) => CANDIDATE_SECTIONS.includes(s.key));

  return (
    <div className="sit-page">
      <div className="sit-card">
        <header className="sit-head">
          <div>
            <h1>BOOKNFLY</h1>
            <p className="muted small">
              {page.position}{page.company ? ` · ${page.company}` : ''}
              {page.at ? ` · ${String(page.at).replace('T', ' ').slice(0, 16)}` : ''}
            </p>
          </div>
        </header>

        <p>
          Hello {page.name} — please fill this in before your interview. It saves us going through
          it with you on the day.
        </p>
        <p className="muted small">
          Nothing here is compulsory. Leave anything blank that does not apply or that you would
          rather say in person.
        </p>
        {page.submitted ? (
          <p className="sit-note">You have sent this once already. Sending it again replaces it.</p>
        ) : null}

        {mine.map((section) => (
          <div className="sit-q" key={section.key}>
            <p className="sit-qtext"><strong>{section.title}</strong></p>

            {section.questions ? (
              QUESTIONS.map((q, i) => (
                <label className="field wide" key={q.key}>
                  <span>{i + 1}. {q.q}</span>
                  <textarea
                    rows={2}
                    value={answers[q.key] ?? ''}
                    onChange={(e) => setAnswers((a) => ({ ...a, [q.key]: e.target.value }))}
                  />
                </label>
              ))
            ) : section.address ? (
              <>
                <div className="iv-grid">
                  {ADDRESS_PARTS.map((p) => (
                    <label className="field" key={p.key}>
                      {p.label}
                      <input
                        value={address[`current_${p.key}`] ?? ''}
                        onChange={(e) => setAddress((a) => ({ ...a, [`current_${p.key}`]: e.target.value }))}
                      />
                    </label>
                  ))}
                </div>
                <button className="link-like" onClick={() => setAddress((a) => sameAsCurrent(a))}>
                  My permanent address is the same
                </button>
                <div className="iv-grid">
                  {ADDRESS_PARTS.map((p) => (
                    <label className="field" key={p.key}>
                      Permanent · {p.label}
                      <input
                        value={address[`permanent_${p.key}`] ?? ''}
                        onChange={(e) => setAddress((a) => ({ ...a, [`permanent_${p.key}`]: e.target.value }))}
                      />
                    </label>
                  ))}
                </div>
              </>
            ) : section.references ? (
              /*
               * References are collected here as plain text. The office's own
               * form keeps them as proper records against the candidate, with
               * HR's verification on them - which is not a candidate's to fill
               * in, so it is not on this page at all.
               */
              <p className="muted small">
                Please bring two references with you — a previous manager and somebody who knows
                you personally, with their phone numbers.
              </p>
            ) : (
              <div className="iv-grid">
                {(section.fields || []).filter((f) => !f.readOnly && f.key !== 'recommended_salary')
                  .map((field) => (
                    <label className={field.long ? 'field wide' : 'field'} key={field.key}>
                      {field.label}
                      {field.type === 'tags' && field.options ? (
                        <span className="iv-chips">
                          {field.options.map((o) => (
                            <button
                              key={o}
                              type="button"
                              className={languages.includes(o) ? 'chip active' : 'chip'}
                              onClick={() =>
                                setLanguages((l) => (l.includes(o) ? l.filter((x) => x !== o) : [...l, o]))
                              }
                            >
                              {o}
                            </button>
                          ))}
                        </span>
                      ) : field.options ? (
                        /*
                          * Ticked, not opened. Four options or fewer on every
                          * list in this form, and this page is filled in on a
                          * phone - a dropdown there is a menu that covers the
                          * screen.
                          */
                        <span className="iv-chips">
                          {field.options.map((o) => (
                            <button
                              key={o}
                              type="button"
                              className={form[field.key] === o ? 'chip active' : 'chip'}
                              onClick={() => set(field.key, form[field.key] === o ? '' : o)}
                            >
                              {o}
                            </button>
                          ))}
                        </span>
                      ) : field.long ? (
                        <textarea rows={2} value={form[field.key] ?? ''} onChange={(e) => set(field.key, e.target.value)} />
                      ) : (
                        <input
                          type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                          value={form[field.key] ?? ''}
                          onChange={(e) => set(field.key, e.target.value)}
                        />
                      )}
                    </label>
                  ))}
              </div>
            )}
          </div>
        ))}

        {/*
          * The declaration Dinesh asked for - "the line that goes at the
          * bottom". Ticking it is what the Send button waits for, because an
          * unticked declaration is not a declaration.
          */}
        <label className="sit-declare">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span>{DECLARATION}</span>
        </label>

        {error ? <p className="banner bad">{error}</p> : null}
        <footer className="sit-foot">
          <span className="muted small">
            {agreed ? 'You can come back to this link and change it.' : 'Please tick the box above.'}
          </span>
          <button className="primary" disabled={busy || !agreed} onClick={save}>
            {busy ? 'Sending…' : 'Send my details'}
          </button>
        </footer>
      </div>
    </div>
  );
}
