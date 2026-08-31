import { useEffect, useState } from 'react';

/**
 * One employee's full record.
 *
 * The list can only sensibly hold the handful of columns used every day; the
 * rest - identifiers for the PF and ESI returns, bank details for the transfer
 * file, contact details - live here, behind the name.
 *
 * Everything saves on the way out of the box it was typed in, so there is no
 * Save button to forget.
 */

const SECTIONS = [
  {
    title: 'Employment',
    fields: [
      ['code', 'Employee code', 'text', 'the code the attendance machine uses'],
      ['designation', 'Designation', 'text'],
      ['department', 'Department', 'text'],
      ['joined_on', 'Joined on', 'date'],
      ['left_on', 'Left on', 'date', 'leave empty while they are still with you'],
    ],
  },
  {
    title: 'Personal',
    fields: [
      ['dob', 'Date of birth', 'date'],
      ['gender', 'Gender', 'select', '', ['', 'Male', 'Female', 'Other']],
      ['phone', 'Phone', 'tel'],
      ['email', 'Email', 'email'],
      ['address', 'Address', 'textarea'],
    ],
  },
  {
    title: 'Statutory',
    fields: [
      ['pan', 'PAN', 'text', 'ABCDE1234F'],
      ['aadhaar', 'Aadhaar', 'text', '12 digits'],
      ['uan', 'UAN', 'text', 'the PF number that follows them between jobs'],
      ['pf_no', 'PF member ID', 'text'],
      ['esic_no', 'ESIC number', 'text'],
    ],
  },
  {
    title: 'Bank',
    fields: [
      ['bank_name', 'Bank', 'text'],
      ['bank_account', 'Account number', 'text'],
      ['ifsc', 'IFSC', 'text', 'e.g. SBIN0001234'],
    ],
  },
];

/** Light checks - a warning beside the box, never a refusal to save. */
function complain(field, value) {
  const v = String(value || '').trim();
  if (!v) return '';
  if (field === 'pan' && !/^[A-Z]{5}[0-9]{4}[A-Z]$/i.test(v)) return 'a PAN looks like ABCDE1234F';
  if (field === 'aadhaar' && !/^\d{12}$/.test(v.replace(/\s/g, ''))) return 'an Aadhaar is 12 digits';
  if (field === 'ifsc' && !/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(v)) return 'an IFSC looks like SBIN0001234';
  if (field === 'uan' && !/^\d{12}$/.test(v)) return 'a UAN is 12 digits';
  if (field === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return 'that does not look like an email';
  if (field === 'phone' && !/^[+\d][\d\s-]{7,}$/.test(v)) return 'that does not look like a phone number';
  return '';
}

export default function EmployeeProfile({ employee, companies, onPatch, onClose }) {
  const [draft, setDraft] = useState(employee);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => setDraft(employee), [employee]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const commit = async (field, value) => {
    if ((employee[field] ?? '') === value) return;
    setSaving(true);
    setError('');
    try {
      await onPatch(employee.id, { [field]: value });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const box = ([field, label, kind, hint, options]) => {
    const value = draft[field] ?? '';
    const warning = complain(field, value);
    return (
      <label key={field} className={kind === 'textarea' ? 'wide-field' : undefined}>
        {label}
        {kind === 'textarea' ? (
          <textarea
            rows={2}
            value={value}
            onChange={(e) => setDraft({ ...draft, [field]: e.target.value })}
            onBlur={(e) => commit(field, e.target.value)}
          />
        ) : kind === 'select' ? (
          <select
            value={value}
            onChange={(e) => {
              setDraft({ ...draft, [field]: e.target.value });
              commit(field, e.target.value);
            }}
          >
            {options.map((o) => (
              <option key={o} value={o}>{o || '—'}</option>
            ))}
          </select>
        ) : (
          <input
            type={kind === 'date' ? 'date' : 'text'}
            inputMode={kind === 'tel' ? 'tel' : undefined}
            placeholder={kind === 'date' ? undefined : hint}
            value={value}
            onChange={(e) => setDraft({ ...draft, [field]: e.target.value })}
            onBlur={(e) => commit(field, e.target.value)}
          />
        )}
        {warning ? <span className="field-warning">{warning}</span> : hint && kind !== 'date' && kind !== 'text' ? null : null}
      </label>
    );
  };

  return (
    <div className="picker-backdrop" onClick={onClose}>
      <div className="modal profile" onClick={(e) => e.stopPropagation()}>
        <div className="payslip-head">
          <div>
            <h2>{employee.name}</h2>
            <p className="muted small">
              {employee.company_name}
              {employee.designation ? ` · ${employee.designation}` : ''}
              {employee.department ? ` · ${employee.department}` : ''}
            </p>
          </div>
          <div className="no-print">
            {saving && <span className="pill saving">Saving…</span>}
            <button onClick={onClose}>Close</button>
          </div>
        </div>

        {error && <p className="error">{error}</p>}

        <div className="form-grid">
          <label>
            Company
            <select
              value={draft.company_id}
              onChange={(e) => {
                setDraft({ ...draft, company_id: Number(e.target.value) });
                commit('company_id', Number(e.target.value));
              }}
            >
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label>
            Name
            <input
              value={draft.name ?? ''}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              onBlur={(e) => commit('name', e.target.value)}
            />
          </label>
          <label>
            Monthly salary
            <input
              inputMode="decimal"
              value={draft.monthly_salary ?? ''}
              onChange={(e) => setDraft({ ...draft, monthly_salary: e.target.value })}
              onBlur={(e) => commit('monthly_salary', Number(e.target.value) || 0)}
            />
          </label>
        </div>

        {SECTIONS.map((section) => (
          <section key={section.title} className="profile-section">
            <h3>{section.title}</h3>
            <div className="form-grid">{section.fields.map(box)}</div>
          </section>
        ))}

        <p className="muted small">
          Everything saves as you leave each box. The warnings are only warnings — an odd-looking
          PAN or IFSC is still saved, in case yours really does look like that.
        </p>
      </div>
    </div>
  );
}
