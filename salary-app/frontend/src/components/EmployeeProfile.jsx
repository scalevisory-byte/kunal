import { useEffect, useState } from 'react';
import { STANDALONE, api } from '../api.js';
import OnboardingChecklist from './OnboardingChecklist.jsx';
import SalaryStructure from './SalaryStructure.jsx';
import Contributions from './Contributions.jsx';
import EmployeeRecord, { Reporting } from './EmployeeRecord.jsx';
import AssetLedger from './people/AssetLedger.jsx';
import EmployeePhoto from './EmployeePhoto.jsx';
import { EMPLOYMENT_TYPES, MASKED } from '../../../shared/employeeMaster.js';
import { RELIGIONS } from '../../../shared/festivals.js';

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
      // A branch is optional. Blank means "not in a branch", which is where
      // everybody starts and is a perfectly normal answer.
      ['branch_id', 'Branch', 'branch', 'leave empty if the company has only one place'],
      ['designation', 'Designation', 'text'],
      ['department', 'Department', 'text'],
      ['employment_type', 'Employment type', 'select', '', ['', ...EMPLOYMENT_TYPES]],
      ['work_location', 'Work location', 'text', 'if they do not sit at the branch address'],
      // The office's own email and mobile for them, apart from their personal ones.
      ['office_email', 'Office email', 'email'],
      ['office_phone', 'Office mobile', 'tel'],
      ['joined_on', 'Joined on', 'date'],
      ['left_on', 'Left on', 'date', 'leave empty while they are still with you'],
      // Only for somebody who does not work the office's usual day. A night
      // shift judged against 09:30 would read as late every single day, and
      // under the late/early concession that would cost them money.
      ['shift_in', 'Shift starts', 'text', "leave empty for the office's usual day"],
      ['shift_out', 'Shift ends', 'text', 'e.g. 06:00 for a night shift'],
    ],
  },
  {
    title: 'Personal',
    fields: [
      ['dob', 'Date of birth', 'date'],
      ['gender', 'Sex', 'select', '', ['', 'Male', 'Female', 'Other']],
      [
        'marital_status',
        'Married',
        'select',
        '',
        ['', 'Single', 'Married', 'Widowed', 'Divorced'],
      ],
      ['blood_group', 'Blood group', 'text', 'e.g. B+'],
      ['nationality', 'Nationality', 'text', 'Indian'],
      ['religion', 'Religion', 'select', 'decides which festivals are a paid holiday', ['', ...RELIGIONS]],
      ['phone', 'Mobile', 'tel'],
      ['phone_alt', 'Second mobile', 'tel', 'a brother, a landline - somewhere else to try'],
      ['email', 'Email', 'email'],
      ['address', 'Address (as typed before)', 'textarea', 'the old single box — still read where the lines below are empty'],
    ],
  },
  {
    /*
     * PRESENT AND PERMANENT, in parts.
     *
     * The old free-text `address` above is KEPT and still read: rewriting
     * eighty-six typed addresses into guessed lines cannot be undone. Fill
     * these in and they win; leave them and nothing changes.
     */
    title: 'Address',
    fields: [
      ['address_line1', 'Address line 1', 'text'],
      ['address_line2', 'Address line 2', 'text'],
      ['city', 'City', 'text'],
      ['state', 'State', 'text'],
      ['pincode', 'PIN code', 'text'],
      ['perm_line1', 'Permanent line 1', 'text', 'leave empty if it is the same'],
      ['perm_line2', 'Permanent line 2', 'text'],
      ['perm_city', 'Permanent city', 'text'],
      ['perm_state', 'Permanent state', 'text'],
      ['perm_pincode', 'Permanent PIN code', 'text'],
    ],
  },
  {
    /*
     * A PF Form 2 asks for the father's or husband's name and an ESIC
     * registration asks for the family, so these are not decoration: they are
     * what the forms want. The mother's name is also what a bank asks for.
     */
    title: 'Family',
    fields: [
      ['father_name', "Father's name", 'text'],
      ['father_phone', "Father's mobile", 'tel'],
      ['father_occupation', "Father's work", 'text'],
      ['father_company', "Father's company / employer", 'text'],
      ['mother_name', "Mother's name", 'text'],
      ['mother_phone', "Mother's mobile", 'tel'],
      ['mother_occupation', "Mother's work", 'text'],
      ['mother_company', "Mother's company / employer", 'text'],
      ['spouse_name', "Spouse's name", 'text', 'leave empty if unmarried'],
    ],
  },
  {
    /*
     * The one set of fields nobody misses until the day somebody needs them.
     * Deliberately three boxes rather than one: a number with no name beside
     * it, found on a day something has gone wrong, is not much use.
     */
    title: 'Emergency contact',
    fields: [
      ['emergency_name', 'Who to call', 'text'],
      ['emergency_phone', 'Their number', 'tel'],
      ['emergency_relation', 'Relation', 'text', 'father, wife, brother…'],
      ['emergency_phone_alt', 'Another number', 'tel', 'somewhere else to try'],
      ['emergency_address', 'Their address', 'textarea'],
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

const JUMPS = [
  ['documents', 'Documents & KYC'],
  ['bank', 'Bank'],
  ['statutory', 'Statutory'],
  ['structure', 'Salary breakup'],
  ['history', 'History'],
];

export default function EmployeeProfile({ employee, companies, employees: allEmployees = [], onPatch, onClose }) {
  const [draft, setDraft] = useState(employee);
  /*
   * What this person is holding, from their own record.
   *
   * Dinesh asked for it from the asset side; this is the other door. Somebody
   * reading a record before an appraisal, a transfer or an exit is exactly
   * who needs to know there is a laptop against them.
   */
  const [assets, setAssets] = useState(false);
  const [saving, setSaving] = useState(false);
  /* Which masked fields this person has chosen to see, this time the drawer
     is open. Closing it hides them again, deliberately. */
  const [shown, setShown] = useState({});
  // Bumped when the photograph changes, so the documents panel re-reads.
  const [recordRefresh, setRecordRefresh] = useState(0);
  const [error, setError] = useState('');
  // Branches of this person's company only - a Surat branch of SCALE is not
  // somewhere a BOOKNFLY employee can be put.
  const [branches, setBranches] = useState([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (STANDALONE || !employee.company_id) return;
      try {
        const { branches: list } = await api.get(`/companies/branches?company_id=${employee.company_id}`);
        if (alive) setBranches(list);
      } catch {
        // No branches is the normal case, and a failure here must not stop
        // the rest of the record saving.
      }
    })();
    return () => {
      alive = false;
    };
  }, [employee.company_id]);

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

  /*
   * PAN, AADHAAR AND THE BANK ACCOUNT ARE HIDDEN UNTIL SOMEBODY ASKS.
   *
   * `\u2022\u2022\u2022\u2022\u2022\u2022234F` is enough to check you are on the right record and
   * not enough to copy down. Pressing "show" reveals it AND writes a line to
   * the audit trail - a name against the moment somebody chose to look.
   *
   * Honest about what this is: the value has already travelled, because the
   * PF return, the ESI return and the staff export all need it and the
   * Employees area is the permission that covers them. This keeps an Aadhaar
   * off a shared screen, out of a screenshot and away from a shoulder. It is
   * not encryption and does not pretend to be.
   */
  const reveal = async (field) => {
    setShown((s) => ({ ...s, [field]: true }));
    try {
      await api.post(`/employees/${employee.id}/viewed`, { field });
    } catch {
      /* Offline, or a build with no server. The value is still shown - the
         trail is the extra, not the gate. */
    }
  };

  const box = ([field, label, kind, hint, options]) => {
    const value = draft[field] ?? '';
    const warning = complain(field, value);
    if (MASKED[field] && value && !shown[field]) {
      return (
        <label key={field}>
          {label}
          <span className="masked-box">
            <span className="masked-value">{MASKED[field](value)}</span>
            <button type="button" className="ghost tiny" onClick={() => reveal(field)}>
              show
            </button>
          </span>
          <span className="muted small">hidden — showing it is recorded</span>
        </label>
      );
    }
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
        ) : kind === 'branch' ? (
          <select
            value={value || ''}
            onChange={(e) => {
              setDraft({ ...draft, [field]: e.target.value });
              commit(field, e.target.value);
            }}
          >
            <option value="">{branches.length ? 'Not in a branch' : 'No branches set up'}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.city && b.city !== b.name ? ` — ${b.city}` : ''}
              </option>
            ))}
          </select>
        ) : kind === 'select' ? (
          <select
            value={value}
            onChange={(e) => {
              setDraft({ ...draft, [field]: e.target.value });
              commit(field, e.target.value);
            }}
          >
            {/* A value on the record that is not on the list is kept, not wiped. */}
            {(value && !options.includes(value) ? [...options, value] : options).map((o) => (
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
          <EmployeePhoto
            employee={employee}
            onChanged={async () => {
              setRecordRefresh((n) => n + 1);
              // Reload the list too, so the face shows beside the name there.
              await onPatch(employee.id, {});
            }}
            onError={(err) => setError(err.message)}
          />
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

        {/*
          * Where everything is, in one row.
          *
          * This drawer is long - the Bank boxes are below six other blocks -
          * and Dinesh asked for bank details to be "added" when they had been
          * there all along, simply out of sight. Same lesson as the asset
          * invoice: a thing you have to scroll to find is a thing that does
          * not exist.
          */}
        <div className="chips jump-row no-print">
          <button className="chip" onClick={() => setAssets(true)}>
            Assets with them
          </button>
          {JUMPS.map(([id, label]) => (
            <button
              key={id}
              className="chip"
              onClick={() =>
                document
                  .getElementById(`sec-${id}`)
                  ?.scrollIntoView({ block: 'start', behavior: 'smooth' })
              }
            >
              {label}
            </button>
          ))}
        </div>

        {assets && (
          <AssetLedger
            employeeId={draft.id}
            name={draft.name}
            onClose={() => setAssets(false)}
            onError={(err) => setError(err.message)}
          />
        )}

        <OnboardingChecklist employee={draft} />

        {/* Works with or without the server - it is a link between two rows. */}
        <Reporting
          employee={draft}
          employees={allEmployees}
          onPatch={async (id, patch) => {
            setDraft({ ...draft, ...patch });
            setSaving(true);
            setError('');
            try {
              await onPatch(id, patch);
            } catch (err) {
              setError(err.message);
            } finally {
              setSaving(false);
            }
          }}
        />

        <EmployeeRecord
          employee={draft}
          employees={allEmployees}
          refresh={recordRefresh}
          onPatch={async (id, patch) => {
            setDraft({ ...draft, ...patch });
            setSaving(true);
            setError('');
            try {
              await onPatch(id, patch);
            } catch (err) {
              setError(err.message);
            } finally {
              setSaving(false);
            }
          }}
          onError={(err) => setError(err.message)}
        />

        <div id="sec-structure">
        <SalaryStructure
          employee={draft}
          onPatch={async (id, patch) => {
            setDraft({ ...draft, ...patch });
            setSaving(true);
            setError('');
            try {
              await onPatch(id, patch);
            } catch (err) {
              setError(err.message);
            } finally {
              setSaving(false);
            }
          }}
        />

        </div>

        <Contributions employee={draft} onPatch={async (id, patch) => {
          setDraft({ ...draft, ...patch });
          setSaving(true);
          setError('');
          try {
            await onPatch(id, patch);
          } catch (err) {
            setError(err.message);
          } finally {
            setSaving(false);
          }
        }} />

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

        {/*
          * A DRAFT, AND THE WAY OUT OF BEING ONE.
          *
          * It is on no payroll month until this is pressed. Said here rather
          * than only as a badge on the list, because this is the screen
          * somebody is on when they finish the form.
          */}
        {draft.is_draft ? (
          <div className="ef-dup">
            <strong>This record is a draft.</strong>
            <p className="muted small">
              It is on <strong>no payroll month</strong> and no attendance grid — nothing is
              counted for them and no payslip can be made. Finish it when the details are in.
            </p>
            <button
              className="primary"
              disabled={saving}
              onClick={async () => {
                setDraft({ ...draft, is_draft: 0 });
                await commit('is_draft', 0);
              }}
            >
              Finish — add them to the payroll
            </button>
          </div>
        ) : null}

        {SECTIONS.map((section) => (
          <section
            key={section.title}
            id={`sec-${section.title.toLowerCase().split(' ')[0]}`}
            className="profile-section"
          >
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
