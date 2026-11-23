import { useMemo, useState } from 'react';
import {
  REPORT_SHAPES,
  TYPED_DEFAULTS,
  dailyReport,
  longDate,
  normaliseShape,
  suggestShape,
} from '../../../shared/dailyReport.js';
import { shiftOfMonth } from '../standardTimes.js';

/**
 * THE MESSAGE HR IS ALREADY TYPING BY HAND EVERY MORNING.
 *
 * Dinesh: *"we have to send attendance report daily in WhatsApp - o kaise
 * aayega"*, with a screenshot of what somebody posts in the BNF GROWTH TEAM
 * group: a heading, the date, Attendance with the absent names and their
 * reasons in brackets, Late Coming / Early Going, Uniform, Office Inspection,
 * Conduct, Overtime, Incidents.
 *
 * Five of those the app already knows to the name, off the very rows the roll
 * call above is drawn from. So this writes the message for him.
 *
 * THREE THINGS IT IS HONEST ABOUT, each of them stated on the panel itself:
 *
 *   **IT ASSEMBLES, IT DOES NOT SEND.** There is no WhatsApp API for a
 *   personal number, and the task assistant already holds the one linked
 *   session - a second one risks the number. So: Copy, or the share link,
 *   which opens WhatsApp with the text already in the box and lets him pick
 *   the group himself.
 *
 *   **OFFICE INSPECTION, CONDUCT AND INCIDENTS ARE NOT IN THIS APP**, so they
 *   are three boxes he types, pre-filled with the words the office already
 *   uses. A report that claimed "All checklist items OK" because nobody
 *   recorded anything would be worse than one that asks.
 *
 *   **THE TEXT IS EDITABLE BEFORE IT GOES.** It is a message to a group of
 *   people, not a filing - and the last word on it belongs to whoever sends
 *   it.
 *
 * AND THE THING THE THREE SHAPES ARE FOR. Dinesh: *"short hours & ot ka
 * report aaj ki date ka dusre din jayega / same day kaise jayega"*. Short
 * hours and overtime are `out - in - lunch`, so they cannot exist until the
 * person has gone home - no source has them earlier. So the shape follows
 * the clock: before the usual day ends this is the morning message with no
 * hours in it at all, after it the end-of-day message with today's. The
 * suggestion is SHOWN and can be overruled, because a rule nobody can see
 * is worse than one they disagree with.
 *
 * It computes nothing of its own: `dailyReport()` is handed the same rows,
 * the same day and the same usual timings the roll call uses, so the message
 * and the screen above it cannot disagree about who was late.
 */
export default function DailyReport({ period, rows, day, companyName = '' }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(TYPED_DEFAULTS);
  /*
   * The heading follows the company filter - his own message reads "BOOKNFLY
   * DAILY OFFICE REPORT" - but it is a box, because the group a message goes
   * to is not always the company a filter is set to, and `null` means "still
   * following the filter" rather than an empty heading.
   */
  const [heading, setHeading] = useState(null);
  const [edited, setEdited] = useState(null);
  const [said, setSaid] = useState('');
  /* null = still following the clock, rather than a shape somebody chose. */
  const [chosen, setChosen] = useState(null);
  /*
   * The hour it was built, read ONCE at mount so the text does not change
   * under somebody who is editing it. Blank means no stamp at all, which is
   * exactly the message this report sent before shapes existed.
   */
  const [asOf, setAsOf] = useState(() => {
    const n = new Date();
    return `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
  });

  const date = period
    ? `${period.year}-${String(period.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    : '';

  const suggestedHeading = companyName
    ? `${companyName.toUpperCase()} DAILY OFFICE REPORT`
    : 'DAILY OFFICE REPORT';

  const standard = period ? shiftOfMonth(period) : null;
  /* Suggested, not imposed - and recomputed on every render, so a panel left
   * open across the end of the day catches up rather than going stale. */
  const suggested = suggestShape({ date, shiftOut: standard?.out_time });
  const shape = normaliseShape(chosen ?? suggested);
  const onSuggestion = chosen === null || chosen === suggested;

  /*
   * Yesterday, for the one-message-a-day shape. Day 1 has no yesterday in
   * THIS month - `attendance` is keyed by day of month, so there is nothing
   * to read and the message says so rather than reporting a day as clean.
   */
  const yesterday = day > 1 ? day - 1 : null;
  const yesterdayDate =
    yesterday && period
      ? `${period.year}-${String(period.month).padStart(2, '0')}-${String(yesterday).padStart(2, '0')}`
      : '';

  const built = useMemo(() => {
    if (!period || !standard) return null;
    return dailyReport({
      period,
      rows,
      day,
      date,
      standard: { in: standard.in_time, out: standard.out_time, grace: standard.grace },
      typed,
      title: heading ?? suggestedHeading,
      shape,
      asOf,
      hoursDay: yesterday,
      hoursDate: yesterdayDate,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, rows, day, typed, heading, suggestedHeading, shape, asOf, yesterday, yesterdayDate]);

  if (!built) return null;

  const shapeNow = REPORT_SHAPES.find((s) => s.key === shape);

  /* What will actually be sent: his edit if he made one, else the built text. */
  const text = edited === null ? built.text : edited;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setSaid('Copied. Paste it into the group.');
    } catch {
      // A browser that will not give us the clipboard is not a failure worth a
      // red banner - the text is on screen and can be selected.
      setSaid('Could not reach the clipboard — select the text above and copy it.');
    }
  };

  return (
    <div className="card" style={{ marginTop: '0.6rem' }}>
      <div className="late-head">
        <div>
          <h3 style={{ margin: 0 }}>Daily report for WhatsApp</h3>
        </div>
        <button className={open ? 'active' : 'primary'} onClick={() => setOpen((v) => !v)}>
          {open ? 'Close' : 'Write the message'}
        </button>
      </div>

      {!open ? (
        <p className="muted small">
          The message your office types into the group every morning — attendance with reasons, late coming,
          early going, uniform, <strong>short hours</strong> and overtime — written from this day's marks.{' '}
          <strong>Two messages a day</strong>, because the hours cannot be known until people have gone
          home: attendance in the morning, short hours and overtime after the last shift.
        </p>
      ) : (
        <>
          <p className="muted small">
            Written from the {built.counts.people} people on screen for{' '}
            <strong>{date}</strong>. The app <strong>assembles it, it does not send it</strong>: there is no
            WhatsApp API for a personal number, so copy it or use the share button and pick the group
            yourself.
          </p>

          <div className="row report-shapes">
            {REPORT_SHAPES.map((option) => (
              <button
                key={option.key}
                className={option.key === shape ? 'active' : 'ghost'}
                onClick={() => {
                  setChosen(option.key);
                  setEdited(null);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="muted small">
            {shapeNow?.why}
            {onSuggestion ? (
              <>
                {' '}
                <em>
                  Picked from the clock — it is {asOf || 'now'} and the usual day ends at{' '}
                  {standard.out_time || '18:30'}
                  {suggested === 'morning' ? ', so nobody has finished yet' : ', so the day is done'}.
                </em>
              </>
            ) : (
              <>
                {' '}
                <em>
                  You chose this one; the clock suggests{' '}
                  <button className="link" onClick={() => setChosen(null)}>
                    {REPORT_SHAPES.find((o) => o.key === suggested)?.label}
                  </button>
                  .
                </em>
              </>
            )}
          </p>
          {shape === 'with_yesterday' && !built.counts.hours_in_message && (
            <p className="muted small">
              This is the first of the month, so yesterday belongs to the previous sheet — open that month
              to report its hours.
            </p>
          )}
          {shape === 'with_yesterday' && built.counts.hours_in_message && (
            <p className="muted small">
              The hours in this message are <strong>{longDate(built.hours_date)}</strong>, named as such in
              the text, so nothing in it reads as today's.
            </p>
          )}

          <div className="form-grid report-fields">
            <label>
              Time on the message
              <input
                value={asOf}
                onChange={(e) => {
                  setAsOf(e.target.value);
                  setEdited(null);
                }}
                placeholder="19:10"
              />
              <span className="hint">
                Stamped under the date, so the group knows how fresh it is. Clear it for no stamp.
              </span>
            </label>
            <label>
              Heading
              <input
                value={heading ?? suggestedHeading}
                onChange={(e) => {
                  setHeading(e.target.value);
                  setEdited(null);
                }}
              />
            </label>
            <label>
              Office Inspection
              <input
                value={typed.inspection}
                onChange={(e) => {
                  setTyped({ ...typed, inspection: e.target.value });
                  setEdited(null);
                }}
              />
            </label>
            <label>
              Conduct
              <input
                value={typed.conduct}
                onChange={(e) => {
                  setTyped({ ...typed, conduct: e.target.value });
                  setEdited(null);
                }}
              />
            </label>
            <label>
              Incidents
              <input
                value={typed.incidents}
                onChange={(e) => {
                  setTyped({ ...typed, incidents: e.target.value });
                  setEdited(null);
                }}
              />
            </label>
          </div>
          <p className="muted small">
            Those three are <strong>not recorded anywhere in this app</strong>, so they are yours to type —
            nothing is assumed about an inspection nobody logged.
          </p>

          <textarea
            className="daily-report-text"
            rows={Math.min(30, text.split('\n').length + 1)}
            value={text}
            onChange={(e) => setEdited(e.target.value)}
            spellCheck={false}
          />

          <div className="row">
            <button className="primary" onClick={copy}>
              Copy the message
            </button>
            <a
              className="button-like"
              href={`https://wa.me/?text=${encodeURIComponent(text)}`}
              target="_blank"
              rel="noreferrer"
            >
              Open WhatsApp
            </a>
            {edited !== null && (
              <button className="ghost" onClick={() => setEdited(null)}>
                Back to what the app wrote
              </button>
            )}
            <span className="muted small">
              {built.counts.present} present · {built.counts.absent} absent · {built.counts.late} late ·{' '}
              {built.counts.short} short · {built.counts.overtime} on overtime
            </span>
          </div>
          {said && <p className="muted small">{said}</p>}
          <p className="muted small">
            <strong>Without anybody opening this page</strong>, twice a day:{' '}
            <code>{`${window.location.origin}/api/people/daily-report?format=text&shape=morning`}</code> at
            ten, and the same link with <code>shape=end_of_day</code> after the last shift — both of them
            today's. <code>shape=with_yesterday</code> is the one-message-a-day version. Also{' '}
            <code>&amp;day=YYYY-MM-DD</code> for a particular day, <code>&amp;as_of=19:10</code> for the
            stamp, and <code>&amp;inspection=&amp;conduct=&amp;incidents=</code> for the three typed lines.
            The WhatsApp assistant already holding a linked session can fetch those on a schedule and post
            them — this app deliberately holds no session of its own.
          </p>
          <p className="muted small">
            <strong>The end-of-day message is only as fresh as the last punch import.</strong> An out punch
            the app has not read yet leaves that person's hours unknown, and they are named rather than
            counted as fine — so either leave the automatic import running, or press Import on Reports
            before you send it.
          </p>
          {built.counts.nothing_marked && (
            <p className="muted small">
              Nothing is marked for this day yet, so the message says that instead of listing everybody as
              absent.
            </p>
          )}
        </>
      )}
    </div>
  );
}
