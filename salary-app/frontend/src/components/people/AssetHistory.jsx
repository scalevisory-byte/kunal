import { useEffect, useMemo, useRef, useState } from 'react';
import { STANDALONE, api, openPage, pageDataUrl } from '../../api.js';
import { rupees } from '../../format.js';

/**
 * One asset's whole life, in date order: bought, issued, returned, checked,
 * written off.
 *
 * Assembled from the rows that already hold each of those — the asset, the
 * handover log, the stock-take verdicts — so nothing here is stored twice and
 * nothing can disagree with the register.
 */
export default function AssetHistory({ asset, onClose, onError }) {
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
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const file = useRef(null);

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
    })();
    loadPhotos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset.id]);

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

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="late-head">
          <div>
            <h3>
              {asset.code} — {asset.kind} {asset.label}
            </h3>
            <p className="muted small">
              {[asset.identifier, asset.company_name, asset.branch_name].filter(Boolean).join(' · ')}
            </p>
          </div>
          <button className="ghost" onClick={onClose}>
            Close
          </button>
        </div>

        {/*
          * The label, shown inline. Offline there is no URL to point an <img>
          * at, so the same shared builder makes the SVG and it goes in as a
          * data URI - which is also why it is encoded rather than inlined raw.
          */}
        {asset.code && labelSrc && (
          <img className="asset-label" src={labelSrc} alt={`Barcode for ${asset.code}`} />
        )}

        <div className="figures">
          <div className="figure">
            <span className="k">Cost</span>
            <span className="n">{asset.purchase_cost ? rupees(asset.purchase_cost) : '—'}</span>
          </div>
          <div className="figure">
            <span className="k">Bought</span>
            <span className="n">{asset.purchase_date || '—'}</span>
          </div>
          <div className="figure">
            <span className="k">Warranty</span>
            <span className="n">{asset.warranty_until || '—'}</span>
          </div>
        </div>

        {asset.vendor && (
          <p className="muted small">
            From {asset.vendor}
            {asset.invoice_no ? `, invoice ${asset.invoice_no}` : ''}.
          </p>
        )}

        {!found ? (
          <p className="muted small">Reading its history…</p>
        ) : !found.events.length ? (
          <p className="muted small">Nothing has happened to it yet.</p>
        ) : (
          <table className="sheet">
            <thead>
              <tr>
                <th>When</th>
                <th>What</th>
                <th>Who</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {found.events.map((e, i) => (
                <tr key={`${e.on}-${e.what}-${i}`}>
                  <td>{e.on}</td>
                  <td>
                    {e.what}
                    {e.amount ? <span className="muted small"> {rupees(e.amount)}</span> : null}
                  </td>
                  <td>{e.who || <span className="muted">—</span>}</td>
                  <td className="muted small">
                    {e.detail || '—'}
                    {e.by && <div>by {e.by}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/*
          * Photographs. What condition something was in when it went out, and
          * what condition it came back in, is the whole of most arguments
          * about an asset - and a line saying "scratched" settles nothing.
          */}
        <h4 style={{ margin: '1rem 0 0.4rem' }}>
          Photographs{photos.length ? ` — ${photos.length}` : ''}
        </h4>
        {photos.length > 0 && (
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
        )}
        <div className="row" style={{ marginTop: '0.4rem' }}>
          {/* capture="environment" opens the camera straight on a phone, which
              is where somebody standing next to the laptop actually is. */}
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
          JPG, PNG, WEBP or HEIC. The file lives on the server, never in this page, and is opened
          through a link that expires.
        </p>

        <div className="row">
          <button className="ghost" onClick={() => openPage(`/people/assets/${asset.id}/label.svg?h=18`).catch(onError)}>
            Print the label
          </button>
          <button
            className="ghost"
            onClick={() => openPage(`/people/assets/${asset.id}/voucher.html`).catch(onError)}
            title="The purchase voucher, to hand to accounts"
          >
            Purchase voucher
          </button>
        </div>
      </div>
    </div>
  );
}
