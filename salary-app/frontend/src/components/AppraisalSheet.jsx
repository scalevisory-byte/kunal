import { useEffect, useMemo, useState } from 'react';
import { STANDALONE, api } from '../api.js';
import { col, printReport } from '../printReport.js';
import { saveCsv } from '../saveCsv.js';
import { CRITERIA, appraisalSheet } from '../../../shared/appraisal.js';
import { dayGrace } from '../../../shared/timesheet.js';

/**
 * THE MONTH'S APPRAISAL SHEET.
 *
 * Dinesh: *"auto appraisal list for proper in uniform whole month, discipline,
 * time, attendance, target"*. Four of those five the month already knows -
 * the uniform walk, the warnings on the record, the clock times and the
 * absences. This lays them side by side for everybody, so the person raising
 * an appraisal starts from the record rather than from memory.
 *
 * It raises nothing and rates nobody. And every square is one of THREE things:
 * yes, no, or not known - a floor nobody walked is not a month in proper
 * uniform. The only thing typed here is Target, because nothing in the app
 * measures one.
 */
const SIGN = { true: '✓', false: '✗', null: '—' };

export default function AppraisalSheet({ payroll, onReload, onGo }) {
  const period = payroll?.period;
  const rows = payroll?.rows || [];
  const [warnings, setWarnings] = useState(null);
  const [show, setShow] = useState('all');
  const [busy, setBusy] = useState(null);

  /* Warnings given this month, counted per person. There is no record of
     them in the single-file build, so there Discipline reads "not known" -
     which is the truth, and not the same as a clean month. */
  useEffect(() => {
    if (STANDALONE || !period) return undefined;
    let alive = true;
    const month = `${period.year}-${String(period.month).padStart(2, '0')}`;
    api
      .get('/people/notes?kind=warning&limit=2000')
      .then((got) => {
        if (!alive) return;
        const count = {};
        for (const row of rows) count[row.employee_id] = 0;
        for (const n of got?.notes || []) {
          if (String(n.dated || '').slice(0, 7) === month) count[n.employee_id] = (count[n.employee_id] || 0) + 1;
        }
        setWarnings(count);
      })
      .catch(() => alive && setWarnings(null));
    return () => {
      alive = false;
    };
  }, [period?.id, rows.length]);

  const sheet = useMemo(
    () => appraisalSheet(rows, period || {}, { warnings, grace: dayGrace(period || {}) }),
    [rows, period, warnings]
  );
  if (!period) return null;

  const list = show === 'clear' ? sheet.clear : show === 'so-far' ? sheet.soFar : show === 'not' ? sheet.notClear : sheet.lines;
  const keys = CRITERIA.map(([key]) => key);

  const tick = async (line, value) => {
    if (payroll.period.locked) return;
    setBusy(line.row_id);
    try {
      // The month's own row carries it, so it is this month's answer and
      // December starts with nobody ticked.
      await api.patch(`/periods/${period.id}/rows/${line.row_id}`, { target_met: value });
      await onReload?.();
    } finally {
      setBusy(null);
    }
  };

  const flat = list.map((l) => ({
    Code: l.code,
    Employee: l.name,
    Department: l.department,
    ...Object.fromEntries(CRITERIA.map(([key, label]) => [label, `${SIGN[String(l.marks[key].ok)]} ${l.marks[key].detail}`])),
    Clear: `${l.passed} of ${keys.length}`,
  }));
  const heads = ['Code', 'Employee', 'Department', ...CRITERIA.map(([, label]) => label), 'Clear'];

  return (
    <div>
      <div className="toolbar">
        <div className="chips">
          {[
            ['all', `Everybody (${sheet.lines.length})`],
            ['clear', `Clear on all five (${sheet.clear.length})`],
            ['so-far', `Nothing against them (${sheet.soFar.length})`],
            ['not', `Something against them (${sheet.notClear.length})`],
          ].map(([key, label]) => (
            <button key={key} className={`chip ${show === key ? 'active' : ''}`} onClick={() => setShow(key)}>
              {label}
            </button>
          ))}
        </div>
        <span className="grow" />
        <button
          className="ghost"
          disabled={!list.length}
          onClick={() =>
            printReport({
              title: 'Monthly appraisal sheet',
              subtitle: period.label,
              meta: [
                `${sheet.clear.length} clear on all five · ${sheet.soFar.length} with nothing against them but something not known · ${sheet.notClear.length} with something against them`,
                '✓ yes · ✗ no · — not known. A square that is not known is not a yes.',
              ],
              landscape: true,
              columns: heads.map((h) => col(h, (r) => r[h])),
              rows: flat,
            })
          }
        >
          Print
        </button>
        <button className="ghost" disabled={!list.length} onClick={() => saveCsv(`Appraisal-sheet-${period.label}.csv`, heads.map((h) => [h, h]), flat)}>
          Excel (CSV)
        </button>
      </div>

      <table className="sheet appraisal-sheet">
        <thead>
          <tr>
            <th>Employee</th>
            {CRITERIA.map(([key, label, what]) => (
              <th key={key} title={what}>{label}</th>
            ))}
            <th title="How many of the five are a yes">Clear</th>
            {onGo ? <th /> : null}
          </tr>
        </thead>
        <tbody>
          {list.map((l) => (
            <tr key={l.row_id}>
              <td>
                {l.name}
                <div className="muted small">{[l.code, l.department].filter(Boolean).join(' · ')}</div>
              </td>
              {keys.map((key) => {
                const mark = l.marks[key];
                const cls = mark.ok === true ? 'ap-yes' : mark.ok === false ? 'ap-no' : 'ap-unknown';
                if (key === 'target' && !payroll.period.locked) {
                  /* The one square that is typed. Pressing the chosen one
                     again hands it back to "not said". */
                  return (
                    <td key={key} className={cls}>
                      <button
                        className={`tiny${mark.ok === true ? ' primary' : ''}`}
                        disabled={busy === l.row_id}
                        onClick={() => tick(l, mark.ok === true ? null : 1)}
                      >
                        met
                      </button>{' '}
                      <button
                        className={`tiny${mark.ok === false ? ' danger' : ''}`}
                        disabled={busy === l.row_id}
                        onClick={() => tick(l, mark.ok === false ? null : 0)}
                      >
                        not met
                      </button>
                    </td>
                  );
                }
                return (
                  <td key={key} className={cls}>
                    <b>{SIGN[String(mark.ok)]}</b> <span className="small">{mark.detail}</span>
                  </td>
                );
              })}
              <td className="num strong">{l.passed} of {keys.length}</td>
              {onGo ? (
                <td>
                  <button className="ghost tiny" onClick={() => onGo('people', l.employee_id)}>
                    appraise
                  </button>
                </td>
              ) : null}
            </tr>
          ))}
          {!list.length && (
            <tr><td colSpan={keys.length + 3} className="empty">Nobody in this pile.</td></tr>
          )}
        </tbody>
      </table>
      <p className="muted small">
        Read off the month’s own records: the uniform walk, the warnings on file, the clock times
        against each person’s own shift, and the days of pay lost. <strong>Nothing here raises an
        appraisal or changes anybody’s pay</strong> — it is what to look at before one is raised
        under People → Appraisals. A dash means not known: a floor nobody walked is not a month in
        proper uniform, and somebody who never clocked in was not on time all month.
        {STANDALONE ? ' Warnings are not kept in this copy, so Discipline reads as not known.' : ''}
      </p>
    </div>
  );
}
