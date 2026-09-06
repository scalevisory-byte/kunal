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

const Toggle = ({ on, onChange, label }) => (
  <button
    type="button"
    className={`toggle ${on ? 'on' : ''}`}
    role="switch"
    aria-checked={on}
    aria-label={label}
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
        <h3>Reminders &amp; follow-ups</h3>
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

      <Row label="Follow-up interval" note="How long an AI-created follow-up waits by default.">
        <select value={settings.followUpIntervalDays} onChange={(e) => save({ followUpIntervalDays: Number(e.target.value) })}>
          <option value={1}>1 day</option>
          <option value={2}>2 days</option>
          <option value={3}>3 days</option>
          <option value={7}>7 days</option>
        </select>
      </Row>

      <Row label="Maximum follow-ups" note="After this many with no reply, it asks for your attention.">
        <select value={settings.followUpMax} onChange={(e) => save({ followUpMax: Number(e.target.value) })}>
          <option value={2}>2</option>
          <option value={3}>3</option>
          <option value={5}>5</option>
        </select>
      </Row>

      <Row label="Escalation" note="Stop repeating after the maximum and flag it, instead of chasing forever.">
        <Toggle on={settings.escalation} label="Escalation" onChange={(v) => save({ escalation: v })} />
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
        label="WhatsApp"
        note="Sends to your own chat only — never to a contact. Off by default."
      >
        <Toggle on={settings.notifyWhatsApp} label="WhatsApp" onChange={(v) => save({ notifyWhatsApp: v })} />
      </Row>
    </section>
  );
}
