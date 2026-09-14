import { useState } from 'react';

const kb = (n) => (n >= 1024 * 1024
  ? `${(n / 1024 / 1024).toFixed(1)} MB`
  : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * Encryption at rest, and the one step left for a person.
 *
 * The panel's job is not to celebrate a green tick. Turning encryption on
 * trades "anyone with the disk reads everything" for "anyone without the key
 * has nothing", and the second is only a good trade if the key is somewhere
 * safe. So the state that matters most is the in-between one — converted, but
 * the readable copy still sitting there — and that is the state this says the
 * most about, because it is the only one with something to do.
 */
export default function Encryption({ state, onError, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  if (!state) return null;
  const { enabled, database, keyFingerprint, whatsappSessionEncrypted, plaintextBackups = [] } = state;
  const leftovers = plaintextBackups.length > 0;

  const drop = async () => {
    setBusy(true);
    try {
      await onChanged();
      setConfirming(false);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-block">
      <header className="settings-head">
        <h3>Encryption at rest</h3>
        <span>{database === 'encrypted' ? 'Database encrypted' : 'Database not encrypted'}</span>
      </header>

      {!enabled && (
        <>
          <p className="field-note">
            The database is stored <b>as plain text</b>. Anyone who gets a copy of the
            disk — or of a backup of it — can read every message, task and note in it
            without a password.
          </p>
          <p className="field-note">
            To turn encryption on, set <code>DB_ENCRYPTION_KEY</code> in the hosting
            provider's variables and redeploy. Generate one with{' '}
            <code>openssl rand -base64 32</code>.{' '}
            <b>Save it somewhere you will still have it in a year.</b> There is no
            recovery: lose the key and the data is gone for good.
          </p>
        </>
      )}

      {enabled && database === 'encrypted' && (
        <p className="field-note">
          Every page of the database is encrypted on disk, and files attached to tasks
          are encrypted as they are written. Key <code>{keyFingerprint}</code> — that is
          a fingerprint, not the key.
        </p>
      )}

      {leftovers && (
        <div className="warn-box">
          <p>
            <b>The readable copy is still here.</b> The conversion left the original
            plain-text database on disk on purpose, so that a lost key is not the end
            of it. Until it is deleted, anyone who gets the disk can still read
            everything — so the encryption is not yet doing anything.
          </p>
          <ul className="plain-list">
            {plaintextBackups.map((b) => (
              <li key={b.name}><code>{b.name}</code> · {kb(b.bytes)}</li>
            ))}
          </ul>
          {!confirming ? (
            <button type="button" className="btn danger" onClick={() => setConfirming(true)}>
              Delete the plain-text copy
            </button>
          ) : (
            <div className="confirm-inline">
              <p>
                After this, <b>{keyFingerprint ? 'the key' : 'DB_ENCRYPTION_KEY'} is the only
                way into this data.</b> Have you saved it somewhere safe?
              </p>
              <button type="button" className="btn danger" disabled={busy} onClick={drop}>
                {busy ? 'Deleting…' : 'Yes, delete it'}
              </button>
              <button type="button" className="btn" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      <p className="field-note quiet">
        <b>What this does not cover:</b> the WhatsApp login
        {whatsappSessionEncrypted ? '' : ' is not encrypted'}. It is a Chromium profile
        that is written to continuously while the app runs, so there is no moment at
        which this app could hold it sealed. Anyone who takes that folder can link the
        account, with or without a key set.
      </p>
    </section>
  );
}
