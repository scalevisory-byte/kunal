import { useEffect, useMemo, useState } from 'react';
import { STANDALONE, api } from '../api.js';
import {
  HK_STATUSES, USUAL_AREAS, dailyReportText, dayStats, hkLabel, isFlag, monthName,
  monthSummary, monthSummaryText,
} from '../../../shared/frontOffice.js';
import { col, printReport } from '../printReport.js';
import VisitorDesk from './frontoffice/VisitorDesk.jsx';
import CourierDesk from './frontoffice/CourierDesk.jsx';
import VisitorReports from './frontoffice/VisitorReports.jsx';
import AreaHistory from './frontoffice/AreaHistory.jsx';

/**
 * THE FRONT DESK — the housekeeping walk, the visitor book and courier in/out.
 *
 * Dinesh sent a single-file tool he had made for this and said *"need this
 * all feature in this"*. It is all here, with three things it could not have
 * on its own: it is the same records from any machine, it is behind the same
 * login as the rest of the office, and the person on reception can be given a
 * login that reaches this and nothing else.
 *
 * THE ONE RULE THAT IS NOT HIS: a day nobody walked is not a clean day. His
 * version started every area at Clean, so a morning the app was never opened
 * reported a spotless office. Here a verdict is blank until somebody records
 * one, and the counts are always three — clean, flagged, and not looked at.
 */

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const nowHHMM = () => new Date().toTimeString().slice(0, 5);

const VIEWS = [
  /*
   * The tabs his own front-office tool had, in its order.
   *
   * Dinesh: *"dashboard banavo / housekeeping ka tab banavo"*. "Today" held
   * the day's figures AND the walk, so neither had a name: somebody sent to
   * "the dashboard" and somebody sent to "housekeeping" were sent to the
   * same tab and had to be told which half to look at.
   */
  ['dashboard', 'Dashboard'],
  ['housekeeping', 'Housekeeping'],
  ['visitors', 'Visitors'],
  ['courier', 'Courier'],
  ['report', 'Daily report'],
  ['month', 'Monthly summary'],
  ['areas', 'Areas'],
];

const prettyDay = (iso) => {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  if (!y) return iso;
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    weekday: 'short', day: '2-digit', month: 'long', year: 'numeric',
  });
};

export default function FrontOffice({ onError, employees = [], companies = [], companyId, onGo }) {
  /*
   * Its own one-line "saved" note rather than the app's, so the desk sees it
   * where it is standing - and it GOES AWAY. A note that stays reads as part
   * of the page: his screenshot had "Signed in" sitting above the tabs long
   * after the visitor it belonged to.
   */
  const [said, setSaid] = useState('');
  const onToast = (message) => setSaid(message);
  useEffect(() => {
    if (!said) return undefined;
    const timer = window.setTimeout(() => setSaid(''), 4000);
    return () => window.clearTimeout(timer);
  }, [said]);
  const [day, setDay] = useState(todayISO);
  const [view, setView] = useState('dashboard');
  const [data, setData] = useState(null);
  const [month, setMonth] = useState(() => todayISO().slice(0, 7));
  const [monthData, setMonthData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [visitor, setVisitor] = useState({});
  const [parcel, setParcel] = useState({ direction: 'Inward' });
  const [newArea, setNewArea] = useState('');
  /*
   * EVERY AREA, INCLUDING THE ONES TAKEN OFF.
   *
   * Dinesh's front desk had nine areas on screen and three of the usual
   * twelve missing, with no way to see which - somebody had taken them off
   * months ago and the only way back was typing the name exactly. So the
   * settings page loads the whole list, shows what is off it, and puts one
   * back on a click. Loaded only on this tab: the day's walk has no use for
   * areas nobody walks.
   */
  const [allAreas, setAllAreas] = useState([]);
  /* Whose history is on screen. One area, down the days. */
  const [historyFor, setHistoryFor] = useState(null);

  const load = async (which = day) => {
    if (STANDALONE) return;
    try {
      setData(await api.get(`/front-office/day/${which}`));
    } catch (err) {
      onError(err);
    }
  };

  useEffect(() => { load(day); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [day]);

  /* Taken off the list, and still on the record. */
  const offList = allAreas.filter((a) => !a.active);
  /*
   * Which of the usual ones are not there AT ALL - an area that is merely
   * off the list is in the section below, where it can be put back by name
   * rather than typed back from memory.
   */
  const have = new Set(allAreas.map((a) => String(a.name).trim().toLowerCase()));
  const missingUsual = USUAL_AREAS.filter((name) => !have.has(name.toLowerCase()));

  const loadAreas = () => {
    if (STANDALONE) return;
    api
      .get('/front-office/areas?all=true')
      .then(({ areas }) => setAllAreas(areas || []))
      .catch(() => setAllAreas([]));
  };

  useEffect(() => {
    if (view === 'areas') loadAreas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, data]);

  useEffect(() => {
    if (STANDALONE || view !== 'month') return;
    api.get(`/front-office/month/${month}`).then(setMonthData).catch(onError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, month]);

  const stats = useMemo(() => dayStats(data || {}), [data]);
  const summary = useMemo(
    () => (monthData ? monthSummary({ ...monthData, month }) : null),
    [monthData, month]
  );

  if (STANDALONE) {
    return (
      <section className="card">
        <h2>Front office</h2>
        <p className="empty">
          The visitor book and the courier register need the server version. They are a
          shared book — the person on reception writes in it and everybody else reads it —
          and a file on one laptop cannot be that.
        </p>
      </section>
    );
  }

  if (!data) return <section className="card"><p className="muted small">Reading…</p></section>;

  const act = async (run, said) => {
    setBusy(true);
    try {
      await run();
      await load(day);
      if (said) onToast(said);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  const verdict = (area, status, remark) =>
    act(() => api.put('/front-office/inspections', { day, area_id: area.id, status, remark }));

  const statusOf = (area) =>
    data.inspections.find((i) => Number(i.area_id) === Number(area.id)) || {};

  /* The day's own rows, read the way the registers read them. */
  const flaggedToday = (data?.areas || [])
    .map((area) => ({ area, ...(statusOf(area) || {}) }))
    .filter((row) => isFlag(row.status));
  const stillInToday = (data?.visitors || []).filter((v) => !v.out_time && !v.out_at);

  /* ---------------- the papers ---------------- */

  const printVisitors = (rows = data.visitors, what = prettyDay(day)) =>
    printReport({
      title: 'Visitor register',
      subtitle: what,
      meta: [
        `${rows.length} ${rows.length === 1 ? 'visitor' : 'visitors'}`,
        `${rows.filter((v) => !v.out_time).length} with no out time recorded`,
      ],
      columns: [
        col('#', (_v, i) => i + 1, '3%'),
        col('In', (v) => v.in_time || ''),
        col('Out', (v) => v.out_time || ''),
        col('Name', (v) => v.name || ''),
        col('Company', (v) => v.company || ''),
        col('To meet', (v) => v.meeting || ''),
        col('Purpose', (v) => v.purpose || ''),
        col('Mobile', (v) => v.mobile || ''),
        col('Pass', (v) => v.pass_no || ''),
        col('Logged by', (v) => v.logged_by || ''),
      ],
      rows,
      empty: 'Nobody signed in.',
      footer:
        'No out time means nobody recorded one — it is not a time anybody left. This page carries visitors’ names and mobile numbers.',
    });

  const printCourier = (rows = data.courier, what = prettyDay(day)) =>
    printReport({
      title: 'Courier register',
      subtitle: what,
      meta: [
        `${rows.filter((c) => c.direction === 'Inward').length} in · ${
          rows.filter((c) => c.direction === 'Outward').length
        } out`,
      ],
      columns: [
        col('#', (_c, i) => i + 1, '3%'),
        col('Time', (c) => c.at_time || ''),
        col('In / Out', (c) => c.direction || ''),
        col('Courier', (c) => c.company || ''),
        col('Ref', (c) => c.ref_no || ''),
        col('From / To', (c) => c.party || ''),
        col('Handed to', (c) => c.handler || ''),
        col('Remark', (c) => c.remark || ''),
      ],
      rows,
      empty: 'Nothing in or out.',
      footer: 'Every entry as it was logged on the desk. Nothing here is worked out.',
    });

  const printWalk = () =>
    printReport({
      title: 'Housekeeping check',
      subtitle: prettyDay(day),
      meta: [
        `${stats.clean} clean · ${stats.flags} flagged · ${stats.not_checked} not checked`,
      ],
      columns: [
        col('#', (_a, i) => i + 1, '3%'),
        col('Area', (a) => a.name),
        col('Verdict', (a) => hkLabel(statusOf(a).status) || 'not checked'),
        col('Remark', (a) => statusOf(a).remark || ''),
        col('Checked by', (a) => statusOf(a).checked_by || ''),
      ],
      rows: data.areas,
      empty: 'No areas on the list yet.',
      footer:
        'An area with no verdict was NOT checked — it is not a clean area. Clean, flagged and not-checked are counted separately for that reason.',
    });

  const printMonth = () => {
    if (!summary) return;
    printReport({
      title: 'Front office — monthly summary',
      subtitle: monthName(month),
      meta: [
        `${summary.days_recorded} day(s) recorded`,
        `${summary.flags} flag(s) · ${summary.visitors} visitor(s) · ${summary.courier_in} in / ${summary.courier_out} out`,
      ],
      columns: [
        col('#', (_r, i) => i + 1, '4%'),
        col('Area', (r) => r.name),
        col('Days flagged', (r) => String(r.days), '20%'),
      ],
      rows: summary.flags_by_area,
      empty: 'No area was flagged this month.',
      footer:
        'Days recorded counts the days somebody actually wrote something down. A month with few flags and few days recorded is a month nobody walked, not a clean month.',
    });
  };

  /**
   * OPEN WHATSAPP WITH THE REPORT ALREADY TYPED.
   *
   * Dinesh: *"front office ka daily report whatsapp pe auto bhej sakte he
   * kya?"*. Truly unattended sending needs a channel this app does not have
   * (see the note under the button), and until there is one this is the
   * honest half: one tap opens WhatsApp with the whole report in the box, he
   * picks the group, and presses send. Nothing is sent by itself, and nothing
   * can go to the wrong group.
   *
   * A `wa.me` link rather than the app's own URL scheme, because the same
   * one works on his phone, in the desktop app and on WhatsApp Web.
   */
  const openWhatsApp = (text) => {
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  };

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      onToast('Copied — paste it into the group');
    } catch {
      onToast('Could not copy here — select the text and copy it');
    }
  };

  const reportText = dailyReportText({ ...data, day });

  return (
    <section className="stack">
      <div className="toolbar">
        <label className="field">
          Date
          <input type="date" value={day} onChange={(e) => setDay(e.target.value || todayISO())} />
        </label>
        <span className="muted small">{prettyDay(day)}</span>
        <span className="grow" />
        <button
          className="ghost danger"
          disabled={busy}
          onClick={() => {
            const counts = `${data.inspections.length} check(s), ${data.visitors.length} visitor(s), ${data.courier.length} courier entr${data.courier.length === 1 ? 'y' : 'ies'}`;
            if (!window.confirm(`Delete everything recorded for ${prettyDay(day)}?\n\n${counts}\n\nOther days are not touched. This cannot be undone.`)) return;
            act(() => api.del(`/front-office/day/${day}`), 'That day is empty again');
          }}
        >
          Clear this day
        </button>
      </div>

      {said ? <p className="muted small">{said}</p> : null}

      <nav className="tabs sub-tabs">
        {VIEWS.map(([key, label]) => (
          <button key={key} className={view === key ? 'active' : undefined} onClick={() => setView(key)}>
            {label}
          </button>
        ))}
      </nav>

      {view === 'dashboard' ? (
        <>
          <div className="card">
            <div className="fo-figures">
              <div><b>{stats.clean}</b><span>clean</span></div>
              <div className={stats.flags ? 'bad' : undefined}><b>{stats.flags}</b><span>flagged</span></div>
              <div><b>{stats.not_checked}</b><span>not checked</span></div>
              <div><b>{stats.visitors}</b><span>visitors</span></div>
              <div><b>{stats.still_in}</b><span>still in</span></div>
              <div><b>{stats.courier_in}</b><span>courier in</span></div>
              <div><b>{stats.courier_out}</b><span>courier out</span></div>
            </div>
            <p className="muted small">
              An area with no verdict counts as <strong>not checked</strong>, never as clean —
              a morning nobody walked is not a spotless office.
            </p>
          </div>

          {/*
            * WHAT THE FIGURES ARE ABOUT, named.
            *
            * A count is a reason to go and look; the names save the going.
            * Nothing here is worked out - each list is the day's own rows,
            * read the same way the register reads them.
            */}
          <div className="card">
            <h3>Needs a look</h3>
            {flaggedToday.length ? (
              <div className="lines">
                {flaggedToday.map((f) => (
                  <div key={f.area.id}>
                    <span className="what">
                      <strong>{f.area.name}</strong> — {hkLabel(f.status)}
                      {f.remark ? ` · ${f.remark}` : ''}
                    </span>
                    <button className="link" onClick={() => setView('housekeeping')}>open the walk</button>
                  </div>
                ))}
              </div>
            ) : stats.clean ? (
              <p className="muted small">
                Nothing flagged. {stats.clean} area{stats.clean === 1 ? '' : 's'} checked and clean
                {stats.not_checked ? `, ${stats.not_checked} not looked at` : ''}.
              </p>
            ) : (
              <p className="muted small">
                Nobody has walked the areas yet today —{' '}
                <button className="link" onClick={() => setView('housekeeping')}>start the check</button>.
              </p>
            )}

            {stillInToday.length ? (
              <>
                <h4>Still in the building ({stillInToday.length})</h4>
                <div className="lines">
                  {stillInToday.map((v) => (
                    <div key={v.id}>
                      <span className="what">
                        <strong>{v.name}</strong>
                        {v.company ? ` · ${v.company}` : ''}
                        {v.in_time ? ` · in ${v.in_time}` : ''}
                        {v.meeting_name ? ` · for ${v.meeting_name}` : ''}
                      </span>
                      <button className="link" onClick={() => setView('visitors')}>visitors</button>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </>
      ) : null}

      {view === 'housekeeping' ? (
        <>
          <div className="card scroll">
            <div className="row">
              <h3>Housekeeping</h3>
              <span className="grow" />
              <button className="ghost" onClick={printWalk} disabled={!data.areas.length}>
                Print the check
              </button>
            </div>
            {data.areas.length ? (
              <table className="sheet numbered fo-table">
                <thead>
                  <tr>
                    <th className="row-no">#</th>
                    <th className="grow">Area</th><th>Verdict</th><th>Remark</th><th>Checked by</th>
                  </tr>
                </thead>
                <tbody>
                  {data.areas.map((area) => {
                    const now = statusOf(area);
                    return (
                      <tr key={area.id} className={isFlag(now.status) ? 'fo-flagged' : undefined}>
                        <td className="row-no">{data.areas.indexOf(area) + 1}</td>
                        <td>{area.name}</td>
                        <td>
                          <select
                            value={now.status || ''}
                            disabled={busy}
                            onChange={(e) => verdict(area, e.target.value, now.remark)}
                          >
                            <option value="">not checked</option>
                            {HK_STATUSES.map(([key, label]) => (
                              <option key={key} value={key}>{label}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            key={now.remark || ''}
                            defaultValue={now.remark || ''}
                            placeholder={now.status ? 'remark' : ''}
                            disabled={!now.status || busy}
                            onBlur={(e) => {
                              if ((now.remark || '') === e.target.value) return;
                              verdict(area, now.status, e.target.value);
                            }}
                          />
                        </td>
                        <td className="small muted">{now.checked_by || ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p className="empty">
                No areas yet. Add them under <strong>Areas</strong> — or put the usual twelve in
                with one press there.
              </p>
            )}
          </div>
        </>
      ) : null}

      {view === 'visitors' ? (
        <VisitorDesk
          day={day}
          employees={employees}
          companyId={companyId}
          onError={onError}
          onToast={onToast}
          onCount={() => load(day)}
        />
      ) : null}

      {view === 'courier' ? (
        <CourierDesk
          day={day}
          employees={employees}
          companyId={companyId}
          onError={onError}
          onToast={onToast}
        />
      ) : null}

      {view === 'report' ? (
        <div className="card">
          <div className="row">
            <h3>Daily front office report</h3>
            <span className="grow" />
            <button className="primary" onClick={() => openWhatsApp(reportText)}>
              Send on WhatsApp
            </button>
            <button onClick={() => copy(reportText)}>Copy the text</button>
            <button className="ghost" onClick={printWalk}>Print the check</button>
          </div>
          <p className="muted small">
            Compiled from what is recorded for {prettyDay(day)} — the housekeeping verdicts, the
            visitor book and the courier register. Nothing here is guessed: areas nobody checked
            are said to be unchecked, and a visitor with no out time is shown as still in.
          </p>
          <pre className="fo-report">{reportText}</pre>
          <p className="muted small">
            <strong>Send on WhatsApp</strong> opens WhatsApp with this message already typed —
            pick the group and press send. It is never sent by itself, so it cannot land in the
            wrong chat. Sending it unattended at a set time needs a WhatsApp number this app is
            allowed to send from; ask and it can be set up.
          </p>
        </div>
      ) : null}

      {/*
        * The day's visitors, with the four figures above them: the message
        * for the group is the housekeeping half, and this is the register
        * half of the same day.
        */}
      {view === 'report' ? (
        <VisitorReports
          mode="day"
          day={day}
          employees={employees}
          companyId={companyId}
          onError={onError}
        />
      ) : null}

      {view === 'month' ? (
        <>
          {/*
            * The visitor side of the month sits above the housekeeping side:
            * six breakdowns of who came, then the areas that were flagged.
            */}
          <VisitorReports
            mode="month"
            day={day}
            employees={employees}
            companyId={companyId}
            onError={onError}
            onGoEmployee={() => onGo?.('employees')}
          />
          <div className="toolbar">
            <label className="field">
              Month
              <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </label>
            <span className="grow" />
            <button
              className="primary"
              onClick={() => summary && openWhatsApp(monthSummaryText(summary))}
              disabled={!summary}
            >
              Send on WhatsApp
            </button>
            <button onClick={() => summary && copy(monthSummaryText(summary))} disabled={!summary}>
              Copy the text
            </button>
            <button className="ghost" onClick={printMonth} disabled={!summary}>
              Print the summary
            </button>
          </div>

          {summary ? (
            <>
              <div className="card">
                <div className="fo-figures">
                  <div><b>{summary.days_recorded}</b><span>days recorded</span></div>
                  <div className={summary.flags ? 'bad' : undefined}><b>{summary.flags}</b><span>flags</span></div>
                  <div><b>{summary.visitors}</b><span>visitors</span></div>
                  <div><b>{summary.courier_in}</b><span>courier in</span></div>
                  <div><b>{summary.courier_out}</b><span>courier out</span></div>
                </div>
                <p className="muted small">
                  <strong>Days recorded</strong> counts the days somebody actually wrote something
                  down. Few flags across few days is a month nobody walked, not a clean month.
                </p>
              </div>

              <div className="cards-2">
                <div className="card scroll">
                  <h3>Flags by area</h3>
                  <table className="sheet">
                    <thead><tr><th className="grow">Area</th><th className="num">Days flagged</th></tr></thead>
                    <tbody>
                      {/* "Parking: 4 days" is the right answer for a month
                          and useless in an argument about the parking. The
                          name opens WHICH four, and what was written. */}
                      {summary.flags_by_area.map((row) => (
                        <tr key={row.area_id}>
                          <td>
                            <button className="link" onClick={() => setHistoryFor(row.area_id)}>
                              {row.name}
                            </button>
                          </td>
                          <td className="num">{row.days}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!summary.flags_by_area.length ? <p className="empty">Nothing was flagged.</p> : null}
                </div>

                <div className="card scroll">
                  <div className="row">
                    <h3>The month’s books</h3>
                    <span className="grow" />
                    <button
                      className="tiny"
                      onClick={() => printVisitors(monthData.visitors, monthName(month))}
                      disabled={!monthData?.visitors.length}
                    >
                      Visitors
                    </button>{' '}
                    <button
                      className="tiny"
                      onClick={() => printCourier(monthData.courier, monthName(month))}
                      disabled={!monthData?.courier.length}
                    >
                      Courier
                    </button>
                  </div>
                  <p className="muted small">
                    The whole month as one register, printed the same way the day is.
                  </p>
                  <pre className="fo-report">{monthSummaryText(summary)}</pre>
                </div>
              </div>
            </>
          ) : (
            <div className="card"><p className="muted small">Reading…</p></div>
          )}
        </>
      ) : null}

      {view === 'areas' ? (
        <div className="card">
          <h3>Areas walked</h3>
          <p className="muted small">
            The list the housekeeping check runs down. Taking one off the list stops it being
            asked about from now on — <strong>it does not delete what it was flagged for</strong>,
            because that is the only reason any of this is written down.
          </p>
          <div className="row">
            <input
              placeholder="Add an area…"
              value={newArea}
              onChange={(e) => setNewArea(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || !newArea.trim()) return;
                act(async () => {
                  await api.post('/front-office/areas', { name: newArea });
                  setNewArea('');
                }, 'Added');
              }}
            />
            <button
              className="primary"
              disabled={busy || !newArea.trim()}
              onClick={() =>
                act(async () => {
                  await api.post('/front-office/areas', { name: newArea });
                  setNewArea('');
                }, 'Added')
              }
            >
              Add
            </button>
            {/*
              * SHOWN WHENEVER SOMETHING IS MISSING, not only on an empty
              * list. Hidden behind "the list is empty", this button was
              * unreachable for the one office that needed it: nine areas on
              * screen, three of the usual ones off, and nothing saying which.
              * It adds only what is absent, and an area that was taken off
              * comes BACK with its history rather than as a second of itself.
              */}
            {missingUsual.length ? (
              <button
                disabled={busy}
                title={`Would add: ${missingUsual.join(', ')}`}
                onClick={() =>
                  act(async () => {
                    await api.post('/front-office/areas/usual', {});
                    loadAreas();
                  }, 'The usual areas are on the list')
                }
              >
                Add the usual areas ({missingUsual.length} missing)
              </button>
            ) : null}
          </div>
          <p className="muted small">
            <strong>Click a name to change it</strong> — renaming keeps that area&apos;s whole
            history, which typing a new one does not.
          </p>

          <table className="sheet">
            <thead><tr><th className="grow">Area</th><th /></tr></thead>
            <tbody>
              {data.areas.map((area) => (
                <tr key={area.id}>
                  <td>
                    <input
                      key={area.name}
                      defaultValue={area.name}
                      onBlur={(e) => {
                        if (e.target.value === area.name || !e.target.value.trim()) return;
                        act(() => api.patch(`/front-office/areas/${area.id}`, { name: e.target.value }));
                      }}
                    />
                  </td>
                  <td className="right">
                    <button className="tiny" onClick={() => setHistoryFor(area.id)}>
                      history
                    </button>{' '}
                    <button
                      className="tiny danger"
                      disabled={busy}
                      onClick={() => {
                        if (!window.confirm(`Stop asking about ${area.name}? Its past flags are kept.`)) return;
                        act(() => api.del(`/front-office/areas/${area.id}`));
                      }}
                    >
                      Off the list
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {offList.length ? (
            <>
              <h4 style={{ marginBottom: '0.2rem' }}>Off the list ({offList.length})</h4>
              <p className="muted small">
                Not walked any more, and <strong>not deleted</strong> — every day they were
                flagged is still on the record. Put one back and it carries that history with it.
              </p>
              <table className="sheet">
                <tbody>
                  {offList.map((area) => (
                    <tr key={area.id}>
                      <td className="grow muted">{area.name}</td>
                      <td className="right">
                        <button className="tiny" onClick={() => setHistoryFor(area.id)}>
                          history
                        </button>{' '}
                        <button
                          className="tiny"
                          disabled={busy}
                          onClick={() =>
                            act(async () => {
                              await api.patch(`/front-office/areas/${area.id}`, { active: true });
                              loadAreas();
                            }, `${area.name} is back on the list`)
                          }
                        >
                          Put it back
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
          {!data.areas.length ? <p className="empty">No areas yet.</p> : null}
        </div>
      ) : null}

      {/* One area, down the days - opened from the list, from an area that
          is off it, or from the month's flags. */}
      {historyFor ? (
        <AreaHistory areaId={historyFor} onClose={() => setHistoryFor(null)} onError={onError} />
      ) : null}
    </section>
  );
}
