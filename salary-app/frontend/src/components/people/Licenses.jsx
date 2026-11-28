import { useEffect, useMemo, useState } from 'react';
import { STANDALONE, api, download } from '../../api.js';
import { rupees } from '../../format.js';
import {
  LICENSE_KINDS,
  fieldWords,
  isAgreement,
  LICENSE_TERMS,
  statusLabel,
  termNote,
} from '../../../../shared/licenses.js';
import Glyph from '../../icons.jsx';
import { STAGE_LABELS, STAGE_STEPS, categoryOf, stageProblem } from '../../../../shared/renewals.js';
import { onStaff } from '../../onStaff.js';
import { todayIso } from '../../../../shared/today.js';

/**
 * SOFTWARE LICENCES.
 *
 * Dinesh's mock-up had a License tab and nothing behind it. Asked what
 * belonged in it: *"license me software license ki detail rahegi"*. So this is
 * Tally, Windows, Office, the antivirus, eTimeTrackLite, the domain, the SSL
 * certificate — what we are licensed to run, on how many machines, and when it
 * has to be paid again.
 *
 * Four things this screen insists on saying in words rather than leaving blank:
 *
 *   A licence with **no renewal date never appears on a reminder list** if it
 *   is perpetual — and is named loudly if it is a subscription, because that is
 *   the one state nobody can plan for.
 *
 *   **The key is masked to its last four.** Showing it is a button, it asks
 *   what for, and it goes on the audit trail — a key that has been read out
 *   cannot be called back.
 *
 *   **Seats in use are counted off the seat list**, so the figure and the list
 *   cannot disagree.
 *
 *   **Over-allocation is shown, not refused.** Eleven installs on a ten-seat
 *   licence is the fact this register exists to surface.
 */

const today = () => todayIso();

const BLANK = {
  name: '',
  kind: 'Accounting software',
  publisher: '',
  version: '',
  term: 'subscription',
  key: '',
  account_email: '',
  seats: '',
  purchased_on: today(),
  expires_on: '',
  cost: '',
  renew_every_months: 12,
  vendor: '',
  invoice_no: '',
  note: '',
  company_id: '',
};

const FILTERS = [
  ['', 'All'],
  ['active', 'In date'],
  ['expiring', 'Expiring soon'],
  ['expired', 'Expired'],
  ['no_date', 'No renewal date'],
  ['perpetual', 'Perpetual'],
  ['cancelled', 'Cancelled'],
];

/**
 * Where it stands, as a pill whose colour means something.
 *
 * `perpetual` is deliberately the quietest of them: a licence bought outright
 * is not an achievement to light up, it is simply nothing to do.
 */
const TONE = {
  expired: 'lapsed',
  expiring: 'due-soon',
  no_date: 'due-soon',
  cancelled: 'retired',
  perpetual: 'forever',
  active: 'in-date',
};

function Where({ row }) {
  return (
    <span className={`pill ${TONE[row.status] || ''}`} title={row.expires_on ? `until ${row.expires_on}` : ''}>
      {row.status_label}
    </span>
  );
}

export default function Licenses({ employees = [], companies = [], companyId, onError }) {
  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState({});
  const [alerts, setAlerts] = useState({});
  const [filter, setFilter] = useState('');
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(BLANK);
  // The form's words follow the kind: a rent agreement has a landlord, not a publisher.
  const words = fieldWords(draft.kind);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null);     // the licence whose page is open
  const [said, setSaid] = useState('');

  const load = async () => {
    try {
      const data = await api.get(`/people/licenses${companyId ? `?company_id=${companyId}` : ''}`);
      setRows(data.licenses || []);
      setTotals(data.totals || {});
      setAlerts(data.alerts || {});
    } catch (err) {
      onError(err);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const shown = useMemo(() => {
    const words = query.trim().toLowerCase();
    return rows
      .filter((r) => (filter === 'cancelled' ? Boolean(r.cancelled_on) : filter ? r.status === filter : !r.cancelled_on))
      .filter((r) =>
        !words ||
        [r.name, r.kind, r.publisher, r.vendor, r.version, r.company_name, r.account_email]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(words))
      );
  }, [rows, filter, query]);

  const add = async () => {
    setBusy(true);
    try {
      const made = await api.post('/people/licenses', {
        ...draft,
        company_id: draft.company_id || companyId || '',
      });
      setDraft(BLANK);
      setAdding(false);
      await load();
      setOpen(made.id);
      setSaid(`${made.name} is on the register.`);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  if (STANDALONE) {
    return (
      <section className="stack">
        <div className="card">
          <p className="ask">This one needs the server.</p>
          <p className="muted small">
            A licence key is the most sensitive thing in this app. On the server it is never sent to
            a screen, never in an export, and shown only by a button that records who asked. In a
            single file on a laptop there is nobody to record and nobody to ask — anyone holding the
            file would hold every key in it. So the register lives on the server copy at{' '}
            <strong>bnfhrms.scalevisory.in</strong>.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="stack">
      <div className="toolbar">
        <div className="sub-tabs toolbar">
          {FILTERS.map(([key, label]) => (
            <button
              key={key || 'all'}
              className={filter === key ? 'active' : undefined}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          placeholder="Search software, publisher, vendor…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ maxWidth: '18rem' }}
        />
        <button
          className="primary"
          onClick={() => {
            setDraft(BLANK);
            setAdding((v) => !v);
          }}
        >
          {adding ? 'Close' : 'Add a licence'}
        </button>
        {/* The way in for the two that are not software: a button that names
            them, because nobody looks for a rent agreement under "licence". */}
        {!adding ? (
          <>
            <button className="ghost" onClick={() => { setDraft({ ...BLANK, kind: 'Rent agreement', term: 'subscription', renew_every_months: '11' }); setAdding(true); }}>
              Add a rent agreement
            </button>
            <button className="ghost" onClick={() => { setDraft({ ...BLANK, kind: 'Insurance policy', term: 'subscription', renew_every_months: '12' }); setAdding(true); }}>
              Add an insurance policy
            </button>
          </>
        ) : null}
        <span className="push-right">
          <button className="ghost" onClick={() => download('/people/licenses.csv', 'software-licences.csv')}>
            Register (CSV)
          </button>
          <button className="ghost" onClick={() => download('/people/licenses/seats.csv', 'licence-seats.csv')}>
            Who uses what (CSV)
          </button>
        </span>
      </div>

      {said && (
        <div className="alerts" onClick={() => setSaid('')}>
          {said}
        </div>
      )}

      {/* ---------------- the four figures ---------------- */}
      <div className="asset-tiles">
        <Tile
          glyph="box"
          label="Licences"
          value={totals.licenses ?? 0}
          note={totals.cancelled ? `${totals.cancelled} cancelled` : 'on the register'}
          onClick={() => setFilter('')}
        />
        <Tile
          glyph="bell"
          label="Renewing within 30 days"
          value={alerts.expiring?.length ?? 0}
          note={alerts.expiring?.length ? alerts.expiring.map((l) => l.name).slice(0, 2).join(', ') : 'nothing due'}
          onClick={() => setFilter('expiring')}
        />
        <Tile
          glyph="alert"
          label="Expired"
          value={alerts.expired?.length ?? 0}
          note={alerts.expired?.length ? 'running unlicensed' : 'none'}
          onClick={() => setFilter('expired')}
        />
        <Tile
          glyph="rupee"
          label="Cost a year"
          value={rupees(totals.yearly || 0)}
          note={
            totals.yearly_unknown
              ? `${totals.yearly_unknown} without a period, so not counted`
              : 'from the renewing ones'
          }
        />
      </div>

      <p className="muted small">
        {totals.used ?? 0} of {totals.seats ?? 0} counted seats in use
        {totals.uncounted ? `, and ${totals.uncounted} where no seat count is set (a site licence, a domain, a subscription)` : ''}
        {totals.perpetual ? ` · ${totals.perpetual} bought outright, which never expire` : ''}.
      </p>

      {/* ---------------- what needs doing ---------------- */}
      {(alerts.count > 0 || alerts.no_date?.length > 0 || alerts.nothing_on_file?.length > 0) && (
        <div className="card">
          {alerts.expired?.length > 0 && (
            <p className="lic-alert bad">
              <strong>{alerts.expired.length} expired</strong> — {alerts.expired.map((l) => l.name).join(', ')}. Software past
              its date is being run unlicensed.
            </p>
          )}
          {alerts.expiring?.length > 0 && (
            <p className="lic-alert warn">
              <strong>{alerts.expiring.length} renewing within 30 days</strong> —{' '}
              {alerts.expiring.map((l) => `${l.name} (${l.expires_on})`).join(', ')}.
            </p>
          )}
          {alerts.over_allocated?.length > 0 && (
            <p className="lic-alert warn">
              <strong>{alerts.over_allocated.length} over its seats</strong> —{' '}
              {alerts.over_allocated
                .map((l) => `${l.name}: ${l.seat_use.used} installs on ${l.seat_use.seats}`)
                .join(', ')}
              . Recorded rather than refused: the install exists either way.
            </p>
          )}
          {alerts.no_date?.length > 0 && (
            <p className="lic-alert warn">
              <strong>{alerts.no_date.length} with no renewal date</strong> —{' '}
              {alerts.no_date.map((l) => l.name).join(', ')}. Not the same as perpetual: nobody can
              plan for these.
            </p>
          )}
          {alerts.nothing_on_file?.length > 0 && (
            <p className="lic-alert muted small">
              {alerts.nothing_on_file.length} with nothing on file —{' '}
              {alerts.nothing_on_file.map((l) => l.name).join(', ')}. No key and no account, so
              there is nothing to rebuild a machine with and nothing to log in to and renew.
            </p>
          )}
        </div>
      )}

      {/* ---------------- adding one ---------------- */}
      {adding && (
        <div className="card">
          <h3>{isAgreement(draft.kind) ? `Add a ${draft.kind.toLowerCase()}` : 'Add a licence'}</h3>
          <p className="muted small">
            Only the <strong>name</strong> is needed. Everything else is something somebody has to go
            and find, and what is missing is said on the row — a form that will not save until the
            invoice turns up is a register that stays empty.
          </p>
          <div className="form-grid">
            <label>
              {words.name}
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={words.namePlaceholder} />
            </label>
            <label>
              Kind
              <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>
                {LICENSE_KINDS.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
            <label>
              {words.publisher}
              <input value={draft.publisher} onChange={(e) => setDraft({ ...draft, publisher: e.target.value })} placeholder={words.publisherPlaceholder} />
            </label>
            {words.secret ? (
              <label>
                Version
                <input value={draft.version} onChange={(e) => setDraft({ ...draft, version: e.target.value })} placeholder="5.0" />
              </label>
            ) : null}
            <label>
              Company
              <select value={draft.company_id} onChange={(e) => setDraft({ ...draft, company_id: e.target.value })}>
                <option value="">— whose licence is it? —</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Held as
              <select value={draft.term} onChange={(e) => setDraft({ ...draft, term: e.target.value })}>
                {LICENSE_TERMS.map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {words.secret ? (<>
            <label>
              Licence key
              <input
                value={draft.key}
                onChange={(e) => setDraft({ ...draft, key: e.target.value })}
                placeholder="typed once; never shown again without asking"
              />
            </label>
            <label>
              Account it sits under
              <input
                value={draft.account_email}
                onChange={(e) => setDraft({ ...draft, account_email: e.target.value })}
                placeholder="the login the renewal notice goes to"
              />
            </label>
            <label>
              Seats
              <input
                value={draft.seats}
                onChange={(e) => setDraft({ ...draft, seats: e.target.value })}
                placeholder="blank = nobody counting"
              />
            </label>
            </>) : null}
            <label>
              Bought on
              <input type="date" value={draft.purchased_on} onChange={(e) => setDraft({ ...draft, purchased_on: e.target.value })} />
            </label>
            <label>
              {words.expires}
              <input
                type="date"
                value={draft.expires_on}
                onChange={(e) => setDraft({ ...draft, expires_on: e.target.value })}
                disabled={draft.term === 'perpetual' || draft.term === 'free'}
              />
            </label>
            <label>
              {words.cost}
              <input value={draft.cost} onChange={(e) => setDraft({ ...draft, cost: e.target.value })} placeholder="22500" />
            </label>
            <label>
              {words.renew}
              <input
                value={draft.renew_every_months}
                onChange={(e) => setDraft({ ...draft, renew_every_months: e.target.value })}
                placeholder="12"
              />
            </label>
            <label>
              {words.vendor}
              <input value={draft.vendor} onChange={(e) => setDraft({ ...draft, vendor: e.target.value })} />
            </label>
            <label>
              {words.invoice}
              <input value={draft.invoice_no} onChange={(e) => setDraft({ ...draft, invoice_no: e.target.value })} />
            </label>
            <label>
              Note
              <input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
            </label>
          </div>
          <p className="muted small">{termNote(draft.term)}</p>
          <div className="row">
            <button className="primary" disabled={busy || !draft.name.trim()} onClick={add}>
              {busy ? 'Saving…' : 'Add it'}
            </button>
            <button className="ghost" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ---------------- the register ---------------- */}
      {!shown.length ? (
        <div className="card">
          <p className="muted">
            {rows.length
              ? 'Nothing under this filter.'
              : 'Nothing on the register yet. Tally, Windows, the antivirus, eTimeTrackLite, the domain — each with its key, its seats and its renewal date.'}
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="sheet numbered">
            <thead>
              <tr>
                <th className="row-no">#</th>
                <th>Software</th>
                <th>Kind</th>
                <th>Held as</th>
                <th className="num">Seats</th>
                <th>Runs until</th>
                <th className="num">Cost a year</th>
                <th>Key</th>
                <th>Company</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row, i) => (
                <tr
                  key={row.id}
                  className="open-row"
                  onClick={() => setOpen(row.id)}
                  title="Open this licence"
                >
                  <td className="row-no">{i + 1}</td>
                  <td className="sticky-name">
                    <strong className="open-name">{row.name}</strong>
                    {row.publisher && <div className="muted small">{row.publisher}{row.version ? ` ${row.version}` : ''}</div>}
                  </td>
                  <td>{row.kind || <span className="muted">—</span>}</td>
                  <td className="small">{row.term_label}</td>
                  <td className="num">
                    {row.seat_use.counted ? (
                      <span className={row.seat_use.over ? 'bad' : ''}>
                        {row.seat_use.used}/{row.seat_use.seats}
                        {row.seat_use.over ? ` (+${row.seat_use.over_by})` : ''}
                      </span>
                    ) : (
                      <span className="muted" title="No seat count set — a site licence, a domain, a subscription">
                        {row.seat_use.used} of ?
                      </span>
                    )}
                  </td>
                  <td>
                    <Where row={row} />
                    {row.expires_on && <div className="muted small">{row.expires_on}</div>}
                  </td>
                  <td className="num">
                    {row.annual_cost === null ? (
                      <span className="muted" title="A cost with no period cannot be annualised">—</span>
                    ) : (
                      rupees(row.annual_cost)
                    )}
                  </td>
                  <td className="small">
                    {row.has_key ? (
                      <code>{row.key_masked}</code>
                    ) : (
                      <span className="muted">not on file</span>
                    )}
                  </td>
                  <td className="small">{row.company_name || <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <LicencePage
          id={open}
          employees={employees}
          companies={companies}
          onClose={() => setOpen(null)}
          onChanged={load}
          onError={onError}
        />
      )}
    </section>
  );
}

/* The same four-tile shape the asset dashboard uses, so the two tabs read as
   one app rather than two. */
function Tile({ glyph, label, value, note, onClick }) {
  const inside = (
    <>
      <span className="asset-tile-icon">
        <Glyph name={glyph} size={20} />
      </span>
      <span className="asset-tile-text">
        <span className="k">{label}</span>
        <span className="n">{value}</span>
        {note && <span className="muted small">{note}</span>}
      </span>
    </>
  );
  return onClick ? (
    <button className="asset-tile" onClick={onClick} title={note || ''}>
      {inside}
    </button>
  ) : (
    <div className="asset-tile" title={note || ''}>{inside}</div>
  );
}

/* ================================================================= *
 * One licence: its details, its seats, its renewals.
 * ================================================================= */
export function LicencePage({ id, employees, companies, onClose, onChanged, onError, canApprove = false }) {
  const [license, setLicense] = useState(null);
  const [suggested, setSuggested] = useState(null);
  const [key, setKey] = useState(null);         // only once it has been asked for
  const [why, setWhy] = useState('');
  const [asking, setAsking] = useState(false);
  const [seat, setSeat] = useState({ employee_id: '', device: '', note: '' });
  const [renewal, setRenewal] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const data = await api.get(`/people/licenses/${id}`);
      setLicense(data.license);
      setSuggested(data.suggested);
    } catch (err) {
      onError(err);
    }
  };

  useEffect(() => {
    setKey(null);
    setAsking(false);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!license) return null;
  const category = categoryOf(license);

  const patch = async (body) => {
    try {
      const after = await api.patch(`/people/licenses/${id}`, body);
      setLicense({ ...after, seats_list: after.seats_list, renewals: after.renewals });
      await onChanged();
    } catch (err) {
      onError(err);
      await load();
    }
  };

  /*
   * Every box saves on blur, and is KEYED on its stored value - so a change
   * made elsewhere re-renders the box instead of leaving a stale figure on
   * screen, the same rule the employee table follows after a bulk edit.
   *
   * `field` is a plain function call, NOT a component defined in here: a
   * component declared inside a render gets a new identity every time, which
   * remounts its input and loses what somebody is halfway through typing.
   */
  const field = ({ name, label, type = 'text', placeholder, options, disabled, hint }) => (
    <label key={name}>
      {label}
      {options ? (
        <select
          key={`${name}-${String(license[name] ?? '')}`}
          defaultValue={String(license[name] ?? '')}
          disabled={disabled}
          onChange={(e) => patch({ [name]: e.target.value })}
        >
          {options.map(([value, text]) => (
            <option key={value} value={value}>
              {text}
            </option>
          ))}
        </select>
      ) : (
        <input
          key={`${name}-${String(license[name] ?? '')}`}
          type={type}
          defaultValue={license[name] ?? ''}
          placeholder={placeholder}
          disabled={disabled}
          onBlur={(e) => {
            if (String(e.target.value) !== String(license[name] ?? '')) patch({ [name]: e.target.value });
          }}
        />
      )}
      {hint && <span className="muted small">{hint}</span>}
    </label>
  );

  const show = async () => {
    setBusy(true);
    try {
      const { key: whole, had } = await api.post(`/people/licenses/${id}/key`, { why });
      setKey(had ? whole : '');
      setAsking(false);
      setWhy('');
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  const assign = async () => {
    setBusy(true);
    try {
      await api.post(`/people/licenses/${id}/seats`, seat);
      setSeat({ employee_id: '', device: '', note: '' });
      await load();
      await onChanged();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  const release = async (seatId) => {
    try {
      await api.post(`/people/licenses/seats/${seatId}/release`, {});
      await load();
      await onChanged();
    } catch (err) {
      onError(err);
    }
  };

  const renew = async () => {
    setBusy(true);
    try {
      await api.post(`/people/licenses/${id}/renew`, renewal);
      setRenewal(null);
      await load();
      await onChanged();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    const why2 = window.prompt(
      `Stop paying for ${license.name}?\n\nThe row stays, the history stays, and NOTHING is released — the software is still installed on those machines tomorrow morning. Why?`,
      ''
    );
    if (why2 === null) return;
    try {
      await api.post(`/people/licenses/${id}/cancel`, { why: why2 });
      await load();
      await onChanged();
    } catch (err) {
      onError(err);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete ${license.name} from the register? Only something nothing has happened to can go.`)) return;
    try {
      await api.del(`/people/licenses/${id}`);
      await onChanged();
      onClose();
    } catch (err) {
      onError(err);
    }
  };

  const openSeats = license.seats_list.filter((s) => !s.released_on);
  const pastSeats = license.seats_list.filter((s) => s.released_on);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="late-head">
          <div>
            <h2>{license.name}</h2>
            <p className="muted small">
              {license.term_label} · <Where row={license} />
              {license.cancelled_on && ` · cancelled ${license.cancelled_on}${license.cancelled_why ? ` (${license.cancelled_why})` : ''}`}
            </p>
          </div>
          <button className="ghost" onClick={onClose}>
            Close
          </button>
        </div>

        {/* ---------------- the key ---------------- */}
        <div className="card">
          <h3>Licence key</h3>
          {!license.has_key ? (
            <>
              <p className="muted small">
                Nothing on file. Reinstalling needs it, so it is worth finding the invoice now rather
                than on the morning the machine is rebuilt.
              </p>
              <label>
                Key
                <input
                  placeholder="type it once"
                  onBlur={(e) => e.target.value.trim() && patch({ key: e.target.value.trim() })}
                />
              </label>
            </>
          ) : key !== null ? (
            <>
              <p>
                <code className="key-shown">{key || '— nothing on file —'}</code>
              </p>
              <p className="muted small">
                This was recorded on the audit trail with your name and your reason. Close this panel
                to put it away.
              </p>
            </>
          ) : asking ? (
            <>
              <label>
                What do you need it for?
                <input
                  autoFocus
                  value={why}
                  onChange={(e) => setWhy(e.target.value)}
                  placeholder="reinstalling on the accounts PC"
                />
              </label>
              <div className="row">
                <button className="primary" disabled={busy} onClick={show}>
                  {busy ? 'One moment…' : 'Show the key'}
                </button>
                <button className="ghost" onClick={() => setAsking(false)}>
                  Never mind
                </button>
              </div>
            </>
          ) : (
            <>
              <p>
                <code>{license.key_masked}</code>
              </p>
              <p className="muted small">
                The last four only. Showing the whole key records who asked and why, because a key
                that has been read out cannot be called back.
              </p>
              <button onClick={() => setAsking(true)}>Show the key</button>
            </>
          )}
        </div>

        {/* ---------------- the details ---------------- */}
        <div className="card">
          <h3>What it is</h3>
          <div className="form-grid">
            {field({ name: 'name', label: 'Software' })}
            {field({ name: 'kind', label: 'Kind', options: [['', '—'], ...LICENSE_KINDS.map((k) => [k, k])] })}
            {field({ name: 'publisher', label: 'Publisher' })}
            {field({ name: 'version', label: 'Version' })}
            {field({ name: 'company_id', label: 'Company', options: [['', '—'], ...companies.map((c) => [String(c.id), c.name])] })}
            {field({ name: 'term', label: 'Held as', options: LICENSE_TERMS.map(([k, l]) => [k, l]), hint: termNote(license.term) })}
            {field({ name: 'account_email', label: 'Account it sits under', hint: 'where the renewal notice lands' })}
            {field({ name: 'seats', label: 'Seats', placeholder: 'blank = nobody counting', hint: license.seat_use.counted ? `${license.seat_use.used} in use` : 'a site licence' })}
            {field({ name: 'purchased_on', label: 'Bought on', type: 'date' })}
            {field({ name: 'expires_on', label: 'Runs until', type: 'date', disabled: license.term === 'perpetual' || license.term === 'free', hint: license.term === 'perpetual' ? 'bought outright — it does not expire' : '' })}
            {field({ name: 'cost', label: 'Cost (this period)' })}
            {field({ name: 'renew_every_months', label: 'Renewed every (months)', hint: 'so the yearly figure can be worked out' })}
            {field({ name: 'vendor', label: 'Vendor' })}
            {field({ name: 'invoice_no', label: 'Invoice' })}
            {field({ name: 'amc_until', label: 'AMC until', type: 'date' })}
            {field({ name: 'amc_cost', label: 'AMC cost' })}
          </div>
          <label className="block">
            Note
            <input key={license.note ?? ''} defaultValue={license.note ?? ''} onBlur={(e) => patch({ note: e.target.value })} />
          </label>
          <p className="muted small">
            Cost a year:{' '}
            <strong>
              {license.annual_cost === null ? 'cannot be worked out — a cost with no period' : rupees(license.annual_cost)}
            </strong>
          </p>
        </div>

        {/* ---------------- seats ---------------- */}
        <div className="card">
          <h3>
            Who is using it{' '}
            <span className="muted small">
              {license.seat_use.counted
                ? `${license.seat_use.used} of ${license.seat_use.seats}`
                : `${license.seat_use.used} — no seat count set`}
            </span>
          </h3>
          {license.seat_use.over && (
            <p className="lic-alert warn">
              <strong>
                {license.seat_use.used} installs on {license.seat_use.seats} seats — over by{' '}
                {license.seat_use.over_by}.
              </strong>{' '}
              Recorded rather than refused: the install exists whether or not this register admits
              it. Either buy the seats or take one off a machine.
            </p>
          )}

          {!openSeats.length ? (
            <p className="muted small">Nobody yet.</p>
          ) : (
            <table className="sheet">
              <thead>
                <tr>
                  <th>Who</th>
                  <th>On</th>
                  <th>Since</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {openSeats.map((s) => (
                  <tr key={s.id}>
                    <td>{s.employee_name || <span className="muted">a machine</span>}</td>
                    <td className="small">
                      {s.device || s.asset_label || <span className="muted">—</span>}
                      {s.asset_code && <span className="muted"> {s.asset_code}</span>}
                    </td>
                    <td className="small">{s.assigned_on}</td>
                    <td>
                      <button className="tiny" onClick={() => release(s.id)}>
                        Release
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="row" style={{ marginTop: '0.6rem', flexWrap: 'wrap' }}>
            <select value={seat.employee_id} onChange={(e) => setSeat({ ...seat, employee_id: e.target.value })}>
              <option value="">— somebody —</option>
              {onStaff(employees).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
            <input
              placeholder="or the machine: ACCOUNTS-PC"
              value={seat.device}
              onChange={(e) => setSeat({ ...seat, device: e.target.value })}
            />
            <button disabled={busy || (!seat.employee_id && !seat.device.trim())} onClick={assign}>
              Give it a seat
            </button>
          </div>

          {pastSeats.length > 0 && (
            <details style={{ marginTop: '0.6rem' }}>
              <summary className="small muted">{pastSeats.length} released earlier</summary>
              <ul className="small muted">
                {pastSeats.map((s) => (
                  <li key={s.id}>
                    {s.employee_name || s.device || s.asset_label} — {s.assigned_on} to {s.released_on}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>

        {/* ---------------- v2.40.0: terms the redesign added ---------------- */}
        <div className="card">
          <h3>{category === 'rent' ? 'Agreement terms' : category === 'insurance' ? 'Policy terms' : 'Terms and responsibility'}</h3>
          <div className="form-grid">
            {field({
              name: 'responsible_id',
              label: 'Responsible person',
              options: [['', '—'], ...onStaff(employees).map((e) => [String(e.id), e.name])],
              hint: 'who sees to the renewal',
            })}
            {field({ name: 'starts_on', label: category === 'rent' ? 'Agreement start' : category === 'insurance' ? 'Policy start' : 'Start date', type: 'date' })}
            {field({ name: 'payment_status', label: 'Payment', options: [['', 'Not said'], ['paid', 'Paid'], ['pending', 'Pending'], ['overdue', 'Overdue']] })}
            {field({ name: 'auto_renew', label: 'Renewal type', options: [['0', 'Manual'], ['1', 'Auto-renews']] })}
            {category === 'rent' ? (
              <>
                {field({ name: 'property_address', label: 'Property address' })}
                {field({ name: 'security_deposit', label: 'Security deposit (₹)' })}
                {field({ name: 'lock_in_months', label: 'Lock-in (months)' })}
                {field({ name: 'notice_days', label: 'Notice period (days)' })}
                {field({ name: 'escalation_pct', label: 'Rent escalation (% a renewal)' })}
              </>
            ) : null}
            {category === 'insurance' ? (
              <>
                {field({ name: 'policy_type', label: 'Policy type', options: [['', '—'], ...['Fire', 'Office package', 'Group health', 'Group term life', 'Vehicle', 'Electronic equipment', 'Public liability', 'Marine / transit', 'Other'].map((t) => [t, t])] })}
                {field({ name: 'insured_item', label: 'Insured property / asset' })}
                {field({ name: 'coverage_amount', label: 'Coverage (sum insured, ₹)' })}
              </>
            ) : null}
          </div>
        </div>

        {/* ---------------- the renewal workflow ---------------- */}
        <RenewalWorkflow license={license} canApprove={canApprove} onDone={async () => { await load(); await onChanged(); }} onError={onError} />

        {/* ---------------- renewals ---------------- */}
        <div className="card">
          <h3>Renewal history</h3>
          {!license.renewals.length ? (
            <p className="muted small">Nothing recorded yet.</p>
          ) : (
            <table className="sheet">
              <thead>
                <tr>
                  <th>Paid on</th>
                  <th>Period</th>
                  <th className="num">Cost</th>
                  <th>Invoice</th>
                  <th>By</th>
                </tr>
              </thead>
              <tbody>
                {license.renewals.map((r) => (
                  <tr key={r.id}>
                    <td className="small">{r.renewed_on}</td>
                    <td className="small">
                      {r.period_from || '?'} → {r.period_to}
                    </td>
                    <td className="num">{rupees(r.cost)}</td>
                    <td className="small">{r.invoice_no || <span className="muted">—</span>}</td>
                    <td className="small">{r.by_whom || <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {!renewal ? (
            <button
              style={{ marginTop: '0.6rem' }}
              onClick={() =>
                setRenewal({
                  renewed_on: today(),
                  period_from: suggested?.from || today(),
                  period_to: suggested?.to || '',
                  cost: suggested?.cost || license.cost || '',
                  invoice_no: '',
                  vendor: license.vendor || '',
                })
              }
            >
              Record a renewal
            </button>
          ) : (
            <>
              <div className="form-grid" style={{ marginTop: '0.6rem' }}>
                <label>
                  Paid on
                  <input type="date" value={renewal.renewed_on} onChange={(e) => setRenewal({ ...renewal, renewed_on: e.target.value })} />
                </label>
                <label>
                  Period from
                  <input type="date" value={renewal.period_from} onChange={(e) => setRenewal({ ...renewal, period_from: e.target.value })} />
                </label>
                <label>
                  Now runs until
                  <input type="date" value={renewal.period_to} onChange={(e) => setRenewal({ ...renewal, period_to: e.target.value })} />
                </label>
                <label>
                  Cost
                  <input value={renewal.cost} onChange={(e) => setRenewal({ ...renewal, cost: e.target.value })} />
                </label>
                <label>
                  Invoice
                  <input value={renewal.invoice_no} onChange={(e) => setRenewal({ ...renewal, invoice_no: e.target.value })} />
                </label>
                <label>
                  Vendor
                  <input value={renewal.vendor} onChange={(e) => setRenewal({ ...renewal, vendor: e.target.value })} />
                </label>
              </div>
              <p className="muted small">
                The dates are filled in from what this licence already carries — the suggestion runs
                from {suggested?.from} for {suggested?.months} months. Change them to what was
                actually paid for.
              </p>
              <div className="row">
                <button className="primary" disabled={busy || !renewal.period_to} onClick={renew}>
                  {busy ? 'Saving…' : 'Record it'}
                </button>
                <button className="ghost" onClick={() => setRenewal(null)}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>

        {/* ---------------- retiring it ---------------- */}
        <div className="card">
          <h3>Stop using it</h3>
          {license.cancelled_on ? (
            <>
              <p className="muted small">
                Cancelled {license.cancelled_on}
                {license.cancelled_why ? ` — ${license.cancelled_why}` : ''}. It is off the renewal
                lists and out of the yearly figure.
              </p>
              <button
                onClick={async () => {
                  try {
                    await api.post(`/people/licenses/${id}/uncancel`, {});
                    await load();
                    await onChanged();
                  } catch (err) {
                    onError(err);
                  }
                }}
              >
                Put it back in use
              </button>
            </>
          ) : (
            <>
              <p className="muted small">
                Cancelling keeps the row and the history, and <strong>releases no seats</strong> — the
                software is still on those machines the morning after somebody stops paying.
                Uninstalling is a job somebody does, and releasing each seat is how it gets recorded.
              </p>
              <div className="row">
                <button onClick={cancel}>Cancel the licence</button>
                <button
                  className="ghost danger"
                  onClick={remove}
                  title="Only something with no renewals and no seat history can be deleted"
                >
                  Delete
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * THE RENEWAL WORKFLOW (v2.40.0): review -> approval -> payment -> renewed.
 *
 * Each step is the server's `moveLicenseStage`; "Mark renewed" is the same
 * renewal record above, so the old term is in the history before the new one
 * replaces it. Approving needs a Manager or an Admin.
 */
function RenewalWorkflow({ license, canApprove, onDone, onError }) {
  const [form, setForm] = useState({
    proposed_cost: license.proposed_cost ?? license.cost ?? '',
    proposed_until: license.proposed_until || '',
    note: license.proposal_note || '',
  });
  const [busy, setBusy] = useState(false);
  if (license.cancelled_on) return null;
  const stage = license.renewal_stage || null;
  const steps = Object.entries(STAGE_STEPS).filter(([key, s]) => s.from.includes(stage) && (!s.approve || canApprove));
  const go = async (step) => {
    const problem = stageProblem(license, step, { canApprove, proposed_until: form.proposed_until, note: form.note });
    if (problem) return onError(new Error(problem));
    setBusy(true);
    try {
      await api.post(`/people/licenses/${license.id}/stage`, { step, ...form });
      await onDone();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };
  const markRenewed = async () => {
    if (!window.confirm(`Mark ${license.name} renewed to ${license.proposed_until} for ${rupees(license.proposed_cost || 0)}? The current term goes into the history first.`)) return;
    setBusy(true);
    try {
      await api.post(`/people/licenses/${license.id}/renew`, {
        period_from: license.expires_on || '',
        period_to: license.proposed_until,
        cost: license.proposed_cost || license.cost || 0,
        vendor: license.vendor || '',
        note: license.proposal_note || '',
      });
      await onDone();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };
  const order = ['review', 'pending_approval', 'pending_payment'];
  return (
    <div className="card rw-card">
      <h3>Renewal</h3>
      <ol className="rw-steps">
        {['Upcoming', 'Review', 'Approval', 'Payment', 'Renewed'].map((label, i) => {
          const at = stage ? order.indexOf(stage) + 1 : 0;
          return (
            <li key={label} className={i < at ? 'done' : i === at ? 'now' : ''}>
              {label}
            </li>
          );
        })}
      </ol>
      {stage ? (
        <p className="small">
          <span className="pill pr-warn">{STAGE_LABELS[stage]}</span>{' '}
          {license.proposed_until ? `New term to ${license.proposed_until}` : ''}
          {license.proposed_cost ? ` · ${rupees(license.proposed_cost)}` : ''}
          {license.approved_by ? ` · approved by ${license.approved_by}` : ''}
        </p>
      ) : (
        <p className="muted small">
          Currently runs until {license.expires_on || 'no date'}{license.cost ? ` at ${rupees(license.cost)}` : ''}. Start a review to
          propose the new terms.
        </p>
      )}
      {stage !== 'pending_payment' ? (
        <div className="form-grid">
          <label>
            New amount (₹)
            <input value={form.proposed_cost} onChange={(e) => setForm({ ...form, proposed_cost: e.target.value })} />
          </label>
          <label>
            New end date
            <input type="date" value={form.proposed_until} onChange={(e) => setForm({ ...form, proposed_until: e.target.value })} />
          </label>
          <label className="wide">
            Remarks
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="needed to send back or drop" />
          </label>
        </div>
      ) : null}
      <div className="row">
        {steps.map(([key, s]) => (
          <button
            key={key}
            disabled={busy}
            className={key === 'approve' || key === 'submit' ? 'primary' : key === 'withdraw' || key === 'reject' ? 'danger' : undefined}
            onClick={() => go(key)}
          >
            {s.label}
          </button>
        ))}
        {stage === 'pending_payment' ? (
          <button className="primary" disabled={busy} onClick={markRenewed}>
            Paid — mark renewed
          </button>
        ) : null}
        {stage === 'pending_approval' && !canApprove ? (
          <span className="muted small">Waiting for a Manager or an Admin to approve.</span>
        ) : null}
      </div>
      <p className="muted small">
        Attach the new invoice and the renewed contract under the record's papers. Nothing is sent to anybody: the
        renewal shows on the Overview and in the reminders.
      </p>
    </div>
  );
}
