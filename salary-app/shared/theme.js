/**
 * Light, dark, or whatever the device says.
 *
 * Dinesh: *"light dark option do"*. Dark already worked - it followed the
 * device. What did not exist was a way to DISAGREE with the device, which is
 * the whole request: somebody whose laptop is dark all day and who wants this
 * one app light had no way to say so.
 *
 * THREE CHOICES, NOT TWO. "Follow the device" is the honest default and is
 * not the same as either of the other two: a phone that goes dark at sunset
 * should take the app with it unless somebody has said otherwise. A two-way
 * switch would have to pick one at install time and silently stop following.
 *
 * Dependency-free, so the page's own first-paint script and the React
 * component that draws the switch cannot disagree about what is stored or
 * what it means.
 */

export const THEMES = [
  ['system', 'Follow the device'],
  ['light', 'Light'],
  ['dark', 'Dark'],
];

export const THEME_KEY = 'bnf-hrms-theme';

export const themeLabel = (value) => THEMES.find(([key]) => key === value)?.[1] || 'Follow the device';

/** Anything we do not recognise is "follow the device", never a guess. */
export const cleanTheme = (value) =>
  THEMES.some(([key]) => key === value) ? value : 'system';

/**
 * What to put on <html data-theme>.
 *
 * Deliberately EMPTY for "system", rather than resolving it to light or dark
 * here. The stylesheet's media query already answers that, every time the
 * device changes its mind - writing an answer onto the element would freeze
 * it at whatever it was when the page loaded, and a phone switching to dark
 * at sunset would leave the app light until somebody reloaded it.
 */
export const themeAttribute = (value) => (cleanTheme(value) === 'system' ? '' : cleanTheme(value));

/**
 * Read the choice, and write it, without ever taking the app down.
 *
 * A private window throws on merely TOUCHING localStorage - the same trap the
 * sign-in screen's Remember Me hit. A theme is a convenience; it must not be
 * the reason somebody cannot open the payroll.
 */
export function readTheme(storage) {
  try {
    return cleanTheme(storage?.getItem(THEME_KEY));
  } catch {
    return 'system';
  }
}

export function writeTheme(storage, value) {
  const theme = cleanTheme(value);
  try {
    if (theme === 'system') storage?.removeItem(THEME_KEY);
    else storage?.setItem(THEME_KEY, theme);
  } catch {
    /* Not stored. The choice still applies to this tab, which is the part
     * somebody can see; it simply will not survive a reload. */
  }
  return theme;
}

/** Put it on the document. Separated so the first-paint script can call it. */
export function applyTheme(documentElement, value) {
  if (!documentElement) return cleanTheme(value);
  const attribute = themeAttribute(value);
  if (attribute) documentElement.setAttribute('data-theme', attribute);
  else documentElement.removeAttribute('data-theme');
  return cleanTheme(value);
}
