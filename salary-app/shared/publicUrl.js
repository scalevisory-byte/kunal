/**
 * The address candidates reach this app at.
 *
 * Until now it was `PUBLIC_URL` in the server's environment and nowhere else,
 * so the apply link simply did not exist and the only thing the screen could
 * say was "set PUBLIC_URL on the server" - a sentence that helps nobody
 * holding a laptop. It is a setting now, typed in the app and kept with the
 * installation, with the environment variable as the default.
 *
 * This module only decides what a usable address IS. Nothing here makes a link
 * work: that happens when the app is actually reachable at it.
 */

/** Tidy what somebody typed, or say why it is not an address. */
export function cleanPublicUrl(value) {
  const text = String(value ?? '').trim();
  if (!text) return { url: '', problem: '' };

  /*
   * Said before parsing, because `new URL` quietly makes "not a link !!" into
   * a host called "not" and the complaint then comes out as "that looks like a
   * name on your own network" - true, but not the thing that is wrong.
   */
  if (/\s/.test(text)) return { url: '', problem: 'An address has no spaces in it' };

  /*
   * Typed without a scheme, which is how everybody types an address.
   *
   * Tested for ANY scheme, not just http - "https://" glued onto
   * "ftp://hr.booknfly.in" gives a host called "ftp", and the complaint then
   * came out as "a name on your own network" instead of naming the protocol.
   */
  // A real scheme is followed by "//". Without that test, "localhost:3000"
  // reads as a scheme called "localhost" and the port becomes the path.
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  const withScheme = hasScheme ? text : `https://${text}`;
  let parsed;
  try {
    parsed = new URL(withScheme);
  } catch {
    return { url: '', problem: 'That is not a web address' };
  }
  if (!/^https?:$/i.test(parsed.protocol)) {
    return { url: '', problem: 'An address has to start with http:// or https://' };
  }
  // A hostname with no dot is a machine name on somebody's own network -
  // "localhost", "hrms" - which a candidate on a phone cannot reach.
  if (!parsed.hostname.includes('.') && parsed.hostname !== 'localhost') {
    return { url: '', problem: 'That looks like a name on your own network, not an address on the internet' };
  }
  // "https://mailto:someone@booknfly.in" parses as a user called mailto at
  // booknfly.in. Nobody means that, so it is named rather than quietly kept.
  if (parsed.username || parsed.password) {
    return { url: '', problem: 'Just the address — no name or password in front of it' };
  }
  if (parsed.search || parsed.hash) {
    return { url: '', problem: 'Just the address — no ? or # on the end' };
  }
  // Keep a path ("/hr"), drop the trailing slash, lose nothing else.
  const path = parsed.pathname.replace(/\/+$/, '');
  return { url: `${parsed.origin}${path}`, problem: '' };
}

/**
 * Is this an address a candidate could actually open?
 *
 * localhost and a private address are accepted as a SETTING - somebody testing
 * on their own machine is doing the right thing - but they are not something
 * to put on an advert, and the screen says so rather than handing out a link
 * that works on exactly one computer.
 */
export function reachablePublicly(url) {
  const text = String(url || '');
  if (!text) return false;
  let host;
  try {
    host = new URL(text).hostname;
  } catch {
    return false;
  }
  if (host === 'localhost' || host.endsWith('.local')) return false;
  if (/^127\./.test(host) || host === '::1') return false;
  if (/^10\./.test(host) || /^192\.168\./.test(host)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
  return true;
}
