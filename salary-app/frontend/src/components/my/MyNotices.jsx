import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { kindIcon, kindLabel } from '../../../../shared/announcements.js';

/**
 * THE NOTICEBOARD AND WHAT WE ARE HIRING FOR.
 *
 * Dinesh: *"employee login me current opeing me bhi dikhavo taki o kisi ko
 * refre kar sake / and any announcmnet like celbration holiday o bhi"*.
 *
 * Two things that belong together: both are the office talking to everybody
 * rather than to one person, and both are read, never answered.
 *
 * THE OPENINGS ARE THE ADVERT, NOT THE VACANCY. Only what is already public
 * travels - the internal notes and who the job reports to stay inside.
 */
export default function MyNotices({ onError }) {
  const [notices, setNotices] = useState(null);
  const [openings, setOpenings] = useState([]);
  const [canShare, setCanShare] = useState(true);
  const [copied, setCopied] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const [board, jobs] = await Promise.all([
          api.get('/me/announcements').catch(() => ({ announcements: [] })),
          api.get('/me/openings').catch(() => ({ openings: [], can_share: false })),
        ]);
        setNotices(board.announcements || []);
        setOpenings(jobs.openings || []);
        setCanShare(jobs.can_share !== false);
      } catch (err) {
        onError?.(err);
        setNotices([]);
      }
    })();
  }, []);

  /* Copying to the clipboard can be refused - an insecure page, a locked
     down browser - so it never pretends it worked. */
  const copy = async (text, id) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(0), 2000);
    } catch {
      onError?.(new Error('Your browser would not let the app copy. Select the text and copy it.'));
    }
  };

  if (notices === null) return <p className="muted small">Loading…</p>;

  return (
    <div className="stack">
      <section className="card">
        <h3>Notices</h3>
        {notices.length ? (
          <ul className="plain-list my-notices">
            {notices.map((n) => (
              <li key={n.id} className={`my-notice${n.pinned ? ' pinned' : ''}`}>
                <span className="my-notice-ico" aria-hidden="true">{kindIcon(n.kind)}</span>
                <div>
                  <strong>{n.title}</strong>
                  {n.pinned ? <span className="pill small">pinned</span> : null}
                  {n.body ? <p className="small">{n.body}</p> : null}
                  <p className="muted small">
                    {kindLabel(n.kind)}
                    {n.from_on ? ` · from ${n.from_label || n.from_on}` : ''}
                    {n.until_on ? ` · until ${n.until_label || n.until_on}` : ''}
                    {n.posted_by ? ` · put up by ${n.posted_by}` : ''}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty fo-empty">
            Nothing on the board today. Office notices, celebrations and holiday announcements
            appear here.
          </p>
        )}
      </section>

      <section className="card">
        <h3>We are hiring</h3>
        {openings.length ? (
          <>
            <p className="muted small">
              If you know somebody who would fit, pass the link on. A referral from somebody who
              already works here is worth more than an advert.
            </p>
            <ul className="plain-list my-jobs">
              {openings.map((j) => (
                <li key={j.ref_no} className="my-job">
                  <div>
                    <strong>{j.title}</strong>
                    {j.location ? <span className="muted"> · {j.location}</span> : null}
                    <p className="muted small">
                      {[j.company, j.department, j.employment_type, j.experience_band, j.salary]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    {j.skills ? <p className="small">{j.skills}</p> : null}
                  </div>
                  <div className="my-job-act">
                    {/* The message, ready to send on - the same advert the
                        office posts, so a referral and an advert say the
                        same thing. */}
                    <button className="small" onClick={() => copy(j.share, j.ref_no)}>
                      {copied === j.ref_no ? 'Copied' : 'Copy the message'}
                    </button>
                    {j.apply_url ? (
                      <a className="muted small" href={j.apply_url} target="_blank" rel="noreferrer">
                        {j.apply_url}
                      </a>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
            {!canShare ? (
              <p className="muted small">
                There is no public web address set for this system yet, so the message carries no
                apply link — it says to send a CV instead. The office can set one.
              </p>
            ) : null}
          </>
        ) : (
          <p className="empty fo-empty">
            Nothing open at the moment. Openings appear here as soon as the office publishes one.
          </p>
        )}
      </section>
    </div>
  );
}
