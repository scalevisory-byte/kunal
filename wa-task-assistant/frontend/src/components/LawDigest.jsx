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

      <Row
        label="Digest time"
        note={settings.lawDigest
          ? `Sent at this time, ${timezone}.`
          : 'Switched off — nothing arrives on its own. The buttons below still work.'}
      >
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
            <div className="digest-shape">
              <small>The lines it fills in</small>
              <pre>{state.shape}</pre>
            </div>
          </>
        )}

      <div className="briefing-preview-foot">
        <button type="button" className="btn ghost" disabled={Boolean(busy)}
          onClick={() => run('preview')}>
          {busy === 'preview' ? 'Reading the feeds…' : 'Fetch now'}
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

/**
 * The digest, laid out to be read.
 *
 * What arrives is a WhatsApp message: asterisks for bold, a bare URL at the end
 * of each line, everything in one block. That is right for WhatsApp and wrong
 * for a page - on screen it was a wall of monospace with the actual finding
 * buried between the markup and a hundred-character link.
 *
 * So it is parsed back into what it always was: a heading, five labelled lines,
 * and one action. The label is set apart, the finding is set in reading type,
 * and the source becomes a link at the end of the line rather than fifty
 * characters of URL in the middle of the sentence. The exact message is still
 * one click away, because that is what was actually sent.
 */
function Digest({ text, compact = false }) {
  const { title, sections, loose } = parseDigest(text);

  return (
    <div className={`digest ${compact ? 'compact' : ''}`}>
      {title && <h4 className="digest-title">{title}</h4>}

      {sections.map((s, i) => (
        <div key={i} className={`digest-row ${s.tone}`}>
          <span className="digest-label">{s.label}</span>
          <span className="digest-text">
            {s.body}
            {s.links.map((href, n) => (
              <a
                key={n}
                className="digest-source"
                href={href}
                target="_blank"
                rel="noopener noreferrer"
              >
                {sourceName(href)} ↗
              </a>
            ))}
          </span>
        </div>
      ))}

      {/* Anything the shape did not account for is shown as it came, never dropped. */}
      {loose.map((line, i) => (
        <p key={i} className="digest-loose"><Linked text={line} /></p>
      ))}

      <details className="digest-raw">
        <summary>The message as it was sent</summary>
        <pre><Linked text={text} /></pre>
      </details>
    </div>
  );
}

/**
 * WhatsApp text back into parts.
 *
 * `*Label:* finding https://…` is the whole grammar. A line that does not fit
 * it is kept as it is rather than forced into a shape it does not have - the
 * "nothing was published today" message is one line and no labels at all.
 */
export function parseDigest(text) {
  const lines = String(text ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  let title = null;
  const sections = [];
  const loose = [];

  for (const line of lines) {
    // The heading: bold, no label colon inside the asterisks.
    const head = /^[^\w*]*\*([^*]+)\*[^\w]*$/.exec(line);
    if (head && !title && !head[1].includes(':')) {
      title = head[1].trim();
      continue;
    }

    const row = /^([^*]*)\*([^*]+?):\*\s*(.*)$/.exec(line);
    if (row) {
      const mark = row[1].trim();
      const label = row[2].trim();
      let body = row[3].trim();
      const links = [];
      body = body.replace(/https?:\/\/[^\s<>"')\]]+/g, (url) => {
        links.push(url);
        return '';
      }).replace(/\s{2,}/g, ' ').trim();

      sections.push({
        label,
        body,
        links,
        // "koi naya update nahi" is a real answer and should read as the quiet
        // one; the line telling him to act on something should not.
        tone: /^\s*(koi naya update nahi|aaj kuch nahi)\.?$/i.test(body)
          ? 'quiet'
          : mark.includes('⚠') ? 'action' : '',
      });
      continue;
    }

    loose.push(line);
  }

  return { title, sections, loose };
}

/** "taxguru.in" rather than a hundred characters of path. */
function sourceName(href) {
  try {
    return new URL(href).hostname.replace(/^www\./, '');
  } catch {
    return 'source';
  }
}

/**
 * The digest, with its sources reachable.
 *
 * Every line ends in the article it came from, and until now those were plain
 * characters in a monospace block - the whole point of a digest is that you can
 * go and read the one line that matters, and that meant copying a URL by hand.
 *
 * Built as elements rather than injected as HTML: this text is written by a
 * model summarising somebody else's feed, and none of it is ever trusted as
 * markup. Only http and https become links, and each opens in its own tab with
 * no handle back to this page.
 */
function Linked({ text }) {
  const parts = String(text ?? '').split(/(https?:\/\/[^\s<>"')\]]+)/g);
  return parts.map((part, index) =>
    /^https?:\/\//.test(part)
      ? (
        <a key={index} href={part} target="_blank" rel="noopener noreferrer" className="digest-link">
          {part}
        </a>
      )
      : part);
}
