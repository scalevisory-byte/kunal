import { useState } from 'react';

const clock = (iso) => String(iso || '').slice(11, 16);

/*
 * WHERE THEY ARE, AND IF NOT, WHY NOT.
 *
 * This used to resolve `null` for every failure alike, so the server's one
 * message came back for all of them: *"Allow location access and try again."*
 * That is right when somebody tapped Block, and it is ADVICE THEY CANNOT
 * FOLLOW when the page is open over plain http - a browser does not offer the
 * location API there at all, so there is nothing to allow and the punch can
 * never work. Somebody would tap it all morning.
 *
 * Only the phone knows which of the four it was, so it says.
 *
 * IT LIVES HERE, ONCE, because two screens can punch now - the personal link
 * and the staff portal - and two screens each working out their own advice is
 * exactly how two sets of advice come to exist. The bug above was fixed in
 * one place; a copy would have kept it in the other.
 */
export const where = () =>
  new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({ point: null, problem: 'This browser cannot give a location at all.' });
      return;
    }
    if (window.isSecureContext === false) {
      resolve({
        point: null,
        problem:
          'This page is open over plain http, and a browser will only give a location over https. ' +
          'Open the link the office sent you — it starts with https:// — rather than an address with ' +
          'numbers in it.',
      });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          point: { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy },
          problem: '',
        }),
      (err) =>
        resolve({
          point: null,
          problem:
            err && err.code === 1
              ? 'Location is blocked for this page. Allow it in the browser and tap again.'
              : err && err.code === 3
                ? 'Finding your location took too long. Step outside or near a window and tap again.'
                : 'Your phone could not find a location just now. Try again in a moment.',
        }),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  });

/**
 * ONE PUNCH BUTTON, used by both screens that have one.
 *
 * `post` is handed in because the two doors are different: the personal link
 * posts to `/api/punch/<token>/punch`, where the token says who they are, and
 * the staff portal posts to `/api/me/punch`, where the LOGIN does. What must
 * not differ is everything else - the location helper, which failure says
 * what, and the rule about whose message wins - so all of that is here.
 *
 * It renders nothing of its own about the business: a button, what happened,
 * and the punches of the day it was handed.
 */
export default function PunchNow({ settings, next, punches = [], post, onDone, heading = 'Today' }) {
  const [busy, setBusy] = useState('');
  const [said, setSaid] = useState('');
  const [error, setError] = useState('');

  const enabled = !!settings?.enabled;

  const punch = async (kind) => {
    setBusy('Finding where you are…');
    setError('');
    setSaid('');
    /* Declared out here so the catch below can still see it: the reason the
       location failed is the half of the message only the phone knows. */
    let problem = '';
    try {
      const found = await where();
      problem = found.problem;
      setBusy('Recording…');
      const body = await post({ kind, ...(found.point || {}) });
      setSaid(`${kind === 'in' ? 'Punched in' : 'Punched out'} at ${clock(body.at)} — ${body.where}`);
      await onDone?.();
    } catch (err) {
      /*
       * The server decides whether to refuse; the phone says WHY there was no
       * location. Where the refusal is about the location and we know the
       * reason, ours is the specific one, so it is the one shown.
       */
      const message = err?.message || 'Could not record that';
      setError(problem && /location/i.test(message) ? problem : message);
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="punch-now">
      {!enabled ? (
        <div className="banner">
          Punching from a phone is switched off. Ask the office to turn it on.
        </div>
      ) : null}

      {said ? <div className="banner good">{said}</div> : null}
      {error ? <div className="banner bad">{error}</div> : null}

      <button
        className="primary punch-button"
        disabled={!enabled || !!busy}
        onClick={() => punch(next === 'out' ? 'out' : 'in')}
      >
        {busy || (next === 'out' ? 'Punch OUT' : 'Punch IN')}
      </button>
      <p className="note" style={{ textAlign: 'center' }}>
        {settings?.requireLocation
          ? 'Your location is recorded with each punch.'
          : 'Location is recorded when you allow it.'}
      </p>

      <h3>{heading}</h3>
      {punches.length ? (
        <ul className="jobs">
          {punches
            .slice()
            .reverse()
            .map((p) => (
              <li key={p.id}>
                <strong>{p.kind === 'in' ? 'In' : 'Out'}</strong> at {clock(p.at)}
                <div className="muted small">{p.note}</div>
              </li>
            ))}
        </ul>
      ) : (
        <p className="note">Nothing punched yet today.</p>
      )}
    </div>
  );
}
