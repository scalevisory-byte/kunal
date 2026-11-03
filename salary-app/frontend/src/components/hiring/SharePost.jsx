import { useState } from 'react';
import { api } from '../../api.js';
import { applyUrl, publicVacancy, vacancyBroadcast } from '../../../../shared/hiringMessages.js';
import { reachablePublicly } from '../../../../shared/publicUrl.js';

/*
 * The step after raising a vacancy: the post to send, and the link to apply
 * with.
 *
 * It used to be one read-only box behind a tab on a panel you had to go and
 * find. Dinesh asked for it as what comes NEXT - "vacancy create ho gaya,
 * uske baad candidate ko bhejne ke liye post, apply karne ke liye link" - so
 * it is now what you are shown the moment a vacancy is published, and it has
 * the two things that sentence names and nothing else.
 *
 * The honest part is the link. It only works when this app is actually
 * reachable on the internet, and the three reasons it might not be are three
 * different sentences, not one shrug:
 *   - nobody has said what the address is       -> a box to type it
 *   - the address is a machine on your own desk -> it works for you alone
 *   - this is the single file on a laptop       -> nothing is serving it
 */

/* The post, in the two shapes people actually send. */
const SHAPES = [
  ['full', 'Full post', 'For a group, a status, or a job board'],
  ['short', 'Short', 'For a one-to-one message'],
];

export default function SharePost({ share, vacancy, onSaved, onToast, onError, offline }) {
  const [shape, setShape] = useState('full');
  const [editing, setEditing] = useState(false);
  const [typed, setTyped] = useState(share?.public_url_base || '');
  const [problem, setProblem] = useState('');
  const [saving, setSaving] = useState(false);

  const v = share?.public || publicVacancy(vacancy || {});
  const base = share?.apply_url ? share.apply_url.replace(/\/apply\/.*$/, '') : '';
  const link = share?.apply_url || '';
  const reachable = share?.apply_url_reachable ?? reachablePublicly(base);

  const text = shape === 'short' ? shortPost(v, link) : share?.broadcast || vacancyBroadcast(vacancy || {}, { baseUrl: base });

  const copy = async (what, said) => {
    try {
      await navigator.clipboard.writeText(what);
      onToast?.(said);
    } catch {
      // A browser that refuses the clipboard is not a failure worth a banner:
      // the text is on screen and selectable.
      onToast?.('Select it and copy');
    }
  };

  const saveUrl = async () => {
    setProblem('');
    setSaving(true);
    try {
      await api.put('/hiring/public-url', { url: typed });
      setEditing(false);
      await onSaved?.();
    } catch (err) {
      setProblem(err?.message || 'Could not save it');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="share-post">
      {!share?.published ? (
        <div className="banner">
          This vacancy is still a draft, so nobody can apply yet. Publish it first — the post
          below is ready either way.
        </div>
      ) : null}

      {/* ---- 1. the link ---- */}
      <section className="sp-block">
        <h3>Apply link</h3>
        {link && reachable ? (
          <>
            <div className="sp-link">
              <input readOnly value={link} onFocus={(e) => e.target.select()} />
              <button className="primary" onClick={() => copy(link, 'Link copied')}>Copy link</button>
            </div>
            <p className="muted small">
              This is the address a candidate opens. It works once this app is running at{' '}
              <strong>{base}</strong>.
            </p>
          </>
        ) : link && !reachable ? (
          <>
            <div className="sp-link">
              <input readOnly value={link} onFocus={(e) => e.target.select()} />
              <button onClick={() => copy(link, 'Link copied')}>Copy link</button>
            </div>
            <p className="warn small">
              That address is on your own machine or network, so the link works for you and
              nobody else. Fine for testing; not for an advert.
            </p>
          </>
        ) : (
          <p className="muted small">
            No address has been set, so there is no link yet. The post below still works —
            candidates reply with their CV.
          </p>
        )}

        {editing ? (
          <div className="sp-set">
            <label className="vf-field">
              <span className="vf-label">Where will this app be reachable?</span>
              <input
                value={typed}
                placeholder="hr.booknfly.in"
                autoFocus
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveUrl()}
              />
              {problem ? <span className="vf-error">{problem}</span> : (
                <span className="vf-hint">
                  The address this app is deployed at. Typing it does not put it online — it is
                  where every apply link, punch link and CV link is built from.
                </span>
              )}
            </label>
            <div className="row">
              <button className="primary" disabled={saving} onClick={saveUrl}>Save address</button>
              <button onClick={() => { setEditing(false); setProblem(''); }}>Cancel</button>
            </div>
          </div>
        ) : (
          <button className="link" onClick={() => { setTyped(base); setEditing(true); }}>
            {base ? 'Change the address' : 'Set the address'}
          </button>
        )}

        {offline ? (
          <p className="muted small" style={{ marginTop: '0.5rem' }}>
            This single file is not serving anything, so even with the address set the link
            will not answer until the server version is running at it. Worth setting now all
            the same: the post is then right the day it goes up.
          </p>
        ) : null}
      </section>

      {/* ---- 2. the post ---- */}
      <section className="sp-block">
        <h3>The post</h3>
        <div className="chips">
          {SHAPES.map(([key, label, why]) => (
            <button
              key={key}
              title={why}
              className={`chip ${shape === key ? 'active' : ''}`}
              onClick={() => setShape(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <textarea className="copy-box sp-text" readOnly value={text} rows={shape === 'short' ? 6 : 14} />
        <div className="row">
          <button className="primary" onClick={() => copy(text, 'Post copied')}>Copy post</button>
          <a
            className="btn"
            target="_blank"
            rel="noreferrer"
            href={`https://wa.me/?text=${encodeURIComponent(text)}`}
          >
            Send on WhatsApp
          </a>
          <span className="muted small">
            Your office notes and who the seat reports to are deliberately not in it.
          </span>
        </div>
      </section>
    </div>
  );
}

/**
 * The same vacancy in four lines, for a message to one person.
 *
 * Built from `publicVacancy` like the long one, so the same things are left
 * out of both - a short post is not a place to let the internal notes slip in.
 */
function shortPost(v, link) {
  const bits = [
    `*${v.title}*${v.location ? ` — ${v.location}` : ''}`,
    [v.company, v.experience_band && `${v.experience_band} experience`, v.salary]
      .filter(Boolean)
      .join(' · '),
    v.skills ? `Skills: ${v.skills}` : '',
    link ? `Apply: ${link}` : 'Reply with your CV to apply.',
    `Ref: ${v.ref_no}`,
  ];
  return bits.filter(Boolean).join('\n');
}
