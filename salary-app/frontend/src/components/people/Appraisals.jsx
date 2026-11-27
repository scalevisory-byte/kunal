import { useEffect, useState } from 'react';
import { APPRAISAL_KINDS, appraisalKindLabel } from '../../../../shared/appraisal.js';
import { col, num, printReport } from '../../printReport.js';
import { api } from '../../api.js';
import { rupees } from '../../format.js';
import { onStaff } from '../../onStaff.js';
import { todayIso } from '../../../../shared/today.js';

const today = () => todayIso();

/**
 * Appraisals, and the increments that came out of them.
 *
 * The appraisal is a **proposal** until somebody applies it. Filling the form
 * in changes nobody's pay; "Apply the increment" is a separate button that
 * writes the new salary onto the master, which lands in the employee's own
 * change history like any other salary change. Applying twice does not give a
 * second rise, and an applied increment cannot be edited away afterwards -
 * somebody was paid on it.
 */
export default function Appraisals({ employees, onError, onReload, only = null }) {
  const [rows, setRows] = useState([]);
  const [pendingOnly, setPendingOnly] = useState(false);
  const [adding, setAdding] = useState(false);
  /*
   * On one person's file the picker is already answered - there is nobody
   * else on the screen to choose. It is still a picker in the Everyone view.
   */
  const [draft, setDraft] = useState({
    employee_id: only?.id || '',
    cycle: '',
    reviewed_on: today(),
    reviewed_by: '',
    kind: 'increment',
    rating: '',
    to_salary: '',
    effective_from: '',
    summary: '',
  });

  const load = async (pending = pendingOnly) => {
    try {
      const { appraisals } = await api.get(
        `/people/appraisals${pending ? '?pending=true' : ''}${only ? `${pending ? '&' : '?'}employee_id=${only.id}` : ''}`
      );
      setRows(appraisals);
    } catch (err) {
      onError(err);
    }
  };

  useEffect(() => {
    load(pendingOnly);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingOnly]);

  const current = employees.find((e) => String(e.id) === String(draft.employee_id));

  /**
   * THE INCREMENT REGISTER — what was proposed, and what has actually been
   * applied.
   *
   * The distinction is the whole module: an appraisal is a PROPOSAL until
   * it is applied, and until then nobody's salary has moved. The paper
   * carries both the "from" it was measured against and the date it was
   * applied, so a sheet of proposals can never be read as a sheet of
   * rises.
   */
  const printIt = () => {
    const names = [...new Set(rows.map((r) => r.company_name).filter(Boolean))];
    const applied = rows.filter((r) => r.applied);
    const sum = (list, pick) => list.reduce((t, r) => t + (Number(pick(r)) || 0), 0);
    printReport({
      title: 'Appraisals and increments',
      subtitle: [
        names.length === 1 ? names[0] : 'All companies',
        pendingOnly ? 'only the ones not applied yet' : 'every appraisal on record',
      ].join(' · '),
      meta: [
        `${rows.length} ${rows.length === 1 ? 'appraisal' : 'appraisals'}`,
        `${applied.length} applied · ${rows.length - applied.length} not applied yet`,
        `${rupees(sum(applied, (r) => r.increment))} a month added by the ones applied`,
      ],
      landscape: true,
      columns: [
        col('#', (_r, i) => i + 1, '3%'),
        col('Reviewed', (r) => r.reviewed_on || ''),
        col('Employee', (r) => r.employee_name),
        col('Cycle', (r) => r.cycle || ''),
        col('For', (r) => appraisalKindLabel(r.kind)),
        col('Rating', (r) => r.rating || ''),
        num('Was on', (r) => rupees(r.from_salary)),
        num('Proposed', (r) => (r.to_salary ? rupees(r.to_salary) : '—')),
        num('Rise', (r) => (r.to_salary ? rupees(r.increment) : '—')),
        num('%', (r) => (r.increment_pct === null || r.increment_pct === undefined ? '' : `${r.increment_pct}%`)),
        col('From when', (r) => r.effective_from || ''),
        col('Applied', (r) => (r.applied ? String(r.applied_at || '').slice(0, 10) : 'not yet')),
        col('What was said', (r) => r.summary || ''),
      ],
      rows,
      totals: {
        label: `Applied (${applied.length})`,
        Rise: rupees(sum(applied, (r) => r.increment)),
      },
      /*
       * Said on the paper, because a printed list of increments is exactly
       * the thing somebody reads as a decision already taken.
       */
      footer:
        'An appraisal is a proposal until it is applied: until the Applied column carries a date, nobody’s salary has moved. “Was on” is what they were on when it was measured, so an increment can never be worked off a stale figure. The total is of the ones actually applied.',
    });
  };

  const save = async () => {
    if (!draft.employee_id) return;
    try {
      await api.post('/people/appraisals', draft);
      setDraft({ ...draft, to_salary: '', summary: '', rating: '' });
      setAdding(false);
      load();
    } catch (err) {
      onError(err);
    }
  };

  const apply = async (row) => {
    const rise = row.increment > 0 ? `up ${rupees(row.increment)}` : `down ${rupees(-row.increment)}`;
    if (
      !window.confirm(
        `${row.employee_name}: ${rupees(row.from_salary)} → ${rupees(row.to_salary)} (${rise}).\n\n` +
          'This writes the new salary onto their record from now on. It cannot be undone from here.'
      )
    )
      return;
    try {
      await api.post(`/people/appraisals/${row.id}/apply`, {});
      await load();
      onReload?.();
    } catch (err) {
      onError(err);
    }
  };

  const remove = async (row) => {
    if (!window.confirm(`Remove this appraisal for ${row.employee_name}?`)) return;
    try {
      await api.del(`/people/appraisals/${row.id}`);
      load();
    } catch (err) {
      onError(err);
    }
  };

  return (
    <section className="stack">
      <div className="toolbar">
        <label className="inline">
          <input
            type="checkbox"
            checked={pendingOnly}
            onChange={(e) => setPendingOnly(e.target.checked)}
          />{' '}
          Only the ones not applied yet
        </label>
        <button className="ghost" onClick={printIt} disabled={!rows.length}>
          Print {rows.length}
        </button>
        <button className="ghost" onClick={() => setAdding(!adding)}>
          {adding ? 'Cancel' : 'Record an appraisal'}
        </button>
      </div>

      {adding && (
        <div className="card">
          <div className="form-grid">
            <label>
              Who
              <select
                value={draft.employee_id}
                onChange={(e) => setDraft({ ...draft, employee_id: e.target.value })}
              >
                <option value="">Pick somebody</option>
                {onStaff(employees).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} — {rupees(e.monthly_salary)}
                  </option>
                ))}
              </select>
            </label>
            {/* WHAT IT IS FOR. An appraisal is a review; a pay rise is one
                thing it can be for, and until this box existed every one of
                them read as a pay rise. */}
            <label>
              What it is for
              <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>
                {APPRAISAL_KINDS.map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
              <span className="hint">{APPRAISAL_KINDS.find(([k]) => k === draft.kind)?.[2]}</span>
            </label>
            <label>
              Cycle
              <input
                type="text"
                value={draft.cycle}
                placeholder="2026-27"
                onChange={(e) => setDraft({ ...draft, cycle: e.target.value })}
              />
            </label>
            <label>
              Reviewed on
              <input
                type="date"
                value={draft.reviewed_on}
                onChange={(e) => setDraft({ ...draft, reviewed_on: e.target.value })}
              />
            </label>
            <label>
              By
              <input
                type="text"
                value={draft.reviewed_by}
                onChange={(e) => setDraft({ ...draft, reviewed_by: e.target.value })}
              />
            </label>
            <label>
              Rating
              <input
                type="text"
                value={draft.rating}
                placeholder="A / B / 4 out of 5"
                onChange={(e) => setDraft({ ...draft, rating: e.target.value })}
              />
            </label>
            <label>
              New salary
              <input
                type="number"
                value={draft.to_salary}
                placeholder={current ? String(Math.round(current.monthly_salary || 0)) : ''}
                onChange={(e) => setDraft({ ...draft, to_salary: e.target.value })}
              />
            </label>
            <label>
              Effective from
              <input
                type="date"
                value={draft.effective_from}
                onChange={(e) => setDraft({ ...draft, effective_from: e.target.value })}
              />
            </label>
          </div>
          <label className="block">
            What was said
            <textarea
              rows="3"
              value={draft.summary}
              onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
            />
          </label>
          <p className="muted small">
            {current
              ? `Measured against ${rupees(current.monthly_salary)}, which is what ${current.name} is on now.`
              : 'The increment is measured against what they are on now, so it can never be worked out off a stale figure.'}{' '}
            Leaving the new salary empty records a review with no rise.
          </p>
          <button onClick={save} disabled={!draft.employee_id}>
            Record it
          </button>
        </div>
      )}

      {!rows.length ? (
        <p className="muted small">No appraisals recorded yet.</p>
      ) : (
        <table className="sheet">
          <thead>
            <tr>
              <th>Reviewed</th>
              <th>Who</th>
              <th>Cycle</th>
              <th>For</th>
              <th>Rating</th>
              <th className="num">From</th>
              <th className="num">To</th>
              <th className="num">Rise</th>
              <th>From when</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.reviewed_on}</td>
                <td className="sticky-name">{row.employee_name}</td>
                <td>{row.cycle || '—'}</td>
                <td>{appraisalKindLabel(row.kind) || '—'}</td>
                <td>{row.rating || '—'}</td>
                <td className="num">{rupees(row.from_salary)}</td>
                <td className="num">{row.to_salary ? rupees(row.to_salary) : '—'}</td>
                <td className="num">
                  {row.to_salary ? (
                    <>
                      {rupees(row.increment)}
                      {row.increment_pct !== null && <span className="muted small"> ({row.increment_pct}%)</span>}
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td>{row.effective_from || '—'}</td>
                <td>
                  {row.applied ? (
                    <span className="muted small">applied {String(row.applied_at).slice(0, 10)}</span>
                  ) : row.to_salary ? (
                    <button onClick={() => apply(row)}>Apply the increment</button>
                  ) : (
                    <button className="ghost small" onClick={() => remove(row)}>
                      remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
