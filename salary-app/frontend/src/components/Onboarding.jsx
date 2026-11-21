import { useEffect, useState } from 'react';
import { api, STANDALONE } from '../api.js';
import { EMPLOYMENT_TYPES } from '../../../shared/employeeMaster.js';
import { STATUSES, isOpen, statusLabel, statusWhy } from '../../../shared/onboardingFlow.js';
import { rupees } from '../format.js';

/**
 * INVITING SOMEBODY TO FILL IN THEIR OWN RECORD, and checking it.
 *
 * Dinesh's brief for onboarding. The office types what it decided - company,
 * job, joining date - hands over a link, and the person fills in the rest.
 * Nothing reaches the payroll until somebody here presses Approve.
 *
 * NOTHING IS SENT. The link is handed over on WhatsApp or on paper by
 * whoever made it; the panel says so rather than letting somebody assume an
 * invitation went out by itself.
 */
const BLANK = {
  name: '', phone: '', email: '', company_id: '', department: '', designation: '',
  employment_type: 'Permanent', joined_on: '', days: 30,
};

export default function Onboarding({ companies = [], employees = [], onReload }) {
  const [list, setList] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [open, setOpen] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(0);

  const load = async () => {
    try {
      const { invitations } = await api.get('/onboarding');
      setList(invitations || []);
    } catch (err) {
      setError(err.message);
      setList([]);
    }
  };
  useEffect(() => { load(); }, []);

  const invite = async () => {
    setBusy(true);
    setError('');
    try {
      const made = await api.post('/onboarding', {
        ...form,
        company_id: Number(form.company_id),
        days: Number(form.days) || 30,
      });
      setForm({ ...BLANK, company_id: form.company_id });
      await load();
      setOpen(made.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (STANDALONE) {
    return (
      <div className="card">
        <h3>Inviting somebody to fill in their own form</h3>
        <p className="muted small">
          This needs the server. The link has to be opened from a browser somewhere else, and
          there is nothing to open in a file on a laptop.
        </p>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="card">
        <h3>Invite somebody</h3>
        <p className="muted small">
          Type what the office decided. They fill in the rest from the link — their own details,
          address, emergency contact, PAN, bank — and you check it before anybody is added.
        </p>
        <div className="form-grid">
          <label>
            Name
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>
            Mobile
            <input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
            <span className="muted small">refused if it is already on the staff list</span>
          </label>
          <label>
            Email
            <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
          <label>
            Company
            <select
              value={form.company_id}
              onChange={(e) => setForm({ ...form, company_id: e.target.value })}
            >
              <option value="">Select…</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>
            Designation
            <input
              list="ob-designations"
              value={form.designation}
              onChange={(e) => setForm({ ...form, designation: e.target.value })}
            />
            <datalist id="ob-designations">
              {[...new Set(employees.map((e) => e.designation).filter(Boolean))].sort().map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </label>
          <label>
            Department
            <input
              value={form.department}
              onChange={(e) => setForm({ ...form, department: e.target.value })}
            />
          </label>
          <label>
            Employment type
            <select
              value={form.employment_type}
              onChange={(e) => setForm({ ...form, employment_type: e.target.value })}
            >
              {EMPLOYMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label>
            Joining date
            <input
              type="date"
              value={form.joined_on}
              onChange={(e) => setForm({ ...form, joined_on: e.target.value })}
            />
          </label>
          <label>
            Link lasts
            <input
              inputMode="numeric"
              value={form.days}
              onChange={(e) => setForm({ ...form, days: e.target.value })}
            />
            <span className="muted small">days</span>
          </label>
        </div>
        <div className="row">
          <button className="primary" disabled={busy || !form.name || !form.company_id} onClick={invite}>
            {busy ? 'Making the link…' : 'Make the link'}
          </button>
          {error ? <span className="error">{error}</span> : null}
        </div>
        <p className="muted small">
          <strong>Nothing is sent.</strong> You get a link to hand over — on WhatsApp, in an
          email, on paper. Anybody who has the link can open the form, so send it to them and
          nobody else.
        </p>
      </div>

      <div className="card">
        <h3>Invitations</h3>
        {list === null ? (
          <p className="muted small">Loading…</p>
        ) : !list.length ? (
          <p className="empty fo-empty">Nobody has been invited yet.</p>
        ) : (
          <table className="sheet">
            <thead>
              <tr>
                <th>Name</th>
                <th>Job</th>
                <th>Joining</th>
                <th>Filled in</th>
                <th>Where it is</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((i) => (
                <tr key={i.id}>
                  <td>
                    <strong>{i.name}</strong>
                    {i.phone ? <div className="muted small">{i.phone}</div> : null}
                  </td>
                  <td className="small">
                    {[i.designation, i.department, i.company_name].filter(Boolean).join(' · ')}
                  </td>
                  <td className="small">{i.joined_on || '—'}</td>
                  <td className="num">{i.progress?.percent ?? 0}%</td>
                  <td className="small">
                    <span className={`chip ${i.status === 'approved' ? 'ok' : i.status === 'submitted' ? 'part' : ''}`}>
                      {statusLabel(i.status)}
                    </span>
                    {i.expires_on && isOpen(i.status) ? (
                      <div className="muted small">link until {i.expires_on}</div>
                    ) : null}
                  </td>
                  <td>
                    <button className="ghost tiny" onClick={() => setOpen(open === i.id ? null : i.id)}>
                      {open === i.id ? 'close' : 'open'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {open ? (
        <Review
          id={open}
          onClose={() => { setOpen(null); load(); onReload?.(); }}
          copied={copied}
          setCopied={setCopied}
        />
      ) : null}
    </div>
  );
}

/* ---------------- one invitation, in full ---------------- */

function Review({ id, onClose, copied, setCopied }) {
  const [data, setData] = useState(null);
  const [remarks, setRemarks] = useState('');
  const [salary, setSalary] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const got = await api.get(`/onboarding/${id}`);
      setData(got);
      if (!code) {
        const next = await api
          .get(`/employees/next-code?company_id=${got.company_id}`)
          .catch(() => null);
        if (next?.code) setCode(next.code);
      }
    } catch (err) {
      setError(err.message);
    }
  };
  useEffect(() => { load(); }, [id]);

  const act = async (what, body) => {
    setBusy(true);
    setError('');
    try {
      await api.post(`/onboarding/${id}/${what}`, body || {});
      if (what === 'approve') return onClose();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <div className="card"><p className="muted small">{error || 'Loading…'}</p></div>;

  const d = data.draft || {};
  const shown = [
    ['Name', d.name], ['Mobile', d.phone], ['Email', d.email],
    ['Born', d.dob], ['Sex', d.gender], ['Blood group', d.blood_group],
    ['Father', d.father_name], ['Mother', d.mother_name], ['Spouse', d.spouse_name],
    ['Address', [d.address_line1, d.address_line2, d.city, d.state, d.pincode].filter(Boolean).join(', ')],
    ['Permanent', d.perm_same ? 'same as above' : [d.perm_line1, d.perm_city, d.perm_state, d.perm_pincode].filter(Boolean).join(', ')],
    ['In an emergency', [d.emergency_name, d.emergency_relation, d.emergency_phone].filter(Boolean).join(' · ')],
    ['PAN', d.pan], ['Aadhaar', d.aadhaar], ['UAN', d.uan], ['ESIC', d.esic_no],
    ['Bank', [d.bank_name, d.bank_account, d.ifsc].filter(Boolean).join(' · ')],
  ].filter(([, v]) => v);

  return (
    <div className="card">
      <div className="row">
        <h3>{data.name}</h3>
        <span className="grow" />
        <span className="chip">{statusLabel(data.status)}</span>
        <button className="ghost" onClick={onClose}>Close</button>
      </div>
      <p className="muted small">{statusWhy(data.status)}</p>

      {isOpen(data.status) ? (
        <div className="row">
          <input className="search" readOnly value={data.link} onFocus={(e) => e.target.select()} />
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(data.link);
                setCopied(id);
                setTimeout(() => setCopied(0), 2000);
              } catch {
                setError('Your browser would not let the app copy. Select the link and copy it.');
              }
            }}
          >
            {copied === id ? 'Copied' : 'Copy the link'}
          </button>
        </div>
      ) : null}
      {!data.link_ready ? (
        <p className="muted small">
          There is no public web address set for this system, so that link only works from
          inside. Set <strong>PUBLIC_URL</strong> and it becomes a link you can send.
        </p>
      ) : null}

      <dl className="pf-facts">
        {shown.map(([k, v]) => (
          <div className="pf-fact" key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {!shown.length ? <p className="empty fo-empty">They have not filled anything in yet.</p> : null}

      {data.status === 'submitted' ? (
        <>
          <div className="form-grid">
            <label>
              Employee code
              <input value={code} onChange={(e) => setCode(e.target.value)} />
            </label>
            <label>
              Monthly salary
              <input
                inputMode="decimal"
                value={salary}
                onChange={(e) => setSalary(e.target.value)}
              />
              <span className="muted small">
                {salary ? rupees(Number(salary)) : 'the office’s to decide — never theirs'}
              </span>
            </label>
            <label className="wide-field">
              Send it back instead, saying what to correct
              <input value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </label>
          </div>
          <div className="row">
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                act('approve', {
                  code,
                  extra: salary ? { monthly_salary: Number(salary) } : {},
                })
              }
            >
              {busy ? 'Adding…' : 'Approve — add to the staff list'}
            </button>
            <button disabled={busy || !remarks.trim()} onClick={() => act('return', { remarks })}>
              Send back for correction
            </button>
            {error ? <span className="error">{error}</span> : null}
          </div>
          <p className="muted small">
            Approving is the only thing here that creates an employee. The salary is typed here
            and never read from what they filled in.
          </p>
        </>
      ) : null}

      {isOpen(data.status) && data.status !== 'submitted' ? (
        <div className="row">
          <button
            className="ghost danger"
            disabled={busy}
            onClick={() => {
              const why = window.prompt('Why is it being withdrawn?');
              if (why === null) return;
              act('cancel', { why });
            }}
          >
            Withdraw the invitation
          </button>
          {error ? <span className="error">{error}</span> : null}
        </div>
      ) : null}

      <h4>What has happened</h4>
      <ul className="plain-list">
        {data.history.map((h) => (
          <li key={h.id} className="small">
            <span className="muted">{h.at}</span> — {statusLabel(h.status)}
            {h.note ? `: ${h.note}` : ''}
            {h.by_whom ? <span className="muted"> ({h.by_whom})</span> : ''}
          </li>
        ))}
      </ul>
    </div>
  );
}

export { STATUSES };
