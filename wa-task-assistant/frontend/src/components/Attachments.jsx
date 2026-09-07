import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { api } from '../api.js';

/** No trailing ".0": the limits are round numbers and should read as round. */
const size = (bytes) => {
  if (bytes >= 1e6) {
    const mb = bytes / 1e6;
    return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
  }
  return bytes >= 1e3 ? `${Math.round(bytes / 1e3)} KB` : `${bytes} B`;
};

/**
 * Files kept beside a task. The store is bounded, and the remaining space is
 * shown rather than left to be discovered when an upload fails - this is the
 * same volume whose filling up once stopped the whole service from starting.
 */
export default function Attachments({ task, initial, onError }) {
  const [files, setFiles] = useState(initial || []);
  const [storage, setStorage] = useState(null);
  const [busy, setBusy] = useState(false);
  const input = useRef(null);

  useEffect(() => {
    api.attachments(task.id)
      .then((d) => { setFiles(d.attachments); setStorage(d.storage); })
      .catch(() => {});
  }, [task.id]);

  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const data = await api.uploadAttachment(task.id, file);
      setFiles(data.attachments);
      setStorage(data.storage);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const remove = async (id) => {
    setBusy(true);
    try {
      const { storage: next } = await api.deleteAttachment(id);
      setFiles((current) => current.filter((f) => f.id !== id));
      setStorage(next);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  const nearlyFull = storage && storage.remaining < storage.maxFile;

  return (
    <div className="field">
      <label>
        Files
        {files.length > 0 && <span className="count-note">{files.length}</span>}
      </label>

      {files.length > 0 && (
        <ul className="file-list">
          {files.map((file) => (
            <li key={file.id}>
              <button
                type="button"
                className="file-open"
                onClick={() => api.openAttachment(file).catch(onError)}
              >
                <Icon name="clipboard" size={13} />
                <span className="file-name">{file.filename}</span>
                <span className="file-size">{size(file.bytes)}</span>
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label={`Delete ${file.filename}`}
                disabled={busy}
                onClick={() => remove(file.id)}
              >
                <Icon name="trash" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <input
        ref={input}
        type="file"
        className="visually-hidden"
        onChange={(e) => upload(e.target.files?.[0])}
      />
      <button
        type="button"
        className="btn small ghost"
        disabled={busy || nearlyFull}
        onClick={() => input.current?.click()}
      >
        {busy ? 'Uploading…' : 'Attach a file'}
      </button>

      {storage && (
        <p className="field-note">
          {nearlyFull
            ? `Storage is full — ${size(storage.used)} of ${size(storage.total)} used. Delete a file to make room.`
            : `${size(storage.used)} of ${size(storage.total)} used · up to ${size(storage.maxFile)} per file.`}
        </p>
      )}
    </div>
  );
}
