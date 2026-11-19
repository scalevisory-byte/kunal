import { useState } from 'react';
import { STANDALONE, downloadPost } from '../../api.js';
import { DEFAULT_FIELDS, fieldGroups } from '../../../../shared/assetExport.js';

/**
 * THE REPORT SOMEBODY ASKED FOR, rather than the one we chose for them.
 *
 * Dinesh: *"export data in proper form — kiske paas he, kahaan he, kya he,
 * purchase date, purchase cost, full report"*, and *"report me option bhi
 * dena, kya-kya chahiye report me"*.
 *
 * The register exported a fixed seventeen columns. Every real request is a
 * different set: the accountant wants cost, date, vendor and invoice; the
 * store keeper wants who has it and where; the auditor wants all of it. So
 * the columns are ticked here.
 *
 * Two things it is careful about:
 *
 *   **It exports WHAT IS ON SCREEN, by sending those ids.** The filters, the
 *   search and a clicked warranty line have already narrowed the register,
 *   and working that out again on the server is how a report comes to
 *   disagree with the list it was taken from. "Everything" is a separate,
 *   explicit choice.
 *
 *   **The choice is remembered**, because nobody wants to tick fourteen boxes
 *   every month.
 */
const REMEMBER = 'bnf-asset-export-fields';

const remembered = () => {
  try {
    const kept = JSON.parse(window.localStorage.getItem(REMEMBER) || 'null');
    return Array.isArray(kept) && kept.length ? kept : [...DEFAULT_FIELDS];
  } catch {
    return [...DEFAULT_FIELDS];
  }
};

export default function AssetExport({ shown = [], total = 0, onError, onDone }) {
  const groups = fieldGroups();
  const [picked, setPicked] = useState(() => new Set(remembered()));
  const [scope, setScope] = useState('shown');
  const [busy, setBusy] = useState('');

  const toggle = (key) => {
    const next = new Set(picked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setPicked(next);
    try {
      window.localStorage.setItem(REMEMBER, JSON.stringify([...next]));
    } catch {
      /* a private window throws on touching localStorage; the choice still
         applies to this export, it just will not be remembered. */
    }
  };

  const take = async (format) => {
    setBusy(format);
    try {
      await downloadPost(
        '/people/assets/export',
        {
          format,
          fields: [...picked],
          ids: scope === 'shown' ? shown.map((a) => a.id) : [],
        },
        format === 'csv' ? 'asset-report.csv' : 'asset-report.xlsx'
      );
      onDone?.();
    } catch (err) {
      onError?.(err);
    } finally {
      setBusy('');
    }
  };

  if (STANDALONE) {
    return (
      <div className="card">
        <h3>Export a report</h3>
        <p className="muted small">
          The spreadsheet is written by the server. In the single file, use <strong>Register (CSV)</strong>.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <h3>Export a report</h3>
      <p className="muted small">
        Tick what you want in it. Money goes out as a <strong>number</strong>, so the column adds up,
        and the spreadsheet carries a frozen header, a filter row and a SUM at the foot.
      </p>

      <div className="sub-tabs toolbar">
        <button className={scope === 'shown' ? 'active' : undefined} onClick={() => setScope('shown')}>
          What is on screen ({shown.length})
        </button>
        <button className={scope === 'all' ? 'active' : undefined} onClick={() => setScope('all')}>
          Everything{total ? ` (${total})` : ''}
        </button>
      </div>

      <div className="export-fields">
        {groups.map((group) => (
          <div key={group.name}>
            <p className="ask" style={{ margin: '0 0 0.3rem' }}>
              {group.name}{' '}
              <button
                className="link tiny"
                onClick={() => {
                  const all = group.fields.every((f) => picked.has(f.key));
                  const next = new Set(picked);
                  for (const f of group.fields) {
                    if (all) next.delete(f.key);
                    else next.add(f.key);
                  }
                  setPicked(next);
                  try {
                    window.localStorage.setItem(REMEMBER, JSON.stringify([...next]));
                  } catch {
                    /* not remembered; the export still carries it */
                  }
                }}
              >
                {group.fields.every((f) => picked.has(f.key)) ? 'none' : 'all'}
              </button>
            </p>
            {group.fields.map((field) => (
              <label key={field.key} className="check">
                <input type="checkbox" checked={picked.has(field.key)} onChange={() => toggle(field.key)} />
                {field.label}
              </label>
            ))}
          </div>
        ))}
      </div>

      <div className="row" style={{ marginTop: '0.7rem' }}>
        <button className="primary" disabled={!picked.size || busy} onClick={() => take('xlsx')}>
          {busy === 'xlsx' ? 'Making it…' : `Excel · ${picked.size} columns`}
        </button>
        <button disabled={!picked.size || busy} onClick={() => take('csv')}>
          {busy === 'csv' ? 'Making it…' : 'CSV'}
        </button>
        <span className="muted small">
          {scope === 'shown'
            ? 'Exactly the assets on screen, filters and all.'
            : 'The whole register, written-off ones included.'}
        </span>
      </div>
    </div>
  );
}
