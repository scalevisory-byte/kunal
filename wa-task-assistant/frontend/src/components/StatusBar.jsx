import { useState } from 'react';
import { api } from '../api.js';

const LABELS = {
  starting: 'Starting…',
  qr: 'Waiting for QR scan',
  authenticated: 'Authenticated',
  ready: 'Connected',
  disconnected: 'Disconnected',
  error: 'Error',
};

function since(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  if (seconds < 90) return `${seconds}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
  return `${Math.round(seconds / 3600)} h`;
}

/**
 * Shown whenever the session is not connected. Every line here answers one
 * question you would otherwise need server logs for: is the disk actually
 * persisting, is a session saved on it, and has the server just restarted?
 */
/** The connection events this process has seen, newest first. */
function EventTrail({ events }) {
  if (!events?.length) return null;
  const shown = [...events].reverse().slice(0, 8);
  return (
    <div className="trail">
      <p className="hint">What the connection has done since this server started:</p>
      <ol>
        {shown.map((e, i) => (
          <li key={`${e.at}-${i}`}>
            <span className="trail-time">{new Date(e.at).toLocaleTimeString()}</span>
            <span className="trail-kind">{e.kind}</span>
            {e.detail && <span className="trail-detail">{e.detail}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}

function Diagnostics({ d }) {
  if (!d) return null;

  const restarting = d.uptimeSeconds < 120 && d.boots > 1;
  // Only a data directory that is supposed to be a mounted volume can be missing one.
  const volumeMissing = d.dataDirIsMount === false && d.dataDirInsideApp === false;
  const rows = [
    ['Server up for', since(d.uptimeSeconds)],
    ['Starts so far', d.boots || '—'],
    [
      'Storage',
      d.storagePersists
        ? `${d.dataDir} — saved across restarts`
        : `${d.dataDir} — not proven yet${volumeMissing ? ' (no volume mounted here)' : ''}`,
    ],
    [
      'Saved login on disk',
      d.sessionOnDisk ? `yes (${Math.round(d.sessionBytes / 1024)} kB)` : 'no — a scan is needed',
    ],
    [
      'Browser profile',
      `${Math.round((d.browserProfileBytes || 0) / 1024 / 1024)} MB (cache, not the login)`,
    ],
    [
      'Memory',
      d.container?.limitMb
        ? `${d.container.usedMb} MB of ${d.container.limitMb} MB`
        : `${d.container?.usedMb ?? d.memoryMb} MB used`,
    ],
  ];

  const memoryTight =
    d.container?.limitMb && d.container.usedMb > d.container.limitMb * 0.85;

  return (
    <div className="diagnostics">
      <dl>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {d.boots === 1 && !volumeMissing && (
        <p className="hint">
          Restart the service once. If <b>Starts so far</b> comes back as 1 again, the disk is
          being wiped on every restart and a scan will never stick.
        </p>
      )}
      {volumeMissing && (
        <p className="hint error-text">
          No volume is mounted at <code>{d.dataDir}</code>. Every restart wipes the linked
          session, so the QR keeps coming back. In Railway: attach a volume at{' '}
          <code>{d.dataDir}</code> and set <code>DATA_DIR={d.dataDir}</code>.
        </p>
      )}
      {memoryTight && (
        <p className="hint error-text">
          Memory is nearly full. Chromium gets killed mid-login when that happens, which
          hands you a fresh QR code even though the phone shows the device as linked.
        </p>
      )}
      {restarting && !volumeMissing && (
        <p className="hint error-text">
          The server restarted {since(d.uptimeSeconds)} ago. If this number keeps resetting,
          it is crash-looping — scanning will not stick until that stops.
        </p>
      )}
    </div>
  );
}

/**
 * Shown once WhatsApp is connected. Answers the next question after "is it
 * linked?" - namely whether messages are arriving, and what the AI made of them.
 */
function Pipeline({ wa, cfg }) {
  const [test, setTest] = useState(null);
  const [testing, setTesting] = useState(false);

  async function runTest() {
    setTesting(true);
    setTest(null);
    try {
      setTest(await api.selfTest());
    } catch (err) {
      setTest({ ok: false, error: err.message });
    } finally {
      setTesting(false);
    }
  }

  const last = wa?.lastExtraction;
  const rows = [
    ['Messages read since start', wa?.messagesSeen ?? 0],
    ['Skipped (blocked chats)', wa?.blockedCount ?? 0],
    ['Waiting to be read', wa?.bufferedCount ?? 0],
    ['Tasks created since start', wa?.tasksCreated ?? 0],
    [
      'Last AI run',
      last
        ? last.error
          ? `failed — ${last.error}`
          : `${last.messages} message(s) → ${last.tasks} task(s)`
        : 'not run yet',
    ],
    ['Anthropic key', cfg?.apiKeySet ? 'set' : 'MISSING — nothing can be extracted'],
  ];

  return (
    <div className="diagnostics">
      <dl>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      {!cfg?.apiKeySet && (
        <p className="hint error-text">
          <code>ANTHROPIC_API_KEY</code> is not set on the server, so no message can ever
          become a task. Add it in the hosting provider's variables and redeploy.
        </p>
      )}

      {wa?.messagesSeen === 0 && (
        <p className="hint">
          Nothing has arrived yet. Only messages that come in <b>after</b> the link are read —
          older chats are not scanned. Ask someone to message you, or message yourself from
          another phone, then wait about {cfg?.batchQuietSeconds ?? 15} seconds.
        </p>
      )}

      <button type="button" className="link" onClick={runTest} disabled={testing}>
        {testing ? 'Testing…' : 'Test the AI on a sample message'}
      </button>

      {test && (
        <p className={`hint ${test.ok ? '' : 'error-text'}`}>
          {test.ok
            ? test.tasks?.length
              ? `Works. ${test.model} read the sample and made: "${test.tasks[0].title}"${test.tasks[0].due_date ? ` (due ${test.tasks[0].due_date})` : ''}.`
              : `${test.model} answered but found no task in the sample, which is unexpected.`
            : `Failed: ${test.error}`}
        </p>
      )}

      <EventTrail events={wa?.events} />
    </div>
  );
}

export default function StatusBar({ status, stats, overdueCount }) {
  const wa = status?.whatsapp;
  const state = wa?.status || 'starting';

  return (
    <section className="status">
      <div className="status-row">
        <span className={`pill ${state}`}>
          <span className="dot" /> WhatsApp: {LABELS[state] || state}
        </span>
        {wa?.mode && <span className="pill">{wa.mode === 'manual' ? 'manual capture' : 'AI reading'}</span>}
        {wa?.bufferedCount > 0 && (
          <span className="pill">{wa.bufferedCount} message(s) queued</span>
        )}
      </div>

      {wa?.mode === 'manual' && state === 'ready' && (
        <p className="hint mode-hint">
          <strong>Manual mode</strong> — nothing is read automatically. Forward a WhatsApp
          message to your own chat, or start any message with{' '}
          <code>{status?.config?.taskTrigger || '#task'}</code>, and it becomes a task.
        </p>
      )}

      {wa?.mode === 'ai' && state === 'ready' && (
        <p className="hint mode-hint">
          <strong>AI mode</strong> — incoming chats are read automatically and actionable
          messages become tasks.
        </p>
      )}

      {state === 'qr' && wa?.qrDataUrl && (
        <div className="qr">
          <p>
            Open WhatsApp on your phone → <b>Settings → Linked devices → Link a device</b>,
            get the camera ready <em>first</em>, then scan. The code refreshes every few
            seconds — scan the one on screen right away.
          </p>
          <img src={wa.qrDataUrl} alt="WhatsApp linking QR code" width="240" height="240" />
        </div>
      )}

      {state === 'error' && wa?.lastError && <p className="hint error-text">{wa.lastError}</p>}

      {state !== 'ready' && (
        <>
          <Diagnostics d={status?.diagnostics} />
          <EventTrail events={wa?.events} />
        </>
      )}

      {state === 'ready' && <Pipeline wa={wa} cfg={status?.config} />}
    </section>
  );
}
