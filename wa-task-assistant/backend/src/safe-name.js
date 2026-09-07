import path from 'node:path';

/**
 * A filename supplied by a browser is untrusted: it can carry a path, control
 * characters, or a hundred characters of nothing. The result of this is for
 * display only - the bytes are always stored under a random name of our own,
 * so nothing a user types can decide where a file lands.
 *
 * Spaces, dashes and the extension are kept, because the point is that the file
 * still reads as the one the user recognises.
 */
export function safeDisplayName(raw) {
  // basename() knows POSIX separators only; a Windows path arrives with
  // backslashes, so take the last segment of either.
  const last = String(raw || 'file').split(/[/\\]/).pop();
  const clean = path
    .basename(last)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/^\.+/, '')
    .trim();
  return (clean || 'file').slice(0, 120);
}
