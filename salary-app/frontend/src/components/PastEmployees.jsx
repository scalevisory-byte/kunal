import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { col, num, printReport } from '../printReport.js';
import { rupees } from '../format.js';
import { EXIT_TYPES } from '../../../shared/settlement.js';

/**
 * PAST EMPLOYEES — the people who have left, and everything still held
 * about them.
 *
 * Dinesh: *"Past employe k data bhi proper rehne chaiye"*. It already was,
 * in the sense that nothing is deleted — but it could only be seen by
 * ticking a box that folded them back into the staff list, greyed out,
 * between people who still work here. There was no page that said: these
 * are the people who have gone, this is when, this is how, and this is
 * whether they were paid off.
 *
 * It joins two records and invents nothing between them: the master (who is
 * off the active list) and the exit register (what was recorded about their
 * leaving). **Somebody off the list with no exit recorded is named, not
 * hidden** — that is the commonest state in a real office, and the one
 * worth acting on.
 */
export default function PastEmployees({ employees, companies = [], onOpen, onExit, onReport, onError }) {
  const [exits, setExits] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || exits) return;
    api
      .get('/people/exits')
      .then(({ exits: list }) => setExits(list || []))
      /* Offline or on a login without People, the register simply is not
         there. The names and dates below still are, so it says so and
         carries on rather than showing an error. */
      .catch(() => setExits([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const gone = employees.filter((e) => !e.active);
  if (!gone.length) return null;

  const byId = new Map((exits || []).map((x) => [x.employee_id, x]));
  const rows = gone
    .map((e) => ({
      ...e,
      exit: byId.get(e.id) || null,
      company_name: e.company_name || companies.find((c) => c.id === e.company_id)?.name || '',
    }))
    .sort((a, b) => String(b.left_on || '').localeCompare(String(a.left_on || '')) || a.name.localeCompare(b.name));

  const wentLabel = (row) =>
    row.exit ? EXIT_TYPES.find((t) => t.code === row.exit.type)?.label || row.exit.type : '';

  const print = () =>
    printReport({
      title: 'Past employees',
      subtitle: companies.length === 1 ? companies[0].name : 'All companies',
      meta: [
        `${rows.length} ${rows.length === 1 ? 'person' : 'people'}`,
        `${rows.filter((r) => r.exit?.settled_on).length} settled`,
        `${rows.filter((r) => !r.exit).length} with no exit recorded`,
      ],
      landscape: true,
      columns: [
        col('#', (_r, i) => i + 1, '3%'),
        col('Name', (r) => r.name),
        col('Code', (r) => r.code || ''),
        col('Company', (r) => r.company_name),
        col('Designation', (r) => r.designation || ''),
        col('Joined', (r) => r.joined_on || ''),
        col('Last working day', (r) => r.left_on || 'not recorded'),
        col('How they went', (r) => wentLabel(r) || 'not recorded'),
        col('Why', (r) => r.exit?.reason || ''),
        col('Full and final', (r) =>
          r.exit?.settled_on ? `settled ${String(r.exit.settled_on).slice(0, 10)}` : 'not settled'
        ),
        num('Settled at', (r) => (r.exit?.settled_on ? rupees(r.exit.settled_amount) : '')),
      ],
      rows,
      note:
        'Nothing about these people is deleted. Every month they were paid in, their attendance, ' +
        'documents, loans, assets and records stay exactly as they were — they are only kept off ' +
        'the current staff list.',
    });

  return (
    <div className="card">
      <h3>
        <button className="link" onClick={() => setOpen(!open)}>
          {open ? '▾' : '▸'} Past employees
        </button>{' '}
        <span className="muted small">
          — {rows.length} {rows.length === 1 ? 'person has' : 'people have'} left
        </span>
      </h3>

      {open && (
        <>
          <p className="muted small">
            Nothing about them is deleted. Every month they were paid in, their attendance,
            documents, loans, assets and records are exactly as they were — they are only kept off
            the current staff list. Click a name to open their full record.
          </p>

          <table className="sheet">
            <thead>
              <tr>
                <th className="sticky-name">Name</th>
                <th>Company</th>
                <th>Designation</th>
                <th>Joined</th>
                <th>Last working day</th>
                <th>How they went</th>
                <th>Full and final</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="sticky-name">
                    <button className="link" onClick={() => onOpen?.(row.id)}>
                      {row.name}
                    </button>
                    {row.code ? <span className="muted small"> #{row.code}</span> : null}
                  </td>
                  <td className="small">{row.company_name}</td>
                  <td className="small">{row.designation || '—'}</td>
                  <td className="small">{row.joined_on || '—'}</td>
                  <td className="small">{row.left_on || <span className="muted">not recorded</span>}</td>
                  <td className="small">
                    {row.exit ? (
                      <>
                        {wentLabel(row)}
                        {row.exit.reason ? <span className="muted"> · {row.exit.reason}</span> : null}
                      </>
                    ) : exits === null ? (
                      <span className="muted">…</span>
                    ) : (
                      /* Off the list with nothing recorded. Named rather than
                         left blank: it is the commonest state in a real
                         office and the one worth acting on. */
                      <span className="pill todo">no exit recorded</span>
                    )}
                  </td>
                  <td className="small">
                    {row.exit?.settled_on ? (
                      `${rupees(row.exit.settled_amount)} on ${String(row.exit.settled_on).slice(0, 10)}`
                    ) : (
                      <span className="muted">not settled</span>
                    )}
                  </td>
                  <td>
                    <button className="ghost tiny" onClick={() => onExit?.(row)}>
                      exit
                    </button>{' '}
                    <button className="ghost tiny" onClick={() => onReport?.(row.id)}>
                      report
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="row" style={{ marginTop: '0.6rem' }}>
            <button className="ghost" onClick={print}>Print the register</button>
            {exits !== null && !exits.length && (
              <span className="muted small">
                The exit register is not available on this login, so only the master’s own dates
                are shown.
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
