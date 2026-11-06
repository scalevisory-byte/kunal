import { useRef, useState } from 'react';
import { STANDALONE, api } from '../api.js';

/*
 * A face on the record.
 *
 * A photograph was always uploadable - it is one of the document kinds, and it
 * counts towards KYC - but it only ever appeared as a filename in a list, so
 * nobody could see whether the right person was on the right record. Dinesh
 * asked for it on the employee master, and this is what he meant: the picture,
 * where the name is.
 *
 * It is the SAME store as the documents panel: uploading here posts a document
 * of kind `photo`, so the KYC count stays right and a replacement does not
 * delete the old one. An ID card printed last year is allowed to look like the
 * person did last year.
 */

/** Initials, for anybody with no photograph. Better than an empty grey box. */
function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/**
 * Just the picture. `src` is a route, not a signed link: it is behind the
 * session, so it keeps working on a page left open all afternoon.
 */
export function Avatar({ employee, size = 'sm', src }) {
  const [failed, setFailed] = useState(false);
  const url =
    src ||
    (!STANDALONE && employee?.has_photo && employee?.id
      ? `/api/employees/${employee.id}/photo`
      : '');
  if (!url || failed) {
    return (
      <span className={`avatar avatar-${size} avatar-none`} aria-hidden="true">
        {initials(employee?.name || employee?.employee_name)}
      </span>
    );
  }
  return (
    <img
      className={`avatar avatar-${size}`}
      src={url}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

/** The picture plus the way to change it, for the record drawer. */
export default function EmployeePhoto({ employee, onChanged, onError }) {
  const file = useRef(null);
  const [busy, setBusy] = useState(false);
  // Bumped after an upload so the <img> refetches: the URL does not change.
  const [stamp, setStamp] = useState(0);

  if (STANDALONE) {
    return (
      <span className="avatar avatar-lg avatar-none" title="A photograph needs the server version">
        {initials(employee?.name)}
      </span>
    );
  }

  const pick = async (e) => {
    const chosen = e.target.files?.[0];
    if (!chosen) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.set('document', chosen);
      form.set('kind', 'photo');
      await api.upload(`/employees/${employee.id}/documents`, form);
      setStamp(Date.now());
      await onChanged?.();
    } catch (err) {
      onError?.(err);
    } finally {
      setBusy(false);
      if (file.current) file.current.value = '';
    }
  };

  /*
   * After the first upload `has_photo` is still false until the employee list
   * reloads, so the stamp alone decides: it shows the face at once rather than
   * leaving the initials sitting there as if nothing had happened.
   */
  const src = stamp
    ? `/api/employees/${employee.id}/photo?v=${stamp}`
    : employee?.has_photo
      ? `/api/employees/${employee.id}/photo`
      : '';

  return (
    <div className="photo-slot">
      <Avatar employee={employee} size="lg" src={src} />
      <input
        ref={file}
        type="file"
        accept="image/jpeg,image/png"
        style={{ display: 'none' }}
        onChange={pick}
      />
      <button className="ghost tiny" disabled={busy} onClick={() => file.current?.click()}>
        {busy ? 'Uploading…' : employee?.has_photo ? 'change' : 'add a photo'}
      </button>
    </div>
  );
}
