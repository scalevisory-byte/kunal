import { useMemo, useState } from 'react';
import { TYPED_DEFAULTS, dailyReport } from '../../../shared/dailyReport.js';
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

  const date = period
    ? `${period.year}-${String(period.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    : '';

  const suggestedHeading = companyName
    ? `${companyName.toUpperCase()} DAILY OFFICE REPORT`
    : 'DAILY OFFICE REPORT';

  const built = useMemo(() => {
    if (!period) return null;
    const standard = shiftOfMonth(period);
    return dailyReport({
      period,
      rows,
      day,
      date,
      standard: { in: standard.in_time, out: standard.out_time, grace: standard.grace },
      typed,
      title: heading ?? suggestedHeading,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, rows, day, typed, heading, suggestedHeading]);

  if (!built) return null;

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
          early going, uniform, <strong>short hours</strong> and overtime — written from this day's marks.
        </p>
      ) : (
        <>
          <p className="muted small">
            Written from the {built.counts.people} people on screen for{' '}
            <strong>{date}</strong>. The app <strong>assembles it, it does not send it</strong>: there is no
            WhatsApp API for a personal number, so copy it or use the share button and pick the group
            yourself.
          </p>

          <div className="form-grid">
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
            Every morning without anybody opening this page:{' '}
            <code>{`${window.location.origin}/api/people/daily-report?format=text`}</code> returns the same
            message as plain text, with <code>&amp;day=YYYY-MM-DD</code> for a particular day and{' '}
            <code>&amp;inspection=&amp;conduct=&amp;incidents=</code> for the three typed lines. The
            WhatsApp assistant already holding a linked session can fetch that on a schedule and post it —
            this app deliberately holds no session of its own.
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
