import { useCallback, useEffect, useState } from 'react';
import { api, STANDALONE } from '../api.js';
import {
  STATUS_LABEL,
  describe as describeRequest,
  isOpen,
  kindLabel,
} from '../../../shared/attendanceRequests.js';
import { formatDistance } from '../../../shared/punchClock.js';
import ScrollFrame from './ScrollFrame.jsx';

const when = (v) => String(v || '').replace('T', ' ').slice(0, 16);

/**
 * The office's side of module 2: who has asked for what, where people punched
 * from, and the fence those punches are measured against.
 *
 * The only thing on this page that writes attendance is Approve. A pending
 * request has changed nobody's pay, and a rejected one never will.
 */
export default function AttendanceRequests({ period, onReload, onError }) {
  const [requests, setRequests] = useState([]);
  const [offices, setOffices] = useState([]);
  const [punches, setPunches] = useState([]);
  const [view, setView] = useState('requests');
  const [busy, setBusy] = useState(0);
  const [office, setOffice] = useState({ name: '', lat: '', lng: '', radius_m: 200 });

  const load = useCallback(async () => {
    if (STANDALONE) return;
    try {
      const [r, o, p] = await Promise.all([
        api.get('/attendance/requests'),
        api.get('/attendance/offices?all=true'),
        api.get('/attendance/punches?limit=100'),
      ]);
      setRequests(r.requests);
      setOffices(o.offices);
      setPunches(p.punches);
    } catch (err) {
      onError(err);
    }
  }, [onError]);

  useEffect(() => {
    load();
  }, [load]);

  if (STANDALONE) {
    return (
      <section className="card">
        <h2>Punching and approvals</h2>
        <p className="muted small">
          Punching from a phone and approving corrections need the server — an employee has to
          be able to reach a link, which a file on your laptop cannot offer. The attendance
          grid, the Time tab and the biometric imports all work here as normal.
        </p>
      </section>
    );
  }

  const decide = async (request, approve) => {
    if (
      approve &&
      !window.confirm(
        `Approve ${request.employee_name}'s ${kindLabel(request.kind).toLowerCase()} for day ${request.day}?\n\n` +
          `This writes it onto the attendance grid: ${describeRequest(request)}.`
      )
    ) {
      return;
    }
    setBusy(request.id);
    try {
      await api.post(`/attendance/requests/${request.id}/decide`, {
        approve,
        by: 'office',
        note: approve ? undefined : window.prompt('Why not? (optional)') || undefined,
      });
      await load();
      // The grid has changed, so the month has to be read again.
      if (approve) onReload();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(0);
    }
  };

  /*
   * Open means pending OR recommended. A manager backing something does not
   * take it off the office's list - it puts it one click from done, which is
   * the opposite of finished.
   */
  const pending = requests.filter(isOpen);

  return (
    <section className="card">
      <div className="row" style={{ marginBottom: '0.8rem' }}>
        <h2 style={{ margin: 0 }}>Punching and approvals</h2>
        <span className="spacer" />
        <div className="chips">
          {[
            ['requests', `Requests${pending.length ? ` (${pending.length})` : ''}`],
            ['punches', 'Punch log'],
            ['offices', 'Where punching counts'],
          ].map(([key, label]) => (
            <button key={key} className={`chip ${view === key ? 'active' : ''}`} onClick={() => setView(key)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {view === 'requests' ? (
        requests.length ? (
          <ScrollFrame box="scroll">
            {/*
              * `request-queue` pins the last column. On a 1280px laptop the
              * Approve button sat past the right edge of the scroller, so the
              * one control this whole screen exists for was the one thing you
              * had to scroll sideways to find. Measured: 1393px on a 1280px
              * window.
              */}
            <table className="sheet request-queue">
              <thead>
                <tr>
                  <th>Who</th>
                  <th>Day</th>
                  <th>Asking for</th>
                  <th>Why</th>
                  <th>Asked</th>
                  <th>Status</th>
                  <th className="decide" />
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id}>
                    <td className="name-cell">
                      {r.employee_name}
                      <div className="muted small">{r.company_name}</div>
                    </td>
                    <td className="num">
                      {r.day}
                      <div className="muted small">{r.period_label}</div>
                    </td>
                    <td className="small">
                      {kindLabel(r.kind)}
                      <div className="muted small">{describeRequest(r)}</div>
                    </td>
                    <td className="small">{r.reason}</td>
                    <td className="small muted">{when(r.created_at)}</td>
                    <td className="small">
                      {STATUS_LABEL[r.status] || r.status}
                      {/* Both halves of a two-step decision, so the row says
                          who backed it as well as who confirmed it. */}
                      {r.recommended_by ? (
                        <div className="muted small">backed by {r.recommended_by}</div>
                      ) : null}
                      {r.decided_by ? <div className="muted small">by {r.decided_by}</div> : null}
                    </td>
                    <td className="right decide">
                      {isOpen(r) ? (
                        <>
                          <button className="tiny primary" disabled={busy === r.id} onClick={() => decide(r, true)}>
                            Approve
                          </button>{' '}
                          <button className="tiny" disabled={busy === r.id} onClick={() => decide(r, false)}>
                            Reject
                          </button>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollFrame>
        ) : (
          <p className="empty">Nothing asked for. Requests arrive from the staff punch links.</p>
        )
      ) : null}

      {view === 'punches' ? (
        punches.length ? (
          <ScrollFrame box="scroll">
            <table className="sheet">
              <thead>
                <tr>
                  <th>Who</th>
                  <th>When</th>
                  <th>In / out</th>
                  <th>Where</th>
                  <th className="num">Distance</th>
                </tr>
              </thead>
              <tbody>
                {punches.map((p) => (
                  <tr key={p.id}>
                    <td className="name-cell">{p.employee_name}</td>
                    <td className="num small">{when(p.at)}</td>
                    <td className="small">{p.kind === 'in' ? 'In' : 'Out'}</td>
                    <td
                      className="small"
                      style={{ color: p.inside_fence === false ? 'var(--warn)' : undefined }}
                    >
                      {p.note}
                    </td>
                    <td className="num small">{formatDistance(p.distance_m)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollFrame>
        ) : (
          <p className="empty">Nobody has punched from a phone yet.</p>
        )
      ) : null}

      {view === 'offices' ? (
        <>
          <p className="muted small">
            A punch is measured against the nearest of these. One outside the circle is
            <strong> recorded and flagged, never refused</strong> — refusing it would leave
            somebody genuinely at a client&apos;s office with no attendance at all.
          </p>
          {offices.length ? (
            <div className="lines">
              {offices.map((o) => (
                <div key={o.id}>
                  <span className="what">
                    <strong>{o.name}</strong>
                    <span className="muted small">
                      {' '}
                      — {o.lat.toFixed(5)}, {o.lng.toFixed(5)} · within {o.radius_m} m
                      {o.company_name ? ` · ${o.company_name}` : ' · all companies'}
                    </span>
                  </span>
                  <button
                    className="tiny danger"
                    onClick={async () => {
                      if (!window.confirm(`Remove ${o.name}?`)) return;
                      try {
                        await api.del(`/attendance/offices/${o.id}`);
                        await load();
                      } catch (err) {
                        onError(err);
                      }
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted small">
              No office location set, so a punch can be recorded but not placed.
            </p>
          )}

          <form
            className="row"
            style={{ marginTop: '0.7rem' }}
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api.post('/attendance/offices', {
                  ...office,
                  lat: Number(office.lat),
                  lng: Number(office.lng),
                  radius_m: Number(office.radius_m) || 200,
                });
                setOffice({ name: '', lat: '', lng: '', radius_m: 200 });
                await load();
              } catch (err) {
                onError(err);
              }
            }}
          >
            <input
              placeholder="Office name"
              required
              value={office.name}
              onChange={(e) => setOffice({ ...office, name: e.target.value })}
            />
            <input
              placeholder="Latitude"
              required
              value={office.lat}
              onChange={(e) => setOffice({ ...office, lat: e.target.value })}
            />
            <input
              placeholder="Longitude"
              required
              value={office.lng}
              onChange={(e) => setOffice({ ...office, lng: e.target.value })}
            />
            <input
              type="number"
              style={{ width: '6rem' }}
              value={office.radius_m}
              onChange={(e) => setOffice({ ...office, radius_m: e.target.value })}
            />
            <button className="primary" type="submit">
              Add
            </button>
            <button
              type="button"
              onClick={() =>
                navigator.geolocation?.getCurrentPosition((pos) =>
                  setOffice({
                    ...office,
                    lat: pos.coords.latitude.toFixed(6),
                    lng: pos.coords.longitude.toFixed(6),
                  })
                )
              }
            >
              Use where I am
            </button>
          </form>
        </>
      ) : null}
      {void period}
    </section>
  );
}
