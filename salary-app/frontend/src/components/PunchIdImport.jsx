import { useState } from 'react';
import { STANDALONE, api } from '../api.js';

/**
 * Giving everybody the number their punch reader knows them by.
 *
 * Without it the Bizcompass spool matches nobody: that file carries a reader
 * user number and no name at all. The machine's own Basic Work Duration
 * report carries both, so it is the mapping — it just has to be checked,
 * because the two lists are typed by different people and do not agree.
 *
 * NOTHING IS WRITTEN UNTIL IT IS TICKED. An exact name arrives ticked; a near
 * miss arrives unticked with what differs, and a number already on somebody
 * else is refused by name.
 */
export default function PunchIdImport({ onReload }) {
  const [plan, setPlan] = useState(null);
  const [picked, setPicked] = useState(new Set());
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [open, setOpen] = useState(false);

  const read = async (file) => {
    if (!file) return;
    setBusy('Reading the report…');
    setError('');
    setDone('');
    try {
      const form = new FormData();
      form.append('file', file);
      const result = await api.upload('/employees/punch-ids/match', form);
      setPlan(result);
      setPicked(new Set(result.pairs.filter((p) => p.suggest).map((p) => p.code)));
    } catch (err) {
      setError(err.message);
      setPlan(null);
    } finally {
      setBusy('');
    }
  };

  const apply = async () => {
    const pairs = plan.pairs
      .filter((p) => picked.has(p.code))
      .map((p) => ({ employee_id: p.employee_id, device_code: p.code }));
    if (!pairs.length) return;
    setBusy('Saving…');
    setError('');
    try {
      const result = await api.post('/employees/punch-ids', { pairs });
      setDone(
        `${result.written} punch ID${result.written === 1 ? '' : 's'} saved.` +
          (result.refused.length ? ` ${result.refused.length} refused.` : '')
      );
      setPlan(null);
      setPicked(new Set());
      onReload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const toggle = (code) => {
    const next = new Set(picked);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    setPicked(next);
  };

  if (STANDALONE) return null;

  return (
    <section className="card">
      <h2>
        <button className="link" onClick={() => setOpen(!open)}>
          {open ? '▾' : '▸'} Punch IDs from the machine&rsquo;s report
        </button>
      </h2>
      {!open ? (
        <p className="muted small">
          The punch spool carries a reader number and no name, so everybody needs their number
          here before their attendance can arrive.
        </p>
      ) : (
        <>
          <p className="muted small">
            Upload eTimeTrackLite&rsquo;s <code>BasicWorkDurationReport</code> or{' '}
            <code>MonthlyStatus_BasicReport</code> &mdash; the same file Reports takes. Its{' '}
            <strong>Emp. Code</strong> is the number the reader uses, with the name beside it.
          </p>

          <div className="row">
            <input type="file" accept=".xls,.xlsx,.xlsm" onChange={(e) => read(e.target.files?.[0])} />
            {busy ? <span className="muted small">{busy}</span> : null}
          </div>

          {error ? <p className="banner bad">{error}</p> : null}
          {done ? <p className="banner good">{done}</p> : null}

          {plan ? (
            <>
              <p className="muted small">
                {plan.counts.machine} on the machine, {plan.counts.staff} on the staff list.{' '}
                <strong>{plan.counts.suggested}</strong> match exactly and are ticked;{' '}
                {plan.counts.toCheck} need a look; {plan.counts.alreadySet} already set.
              </p>
              {/*
                * THE WARNING THIS SCREEN EXISTS FOR. The lists are typed by
                * different people: a middle name on one side, a surname a
                * letter out. A wrong tick puts one person's attendance on
                * another person's payslip.
                */}
              <p className="banner">
                <strong>Check the unticked ones before saving.</strong> The names are not spelt
                the same on both lists, so these are a guess &mdash; and a wrong number puts one
                person&rsquo;s attendance on another person&rsquo;s payslip.
              </p>

              <div className="table-wrap" style={{ maxHeight: '26rem' }}>
                <table className="sheet wide">
                  <thead>
                    <tr>
                      <th />
                      <th>Punch ID</th>
                      <th>On the machine</th>
                      <th>On the staff list</th>
                      <th>Match</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {plan.pairs.map((p) => (
                      <tr key={p.code} className={p.why === 'already set' ? 'inactive' : undefined}>
                        <td className="num">
                          <input
                            type="checkbox"
                            checked={picked.has(p.code)}
                            disabled={p.why === 'already set'}
                            onChange={() => toggle(p.code)}
                          />
                        </td>
                        <td><strong>{p.code}</strong></td>
                        <td>
                          {p.machine_name}
                          {p.company ? <span className="muted small"> · {p.company}</span> : null}
                        </td>
                        <td>{p.employee_name}</td>
                        <td className="num">{Math.round(p.score * 100)}%</td>
                        <td className="muted small">{p.why}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="row" style={{ marginTop: '0.6rem' }}>
                <button className="primary" disabled={!!busy || !picked.size} onClick={apply}>
                  Save {picked.size} punch ID{picked.size === 1 ? '' : 's'}
                </button>
                <button className="ghost" disabled={!!busy} onClick={() => setPlan(null)}>
                  Cancel
                </button>
              </div>

              {plan.onlyOnMachine.length ? (
                <p className="muted small">
                  <strong>{plan.onlyOnMachine.length} on the machine and not on the staff list</strong>{' '}
                  (left, or never added): {plan.onlyOnMachine.slice(0, 10).map((p) => `${p.code} ${p.name}`).join(', ')}
                  {plan.onlyOnMachine.length > 10 ? ' …' : ''}
                </p>
              ) : null}
              {plan.stillWithout.length ? (
                <p className="muted small">
                  <strong>{plan.stillWithout.length} on the staff list with no number at all</strong>{' '}
                  &mdash; their attendance will not arrive:{' '}
                  {plan.stillWithout.slice(0, 10).map((e) => e.name).join(', ')}
                  {plan.stillWithout.length > 10 ? ' …' : ''}
                </p>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </section>
  );
}
