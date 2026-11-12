/**
 * A name turned into a username: "Amit Shah" -> "amit.shah".
 *
 * ONE rule, in shared/, because there are two places that need it and they
 * had started to differ: the server makes staff usernames with its own
 * version, and the Admin screen had just grown a second one for office
 * logins. On "Meena-Shah" they already disagreed - meena.shah against
 * meenashah - which is the kind of difference nobody notices until two
 * people are told two different usernames for the same person.
 *
 * It gets read out across a counter and typed at a sign-in box, so: letters
 * and digits only, no accents, and at most two parts. Whether it collides
 * with one that exists is the server's question, not this one's - only the
 * server can see the other logins.
 */
export function usernameBase(name) {
  const base = String(name || '')
    .toLowerCase()
    // Strip the accents rather than treating them as punctuation: "José"
    // should be "jose", not "jos". Decompose, then drop the marks.
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    // Anything that is not a letter or a digit becomes a separator, so a
    // hyphen, an apostrophe and a space all read the same way.
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .split('.')
    .filter(Boolean)
    .slice(0, 2)
    .join('.');
  // 36 characters, which is inside the 40 createUser allows and leaves room
  // for the digit a collision adds.
  return base.slice(0, 36);
}
