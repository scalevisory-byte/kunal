import { useRef, useState } from 'react';
import { api } from '../../api.js';
import { rupees } from '../../format.js';

/**
 * An office's existing asset list, out of the spreadsheet it already keeps.
 *
 * Typing a hundred and twenty laptops in by hand is how a register never gets
 * started, so this reads the file as it is — the columns are found from the
 * sheet's own words rather than a layout anybody has to match.
 *
 * **Dry run first, always.** The file is read and the plan shown; nothing is
 * written until the second button. An import that quietly creates a second
 * copy of every laptop is worse than no import at all, and the two calls are
 * otherwise identical on purpose: the plan you approve is the plan that runs.
 */
export default function AssetImport({ onDone, onError }) {
  const file = useRef(null);
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState('');

  const send = async (write) => {
    const chosen = file.current?.files?.[0];
    if (!chosen) return;
    setBusy(write ? 'Importing…' : 'Reading…');
    try {
      const form = new FormData();
      form.set('file', chosen);
      if (write) form.set('write', 'true');
      const result = await api.upload('/people/assets/import', form);
      setPlan(result);
      if (write) onDone?.();
    } catch (err) {
      onError(err);
    } finally {
      setBusy('');
    }
  };

  const Group = ({ title, list, tone, describe }) =>
    list?.length ? (
      <p className={`small ${tone || ''}`}>
        <strong>{list.length}</strong> {title}:{' '}
        {list.slice(0, 8).map(describe || ((a) => a.label)).join('; ')}
        {list.length > 8 ? ` and ${list.length - 8} more` : ''}
      </p>
    ) : null;

  return (
    <div className="card">
      <h3>Bring in an asset list from Excel</h3>
      <p className="muted small">
        Any .xlsx with one row per asset. The columns are read off the sheet&apos;s own
        header — <strong>Asset / Item / Item Name / Name</strong> is the only one it cannot
        do without. Asset ID, Type, Model (or Modal), Serial No, Assignee, Status,
        Condition, Purchased Date, Warranty, Vendor, Price, Purchase Invoice, Location and
        Room are all picked up if they are there, spelt however your sheet spells them.
        An empty cell written as <strong>-</strong> is read as empty, not as a value.
      </p>

      <div className="row">
        <input ref={file} type="file" accept=".xlsx" onChange={() => setPlan(null)} />
        <button onClick={() => send(false)} disabled={!!busy}>
          {busy === 'Reading…' ? busy : 'Read the file'}
        </button>
        {plan && !plan.wrote && !plan.problem && (plan.create.length > 0 || plan.update.length > 0) && (
          <button className="primary" onClick={() => send(true)} disabled={!!busy}>
            {busy === 'Importing…'
              ? busy
              : `Import ${plan.create.length} and update ${plan.update.length}`}
          </button>
        )}
      </div>

      {plan?.problem && <p className="error small">{plan.problem}</p>}

      {plan && !plan.problem && (
        <div className="stack-tight" style={{ marginTop: '0.6rem' }}>
          <p className="small">
            <strong>{plan.sheet}</strong>, header on row {plan.headerRow + 1}.{' '}
            {plan.wrote || plan.updated ? (
              <span className="good">
                Done — {plan.wrote} added, {plan.updated} updated.
              </span>
            ) : (
              <>
                <strong>{plan.create.length}</strong> would be added,{' '}
                <strong>{plan.update.length}</strong> already on the register would be
                updated. Nothing has been written yet.
              </>
            )}
          </p>

          <Group title="would be added" list={plan.create} />
          <Group title="are already here and would be updated" list={plan.update} />
          {/* A skipped row is useless as "row 10" - the reason is the point. */}
          <Group
            title="rows were passed over"
            list={plan.skipped}
            tone="muted"
            describe={(s) => `row ${s.row} (${s.why})`}
          />

          {/* Each of these is a thing the office has to decide, named rather
              than guessed at. */}
          {plan.holders_unknown?.length > 0 && (
            <p className="small warn">
              <strong>{plan.holders_unknown.length}</strong> named a holder who is not on the
              staff list — {plan.holders_unknown.slice(0, 6).map((a) => a.holder_name).join(', ')}
              . Those come in as <strong>in the office</strong>; nobody is invented. Issue them
              by hand afterwards.
            </p>
          )}
          {plan.failed?.length > 0 && (
            <p className="small warn">
              {/*
                * Said after a write, because the rest DID go in. Silence here
                * would leave a register that is wrong with nothing saying
                * where.
                */}
              <strong>{plan.failed.length}</strong> could not be saved and are not in the
              register:{' '}
              {plan.failed.slice(0, 5).map((f) => `row ${f.row} (${f.why})`).join('; ')}
              {plan.failed.length > 5 ? ' and more' : ''}. Everything else went in — fix those
              rows and import the file again.
            </p>
          )}
          {plan.serials_lost?.length > 0 && (
            <p className="small warn">
              {/*
                * Excel did this before the file reached us, and it cannot be
                * undone from here. Said plainly, with the rows named, because
                * the alternative is a register full of identical IMEIs that
                * all read as the same phone.
                */}
              <strong>{plan.serials_lost.length}</strong> had a serial Excel had already
              rounded off — a 15-digit IMEI in a plain cell becomes{' '}
              <code>3.52E+14</code> and the real number is gone from the file. Those assets
              come in <strong>without a serial</strong>, not with the wrong one
              {': '}
              rows {plan.serials_lost.slice(0, 8).map((a) => a.row).join(', ')}
              {plan.serials_lost.length > 8 ? ' and more' : ''}. To keep them, format that
              column as <strong>Text</strong> in Excel before saving and import again.
            </p>
          )}
          {plan.unmatchable?.length > 0 && (
            <p className="small warn">
              <strong>{plan.unmatchable.length}</strong> carry no code and no serial, so there is
              nothing to recognise them by — importing this file <em>again</em> would create a
              second copy of each. Put a serial or a code in the sheet if you plan to re-import.
            </p>
          )}

          {plan.create.length > 0 && !plan.wrote && (
            <div className="table-wrap">
              <table className="sheet">
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Asset</th>
                    <th>Kind</th>
                    <th>Serial</th>
                    <th className="num">Cost</th>
                    <th>Bought</th>
                    <th>Holder</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.create.slice(0, 40).map((a) => (
                    <tr key={a.row}>
                      <td className="num">{a.row}</td>
                      <td>{a.label}</td>
                      <td>{a.kind}</td>
                      <td>{a.identifier || <span className="muted">—</span>}</td>
                      <td className="num">
                        {a.purchase_cost ? rupees(a.purchase_cost) : <span className="muted">—</span>}
                      </td>
                      <td>{a.purchase_date || <span className="muted">—</span>}</td>
                      <td className={a.holder_unknown ? 'warn' : undefined}>
                        {a.holder_name || <span className="muted">in the office</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {plan.create.length > 40 && (
                <p className="muted small">…and {plan.create.length - 40} more.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
