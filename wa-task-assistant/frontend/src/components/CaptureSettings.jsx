import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

/**
 * What the app reads from your chats. This sits with the connection rather than
 * with the reminders, because it is about capture, not about being chased.
 */
export default function CaptureSettings({ onError }) {
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.schedulingSettings();
      setSettings(data.settings);
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
        <h3>What is read</h3>
        <span>{saving ? 'Saving…' : 'Applies to incoming messages'}</span>
      </header>

      <div className="set-row">
        <div className="set-label">
          <strong>Read photos in chats</strong>
          <small>
            Invoices, bills, cheques and forms arrive as pictures, often with no caption,
            and what has to be done is visible only in the image. Claude reads those the
            same way it reads a message, and the photo is attached to the task it creates.
          </small>
        </div>
        <div className="set-control">
          <button
            type="button"
            className={`toggle ${settings.readImages ? 'on' : ''}`}
            role="switch"
            aria-checked={settings.readImages}
            aria-label="Read photos"
            onClick={() => save({ readImages: !settings.readImages })}
          >
            <span />
          </button>
        </div>
      </div>

      <p className="field-note">
        Off by default because it costs more: a photo is roughly a page of tokens, and most
        photos in a personal chat are forwards and greetings. Turn it on and watch{' '}
        <strong>AI Usage</strong> for a few days to see what it actually adds.
      </p>
    </section>
  );
}
