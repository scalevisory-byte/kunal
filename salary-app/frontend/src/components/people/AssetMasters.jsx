import { useEffect, useState } from 'react';
import { api } from '../../api.js';

/*
 * The four lists behind the pickers: categories, the types under them, brands
 * and vendors.
 *
 * One screen, because they are four lists of names and four screens would be
 * four places to fix the same typo.
 *
 * Nothing here is a gate. An asset stores its category, brand and vendor as
 * TEXT, so a name typed before this list existed keeps working and nobody is
 * stuck at six in the evening because the vendor is not on a list yet. The
 * master makes typing easy; it is not a key, and taking a name off it does
 * not touch a single asset carrying that name.
 */

const VENDOR_BOXES = [
  ['contact_person', 'Who to ask for', 'Rashmi'],
  ['phone', 'Phone', '98250 11223'],
  ['email', 'Email', 'sales@…'],
  ['gstin', 'GSTIN', '24ABCDE1234F1Z5'],
  ['address', 'Address', 'Alkapuri, Vadodara'],
];

const LISTS = [
  ['category', 'Categories', 'The broad groups: IT equipment, Furniture, Vehicles'],
  ['type', 'Types', 'What sits under a category: Laptop, Printer, Desk'],
  ['brand', 'Brands', 'Dell, HP, Samsung'],
  ['vendor', 'Vendors', 'Who it was bought from'],
];

export default function AssetMasters({ onError }) {
  const [kind, setKind] = useState('category');
  const [rows, setRows] = useState([]);
  const [name, setName] = useState('');
  const [parent, setParent] = useState('');
  /* A vendor is somebody you ring up; the other three are just names. */
  const [contact, setContact] = useState({ contact_person: '', phone: '', email: '', address: '', gstin: '' });
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const { masters } = await api.get('/people/asset-masters');
      setRows(masters);
    } catch (err) {
      onError(err);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const categories = rows.filter((r) => r.kind === 'category');
  const shown = rows.filter((r) => r.kind === kind);

  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api.post('/people/asset-masters', {
        kind,
        name: name.trim(),
        parent_id: kind === 'type' ? Number(parent) || null : null,
        ...(kind === 'vendor' ? contact : {}),
      });
      setName('');
      setContact({ contact_person: '', phone: '', email: '', address: '', gstin: '' });
      await load();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  /* Saved on blur, like every other detail box in the app. */
  const patch = async (row, key, value) => {
    if ((row[key] || '') === value) return;
    try {
      await api.patch(`/people/asset-masters/${row.id}`, { [key]: value });
      await load();
    } catch (err) {
      onError(err);
    }
  };

  const remove = async (row) => {
    if (
      !window.confirm(
        `Take ${row.name} off the list?\n\n` +
          'Assets already carrying that name keep it — this only stops it being offered.'
      )
    )
      return;
    try {
      await api.del(`/people/asset-masters/${row.id}`);
      await load();
    } catch (err) {
      onError(err);
    }
  };

  const current = LISTS.find(([k]) => k === kind);

  return (
    <div className="card">
      <div className="chips">
        {LISTS.map(([key, label, hint]) => (
          <button
            key={key}
            title={hint}
            className={`chip ${kind === key ? 'active' : ''}`}
            onClick={() => setKind(key)}
          >
            {label} <span className="muted">{rows.filter((r) => r.kind === key).length}</span>
          </button>
        ))}
      </div>
      <p className="muted small" style={{ marginTop: '0.5rem' }}>{current?.[2]}</p>

      <div className="row" style={{ marginTop: '0.6rem' }}>
        {kind === 'type' && (
          <label className="field inline">
            Under
            <select value={parent} onChange={(e) => setParent(e.target.value)}>
              <option value="">Choose a category…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
        )}
        <input
          value={name}
          placeholder={kind === 'vendor' ? 'Rashmi Computers' : kind === 'brand' ? 'Dell' : 'IT equipment'}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button className="primary" disabled={busy || !name.trim() || (kind === 'type' && !parent)} onClick={add}>
          Add
        </button>
      </div>
      {kind === 'type' && !categories.length ? (
        <p className="muted small">Add a category first — a type under nothing is a type of nothing.</p>
      ) : null}

      {/* A vendor's details, typed with the name rather than afterwards. */}
      {kind === 'vendor' && (
        <div className="grid" style={{ marginTop: '0.5rem' }}>
          {VENDOR_BOXES.map(([key, label, placeholder]) => (
            <label className="field" key={key}>
              {label}
              <input
                value={contact[key]}
                placeholder={placeholder}
                onChange={(e) => setContact({ ...contact, [key]: e.target.value })}
              />
            </label>
          ))}
        </div>
      )}

      <div className="lines" style={{ marginTop: '0.7rem' }}>
        {!shown.length ? (
          <p className="muted small">Nothing on this list yet.</p>
        ) : (
          shown.map((row) => (
            <div key={row.id} className="master-row">
              <span className="what">
                {kind === 'vendor' ? (
                  <button className="link" onClick={() => setOpen(open === row.id ? null : row.id)}>
                    {row.name}
                  </button>
                ) : (
                  row.name
                )}
                {row.parent_name ? <span className="muted small"> · under {row.parent_name}</span> : null}
                {kind === 'vendor' ? (
                  <span className="muted small">
                    {' '}
                    {[row.contact_person, row.phone].filter(Boolean).join(' · ') || 'no contact yet'}
                  </span>
                ) : null}
              </span>
              <button className="link" onClick={() => remove(row)}>remove</button>
              {kind === 'vendor' && open === row.id ? (
                <div className="grid master-contact">
                  {VENDOR_BOXES.map(([key, label, placeholder]) => (
                    <label className="field" key={key}>
                      {label}
                      <input
                        key={`${row.id}-${key}-${row[key] ?? ''}`}
                        defaultValue={row[key] || ''}
                        placeholder={placeholder}
                        onBlur={(e) => patch(row, key, e.target.value)}
                      />
                    </label>
                  ))}
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
