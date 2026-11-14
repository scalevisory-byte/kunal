import { useEffect, useState } from 'react';
import { STANDALONE, api } from '../../api.js';
import { checkOffer, longDate, offerMovesFrom, offerStatusMeta } from '../../../../shared/offer.js';

/**
 * The offer: approve it, then send it.
 *
 * Two acts, two abilities, and nothing in this file can do one as a side
 * effect of the other. The download button does not exist until the offer has
 * been approved - an unapproved letter that can be downloaded is an unapproved
 * letter that gets sent.
 */
export default function Offer({ applicationId, abilities = [], onChanged, onError, onToast }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState({});
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const got = await api.get(`/hiring/applications/${applicationId}/offer`);
      setData(got);
      setForm(got.offer || got.suggested || {});
    } catch (err) {
      onError(err);
    }
  };

  useEffect(() => {
    if (!STANDALONE) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId]);

  if (STANDALONE || !data) return null;

  const offer = data.offer;
  const status = offer?.status || 'draft';
  const editable = !offer || status === 'draft';
  const problems = checkOffer(form);
  const moves = offer ? offerMovesFrom(status, abilities) : [];
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/hiring/applications/${applicationId}/offer`, form);
      onToast('Offer saved as a draft');
      await load();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  const move = async (to) => {
    setBusy(true);
    try {
      await api.post(`/hiring/applications/${applicationId}/offer/move`, { to, remarks });
      onToast(to === 'approved' ? 'Approved — the letter can be sent now' : 'Recorded');
      setRemarks('');
      await load();
      onChanged?.();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  /*
   * The letter downloads as a file rather than opening in a tab.
   *
   * The route sends it as an attachment, so there is nothing for a tab to
   * show - the CV button learnt that the hard way, through a pop-up blocker
   * and an about:blank. An anchor with `download` and an absolute href, no tab
   * at all.
   */
  const download = () => {
    const a = document.createElement('a');
    a.href = `${window.location.origin}/api/hiring/applications/${applicationId}/offer/letter`;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const FIELDS = [
    ['designation', 'Position', 'text'],
    ['department', 'Department', 'text'],
    ['location', 'Place of work', 'text'],
    ['reports_to', 'Reporting to', 'text'],
    ['salary', 'Monthly salary', 'number'],
    ['joining_date', 'Date of joining', 'date'],
    ['probation', 'Probation', 'text'],
    ['working_hours', 'Working hours', 'text'],
    ['valid_till', 'Offer valid till', 'date'],
  ];

  return (
    <div className="card">
      <h3>Offer</h3>
      <p className="muted small">
        {offer ? (
          <>
            <strong>{offerStatusMeta(status)?.label}</strong> — {offerStatusMeta(status)?.hint}
            {offer.approved_by ? ` · approved by ${offer.approved_by}` : ''}
            {offer.sent_at ? ` · sent ${String(offer.sent_at).slice(0, 10)}` : ''}
            {offer.decline_reason ? ` · they said: ${offer.decline_reason}` : ''}
          </>
        ) : (
          'Nothing offered yet. Fill this in, then an Admin approves it — there is no letter until somebody has.'
        )}
      </p>

      {editable ? (
        <>
          <div className="iv-grid">
            {FIELDS.map(([key, label, type]) => (
              <label className="field" key={key}>
                {label}
                <input
                  type={type}
                  value={form[key] ?? ''}
                  onChange={(e) => set(key, e.target.value)}
                />
              </label>
            ))}
            <label className="field wide">
              Other terms on the letter
              <textarea rows={2} value={form.terms ?? ''} onChange={(e) => set('terms', e.target.value)} />
            </label>
          </div>
          <div className="row">
            {problems.length ? <span className="muted small">{problems[0]}</span> : null}
            <span className="spacer" />
            <button disabled={busy} onClick={save}>Save draft</button>
          </div>
        </>
      ) : (
        <div className="scr-lines">
          {FIELDS.map(([key, label]) => {
            const v = offer[key];
            if (!v) return null;
            return (
              <div className="scr-line unknown" key={key}>
                <span className="scr-mark">·</span>
                <span className="scr-label">{label}</span>
                <span className="scr-said">
                  {key === 'salary' ? `₹${Math.round(v).toLocaleString('en-IN')}` : null}
                  {key.endsWith('_date') || key === 'valid_till' ? longDate(v) : null}
                  {key !== 'salary' && !key.endsWith('_date') && key !== 'valid_till' ? v : null}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {offer ? (
        <>
          {moves.length ? (
            <>
              <label className="field">
                Remarks
                <input value={remarks} onChange={(e) => setRemarks(e.target.value)} />
              </label>
              <div className="iv-decisions">
                {moves.map((m) => (
                  <button
                    key={m.to}
                    className={m.to === 'approved' ? 'primary' : ''}
                    disabled={busy}
                    onClick={() => move(m.to)}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="muted small">
              {['accepted', 'declined', 'withdrawn'].includes(status)
                ? 'This offer is finished.'
                : 'Nothing for this login to do here — approving is an Admin’s.'}
            </p>
          )}

          {/*
            * No download while it is a draft. The server refuses too; this is
            * so nobody is offered a button that cannot work.
            */}
          {status !== 'draft' ? (
            <div className="row" style={{ marginTop: '0.5rem' }}>
              <button onClick={download}>Download the letter</button>
              <span className="muted small">
                One file, this person only. Opens on any phone, prints to PDF.
              </span>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
