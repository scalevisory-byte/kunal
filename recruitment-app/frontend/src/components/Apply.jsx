import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

/**
 * Steps 3 and 4, the only page a candidate ever sees.
 *
 * Roomy rather than dense: somebody is filling this in on a phone, once. Name
 * and number are the only required fields, because an application that is too
 * much work is an application that does not arrive - everything else can be
 * asked for later, and a second application from the same number tops up the
 * same record rather than making a new one.
 *
 * It asks for no money, at any point.
 */
export default function Apply({ ref_no }) {
  const [brand, setBrand] = useState(null);
  const [vacancy, setVacancy] = useState(null);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(null);
  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
    location: '',
    education: '',
    experience: '',
    current_company: '',
    current_salary: '',
    expected_salary: '',
    notice_period: '',
    skills: '',
  });
  const file = useRef(null);
  const [test, setTest] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const cfg = await api.public.get('/config');
        setBrand(cfg);
        const { vacancy: v } = await api.public.get(`/vacancies/${encodeURIComponent(ref_no)}`);
        setVacancy(v);
      } catch (err) {
        setError(err.message);
      }
    })();
  }, [ref_no]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSending(true);
    try {
      const chosen = file.current?.files?.[0];
      let result;
      if (chosen) {
        const data = new FormData();
        for (const [k, v] of Object.entries(form)) if (v) data.set(k, v);
        data.set('resume', chosen);
        result = await api.public.upload(`/vacancies/${encodeURIComponent(ref_no)}/apply`, data);
      } else {
        result = await api.public.post(`/vacancies/${encodeURIComponent(ref_no)}/apply`, form);
      }
      setDone(result);
      // The test, if one is set up, is the next thing to put in front of them.
      if (result.upload_token && brand?.test_configured) {
        try {
          setTest(await api.public.get(`/test/${result.upload_token}`));
        } catch {
          setTest(null);
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  if (error && !vacancy) {
    return (
      <div className="public">
        <div className="done">
          <p className="big">This opening is not available</p>
          <p className="muted">{error}</p>
        </div>
      </div>
    );
  }

  if (!vacancy) return <p className="loading">Loading…</p>;

  if (done) {
    return (
      <div className="public">
        <div className="done">
          <p className="big">{done.already_applied ? 'You have already applied' : 'Thank you'}</p>
          <p className="muted">{done.message}</p>
          <p className="note">
            Your reference is {done.candidate_ref}. {done.has_resume ? '' : 'We will ask you for your CV.'}
          </p>

          {!done.has_resume ? (
            <CvLater token={done.upload_token} maxMb={brand?.max_resume_mb} />
          ) : null}

          {test?.url ? (
            <section style={{ textAlign: 'left' }}>
              <h3>One short assessment</h3>
              <p className="note">Do it in one sitting. It does not take long.</p>
              <iframe
                title="Assessment"
                src={test.url}
                style={{ width: '100%', height: '70vh', border: '1px solid var(--line)', borderRadius: '10px' }}
              />
            </section>
          ) : null}

          {brand?.whatsapp ? (
            <p className="note" style={{ marginTop: '1.5rem' }}>
              Questions?{' '}
              <a href={`https://wa.me/${brand.whatsapp}`} target="_blank" rel="noreferrer">
                Message us on WhatsApp
              </a>
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  const facts = [
    ['Company', vacancy.company],
    ['Location', vacancy.location],
    ['Experience', vacancy.experience_band],
    ['Salary', vacancy.salary],
    ['Qualification', vacancy.education],
    ['Type', [vacancy.employment_type, vacancy.work_mode].filter(Boolean).join(' / ')],
    ['Openings', vacancy.positions > 1 ? vacancy.positions : ''],
  ].filter(([, v]) => v);

  return (
    <div className="public">
      <header>
        <span className="brand">{brand?.brand || 'Placement services'}</span>
        <h1>{vacancy.title}</h1>
        <span className="where">
          {[vacancy.company, vacancy.location].filter(Boolean).join(' · ')}
        </span>
      </header>

      <div className="facts">
        {facts.map(([k, v]) => (
          <div key={k}>
            <div className="k">{k}</div>
            <div className="v">{v}</div>
          </div>
        ))}
      </div>

      {vacancy.skills ? (
        <section>
          <h3>Skills</h3>
          <p>{vacancy.skills}</p>
        </section>
      ) : null}
      {vacancy.description ? (
        <section>
          <h3>About the job</h3>
          <p>{vacancy.description}</p>
        </section>
      ) : null}
      {vacancy.responsibilities ? (
        <section>
          <h3>What you will do</h3>
          <p>{vacancy.responsibilities}</p>
        </section>
      ) : null}
      {vacancy.requirements ? (
        <section>
          <h3>What is needed</h3>
          <p>{vacancy.requirements}</p>
        </section>
      ) : null}
      {vacancy.benefits ? (
        <section>
          <h3>What you get</h3>
          <p>{vacancy.benefits}</p>
        </section>
      ) : null}

      <section>
        <h3>Apply</h3>
        <p className="note">
          Only your name and mobile number are needed. There is no fee to apply — we are paid
          by the hiring company, never by you.
        </p>
        {error ? <div className="banner bad">{error}</div> : null}
        <form onSubmit={submit}>
          {[
            ['name', 'Your name', true],
            ['phone', 'Mobile number', true],
            ['email', 'Email', false],
            ['location', 'Where you live', false],
            ['education', 'Qualification', false],
            ['experience', 'Experience', false],
            ['current_company', 'Current company', false],
            ['current_salary', 'Current salary', false],
            ['expected_salary', 'Expected salary', false],
            ['notice_period', 'Notice period', false],
          ].map(([key, label, required]) => (
            <label className="field" key={key}>
              {label}
              {required ? ' *' : ''}
              <input
                value={form[key]}
                required={required}
                inputMode={key === 'phone' ? 'numeric' : undefined}
                autoComplete={key === 'name' ? 'name' : key === 'phone' ? 'tel' : undefined}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              />
            </label>
          ))}
          <label className="field wide">
            Your skills
            <input
              value={form.skills}
              placeholder="Tally, GST, Excel"
              onChange={(e) => setForm({ ...form, skills: e.target.value })}
            />
          </label>
          <label className="field wide">
            Your CV (PDF, Word or a photo — up to {brand?.max_resume_mb || 5} MB)
            <input ref={file} type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" />
          </label>
          <div className="wide">
            <button className="primary" type="submit" disabled={sending}>
              {sending ? 'Sending…' : 'Send my application'}
            </button>
          </div>
        </form>
        <p className="note" style={{ marginTop: '1rem' }}>
          Reference {vacancy.ref_no}. Your details are used only to put you forward for jobs.
        </p>
      </section>
    </div>
  );
}

/** Somebody who applied from a phone with no file to hand. */
function CvLater({ token, maxMb }) {
  const file = useRef(null);
  const [state, setState] = useState('');

  const send = async () => {
    const chosen = file.current?.files?.[0];
    if (!chosen) return;
    setState('sending');
    try {
      const data = new FormData();
      data.set('resume', chosen);
      await api.public.upload(`/resume/${token}`, data);
      setState('done');
    } catch (err) {
      setState(err.message);
    }
  };

  if (state === 'done') return <p className="note">Your CV has been received. Thank you.</p>;

  return (
    <section style={{ textAlign: 'left' }}>
      <h3>Send your CV</h3>
      <p className="note">PDF, Word or a clear photo, up to {maxMb || 5} MB.</p>
      <div className="row">
        <input ref={file} type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" />
        <button onClick={send} disabled={state === 'sending'}>
          {state === 'sending' ? 'Sending…' : 'Upload'}
        </button>
      </div>
      {state && state !== 'sending' ? <p className="note" style={{ color: 'var(--bad)' }}>{state}</p> : null}
    </section>
  );
}
