import { useEffect, useRef, useState } from 'react';
import { api } from '../../api.js';
import { ONCE_ONLY, SELF_DECLARATION } from '../../../../shared/selfRecord.js';

/**
 * FILLING IN YOUR OWN RECORD.
 *
 * Dinesh: the details it takes to make an employee should be typed by the
 * employee. The office's joining form asks for thirty-six things about a
 * person; this is the same thirty-six, asked of the person themselves.
 *
 * THE SHAPE COMES FROM THE SERVER (`/api/me/profile` → `sections`), which
 * gets it from `shared/selfRecord.js`, which gets it from the master's own
 * `SECTIONS`. There is no list of fields in this file. A form whose fields
 * live in JSX cannot answer "what is still missing", and it drifts from the
 * office's form the first time a field is added to one of them.
 *
 * Saved as each box is left, like the record drawer the office uses. A
 * thirty-six field form behind one Save button is a form that loses an
 * afternoon's typing to a flat battery.
 */

const filled = (v) => v !== undefined && v !== null && String(v).trim() !== '';

const missingAny = (progress, names) => names.some((n) => progress.missing.includes(n));

/** One box, by what kind of field it is. The kinds come from the master. */
function Field({ field, value, locked, waiting, onSave }) {
  const { field: name, label, kind, options, hint, placeholder } = field;
  const common = {
    key: `${name}-${value ?? ''}`,
    defaultValue: value ?? '',
    disabled: locked,
    placeholder: placeholder || '',
  };

  return (
    <label className="vf-field">
      <span className="vf-label">
        {label}
        {locked && <span className="muted small"> · set</span>}
        {/* On their page, NOT on the record yet. A box that shows their own
            value has to say which of the two it is. */}
        {waiting && <span className="pill warning vf-waiting">waiting for HR</span>}
      </span>
      {kind === 'select' ? (
        <select {...common} onChange={(e) => onSave(name, e.target.value)}>
          {(options || ['']).map((o) => (
            <option key={o} value={o}>
              {o || '—'}
            </option>
          ))}
        </select>
      ) : kind === 'textarea' ? (
        <textarea {...common} rows={2} onBlur={(e) => onSave(name, e.target.value)} />
      ) : (
        <input
          {...common}
          type={kind === 'date' ? 'date' : kind === 'tel' ? 'tel' : kind === 'email' ? 'email' : 'text'}
          onBlur={(e) => onSave(name, e.target.value)}
        />
      )}
      {hint && <span className="vf-hint muted small">{hint}</span>}
    </label>
  );
}

export default function MyProfileForm({ onError }) {
  const [data, setData] = useState(null);
  const [said, setSaid] = useState('');
  const [refused, setRefused] = useState(null);
  const timer = useRef(null);

  const load = async () => {
    try {
      setData(await api.get('/me/profile'));
    } catch (err) {
      onError?.(err);
    }
  };

  useEffect(() => {
    load();
    return () => window.clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!data) return <p className="loading">…</p>;

  const { employee, sections, office_set: officeSet, progress, waiting = [], on_record: onRecord = [], turned_down: turnedDown = [] } = data;

  const say = (text) => {
    setSaid(text);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setSaid(''), 2500);
  };

  const save = async (name, value) => {
    if (String(employee[name] ?? '') === String(value ?? '')) return;
    /*
     * ASK BEFORE A NUMBER THEY CANNOT TAKE BACK.
     *
     * Saved on blur, a mistyped UAN commits the moment the box is left and
     * is then the office's to correct — which the rule says plainly, and
     * which is still a nasty surprise at the instant somebody fat-fingers a
     * digit. So the one kind of box that cannot be edited again asks first,
     * with the value read back.
     */
    if (ONCE_ONLY.includes(name) && String(value ?? '').trim()) {
      const label = sections.flatMap((s) => s.fields).find((f) => f.field === name)?.label || name;
      const ok = window.confirm(
        `Send your ${label} as ${value}?\n\nCheck it against the card. Once HR has approved it onto your record only the office can change it.`
      );
      if (!ok) {
        await load();
        return;
      }
    }
    setRefused(null);
    try {
      const next = await api.patch('/me/profile', { [name]: value });
      setData((d) => ({ ...d, ...next }));
      say(next.withdrawn?.length ? 'Taken back.' : 'Sent to HR — it goes onto your record when they approve it.');
    } catch (err) {
      /*
       * A refusal is shown as a sentence, not swallowed. The server answers
       * with WHY — "your PAN is already on your record, ask the office" —
       * and that sentence is the whole of what this screen has to say.
       */
      setRefused(err.message);
      await load();
    }
  };

  return (
    <div className="stack">
      <div className="card">
        <div className="row">
          <h3>Your record</h3>
          <span className="grow" />
          <strong className="val">{progress.percent}% filled in</strong>
        </div>
        {progress.missing.length > 0 ? (
          <p className="muted small">
            The office still needs: <strong>{progress.missing.join(', ')}</strong>.
            {/* Only say what is actually true of THIS record. The line used to
                warn about the bank transfer whether or not the bank lines were
                among the missing, which reads as a fault on a record that has
                them. */}
            {missingAny(progress, ['UAN', 'ESIC number', 'PAN']) &&
              ' Without those numbers the PF, ESI and TDS filings cannot carry your name.'}
            {missingAny(progress, ['Bank', 'Account number', 'IFSC']) &&
              ' A bank transfer needs the bank, the account number and the IFSC — all three.'}
          </p>
        ) : (
          <p className="muted small">
            Everything the office asks for is here. Thank you — keep it right if anything changes.
          </p>
        )}
        {refused && <p className="warn">{refused}</p>}
        {/*
          * WHAT THEY TYPED IS NOT THE RECORD YET. Said at the top, in a
          * sentence, because "I filled in my UAN" is exactly what somebody
          * will tell the office the day the PF return still has no number.
          */}
        {waiting.length > 0 && (
          <p className="banner">
            <strong>
              {waiting.length} thing{waiting.length === 1 ? '' : 's'} you filled in {waiting.length === 1 ? 'is' : 'are'} waiting for HR.
            </strong>{' '}
            They go onto your record when HR approves them. Until then you can still correct them here.
          </p>
        )}
        {turnedDown.length > 0 && (
          <div className="stack-tight">
            {turnedDown.map((t) => (
              <p className="warn small" key={t.field}>
                HR did not accept your {t.label}{t.value ? ` (${t.value})` : ''}: {t.note}
              </p>
            ))}
          </div>
        )}
      </div>

      {sections.map((section) => (
        <div className="card" key={section.key}>
          <h3>{section.title}</h3>
          <p className="muted small">{section.why}</p>
          <div className="vf-grid">
            {section.fields.map((f) => (
              <Field
                key={f.field}
                field={f}
                value={employee[f.field]}
                /* Fill a blank; a number already on the record is the
                   office's to correct, because they can see the card. */
                locked={ONCE_ONLY.includes(f.field) && onRecord.includes(f.field)}
                waiting={waiting.includes(f.field)}
                onSave={save}
              />
            ))}
          </div>
          {section.key === 'statutory' && (
            <p className="muted small">
              Type these exactly as they appear on the card. Once one is on your record it is the
              office&rsquo;s to correct — tell them and they will check it against the document.
            </p>
          )}
        </div>
      ))}

      <div className="card">
        <h3>Held by the office</h3>
        <dl className="pf-facts">
          {officeSet.map(([key, label]) => (
            <div className="pf-fact" key={key}>
              <dt>{label}</dt>
              <dd>{employee[key] || <span className="muted">—</span>}</dd>
            </div>
          ))}
        </dl>
        <p className="muted small">
          What the office decided when you joined. If one of these is wrong, tell them — it is
          corrected on your record, not here.
        </p>
      </div>

      <p className="muted small">
        {said || SELF_DECLARATION} What you fill in goes to HR first; once approved it is saved on your
        record with your name and the date.
      </p>
    </div>
  );
}
