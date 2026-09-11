import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { Row, Toggle } from './SchedulingSettings.jsx';
import LawUpdates from './LawUpdates.jsx';
/*
 * The digest renderer is shared. The two messages have the same grammar -
 * a heading, labelled sections, bullets, a closing line - so a second copy
 * would only drift away from the first.
 */
import { Digest } from './LawDigest.jsx';

/**
 * Legal & court updates: judgments, orders, Acts and amendments.
 *
 * A separate page from the tax digest, and separate on purpose. A circular
 * tells a client what to do by a date; a judgment tells a firm where its
 * arguments now stand. Same shell, its own categories, its own morning.
 *
 * (Was the morning law digest's page.)
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
export default function LegalUpdates({ onError }) {
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
        label="Legal digest on WhatsApp"
        note="The day's judgments, orders and amendments in one message to your own chat, grouped by court. Costs about ₹1–2 a day in AI, whether or not anything was reported."
      >
        <Toggle on={settings.legalDigest} label="Daily legal digest"
          onChange={(v) => save({ legalDigest: v })} />
      </Row>

      <Row
        label="Digest time"
        note={settings.legalDigest
          ? `Sent at this time, ${timezone}.`
          : 'Switched off — nothing arrives on its own. The buttons below still work.'}
      >
        <input type="time" value={settings.legalDigestTime} disabled={!settings.legalDigest}
          onChange={(e) => save({ legalDigestTime: e.target.value })} />
      </Row>

      <Panel onError={onError} />

      {/*
        * The digest above is the day in one message; this is everything it was
        * built from. Same page on purpose - they are two views of one morning's
        * reading, and splitting them would mean checking two places.
        */}
      <LawUpdates onError={onError} module="legal" />
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
      setState(await api.legalDigest());
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
        const out = await api.previewLegal();
        setFresh(out.text);
        setResult(out.items
          ? `Read ${out.items} article${out.items === 1 ? '' : 's'} from the feeds.`
          : 'The sources answered — nothing new was reported.');
      } else {
        const out = await api.runLegal();
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
        <strong>Today's legal digest</strong>
        <span>{status(state, today)}</span>
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

      {/*
        * With nothing built, the shape of the message rather than an empty box.
        *
        * "How does anything get in here?" was a fair question of a panel that
        * showed a sentence and two buttons. This is the five headings the model
        * is asked to fill, with every line deliberately blank: it says what the
        * message answers without inventing a single finding to demonstrate it.
        */}
      {text
        ? <Digest text={text} />
        : (
          <>
            <p className="dim">
              {state.settings.on
                ? <>This builds itself each morning at {state.settings.time} — you do
                  not have to press anything. The buttons are for seeing it sooner:{' '}
                  <strong>Fetch now</strong> reads the five feeds and writes today's
                  digest here without sending it, and <strong>Send now</strong> puts
                  it in your own WhatsApp chat.</>
                : <>It is switched off, so nothing is read on its own.{' '}
                  <strong>Fetch now</strong> reads the five feeds and writes today's
                  digest here without sending it; <strong>Send now</strong> puts it in
                  your own WhatsApp chat.</>}
            </p>
            {/*
              * The empty shape, rendered exactly as a real digest is.
              *
              * It was left as raw monospace when the digest itself was made
              * readable, which meant the page looked broken for the hours
              * before the morning run - the same page, the same box, and the
              * asterisks back. An example of the thing has to look like the
              * thing.
              */}
            <div className="digest-shape">
              <small>The lines it fills in</small>
              <Digest text={state.shape} compact />
            </div>
          </>
        )}

      <div className="briefing-preview-foot">
        <button type="button" className="btn ghost" disabled={Boolean(busy)}
          onClick={() => run('preview')}>
          {busy === 'preview' ? 'Reading the courts…' : 'Fetch judgments'}
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
          <summary>Earlier legal digests ({past.length})</summary>
          {past.map((d) => (
            <div key={d.day}>
              <strong>{d.day}</strong>
              {d.sent_at ? ' · sent' : ' · not sent'}
              {d.error ? ` · ${d.error}` : ''}
              <Digest text={d.text} compact />
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

/**
 * What the panel says about today, in the top right.
 *
 * "Not built yet today" was true and unhelpful on a page whose whole question
 * was whether anything happens without being asked. When it is switched on and
 * the hour has passed, the honest answer is that it is about to run - the
 * engine ticks every few minutes - and when the hour has not come yet, that is
 * what it says instead.
 */
function status(state, today) {
  if (today?.sent_at) {
    const at = new Date(`${today.sent_at}Z`)
      .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `Sent ${at}`;
  }
  if (today) return 'Built, not sent yet';
  if (!state.settings.on) return 'Switched off';

  const [h, m] = String(state.settings.time || '08:00').split(':').map(Number);
  const now = new Date();
  const passed = now.getHours() * 60 + now.getMinutes() >= h * 60 + m;
  return passed ? 'Due — building shortly' : `Runs at ${state.settings.time}`;
}
