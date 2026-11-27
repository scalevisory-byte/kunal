/*
 * When the office's "staff are waiting" box should come up.
 *
 * Dinesh (v2.35.0): a request nobody has acted on should pop up, and keep
 * popping up every hour until it is acted on. Kept here, apart from the box
 * itself, because the rule is the whole feature and a rule inside a component
 * cannot be tested.
 *
 *   - nothing waiting            -> never;
 *   - never put away             -> now;
 *   - something new since then   -> now (a new leave application must not
 *                                   wait out somebody else's hour);
 *   - an hour since put away     -> now;
 *   - otherwise                  -> not yet.
 *
 * "New" is judged by the lines' wording, which carries the names: one more
 * person applying changes the line, the same two waiting does not.
 */

export const REMIND_EVERY_MS = 60 * 60 * 1000;

export const reminderSignature = (items = []) =>
  items
    .map((i) => String(i?.text || ''))
    .sort()
    .join('\n');

export function reminderDue(items, seen, now = Date.now()) {
  if (!items || !items.length) return false;
  if (!seen || !Number.isFinite(Number(seen.at))) return true;
  const was = new Set(String(seen.signature || '').split('\n').filter(Boolean));
  if (items.some((i) => !was.has(String(i?.text || '')))) return true;
  return now - Number(seen.at) >= REMIND_EVERY_MS;
}
