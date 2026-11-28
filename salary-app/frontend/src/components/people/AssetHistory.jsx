import { useEffect, useMemo, useRef, useState } from 'react';
import { STANDALONE, api, openPage, pageDataUrl } from '../../api.js';
import { rupees } from '../../format.js';
import Glyph from '../../icons.jsx';
import { ASSET_STATES, assetStatus, statusLabel } from '../../../../shared/assetStatus.js';
import { isOpenService, isSpent, serviceStatusLabel, statusOfService } from '../../../../shared/serviceStatus.js';
import { ServiceForm } from './Maintenance.jsx';

/*
 * v2.45.0: the asset's page, in tabs, with the actions on it.
 *
 * It used to be one long drawer - figures, a history table, paperwork,
 * photographs - and every action (give it to somebody, take it back, mark it
 * at the repair shop, write it off) lived only on the register's row behind
 * it. The actions here are the REGISTER'S OWN handlers, passed in, not copies:
 * the same prompts, the same requests, the same rules on the server.
 */
const TABS = [
  ['overview', 'Overview'],
  ['history', 'History'],
  ['service', 'Maintenance'],
  ['papers', 'Documents'],
  ['photos', 'Photos'],
];

/**
 * One asset's whole life, in date order: bought, issued, returned, checked,
 * written off.
 *
 * Assembled from the rows that already hold each of those — the asset, the
 * handover log, the stock-take verdicts — so nothing here is stored twice and
 * nothing can disagree with the register.
 */
export default function AssetHistory({ asset, employees = [], actions = null, onClose, onError }) {
  const [tab, setTab] = useState(asset?.open === 'papers' ? 'papers' : 'overview');
  const [services, setServices] = useState(null);
  const [logging, setLogging] = useState(false);
  const [giveTo, setGiveTo] = useState('');
  const [problem, setProblem] = useState('');
  const [tick, setTick] = useState(0);
  /* The inline label: a URL on the server, a data URI in the single file. */
  const labelSrc = useMemo(() => {
    if (!asset?.code) return '';
    const path = `/people/assets/${asset.id}/label.svg?h=14`;
    if (!STANDALONE) return `/api${path}`;
    try {
      return pageDataUrl(path);
    } catch {
      return '';
    }
  }, [asset?.id, asset?.code]);
  const [found, setFound] = useState(null);
  const [photos, setPhotos] = useState([]);
  /* The paperwork: the invoice, the warranty card, the delivery note. */
  const [docs, setDocs] = useState([]);
  const [docKind, setDocKind] = useState('invoice');
  const [docKinds, setDocKinds] = useState([]);
  const docFile = useRef(null);
  const [note, setNote] = useState('');
  /*
   * Opened from the register's Invoice column: scroll to the paperwork rather
   * than landing at the top of a long drawer and making somebody hunt for the
   * thing they clicked.
   */
  const papers = useRef(null);
  const [busy, setBusy] = useState('');
  const file = useRef(null);

  const loadDocs = async () => {
    try {
      const { documents, kinds } = await api.get(`/people/assets/${asset.id}/documents`);
      setDocs(documents || []);
      setDocKinds(kinds || []);
    } catch (err) {
      // Offline this is a refusal with a reason, said beside the button
      // rather than as a banner over a drawer somebody just opened.
      setDocs([]);
    }
  };

  const addDoc = async () => {
    const chosen = docFile.current?.files?.[0];
    if (!chosen) return;
    const form = new FormData();
    form.set('file', chosen);
    form.set('kind', docKind);
    setBusy('Attaching…');
    try {
      await api.upload(`/people/assets/${asset.id}/documents`, form);
      if (docFile.current) docFile.current.value = '';
      await loadDocs();
    } catch (err) {
      onError(err);
    } finally {
      setBusy('');
    }
  };

  const removeDoc = async (doc) => {
    if (!window.confirm(`Remove ${doc.file_name || 'this file'}?`)) return;
    try {
      await api.del(`/people/assets/${asset.id}/documents/${doc.id}`);
      await loadDocs();
    } catch (err) {
      onError(err);
    }
  };

  const loadPhotos = async () => {
    try {
      const { photos: list } = await api.get(`/people/assets/${asset.id}/photos`);
      setPhotos(list);
    } catch (err) {
      onError(err);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        setFound(await api.get(`/people/assets/${asset.id}/history`));
      } catch (err) {
        onError(err);
      }
      try {
        const { services: list } = await api.get(`/people/maintenance/services?asset_id=${asset.id}`);
        setServices(list || []);
      } catch {
        setServices([]);
      }
    })();
    if (!tick) {
      loadPhotos();
      loadDocs();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset.id, tick]);

  /* Run one of the register's handlers; refresh this page; say a refusal here. */
  const run = async (promise) => {
    setProblem('');
    const result = await promise;
    if (result instanceof Error) setProblem(result.message);
    else if (result) setTick((n) => n + 1);
  };

  // Opened from the register's Invoice column: go where they clicked.
  useEffect(() => {
    if (asset.open !== 'papers') return;
    const t = window.setTimeout(
      () => papers.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
      150
    );
    return () => window.clearTimeout(t);
  }, [asset.open, asset.id]);

  const addPhoto = async () => {
    const chosen = file.current?.files?.[0];
    if (!chosen) return;
    setBusy('Uploading…');
    try {
      const form = new FormData();
      form.set('photo', chosen);
      if (note.trim()) form.set('note', note.trim());
      await api.upload(`/people/assets/${asset.id}/photos`, form);
      if (file.current) file.current.value = '';
      setNote('');
      await loadPhotos();
    } catch (err) {
      onError(err);
    } finally {
      setBusy('');
    }
  };

  const removePhoto = async (photo) => {
    if (!window.confirm('Remove this photograph?')) return;
    try {
      await api.del(`/people/assets/${asset.id}/photos/${photo.id}`);
      await loadPhotos();
    } catch (err) {
      onError(err);
    }
  };

  const status = assetStatus(asset);
  const gone = status === 'written_off' || status === 'disposed';
  const held = asset.employee_id && !asset.returned_on;
  const open = (services || []).filter(isOpenService);
  const spent = (services || []).filter(isSpent);
  const spentTotal = spent.reduce((t, s) => t + (Number(s.cost) || 0), 0);
  const fact = (label, value) => (
    <div>
      <dt>{label}</dt>
      <dd>{value || <span className="muted">—</span>}</dd>
    </div>
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal ah-page" onClick={(e) => e.stopPropagation()}>
        <div className="ah-head">
          <span className="ah-icon" aria-hidden="true"><Glyph name="asset" size={22} /></span>
          <div className="ah-title">
            <h3>
              {asset.code || 'No code'} <span className="ah-name">— {asset.kind} {asset.label}</span>
            </h3>
            <p className="muted small">
              <span className={`pill as-${status} ah-pill`}>{statusLabel(status)}</span>{' '}
              {held ? <>with <strong>{asset.employee_name}</strong>{asset.issued_on ? ` since ${asset.issued_on}` : ''}</> : gone ? '' : 'in the office'}
              {[asset.identifier, asset.company_name, asset.branch_name].filter(Boolean).length ? ' · ' : ''}
              {[asset.identifier, asset.company_name, asset.branch_name].filter(Boolean).join(' · ')}
            </p>
          </div>
          <button className="ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/*
          * QUICK ACTIONS. Only what this asset can have done to it now: an
          * asset with somebody is taken back before it goes to anybody else,
          * and a written-off asset keeps only its label and voucher.
          */}
        {actions && (
          <div className="ah-actions">
            {!gone && !held && status === 'available' && (
              <span className="ah-give">
                <select value={giveTo} onChange={(e) => setGiveTo(e.target.value)} aria-label="Give it to">
                  <option value="">Give it to…</option>
                  {employees.filter((e) => e.active !== 0 && e.active !== false).map((e) => (
                    <option key={e.id} value={e.id}>{e.name}{e.code ? ` (${e.code})` : ''}</option>
                  ))}
                </select>
                <button className="primary" disabled={!giveTo} onClick={() => run(actions.issue(asset, giveTo)).then(() => setGiveTo(''))}>
                  Assign
                </button>
              </span>
            )}
            {!gone && held && <button className="primary" onClick={() => run(actions.back(asset))}>Take it back</button>}
            {!gone && <button onClick={() => setLogging(true)}>Log a service</button>}
            {!gone && (
              <select
                className="ah-mark"
                value=""
                onChange={(e) => e.target.value && run(actions.setState(asset, e.target.value === 'clear' ? '' : e.target.value))}
                aria-label="Mark it"
              >
                <option value="">Mark it…</option>
                {ASSET_STATES.filter(([k]) => k !== 'disposed' && k !== asset.state).map(([k, label]) => (
                  <option key={k} value={k}>{label}</option>
                ))}
                {asset.state ? <option value="clear">Back in use</option> : null}
              </select>
            )}
            <button className="ghost" onClick={() => actions.label(asset)}>Print label</button>
            <button className="ghost" onClick={() => actions.voucher(asset)}>Purchase voucher</button>
            {asset.disposal_pending ? (
              <span className="pill pending" title="Nothing changes until a Manager or an Admin approves it">
                {asset.disposal_number}: {asset.disposal_pending === 'dispose' ? 'disposal' : 'write-off'} waiting for approval
              </span>
            ) : (
              <>
                {!gone && <button className="ghost danger" onClick={() => run(actions.writeOff(asset))}>Write off</button>}
                {asset.state !== 'disposed' && actions.dispose && (
                  <button className="ghost danger" onClick={() => run(actions.dispose(asset))}>Dispose</button>
                )}
              </>
            )}
          </div>
        )}
        {problem ? <p className="lic-alert warn">{problem}</p> : null}

        <div className="sub-tabs toolbar ah-tabs">
          {TABS.map(([key, label]) => (
            <button key={key} className={tab === key ? 'active' : undefined} onClick={() => setTab(key)}>
              {label}
              {key === 'service' && open.length ? <span className="ah-count warn">{open.length} open</span> : null}
              {key === 'papers' && docs.length ? <span className="ah-count">{docs.length}</span> : null}
              {key === 'photos' && photos.length ? <span className="ah-count">{photos.length}</span> : null}
            </button>
          ))}
        </div>

        {tab === 'overview' && (
          <>
            <div className="ah-overview">
              <dl className="ah-facts">
                {fact('Bought for', asset.purchase_cost ? rupees(asset.purchase_cost) : null)}
                {fact('Bought on', asset.purchase_date)}
                {fact('Vendor', asset.vendor)}
                {fact('Invoice', asset.invoice_no)}
                {fact('Warranty to', asset.warranty_until)}
                {fact('AMC to', asset.amc_until)}
                {fact('Spent keeping it', services ? rupees(spentTotal) : '…')}
                {fact('Services done', services ? spent.length : '…')}
                {fact('Serial / identifier', asset.identifier)}
                {fact('Where', [asset.company_name, asset.branch_name, asset.location].filter(Boolean).join(' · '))}
              </dl>
              {/*
                * The label, shown inline. Offline there is no URL to point an
                * <img> at, so the same shared builder makes the SVG and it goes
                * in as a data URI.
                */}
              {asset.code && labelSrc && (
                <img className="asset-label" src={labelSrc} alt={`Barcode for ${asset.code}`} />
              )}
            </div>
            {open.length > 0 && (
              <p className="lic-alert warn">
                {open.length === 1 ? 'One job is' : `${open.length} jobs are`} open on it —{' '}
                {open.map((s) => `${s.kind} ${serviceStatusLabel(s).toLowerCase()}${s.serviced_on ? ` (${s.serviced_on})` : ''}`).join(', ')}.{' '}
                <button className="link" onClick={() => setTab('service')}>See maintenance</button>
              </p>
            )}
            {asset.state_note ? <p className="muted small">Note on its status: {asset.state_note}</p> : null}
          </>
        )}

        {tab === 'history' &&
          (!found ? (
            <p className="muted small">Reading its history…</p>
          ) : !found.events.length ? (
            <p className="muted small">Nothing has happened to it yet.</p>
          ) : (
            <ol className="ah-timeline">
              {found.events.map((e, i) => (
                <li key={`${e.on}-${e.what}-${i}`}>
                  <span className="ah-when">{e.on}</span>
                  <span className="ah-what">
                    <strong>{e.what}</strong>
                    {e.amount ? <span className="muted small"> {rupees(e.amount)}</span> : null}
                    {e.who ? <> · {e.who}</> : null}
                    {e.detail ? <span className="muted small"> · {e.detail}</span> : null}
                    {e.by ? <span className="muted small"> · by {e.by}</span> : null}
                  </span>
                </li>
              ))}
            </ol>
          ))}

        {tab === 'service' && (
          <>
            <div className="ah-tab-head">
              <span className="muted small">
                {services ? `${spent.length} completed, ${rupees(spentTotal)} spent` : 'Reading…'}
                {open.length ? ` · ${open.length} open, counted in no total until completed` : ''}
              </span>
              {!gone && <button onClick={() => setLogging(true)}>Log a service</button>}
            </div>
            {services && services.length ? (
              <div className="table-wrap">
                <table className="sheet">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Work</th>
                      <th>Who</th>
                      <th className="num">Cost</th>
                      <th>Status</th>
                      <th>Next due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {services.map((s) => (
                      <tr key={s.id}>
                        <td>{s.serviced_on}</td>
                        <td>{s.kind}{s.work ? <span className="muted small"> · {s.work}</span> : null}{s.under_warranty ? <span className="muted small"> · under cover</span> : null}</td>
                        <td className="muted small">{s.vendor || '—'}</td>
                        <td className="num">
                          {isSpent(s) ? rupees(s.cost || 0) : s.cost ? <span className="muted" title="Quoted — not spent until completed">({rupees(s.cost)})</span> : '—'}
                        </td>
                        <td><span className={`ah-svc s-${statusOfService(s)}`}>{serviceStatusLabel(s)}</span></td>
                        <td className="muted small">{s.next_service_on || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : services ? (
              <p className="muted small">No service on record. Moving booked work along is on Maintenance & Repairs → Open work.</p>
            ) : null}
          </>
        )}

        {tab === 'papers' && (
          <>
            {/*
              * The paperwork. Its own list rather than a field on the asset,
              * because an asset really does collect several over its life.
              */}
            <h4 ref={papers} className="ah-sub">Documents{docs.length ? ` — ${docs.length}` : ''}</h4>
            {docs.length > 0 ? (
              <div className="lines">
                {docs.map((doc) => (
                  <div key={doc.id}>
                    <span className="what">
                      <a href={doc.link?.url} target="_blank" rel="noreferrer">
                        {doc.file_name || 'document'}
                      </a>
                      <span className="muted small">
                        {' '}
                        {[docKinds.find(([k]) => k === doc.kind)?.[1] || doc.kind, doc.number, doc.dated]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    <button className="ghost tiny" onClick={() => removeDoc(doc)}>remove</button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted small">Nothing attached yet.</p>
            )}
            {/*
              * In the single file there is nowhere to put a PDF, so the box
              * that cannot work is not offered.
              */}
            {STANDALONE ? (
              <p className="muted small">
                Attaching the invoice needs the <strong>server version</strong> — a PDF is a file, and a file cannot
                live inside this HTML page. The invoice <em>number</em> and date are on the asset and do work here.
              </p>
            ) : (
              <>
                <div className="row" style={{ marginTop: '0.4rem' }}>
                  <select value={docKind} onChange={(e) => setDocKind(e.target.value)}>
                    {(docKinds.length ? docKinds : [['invoice', 'Invoice']]).map(([k, text]) => (
                      <option key={k} value={k}>{text}</option>
                    ))}
                  </select>
                  <input ref={docFile} type="file" accept=".pdf,image/*" />
                  <button onClick={addDoc} disabled={!!busy}>Attach it</button>
                </div>
                <p className="muted small">
                  A PDF or a scan. The invoice number and date come from the asset, so the commonest one needs nothing
                  typed.
                </p>
              </>
            )}
          </>
        )}

        {tab === 'photos' && (
          <>
            {/*
              * What condition something was in when it went out, and came back
              * in, is the whole of most arguments about an asset.
              */}
            {photos.length > 0 ? (
              <div className="photo-strip">
                {photos.map((photo) => (
                  <figure key={photo.id}>
                    <a href={photo.link?.url} target="_blank" rel="noreferrer" title="Open it full size">
                      <img src={photo.link?.url} alt={photo.note || asset.code} loading="lazy" />
                    </a>
                    <figcaption>
                      <span className="muted small">{photo.taken_on}</span>
                      {photo.note && <span className="small"> {photo.note}</span>}
                      <button className="ghost tiny" onClick={() => removePhoto(photo)}>
                        remove
                      </button>
                    </figcaption>
                  </figure>
                ))}
              </div>
            ) : (
              <p className="muted small">No photographs yet.</p>
            )}
            <div className="row" style={{ marginTop: '0.4rem' }}>
              {/* capture="environment" opens the camera straight on a phone. */}
              <input ref={file} type="file" accept="image/*" capture="environment" />
              <input
                placeholder="what it shows — scratched lid, on handover…"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                style={{ flex: '1 1 14rem' }}
              />
              <button onClick={addPhoto} disabled={!!busy}>
                {busy || 'Add a photo'}
              </button>
            </div>
            <p className="muted small">
              JPG, PNG, WEBP or HEIC. The file lives on the server, never in this page, and is opened through a link
              that expires.
            </p>
          </>
        )}

        {logging && (
          <ServiceForm
            asset={asset}
            onClose={() => setLogging(false)}
            onDone={() => {
              setLogging(false);
              setTick((n) => n + 1);
              setTab('service');
            }}
          />
        )}
      </div>
    </div>
  );
}
