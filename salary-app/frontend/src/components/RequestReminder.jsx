import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { reminderDue, reminderSignature, REMIND_EVERY_MS } from '../../../shared/requestReminder.js';

/*
 * WHAT STAFF ARE WAITING ON, OVER WHATEVER THE OFFICE IS DOING.
 *
 * Dinesh: *"koi employee kuch request kare uska dashboard me kuch popup
 * chahiye, or uspe action na lo tab tak every hour popup"*. The counts were
 * already in the top bar and the lines on the dashboard; somebody on the
 * salary sheet all morning saw neither.
 *
 * So: a box that comes up when something staff asked for is waiting, again
 * an hour after it was put away, and AT ONCE when something new arrives. It
 * goes away for good only by being dealt with - the lines come off the
 * digest when the request is decided, and with nothing left there is nothing
 * to show. "Remind me in an hour" is the only other way out, and it says so.
 *
 * Nothing here decides anything. Each line opens the screen that can.
 * The time it was put away is kept in this browser only: a reminder is a
 * convenience for the person at this desk, not a record of anything.
 */

const KEY = 'salary-app-request-reminder-v1';

const readSeen = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    return null;
  }
};
const writeSeen = (value) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    /* a private window: it simply reminds again next time */
  }
};

export default function RequestReminder({ onGo }) {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const itemsRef = useRef([]);

  useEffect(() => {
    let alive = true;
    const ask = () =>
      api
        .get('/people/digest')
        .then((got) => {
          if (!alive) return;
          const waiting = (got?.items || []).filter((i) => i.staff);
          itemsRef.current = waiting;
          setItems(waiting);
          if (reminderDue(waiting, readSeen(), Date.now())) setOpen(true);
          if (!waiting.length) setOpen(false);
        })
        // A login without the People right has no such list; it gets no box.
        .catch(() => {});
    ask();
    // Asked every five minutes: the digest reads a fair amount, and a new
    // request still surfaces within five minutes of arriving.
    const timer = setInterval(ask, 5 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const later = () => {
    writeSeen({ at: Date.now(), signature: reminderSignature(itemsRef.current) });
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && later();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open || !items.length) return null;
  const minutes = Math.round(REMIND_EVERY_MS / 60000);
  return (
    <div className="modal-backdrop" onClick={later}>
      <div className="modal request-reminder" role="alertdialog" onClick={(e) => e.stopPropagation()}>
        <header className="rr-head">
          <h3>Staff are waiting on the office</h3>
          <button className="ghost" onClick={later} title="Remind me later">×</button>
        </header>
        <ul className="rr-list">
          {items.map((item) => (
            <li key={item.text}>
              <button
                className="pa-row"
                onClick={() => {
                  later();
                  onGo(item.go || 'people', item.focus);
                }}
              >
                <span className="pa-name">{item.text}</span>
                <span className="rr-open">Open →</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="muted small">
          This comes back every {minutes} minutes until each one is decided, and straight away when
          something new comes in. Nothing here approves anything — open the line to act on it.
        </p>
        <div className="rr-actions">
          <button className="primary" onClick={later}>Remind me in an hour</button>
        </div>
      </div>
    </div>
  );
}
