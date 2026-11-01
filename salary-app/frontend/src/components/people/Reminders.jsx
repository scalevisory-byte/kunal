import { useEffect, useState } from 'react';
import { api } from '../../api.js';

/**
 * Everything waiting on somebody, as text you can send.
 *
 * Dinesh's list asks for "Notifications — WhatsApp, email and app reminders".
 * This page is the honest half: it works out what there is to say. It does not
 * send, and says so rather than implying plumbing that is not there —
 *
 *   WhatsApp has no legitimate API for a personal number, and his task
 *   assistant already holds a linked session; a second session on the same
 *   number is a risk to the number, so the right shape is for that app to
 *   fetch this text. Email needs an SMTP account and password, which is a
 *   decision about credentials. Push needs keys and a service worker, which
 *   the task assistant has and this app does not.
 *
 * What works today: copy it into WhatsApp, or point a cron at the URL below.
 */
export default function Reminders({ onError }) {
  const [built, setBuilt] = useState(null);
  const [copied, setCopied] = useState('');

  const load = async () => {
    try {
      setBuilt(await api.get('/people/digest'));
    } catch (err) {
      onError(err);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copy = async () => {
    const text = `${built.heading}\n\n${built.text}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied('Copied.');
    } catch {
      // A blocked clipboard is normal on a plain-HTTP address, so select it
      // instead of claiming a copy that did not happen.
      setCopied('Could not copy — select the text and copy it by hand.');
    }
  };

  const url = `${window.location.origin}/api/people/digest?format=text`;

  return (
    <section className="stack">
      <div className="card">
        <div className="late-head">
          <div>
            <h3>{built ? built.heading : 'Working it out…'}</h3>
            <p className="muted small">
              Everything waiting on a decision, a payment or an answer, in one place.
            </p>
          </div>
          <button className="ghost" onClick={load}>
            Again
          </button>
        </div>

        {built && (
          <>
            <pre className="digest">{built.text}</pre>
            <button onClick={copy} disabled={!built.lines.length}>
              Copy it
            </button>{' '}
            {copied && <span className="muted small">{copied}</span>}
          </>
        )}
      </div>

      <div className="card">
        <h4>Sending it</h4>
        <p className="muted small">
          This page works out <em>what</em> to say; it does not send. That is deliberate rather
          than unfinished:
        </p>
        <ul className="alerts">
          <li>
            <strong>WhatsApp</strong> — there is no legitimate API for a personal number, and the
            task assistant already holds a linked session. A second session on the same number
            risks the number, so the right shape is for that app to fetch this text and send it.
          </li>
          <li>
            <strong>Email</strong> — needs an SMTP account and its password. That is a decision
            about credentials, not code.
          </li>
          <li>
            <strong>Phone notifications</strong> — need push keys and a service worker. The task
            assistant has those; this app does not.
          </li>
        </ul>
        <p className="muted small">
          What works today: copy the text above into WhatsApp, or point anything on a schedule at
          this address, which returns it as plain text.
        </p>
        <pre className="digest">{url}</pre>
        <p className="muted small">
          It needs the dashboard password in an <code>Authorization: Bearer</code> header, like
          every other call here.
        </p>
      </div>
    </section>
  );
}
