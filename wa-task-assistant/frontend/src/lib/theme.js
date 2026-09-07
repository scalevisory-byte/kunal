/**
 * Light, dark, or whatever the device says.
 *
 * The palette for all three already exists in styles.css - `:root` carries
 * light, a `prefers-color-scheme` block carries dark, and `[data-theme]`
 * overrides both. All that was missing was a way to say which you want, so this
 * only sets an attribute on the root element.
 *
 * Three states rather than two, because "match my device" is a real answer and
 * not the absence of one: a phone that goes dark in the evening should take the
 * dashboard with it unless you have said otherwise. That is the default, and
 * choosing light or dark is choosing to stop following it.
 */

const KEY = 'wa-tasks-theme';
export const THEMES = ['system', 'light', 'dark'];

export function getTheme() {
  try {
    const saved = localStorage.getItem(KEY);
    return THEMES.includes(saved) ? saved : 'system';
  } catch {
    // A private window, or site data blocked. Follow the device.
    return 'system';
  }
}

/** What is actually on screen right now, which "system" alone does not say. */
export function resolvedTheme(theme = getTheme()) {
  if (theme !== 'system') return theme;
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);

  // So form controls, scrollbars and the browser's own chrome follow too.
  root.style.colorScheme = theme === 'system' ? 'light dark' : theme;
}

export function setTheme(theme) {
  const next = THEMES.includes(theme) ? theme : 'system';
  try {
    if (next === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch { /* nothing to persist to; the choice still applies to this tab */ }
  applyTheme(next);
  return next;
}
