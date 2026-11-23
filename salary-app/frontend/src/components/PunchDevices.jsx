import { useEffect, useState } from 'react';
import { STANDALONE, api } from '../api.js';
import { LUNCH_RULES } from '../../../shared/lunchGap.js';

/**
 * Our own punch collector: the readers, and the punches we have kept.
 *
 * Why it exists: the punches used to reach this app through the Bizcompass
 * Sync Tool, which is somebody else's product with somebody else's licence.
 * When that licence lapsed the whole feed was one setting away from stopping.
 * This talks to the readers directly, over the office network, and keeps a
 * copy of every punch in this app's own database.
 *
 * The screen is in two halves on purpose, because the two halves are not
 * equally safe:
 *
 *   COLLECT only copies punches into our store. It changes no attendance, no
 *   pay, and never erases a reader, so it can be done as often as liked and
 *   can run on a timer.
 *
 *   PUT ON THE GRID is the step that reaches a payslip, so it has the usual
 *   look-first button and goes through exactly the same rules as every other
 *   punch import.
 */
export default function PunchDevices({ period, onReload, onGo }) {
  const [data, setData] = useState(null);
  // null = closed, 'new' = adding, a number = editing that reader.
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', host: '', port: 4370, comm_key: '' });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [said, setSaid] = useState('');
  const [preview, setPreview] = useState(null);

  const load = () => api.get('/devices').then(setData).catch(() => setData(null));
  useEffect(() => { if (!STANDALONE) load(); }, []);

  const act = async (what, run) => {
    setBusy(what);
    setError('');
    setSaid('');
    try {
      const out = await run();
      await load();
      return out;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setBusy('');
    }
  };

  const openForm = (device) => {
    setError('');
    setSaid('');
    setForm(device
      ? {
          name: device.name || '',
          host: device.host || '',
          port: device.port || 4370,
          comm_key: device.comm_key || '',
        }
      : { name: '', host: '', port: 4370, comm_key: '' });
    setEditing(device ? device.id : 'new');
  };

  const save = async () => {
    const body = {
      ...form,
      port: Number(form.port) || 4370,
      comm_key: Number(form.comm_key) || 0,
    };
    const making = editing === 'new';
    const out = await act('Saving…', () => (making
      ? api.post('/devices', body)
      : api.patch(`/devices/${editing}`, body)));
    if (out) {
      setEditing(null);
      setSaid(making
        ? `${out.name} added. Try "Test" to see whether it answers.`
        : `${out.name} saved. Try "Test" again.`);
    }
  };

  const test = (device) => act(`Asking ${device.name}…`, async () => {
    const out = await api.post(`/devices/${device.id}/test`);
    setSaid(out.ok
      ? `${device.name} answered in ${out.ms} ms.`
      : `${device.name} did not answer — ${out.error}`);
    return out;
  });

  const pull = (device) => act(`Reading ${device.name}…`, async () => {
    const out = await api.post(`/devices/${device.id}/pull`);
    setSaid(out.ok
      ? `${device.name}: ${out.read} punches on the reader, ${out.added} of them new.`
      : `${device.name} — ${out.error}`);
    return out;
  });

  const pullAll = () => act('Reading every reader…', async () => {
    const out = await api.post('/devices/pull');
    setSaid(`${out.read} punches read, ${out.added} new.`
      + (out.failed.length ? ` ${out.failed.map((f) => f.name).join(', ')} did not answer.` : ''));
    return out;
  });

  const grid = (dryRun) => act(dryRun ? 'Looking…' : 'Writing the marks…', async () => {
    const body = new FormData();
    body.append('dry_run', String(dryRun));
    const out = await api.upload(`/periods/${period.id}/device-punches`, body);
    setPreview(out);
    if (!dryRun) {
      setSaid(`${out.written} marks written.`);
      onReload();
    }
    return out;
  });

  const remove = (device) => {
    if (!window.confirm(
      `Remove ${device.name}?\n\nIts ${device.punches} collected punches are KEPT — they are `
      + 'attendance already gathered, and some may already have been paid. Only the reader goes.',
    )) return;
    act('Removing…', () => api.del(`/devices/${device.id}`));
  };

  if (STANDALONE) {
    return (
      <section className="card">
        <h2>Our own punch readers</h2>
        <p className="muted small">
          This talks to the attendance readers over the office network, so it needs the server
          version. A single file on a laptop has no way to reach them.
        </p>
      </section>
    );
  }

  const devices = data?.devices || [];
  const store = data?.store || {};

  return (
    <section className="card">
      <h2>Our own punch readers</h2>
      <p className="muted small">
        This app reads the attendance readers itself, over the office network, and keeps its own
        copy of every punch. No other software has to be running and no licence of anybody
        else&rsquo;s has to be valid.
      </p>

      {/*
        * The one thing that will actually bite him, said where he is standing.
        * eTimeTrackLite has "Auto Clear After Download" ticked on his devices,
        * which means whichever tool downloads first wipes the reader. Two
        * collectors with that tick on will each get half the punches.
        */}
      <p className="note small">
        <strong>Before you rely on this:</strong> in eTimeTrackLite, turn <strong>off</strong>{' '}
        &ldquo;Auto Clear After Download&rdquo; on each device. With it on, whichever software
        downloads first empties the reader and the other one gets nothing. Nothing here ever
        erases a reader.
      </p>

      {error && !editing ? <p className="error">{error}</p> : null}
      {said ? <p className="ok small">{said}</p> : null}

      {/* ---------------- the readers ---------------- */}

      {devices.length ? (
        <table className="sheet">
          <thead>
            <tr>
              <th>Reader</th>
              <th>Address</th>
              <th className="num">Punches kept</th>
              <th>Last read</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => (
              <tr key={d.id}>
                <td>
                  {d.name}
                  {d.comm_key ? <span className="muted small"> · key set</span> : null}
                </td>
                <td className="mono small">{d.host}:{d.port}</td>
                <td className="num">{d.punches.toLocaleString('en-IN')}</td>
                <td className="small">
                  {d.last_error
                    ? <span className="warn">{d.last_error}</span>
                    : d.last_ok_at
                      ? <>
                          {d.last_ok_at}
                          {d.last_added != null
                            ? <span className="muted"> · {d.last_added} new of {d.last_read}</span>
                            : null}
                        </>
                      : <span className="muted">not read yet</span>}
                </td>
                <td className="right nowrap">
                  <button type="button" className="ghost" onClick={() => test(d)} disabled={!!busy}>
                    Test
                  </button>{' '}
                  <button type="button" onClick={() => pull(d)} disabled={!!busy}>
                    Collect
                  </button>{' '}
                  <button type="button" className="ghost" onClick={() => openForm(d)} disabled={!!busy}>
                    Edit
                  </button>{' '}
                  <button type="button" className="ghost danger" onClick={() => remove(d)} disabled={!!busy}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted small">
          No readers yet. Add one with its address on the office network — the same IP
          eTimeTrackLite uses for it.
        </p>
      )}

      <div className="row gap wrap">
        {editing ? null : (
          <button type="button" onClick={() => openForm(null)} disabled={!!busy}>
            Add a reader
          </button>
        )}
        {devices.length ? (
          <button type="button" onClick={pullAll} disabled={!!busy}>
            Collect from every reader
          </button>
        ) : null}
      </div>

      {editing ? (
        <div className="card narrow inset">
          <h3>{editing === 'new' ? 'Add a reader' : 'Edit this reader'}</h3>

          {/*
            * The error belongs HERE, beside the boxes, not at the top of the
            * card. "the reader needs a name" appeared six inches above the
            * empty box it was about, with a wall of text in between.
            */}
          {error ? <p className="error">{error}</p> : null}

          <label>
            What it is called <span className="muted">(required)</span>
            <input
              value={form.name}
              /* "e.g." because grey example text reads as a filled-in value.
                 Somebody pressed Save on an untouched form and was told the
                 reader needed a name, with "IN gate" apparently already in it. */
              placeholder="e.g. IN gate"
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label>
            Its address on the office network <span className="muted">(required)</span>
            <input
              value={form.host}
              placeholder="e.g. 192.168.1.7"
              onChange={(e) => setForm({ ...form, host: e.target.value })}
            />
          </label>
          <div className="row gap">
            <label>
              Port
              <input
                type="number"
                value={form.port}
                onChange={(e) => setForm({ ...form, port: e.target.value })}
              />
            </label>
            <label>
              Communication key
              <input
                type="number"
                value={form.comm_key}
                placeholder="0"
                onChange={(e) => setForm({ ...form, comm_key: e.target.value })}
              />
            </label>
          </div>
          <p className="muted small">
            Port 4370 and key 0 are how these readers leave the factory. If Test says the
            device <strong>wants its communication key</strong>, the number is in
            eTimeTrackLite under the device&rsquo;s own settings (&ldquo;Comm Key&rdquo;), or on
            the machine itself under Menu &rarr; Comm &rarr; Security.
          </p>
          <div className="row gap">
            <button type="button" onClick={save} disabled={!!busy}>Save</button>
            <button type="button" className="ghost" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      ) : null}

      {/* ---------------- what we hold ---------------- */}

      {store.punches ? (
        <>
          <h3 className="spaced">Punches collected</h3>
          <p className="small">
            <strong>{store.punches.toLocaleString('en-IN')}</strong> punches from{' '}
            <strong>{store.ids}</strong> punch IDs, {store.first_at?.slice(0, 10)} to{' '}
            {store.last_at?.slice(0, 10)}.{' '}
            {data.pullMinutes
              ? `Collected automatically every ${data.pullMinutes} minute${data.pullMinutes === 1 ? '' : 's'}.`
              : 'Collected only when somebody presses Collect.'}
          </p>
          {!data.pullMinutes ? (
            <p className="muted small">
              To collect by itself, put <code>DEVICE_PULL_MINUTES=10</code> in the server&rsquo;s
              settings file and restart it. It will never open a month, never write into a locked
              one and never overrule a mark somebody set.
            </p>
          ) : null}
          {data.lastRun ? (
            <p className="muted small">
              Last automatic run {data.lastRun.at?.slice(0, 16).replace('T', ' ')} —{' '}
              {data.lastRun.error
                ? <span className="warn">{data.lastRun.error}</span>
                : `${data.lastRun.added ?? 0} new punches${data.lastRun.note ? `, ${data.lastRun.note}` : ''}${
                    data.lastRun.written != null ? `, ${data.lastRun.written} marks written` : ''}`}
            </p>
          ) : null}

          {data.unknownIds?.length ? (
            <div className="note small">
              <p>
                <strong>{data.unknownIds.length} punch ID
                {data.unknownIds.length === 1 ? '' : 's'} nobody on the staff list carries.</strong>{' '}
                These punches cannot reach anybody&rsquo;s attendance until the number is put on a
                record. The readers hold no names at all, so this cannot be guessed at.
              </p>
              <p className="mono small">
                {data.unknownIds.slice(0, 20).map((r) => `${r.device_code} (${r.punches})`).join(', ')}
                {data.unknownIds.length > 20 ? ` … and ${data.unknownIds.length - 20} more` : ''}
              </p>
              {onGo ? (
                <button type="button" className="ghost" onClick={() => onGo('employees')}>
                  Match them in Employees →
                </button>
              ) : null}
            </div>
          ) : null}

          <h3 className="spaced">Put them on {period?.label || 'the month'}&rsquo;s grid</h3>
          <p className="muted small">
            This is the step that reaches a payslip, so look first. Leave, holidays, a weekly off
            worked and a day at home are never overruled by a punch — the clock times land, the
            mark stays.
          </p>
          <div className="row gap wrap">
            <button type="button" onClick={() => grid(true)} disabled={!!busy || !period}>
              Look first
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => grid(false)}
              disabled={!!busy || !preview || !period}
            >
              Write the marks
            </button>
          </div>

          {preview ? (
            <div className="note small">
              <p>
                {preview.collected?.toLocaleString('en-IN')} punches for this month,{' '}
                {preview.matchedPeople} people matched, {preview.days?.length || 0} days.
                {preview.keptMarks ? ` ${preview.keptMarks} marks somebody set were kept.` : ''}
                {/* The same sentence the spool panel says, because the two
                    ends in one `applyPunches` and must not read as two rules. */}
                {preview.summary?.lunchFound ? (
                  <>
                    {' '}
                    <strong>{preview.summary.lunchFound} lunch break
                    {preview.summary.lunchFound === 1 ? '' : 's'} found</strong> (a gap of{' '}
                    {LUNCH_RULES.minMinutes}&ndash;{LUNCH_RULES.maxMinutes} minutes in the middle
                    of the day){' '}
                    {period?.lunch_paid === 1
                      ? '— recorded, and nothing deducted, because this month has the break inside the paid day.'
                      : '— and this month takes the break off the hours, so it is in the figures above.'}
                    {preview.lunchKept ? ` ${preview.lunchKept} typed lunches were left alone.` : ''}
                  </>
                ) : null}
              </p>
              {preview.unknownIds?.length ? (
                <p className="warn">
                  {preview.unknownIds.length} punch ID
                  {preview.unknownIds.length === 1 ? ' belongs' : 's belong'} to nobody in this month.
                </p>
              ) : null}
              {preview.dryRun ? <p className="muted">Nothing has been written yet.</p> : null}
            </div>
          ) : null}
        </>
      ) : devices.length ? (
        <p className="muted small">
          Nothing collected yet. Press <strong>Collect</strong> on a reader above.
        </p>
      ) : null}

      {busy ? <p className="muted small">{busy}</p> : null}
    </section>
  );
}
