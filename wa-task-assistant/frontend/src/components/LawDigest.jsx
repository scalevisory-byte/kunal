import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { Row, Toggle } from './SchedulingSettings.jsx';

/**
 * The morning law digest, on its own page.
 *
 * It began at the bottom of the reminder settings, under the engine, the
 * briefing and the weekly review - and was not found. That was the right
 * reading of it as a *setting* and the wrong reading of what it is: everything
 * else on that page is about the user's own tasks, and this is not about tasks
 * at all. It is a thing the app reads and writes for him every morning, so it
 * gets a place in the sidebar like the other things that run on their own.
 *
 * The switch and the time live here too. One control in one place - having them
 * in Settings as well would be two answers to "is this on".
 */
export default function LawDigest({ onError }) {
  const [settings, setSettings] = useState(null);
  const [timezone, setTimezone] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await api.schedulingSettings();
      setSettings(data.settings);
      setTimezone(data.timezone);
    } catch (err) {
      onError(err);
    }
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  const save = async (patch) => {
    setSettings((s) => ({ ...s, ...patch }));
    try {
      const data = await api.saveSchedulingSettings(patch);
      setSettings(data.settings);
    } catch (err) {
      onError(err);
      load();
    }
  };

  if (!settings) return null;

  return (
    <section className="settings">
      <Row
        label="Law update on WhatsApp"
        note="Yesterday's notifications and circulars in five Hinglish lines, to your own chat. Costs about ₹1–2 a day in AI, whether or not anything was published."
      >
        <Toggle on={settings.lawDigest} label="Daily law digest"
          onChange={(v) => save({ lawDigest: v })} />
      </Row>

      <Row label="Digest time" note={`Sent at this time, ${timezone}.`}>
        <input type="time" value={settings.lawDigestTime} disabled={!settings.lawDigest}
          onChange={(e) => save({ lawDigestTime: e.target.value })} />
      </Row>

      <Panel onError={onError} />
    </section>
  );
}

/**
 * The law digest: what was last built, and the two buttons that build a new one.
 *
 * Neither button is pressed for you. The other previews on this page read rows
 * already in the database and cost nothing, so they load themselves; this one
 * fetches five feeds and pays Claude for a summary, so opening Settings must
 * not spend money. What you see on arrival is the digest that was last built.
 */
function Panel({ onError }) {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState('');
  const [fresh, setFresh] = useState(null);

  const load = useCallback(async () => {
    try {
      setState(await api.lawDigest());
    } catch (err) {
      onError(err);
    }
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  const run = async (what) => {
    setBusy(what);
    setResult('');
    try {
      if (what === 'preview') {
        const out = await api.previewLawDigest();
        setFresh(out.text);
        setResult(out.items
          ? `Read ${out.items} article${out.items === 1 ? '' : 's'} from the feeds.`
          : 'The feeds answered — nothing new was published.');
      } else {
        const out = await api.runLawDigest();
        setFresh(out.text || null);
        setResult(out.sent
          ? 'Sent to your own WhatsApp chat.'
          : `Not sent — ${out.reason}${out.error ? `: ${out.error}` : ''}.`);
      }
      load();
    } catch (err) {
      // A feed that will not answer is the ordinary failure here, and saying
      // which one beats a red banner that says "something went wrong".
      setResult(err?.message ? `Failed — ${err.message}` : 'Failed.');
    } finally {
      setBusy('');
    }
  };

  if (!state) return null;

  const today = state.today;
  const text = fresh || today?.text;
  const past = state.recent.filter((d) => d.day !== state.day);

  return (
    <div className="briefing-preview">
      <div className="briefing-preview-head">
        <strong>Today's digest</strong>
        <span>
          {today?.sent_at
            ? `Sent ${new Date(`${today.sent_at}Z`).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
            : today
              ? 'Built, not sent yet'
              : 'Not built yet today'}
        </span>
      </div>

      {/*
        * What the schedule tried and could not do.
        *
        * The morning attempt leaves its reason on the claim row, not on a
        * digest - there is no digest to leave it on. Without this the panel
        * said "not built yet today" after three failed attempts, which reads
        * as "nothing has happened" when in fact the feeds were unreachable.
        */}
      {!text && state.sent?.error && (
        <p className="digest-failed">
          Tried this morning and could not: {state.sent.error}
        </p>
      )}

      {text
        ? <pre>{text}</pre>
        : (
          <p className="dim">
            Nothing built today. “Fetch now” reads the feeds and writes the digest
            without sending it.
          </p>
        )}

      <div className="briefing-preview-foot">
        <button type="button" className="btn ghost" disabled={Boolean(busy)}
          onClick={() => run('preview')}>
          {busy === 'preview' ? 'Fetching…' : 'Fetch now'}
        </button>
        <button type="button" className="btn ghost" disabled={Boolean(busy)}
          onClick={() => run('send')}>
          {busy === 'send' ? 'Sending…' : 'Send now'}
        </button>
        {result && <small>{result}</small>}
      </div>

      <small className="dim">
        Sources: {state.sources.join(' · ')}. Read once a day, covering the last
        26 hours. The message goes to your own WhatsApp chat only.
      </small>

      {/*
        * Counted from the days that are actually in the fold, not from the
        * whole list: with yesterday's digest stored and none built today the
        * list is one long, and "> 1" hid the only thing there was to show.
        */}
      {past.length > 0 && (
        <details className="digest-past">
          <summary>Earlier digests ({past.length})</summary>
          {past.map((d) => (
            <div key={d.day}>
              <strong>{d.day}</strong>
              {d.sent_at ? ' · sent' : ' · not sent'}
              {d.error ? ` · ${d.error}` : ''}
              <pre>{d.text}</pre>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
