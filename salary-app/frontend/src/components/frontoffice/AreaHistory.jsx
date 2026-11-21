import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { HK_STATUSES, areaHistory, hkLabel } from '../../../../shared/frontOffice.js';
import { col, printReport } from '../../printReport.js';
import { toCsv } from '../../../../shared/statutory.js';

/**
 * ONE AREA, DOWN THE DAYS.
 *
 * Dinesh: *"area wise history"*. The monthly summary says the parking was
 * flagged four days, which is the right answer for a month and useless in an
 * argument about the parking: it cannot say WHICH four, what was wrong, or
 * who looked.
 *
 * **A day nobody walked is not a clean day**, here as everywhere else in this
 * module. The days with no verdict are counted and named as not checked,
 * never folded into "clean" — and where the range is not known the figure is
 * a dash rather than nought, because nought would read as "every day was
 * walked".
 */
const today = () => new Date().toISOString().slice(0, 10);
const daysBack = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

/* A CSV straight from the browser - these rows are already on screen, so
   there is nothing for the server to build. */
function save(body, filename) {
  const url = URL.createObjectURL(new Blob([body], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export default function AreaHistory({ areaId, onClose, onError }) {
  const [from, setFrom] = useState(() => daysBack(89));
  const [to, setTo] = useState(today);
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!areaId) return;
    api
      .get(`/front-office/areas/${areaId}/history?from=${from}&to=${to}`)
      .then(setData)
      .catch(onError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areaId, from, to]);

  if (!areaId) return null;
  const history = data ? areaHistory({ area: data.area, inspections: data.inspections, from, to }) : null;

  const columns = [
    col('Date', (r) => r.day),
    col('Verdict', (r) => hkLabel(r.status)),
    col('Remark', (r) => r.remark || ''),
    col('Checked by', (r) => r.checked_by || ''),
  ];

  const print = () =>
    printReport({
      title: `${data.area.name} — housekeeping history`,
      subtitle: `${from} to ${to}`,
      meta: [
        `${history.checked} day(s) checked`,
        `${history.clean} clean · ${history.flagged} flagged`,
        history.not_checked === null
          ? 'days not checked: not known'
          : `${history.not_checked} day(s) not checked`,
      ],
      columns,
      rows: history.rows,
      empty: 'Nothing was recorded for this area in these dates.',
      note:
        'A day with no verdict is a day nobody walked — it is counted as not checked and never as clean.',
    });

  return (
    <div className="backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel">
        <header>
          <div>
            <h3>{data?.area?.name || 'Area'}</h3>
            <p className="muted small">
              Housekeeping, day by day
              {data?.area && !data.area.active ? ' · off the list — its record stays' : ''}
            </p>
          </div>
          <button onClick={onClose}>Close</button>
        </header>

        <div className="row wrap" style={{ gap: '0.5rem', margin: '0.6rem 0' }}>
          <label className="field">
            From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="field">
            To
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <span className="spacer" />
          <button className="ghost" disabled={!history?.rows.length} onClick={print}>Print</button>
          <button
            disabled={!history?.rows.length}
            onClick={() =>
              save(
                toCsv(
                  [
                    { label: 'Date', key: 'day' },
                    { label: 'Verdict', key: 'status' },
                    { label: 'Remark', key: 'remark' },
                    { label: 'Checked by', key: 'checked_by' },
                  ],
                  history.rows
                ),
                `${data.area.name.replace(/\s+/g, '-')}-history.csv`
              )
            }
          >
            CSV
          </button>
        </div>

        {!history ? (
          <p className="loading">…</p>
        ) : (
          <>
            <div className="figures">
              <div className="figure">
                <span className="n">{history.checked}</span>
                <span className="k">Days checked</span>
              </div>
              <div className="figure">
                <span className="n">{history.clean}</span>
                <span className="k">Clean</span>
              </div>
              <div className="figure">
                <span className={history.flagged ? 'n bad' : 'n'}>{history.flagged}</span>
                <span className="k">Flagged</span>
              </div>
              <div className="figure">
                {/* A dash, never a nought: not knowing the range and walking
                    every day of it are different facts. */}
                <span className="n">{history.not_checked === null ? '—' : history.not_checked}</span>
                <span className="k">Not checked</span>
              </div>
            </div>

            {history.latest ? (
              <p className="muted small">
                Last looked at on <strong>{history.latest.day}</strong> —{' '}
                {hkLabel(history.latest.status)}
                {history.latest.remark ? ` (${history.latest.remark})` : ''}
                {history.latest.checked_by ? ` · ${history.latest.checked_by}` : ''}
              </p>
            ) : null}

            <table className="sheet">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Verdict</th>
                  <th className="grow">Remark</th>
                  <th>Checked by</th>
                </tr>
              </thead>
              <tbody>
                {history.rows.map((row) => (
                  <tr key={row.id}>
                    <td className="num">{row.day}</td>
                    <td className={row.flagged ? 'ans-wrong' : undefined}>{hkLabel(row.status)}</td>
                    <td>{row.remark || <span className="muted">—</span>}</td>
                    <td className="muted small">{row.checked_by || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!history.rows.length ? (
              <p className="empty">
                Nothing was written down for this area in these dates. That is not a clean run —
                it is days nobody walked.
              </p>
            ) : null}
            <p className="muted small">
              The verdicts are {HK_STATUSES.map(([, label]) => label).join(' / ')}. A day with no
              verdict is counted as <strong>not checked</strong>, never as clean.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
