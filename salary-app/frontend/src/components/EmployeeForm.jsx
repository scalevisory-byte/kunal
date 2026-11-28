import { useEffect, useMemo, useRef, useState } from 'react';
import { needsTidying, tidyName } from '../../../shared/properName.js';
import { api } from '../api.js';
import {
  SECTIONS,
  STARRED,
  completeness,
  fieldApplies,
  formMissing,
  missingRequired,
} from '../../../shared/employeeMaster.js';
import { employeeCodeProblem, tidyEmployeeCode } from '../../../shared/employeeCode.js';
import { rupees } from '../format.js';
import { todayIso } from '../../../shared/today.js';

/**
 * ADDING SOMEBODY, PROPERLY.
 *
 * Dinesh's brief: a *"complete, professional New Employee form with 8
 * sections"*. What it replaces was six boxes - company, name, salary, PF,
 * ESI, how they are paid - and then eighty per cent of a person's record was
 * typed into the drawer afterwards, if anybody remembered. The PF return
 * does not file for want of a UAN, and the transfer fails for want of an
 * IFSC, and neither is discovered until month end.
 *
 * ---------------------------------------------------------------------------
 * THE SHAPE IS NOT IN THIS FILE. `shared/employeeMaster.js` holds the eight
 * sections, which field belongs to which, what is starred and what counts
 * towards completeness. A form whose fields live in its own JSX cannot answer
 * "what is still missing", and the answer drifts the first time one is added.
 * ---------------------------------------------------------------------------
 *
 * Three rules it follows, each the opposite of what a form like this usually
 * does:
 *
 *   IT SAVES WHAT IT HAS. Only a name and a company are refused, because
 *       every other door into this table - the staff spreadsheet, the hiring
 *       handover, the bulk add - wants no more than that, and a rule
 *       enforced on one door of several is a surprise rather than a rule.
 *
 *   IT WARNS ABOUT A DUPLICATE, IT DOES NOT REFUSE ONE. Two brothers at one
 *       company share a surname and a village. The single exception is an
 *       exact employee code, which is a clash: two people with one code
 *       means the punch import, the bank file and the muster roll each pick
 *       whichever they find first.
 *
 *   A DRAFT IS REALLY A DRAFT. It is kept off every payroll month until it
 *       is saved properly, so a form started mid-shift cannot produce a
 *       payslip for somebody who has not started.
 */

const money = (v) => (v === '' || v === null || v === undefined ? '' : String(v));

export default function EmployeeForm({
  companies = [],
  employees = [],
  companyId = '',
  maySeePay = true,
  onCreate,
  onClose,
}) {
  const [form, setForm] = useState(() => ({
    company_id: companyId || '',
    payment_mode: 'Bank',
    nationality: 'Indian',
    perm_same: true,
    joined_on: todayIso(),
  }));
  const [tab, setTab] = useState(SECTIONS[0].key);
  const [branches, setBranches] = useState([]);
  const [duplicates, setDuplicates] = useState([]);
  const [codeTouched, setCodeTouched] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [problems, setProblems] = useState({});
  const dupTimer = useRef(null);

  const set = (field, value) => setForm((f) => ({ ...f, [field]: value }));

  /* The company's branches. No branches at all is the normal case, and a
     failure here must never stop somebody being added. */
  useEffect(() => {
    if (!form.company_id) return setBranches([]);
    api
      .get(`/companies/branches?company_id=${form.company_id}`)
      .then(({ branches: list }) => setBranches(list || []))
      .catch(() => setBranches([]));
  }, [form.company_id]);

  /*
   * THE CODE IS SUGGESTED, NOT RESERVED.
   *
   * Read when the company is chosen, so two people with the form open do not
   * burn two numbers between them and leave a hole in the series. If both
   * save, the second is refused as a clash and asks again - which is the
   * right way round: a gap is a question nobody can answer a year later.
   *
   * Touched by hand and it is left alone for good. This office already has
   * codes on its punch machine.
   */
  useEffect(() => {
    if (!form.company_id || codeTouched) return;
    api
      .get(`/employees/next-code?company_id=${form.company_id}`)
      .then(({ code }) => setForm((f) => ({ ...f, code })))
      .catch(() => {});
  }, [form.company_id, codeTouched]);

  /* Asked as it is typed, on the fields that identify somebody. */
  useEffect(() => {
    clearTimeout(dupTimer.current);
    const want = {
      name: form.name,
      phone: form.phone,
      pan: form.pan,
      aadhaar: form.aadhaar,
      uan: form.uan,
      code: form.code,
      dob: form.dob,
      bank_account: form.bank_account,
    };
    if (!want.name && !want.phone && !want.pan) return setDuplicates([]);
    dupTimer.current = setTimeout(() => {
      api
        .post('/employees/check-duplicate', want)
        .then(({ duplicates: found }) => setDuplicates(found || []))
        .catch(() => setDuplicates([]));
    }, 450);
    return () => clearTimeout(dupTimer.current);
  }, [form.name, form.phone, form.pan, form.aadhaar, form.uan, form.code, form.dob, form.bank_account]);

  const done = useMemo(() => completeness(form), [form]);
  const clash = duplicates.find((d) => d.blocking);

  const save = async (asDraft) => {
    setError('');
    const missing = missingRequired(form);
    if (missing.length) {
      setError(`${missing.join(' and ')} — that much is needed even for a draft.`);
      setTab(missing.includes('Company') ? 'employment' : 'basic');
      return;
    }
    // The joining form's own demands, on a full save only: a draft is a form
    // somebody has not finished, which is what a draft is for.
    const asked = asDraft ? [] : formMissing(form);
    if (asked.length) {
      setError(`${asked.join(', ')} — needed before the employee is saved. Save draft keeps what you have.`);
      setTab('basic');
      return;
    }
    if (clash && !asDraft) {
      setError(`${clash.code} is already ${clash.name}'s code. Change it before saving.`);
      setTab('employment');
      return;
    }
    setBusy(asDraft ? 'draft' : 'save');
    try {
      const made = await onCreate({
        ...form,
        is_draft: asDraft ? 1 : 0,
        company_id: Number(form.company_id),
        branch_id: Number(form.branch_id) || null,
        reports_to_id: Number(form.reports_to_id) || null,
        hod_id: Number(form.hod_id) || null,
        perm_same: form.perm_same ? 1 : 0,
        monthly_salary: Number(form.monthly_salary) || 0,
        pf: Number(form.pf) || 0,
        esi: Number(form.esi) || 0,
        basic: Number(form.basic) || 0,
        hra: Number(form.hra) || 0,
        conveyance: Number(form.conveyance) || 0,
        medical: Number(form.medical) || 0,
        cl_quota: Number(form.cl_quota) || 0,
        sl_quota: Number(form.sl_quota) || 0,
        pl_quota: Number(form.pl_quota) || 0,
      });
      onClose?.(made, asDraft);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const section = SECTIONS.find((s) => s.key === tab) || SECTIONS[0];
  /* The salary tab is hidden entirely from a login that may not see pay -
     the server strips the figures anyway, and a row of empty money boxes
     reads as a fault rather than as a permission. */
  const tabs = SECTIONS.filter((s) => !s.pay || maySeePay);

  return (
    <div className="ef-wrap">
      <header className="ef-head">
        <div>
          <h2>Add employee</h2>
          <p className="muted small">
            {form.name || 'A new joiner'}
            {form.code ? ` · ${form.code}` : ''} · {done.percent}% of the form filled in
          </p>
        </div>
        <span className="grow" />
        <button className="ghost" onClick={() => onClose?.(null)}>Close</button>
      </header>

      <div className="ef-tabs" role="tablist">
        {tabs.map((s, i) => {
          const d = done.sections[s.key];
          return (
            <button
              key={s.key}
              role="tab"
              aria-selected={tab === s.key}
              className={tab === s.key ? 'on' : undefined}
              onClick={() => setTab(s.key)}
            >
              <span className="ef-no">{i + 1}</span>
              {s.title}
              {d && d.want ? <span className="ef-pc">{d.percent}%</span> : null}
            </button>
          );
        })}
      </div>

      {/*
        * THE DUPLICATE BAND, above the form and not inside a tab: somebody
        * about to add a person who is already on the list needs to know
        * before they have typed the rest of it.
        */}
      {duplicates.length ? (
        <div className={`ef-dup${clash ? ' bad' : ''}`}>
          <strong>
            {clash
              ? 'That employee code is already in use.'
              : `Already on the list — ${duplicates.length === 1 ? 'one person looks' : `${duplicates.length} people look`} like this.`}
          </strong>
          <ul className="plain-list">
            {duplicates.slice(0, 4).map((d) => (
              <li key={d.id}>
                <strong>{d.name}</strong>
                {d.code ? <span className="muted"> · {d.code}</span> : null}
                {d.company_name ? <span className="muted"> · {d.company_name}</span> : null}
                {d.active === 0 ? <span className="muted"> · left</span> : null}
                <span> — {d.why.join(', ')}</span>
              </li>
            ))}
          </ul>
          {!clash ? (
            <p className="muted small">
              This is a warning, not a refusal. Two brothers at one company really do share a
              surname — add them if they are different people.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="ef-body">
        <p className="muted small ef-why">{section.why}</p>

        {section.key === 'documents' ? (
          <div className="ef-note">
            <p>
              <strong>Documents go on the record, not on this form.</strong> A file has to hang
              on somebody, and nobody exists until this is saved — so their record opens the
              moment you press <strong>Save employee</strong>, with the upload boxes waiting:
              photograph, PAN card, Aadhaar, cancelled cheque, education certificates.
            </p>
            <p className="muted small">
              Four of them count as KYC, and the record says which are still missing and flags
              anything past its expiry date.
            </p>
          </div>
        ) : (
          /*
           * Fields that share a `group` are drawn in a box of their own - each
           * parent, each address - and the rest in the plain grid. A mirrored
           * field (the permanent address while "same" is ticked) is still
           * drawn, greyed, carrying the present address: a box that vanishes
           * reads as a form without it.
           */
          groupsOf(
            section.fields
              .map(([field, label, kind, opts = {}]) => ({ ...opts, field, label, kind }))
              .filter((f) => fieldApplies(f, form) || f.mirror)
          ).map(({ group, fields }) => {
            const boxes = fields.map((f) => {
              const mirrored = Boolean(f.mirror && form.perm_same);
              return (
                <Field
                  key={f.field}
                  f={f}
                  value={mirrored ? form[f.mirror] : form[f.field]}
                  disabled={mirrored}
                  starred={STARRED.includes(f.field)}
                  problem={problems[f.field]}
                  companies={companies}
                  branches={branches}
                  employees={employees}
                  onChange={(v) => {
                    if (f.field === 'code') {
                      setCodeTouched(true);
                      const tidied = tidyEmployeeCode(v);
                      setProblems((p) => ({ ...p, code: employeeCodeProblem(tidied) }));
                      return set('code', tidied);
                    }
                    set(f.field, v);
                  }}
                />
              );
            });
            return group ? (
              <fieldset className="ef-box" key={group}>
                <legend>{group}</legend>
                <div className="form-grid ef-grid">{boxes}</div>
              </fieldset>
            ) : (
              <div className="form-grid ef-grid" key={`plain-${fields[0].field}`}>{boxes}</div>
            );
          })
        )}

        {/* What this tab is still short of, said once rather than as a red
            box per field - nothing here is refused. */}
        {done.sections[section.key]?.missing?.length ? (
          <p className="muted small">
            Still blank: {done.sections[section.key].missing.join(', ')}.
          </p>
        ) : null}

        {section.key === 'salary' && Number(form.monthly_salary) > 0 ? (
          <p className="muted small">
            The breakup is optional and <strong>changes nothing</strong> about what they are
            paid — it divides the {rupees(Number(form.monthly_salary))} above into lines on the
            payslip. Leave it blank and the payslip shows one figure.
          </p>
        ) : null}
        {section.key === 'access' ? (
          <p className="muted small">
            A login lets them see <strong>their own</strong> payslips, attendance and leave, and
            nothing of anybody else&rsquo;s. The password is shown <strong>once</strong>, on the
            screen that makes it, and they are made to change it the first time they sign in.
          </p>
        ) : null}
      </div>

      {error ? <p className="error ef-error">{error}</p> : null}

      <footer className="ef-foot">
        <button
          className="primary"
          disabled={!!busy}
          onClick={() => save(false)}
          title="Saves the record and opens it so the documents can go on"
        >
          {busy === 'save' ? 'Saving…' : 'Save employee'}
        </button>
        <button
          disabled={!!busy}
          onClick={() => save(true)}
          title="Kept off every payroll until it is saved properly"
        >
          {busy === 'draft' ? 'Saving…' : 'Save draft'}
        </button>
        <span className="grow" />
        <span className="muted small">
          A full save needs a name, a company, both mobiles and the personal email. Save draft needs only a name and a company.
        </span>
      </footer>
    </div>
  );
}

/* ---------------- one box ---------------- */

/** Consecutive fields with one `group` become one box; the rest stay plain. */
function groupsOf(fields) {
  const out = [];
  for (const f of fields) {
    const last = out[out.length - 1];
    if (last && last.group === (f.group || '')) last.fields.push(f);
    else out.push({ group: f.group || '', fields: [f] });
  }
  return out;
}

function Field({ f, value, disabled = false, starred, problem, companies, branches, employees, onChange }) {
  const v = value === undefined || value === null ? '' : value;
  /*
   * THE TEXT AND THE STAR MUST BE ONE ELEMENT.
   *
   * `.form-grid label` is `display: flex; flex-direction: column`, so a bare
   * text node and a sibling <span> become TWO flex items and stack: the star
   * landed on its own line and pushed the input 38px below every other box in
   * the row. Measured, not guessed - labels all at 447, starred inputs at 508
   * against 470 for the rest.
   *
   * On screen that reads as the field being MISSING, because the box sits
   * under the next column's label. Dinesh reported exactly that twice in one
   * message: "date of joining me entry ka option nahi he" and "mobile num
   * kese add karenge" - both fields were there, 38px down.
   */
  const label = (
    <span className="ef-text">
      {f.label}
      {starred ? <span className="ef-star" title="wanted for a complete record"> *</span> : null}
    </span>
  );

  if (f.kind === 'checkbox') {
    return (
      <label className="ef-check">
        <input type="checkbox" checked={!!v} onChange={(e) => onChange(e.target.checked)} />
        <span>{f.label}</span>
        {f.hint ? <span className="muted small"> — {f.hint}</span> : null}
      </label>
    );
  }

  const inner = () => {
    switch (f.kind) {
      case 'company':
        return (
          <select value={v} onChange={(e) => onChange(e.target.value)}>
            <option value="">Select…</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        );
      case 'branch':
        return (
          <select value={v} onChange={(e) => onChange(e.target.value)}>
            <option value="">{branches.length ? 'Not in a branch' : 'No branches set up'}</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        );
      case 'employee':
        return (
          <select value={v} onChange={(e) => onChange(e.target.value)}>
            <option value="">Nobody</option>
            {employees
              .filter((e) => e.active !== 0)
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}{e.designation ? ` — ${e.designation}` : ''}
                </option>
              ))}
          </select>
        );
      case 'select': {
        /* A value already on the record that is not on the list (a religion
           typed before it became a list) is kept as an option, not wiped. */
        const options = f.options || [];
        const all = v && !options.includes(v) ? [...options, v] : options;
        return (
          <select value={v} onChange={(e) => onChange(e.target.value)}>
            {all.map((o) => (
              <option key={o} value={o}>{o === '' ? 'Not said' : o}</option>
            ))}
          </select>
        );
      }
      case 'master':
        /* Typed, with what the office already uses as suggestions - a fixed
           list would mean a new designation needs a developer. */
        return (
          <>
            <input
              list={`ef-${f.master}`}
              value={v}
              onChange={(e) => onChange(e.target.value)}
            />
            <datalist id={`ef-${f.master}`}>
              {[...new Set(employees.map((e) => e[f.master]).filter(Boolean))].sort().map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
          </>
        );
      case 'textarea':
        return <textarea rows={2} value={v} onChange={(e) => onChange(e.target.value)} />;
      case 'money':
      case 'number':
        return (
          <input
            inputMode="decimal"
            value={money(v)}
            onChange={(e) => onChange(e.target.value)}
          />
        );
      case 'weeklyoff':
        return (
          <input
            placeholder="leave empty for the company's own"
            value={v}
            onChange={(e) => onChange(e.target.value)}
          />
        );
      default:
        return (
          <input
            type={f.kind === 'date' ? 'date' : f.kind === 'time' ? 'time' : f.kind === 'tel' ? 'tel' : f.kind === 'email' ? 'email' : 'text'}
            placeholder={f.placeholder || ''}
            value={v}
            disabled={disabled}
            title={disabled ? 'the same as the present address — untick to type a different one' : undefined}
            onChange={(e) => onChange(e.target.value)}
            /* ONE FORMAT FOR A NAME. Dinesh: "Name in single format, case
               letter sab ke sahi karne he". ANSHIKA GUPTA and mahek gotawala
               both become the same shape as they are typed - on leaving the
               box, where the person typing can see it and put it back. A name
               already in mixed case (McDonald, D'Souza) is left alone: nobody
               knows better than whoever typed it. Everybody already on the
               list is put right in one press: Employees -> Tidy names. */
            onBlur={
              f.field === 'name'
                ? (e) => needsTidying(e.target.value) && onChange(tidyName(e.target.value))
                : undefined
            }
          />
        );
    }
  };

  return (
    <label>
      {label}
      {inner()}
      {problem ? <span className="ef-problem">{problem}</span> : null}
      {!problem && f.hint ? <span className="muted small">{f.hint}</span> : null}
    </label>
  );
}
