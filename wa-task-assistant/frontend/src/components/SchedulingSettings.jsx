import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

const Row = ({ label, note, children }) => (
  <div className="set-row">
    <div className="set-label">
      <strong>{label}</strong>
      {note && <small>{note}</small>}
    </div>
    <div className="set-control">{children}</div>
  </div>
);

const Toggle = ({ on, onChange, label, disabled = false }) => (
  <button
    type="button"
    className={`toggle ${on ? 'on' : ''}`}
    role="switch"
    aria-checked={on}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!on)}
  >
    <span />
  </button>
);

/** Reminder and follow-up behaviour. Saved as you change it. */
export default function SchedulingSettings({ onError }) {
  const [settings, setSettings] = useState(null);
  const [timezone, setTimezone] = useState('');
  const [saving, setSaving] = useState(false);

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
    setSaving(true);
    try {
      const data = await api.saveSchedulingSettings(patch);
      setSettings(data.settings);
    } catch (err) {
      onError(err);
      load();
    } finally {
      setSaving(false);
    }
  };

  if (!settings) return null;

  return (
    <section className="settings-block">
      <header className="settings-head">
        <h3>Before the deadline</h3>
        <span>{saving ? 'Saving…' : `Times in ${timezone}`}</span>
      </header>

      <Row label="Default reminder" note="Used by the presets in a task's drawer.">
        <select value={settings.defaultReminderOffset} onChange={(e) => save({ defaultReminderOffset: Number(e.target.value) })}>
          <option value={0}>At the due time</option>
          <option value={15}>15 minutes before</option>
          <option value={30}>30 minutes before</option>
          <option value={60}>1 hour before</option>
          <option value={120}>2 hours before</option>
          <option value={1440}>1 day before</option>
        </select>
      </Row>

      <Row label="Business hours" note="Reminders outside these hours move to the next morning.">
        <div className="set-inline">
          <Toggle on={settings.businessHoursEnabled} label="Business hours"
            onChange={(v) => save({ businessHoursEnabled: v })} />
          <input type="time" value={settings.businessStart} disabled={!settings.businessHoursEnabled}
            onChange={(e) => save({ businessStart: e.target.value })} />
          <span>to</span>
          <input type="time" value={settings.businessEnd} disabled={!settings.businessHoursEnabled}
            onChange={(e) => save({ businessEnd: e.target.value })} />
        </div>
      </Row>

      <Row label="Skip weekends" note="A Saturday or Sunday reminder moves to Monday.">
        <Toggle on={settings.skipWeekends} label="Skip weekends" onChange={(v) => save({ skipWeekends: v })} />
      </Row>

      <Row label="Missed reminders" note="Older than this is marked missed instead of firing late.">
        <select value={settings.missedAfterHours} onChange={(e) => save({ missedAfterHours: Number(e.target.value) })}>
          <option value={6}>After 6 hours</option>
          <option value={12}>After 12 hours</option>
          <option value={24}>After 24 hours</option>
          <option value={72}>After 3 days</option>
        </select>
      </Row>

      <Row label="Remind at the due time" note="One notification the moment a task falls due.">
        <Toggle on={settings.remindAtDue} label="Remind at due" onChange={(v) => save({ remindAtDue: v })} />
      </Row>

      <header className="settings-head second">
        <h3>Follow up until it is done</h3>
        <span>After the deadline, while a task is still open</span>
      </header>

      <Row label="Keep following up" note="Turn off to stop after the due reminder.">
        <Toggle on={settings.followUpEnabled} label="Follow up" onChange={(v) => save({ followUpEnabled: v })} />
      </Row>

      {[0, 1, 2].map((index) => (
        <Row
          key={index}
          label={`${['First', 'Second', 'Third'][index]} follow-up`}
          note={`How long after the deadline the ${['first', 'second', 'third'][index]} nudge goes out.`}
        >
          <select
            value={settings.followUpOffsets[index] ?? ''}
            disabled={!settings.followUpEnabled}
            onChange={(e) => {
              const next = [...settings.followUpOffsets];
              next[index] = Number(e.target.value);
              save({ followUpOffsets: next });
            }}
          >
            <option value={15}>15 minutes after</option>
            <option value={30}>30 minutes after</option>
            <option value={60}>1 hour after</option>
            <option value={120}>2 hours after</option>
            <option value={480}>8 hours after</option>
            <option value={960}>16 hours after (next morning)</option>
            <option value={1440}>1 day after</option>
          </select>
        </Row>
      ))}

      <Row label="Maximum follow-ups" note="After this many, the task is flagged and the app stops asking.">
        <select value={settings.followUpMax} disabled={!settings.followUpEnabled}
          onChange={(e) => save({ followUpMax: Number(e.target.value) })}>
          <option value={1}>1</option>
          <option value={2}>2</option>
          <option value={3}>3</option>
        </select>
      </Row>

      <Row label="Default due time" note="Used when a task has a date but no time.">
        <input type="time" value={settings.defaultDueTime}
          onChange={(e) => save({ defaultDueTime: e.target.value })} />
      </Row>

      <header className="settings-head second">
        <h3>Where reminders go</h3>
      </header>

      <Row label="In the app" note="The bell in the header. Always on.">
        <Toggle on onChange={() => {}} label="In app" />
      </Row>

      <Row label="Browser notification" note="Needs 'Enable alerts' in the header once per device.">
        <Toggle on={settings.notifyBrowser} label="Browser" onChange={(v) => save({ notifyBrowser: v })} />
      </Row>

      <Row
        label="WhatsApp — deadline reminders"
        note="The reminder at or before the due time. Your own chat only, never a contact."
      >
        <Toggle on={settings.notifyWhatsApp} label="WhatsApp deadline reminders"
          onChange={(v) => save({ notifyWhatsApp: v })} />
      </Row>

      <Row
        label="WhatsApp — follow-ups"
        note="The nudges after a deadline passes, until the task is done."
      >
        <Toggle on={settings.whatsappFollowUps} label="WhatsApp follow-ups"
          disabled={!settings.followUpEnabled}
          onChange={(v) => save({ whatsappFollowUps: v })} />
      </Row>

      <header className="settings-head second">
        <h3>Daily briefing</h3>
        <span>One WhatsApp message each morning</span>
      </header>

      <Row
        label="Daily WhatsApp briefing"
        note="Today's tasks and anything overdue, in one message to your own chat."
      >
        <Toggle on={settings.dailyBriefing} label="Daily briefing"
          onChange={(v) => save({ dailyBriefing: v })} />
      </Row>

      <Row label="Briefing time" note={`Sent at this time, ${timezone}.`}>
        <input type="time" value={settings.briefingTime} disabled={!settings.dailyBriefing}
          onChange={(e) => save({ briefingTime: e.target.value })} />
      </Row>

      <BriefingPreview timezone={timezone} onError={onError} />

      <header className="settings-head second">
        <h3>Weekly review</h3>
        <span>One message summing up the week</span>
      </header>

      <Row
        label="Weekly summary"
        note="What you finished, what is still open, and which chats the work came from."
      >
        <Toggle on={settings.weeklySummary} label="Weekly summary"
          onChange={(v) => save({ weeklySummary: v })} />
      </Row>

      <Row label="Sent on" note={`Day and time, ${timezone}.`}>
        <div className="set-inline">
          <select value={settings.weeklyDay} disabled={!settings.weeklySummary}
            onChange={(e) => save({ weeklyDay: Number(e.target.value) })}>
            {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
              .map((name, index) => <option key={name} value={index}>{name}</option>)}
          </select>
          <input type="time" value={settings.weeklyTime} disabled={!settings.weeklySummary}
            onChange={(e) => save({ weeklyTime: e.target.value })} />
        </div>
      </Row>

      <WeeklyPreview onError={onError} />
    </section>
  );
}

/** The week's review as it would arrive, and a way to send it now. */
function WeeklyPreview({ onError }) {
  const [state, setState] = useState(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState('');

  const load = useCallback(async () => {
    try {
      setState(await api.weeklySummary());
    } catch (err) {
      onError(err);
    }
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  const sendNow = async () => {
    setSending(true);
    setResult('');
    try {
      const out = await api.runWeekly();
      setResult(out.sent ? 'Sent to your own WhatsApp chat.' : `Not sent — ${out.reason}.`);
      load();
    } catch (err) {
      onError(err);
    } finally {
      setSending(false);
    }
  };

  if (!state) return null;

  return (
    <div className="briefing-preview">
      <div className="briefing-preview-head">
        <strong>This week's message</strong>
        <span>{state.sent?.sent_at ? 'Already sent this week' : 'Not sent yet'}</span>
      </div>
      <pre>{state.preview}</pre>
      <div className="briefing-preview-foot">
        <button type="button" className="btn ghost" onClick={sendNow} disabled={sending}>
          {sending ? 'Sending…' : 'Send now'}
        </button>
        {result && <small>{result}</small>}
      </div>
    </div>
  );
}

/** Exactly what would go out, and a way to send it now to check the wiring. */
function BriefingPreview({ timezone, onError }) {
  const [state, setState] = useState(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState('');

  const load = useCallback(async () => {
    try {
      setState(await api.briefing());
    } catch (err) {
      onError(err);
    }
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  const sendNow = async () => {
    setSending(true);
    setResult('');
    try {
      const out = await api.runBriefing();
      setResult(out.sent ? 'Sent to your own WhatsApp chat.' : `Not sent — ${out.reason}.`);
      load();
    } catch (err) {
      onError(err);
    } finally {
      setSending(false);
    }
  };

  if (!state) return null;

  const sentAt = state.today?.sent_at;

  return (
    <div className="briefing-preview">
      <div className="briefing-preview-head">
        <strong>Today's message</strong>
        <span>
          {sentAt
            ? `Sent ${new Date(sentAt + 'Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
            : `Not sent yet · ${timezone}`}
        </span>
      </div>
      <pre>{state.preview}</pre>
      <div className="briefing-preview-foot">
        <button type="button" className="btn ghost" onClick={sendNow} disabled={sending}>
          {sending ? 'Sending…' : 'Send now'}
        </button>
        {result && <small>{result}</small>}
      </div>
    </div>
  );
}
