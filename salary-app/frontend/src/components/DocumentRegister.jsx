import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { DOCUMENT_KINDS, KYC_KINDS, kindLabel } from '../../../shared/documents.js';
import { col, printReport } from '../printReport.js';

/**
 * EVERY PERSON AGAINST EVERY KYC DOCUMENT, on one page.
 *
 * This is what an audit asks for and what each employee's own record could
 * never answer: not "is this person's file complete" but "whose is not".
 *
 * It computes nothing. The server builds it with the same `documentStatus`
 * the record itself shows, so a row here and the record behind it cannot
 * disagree.
 */
const TONE = { verified: 'ok', rejected: 'bad', expired: 'bad', missing: 'bad', unchecked: 'muted' };

export default function DocumentRegister({ companyId, onGo, onError, startOn = '' }) {
  const [data, setData] = useState(null);
  const [only, setOnly] = useState(startOn);
  useEffect(() => {
    if (startOn) setOnly(startOn);
  }, [startOn]);
  const [find, setFind] = useState('');

  useEffect(() => {
    api
      .get(`/documents/register${companyId ? `?company_id=${companyId}` : ''}`)
      .then(setData)
      .catch((err) => onError?.(err.message));
  }, [companyId]);

  const rows = useMemo(() => {
    if (!data) return [];
    let list = data.rows;
    if (only === 'missing') list = list.filter((r) => r.missing.length);
    if (only === 'unchecked') list = list.filter((r) => r.unchecked > 0);
    if (only === 'rejected') list = list.filter((r) => r.rejected > 0);
    if (only === 'expired') list = list.filter((r) => r.expired > 0);
    const q = find.trim().toLowerCase();
    if (q) {
      list = list.filter((r) =>
        [r.name, r.code, r.department, r.company_name]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q))
      );
    }
    return list;
  }, [data, only, find]);

  const print = () => {
    if (!data) return;
    printReport({
      title: 'Employee document register',
      subtitle: 'KYC papers on file',
      meta: [
        `${rows.length} of ${data.rows.length} people`,
        `${data.totals.complete} have all four on file · ${data.totals.checked} checked`,
        only ? `showing only: ${only}` : null,
      ].filter(Boolean),
      columns: [
        col('Code', (r) => r.code, '9%'),
        col('Name', (r) => r.name, '18%'),
        col('Company', (r) => r.company_name, '14%'),
        ...KYC_KINDS.map((kind) => col(kindLabel(kind), (r) => r.kinds[kind].label)),
        col('Still missing', (r) => r.missing.join(', ')),
      ],
      rows,
      landscape: true,
      compact: true,
      empty: 'Nobody matches.',
      footer:
        'NOT CHECKED IS NOT REJECTED — a document nobody has looked at is its own state, and is counted apart.',
    });
  };

  if (!data) return <p className="muted small">Loading…</p>;

  return (
    <div className="stack">
      <div className="stat-row">
        <Fig label="People" value={data.totals.people} />
        <Fig label="All four on file" value={data.totals.complete} />
        <Fig label="All four checked" value={data.totals.checked} />
        <Fig label="Something missing" value={data.totals.missing_something} bad />
        <Fig label="Rejected" value={data.totals.rejected} bad />
        <Fig label="Expired" value={data.totals.expired} bad />
      </div>

      <div className="toolbar">
        <div className="chips">
          {[
            ['', 'Everyone'],
            ['missing', 'Something missing'],
            ['unchecked', 'Not checked'],
            ['rejected', 'Rejected'],
            ['expired', 'Expired'],
          ].map(([key, label]) => (
            <button
              key={key || 'all'}
              className={`chip ${only === key ? 'active' : ''}`}
              onClick={() => setOnly(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          className="search"
          placeholder="Name, code or department"
          value={find}
          onChange={(e) => setFind(e.target.value)}
        />
        <button onClick={print}>Print</button>
      </div>

      <div className="table-wrap">
        <table className="sheet">
          <thead>
            <tr>
              <th className="sticky-name">Name</th>
              <th>Code</th>
              {KYC_KINDS.map((kind) => <th key={kind}>{kindLabel(kind)}</th>)}
              <th>Company</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.employee_id}>
                <td className="sticky-name">{r.name}</td>
                <td className="muted small">{r.code || '—'}</td>
                {KYC_KINDS.map((kind) => (
                  <td key={kind} className="small">
                    <span className={`chip ${TONE[r.kinds[kind].key] || ''}`}>
                      {r.kinds[kind].label}
                    </span>
                  </td>
                ))}
                <td className="muted small">{r.company_name}</td>
                <td>
                  {onGo ? (
                    <button className="link" onClick={() => onGo('employees', r.employee_id)}>
                      open
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={KYC_KINDS.length + 4} className="empty">
                  Nobody matches.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="muted small">
        <strong>Not checked is not rejected.</strong> A document nobody has looked at is its own
        state and is counted apart — the alternative is a page of red on the day this is first
        opened, which nobody reads twice. Open a record to mark one checked or send it back.
      </p>
    </div>
  );
}

function Fig({ label, value, bad }) {
  return (
    <div className="stat plain">
      <span className="value" style={bad && value ? { color: 'var(--bad)' } : undefined}>{value}</span>
      <span className="label">{label}</span>
    </div>
  );
}
