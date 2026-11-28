/**
 * What state an office login is in, as one badge on the Logins screen.
 *
 * Switched off outranks everything: a login that cannot get in must never
 * read as "Active" or "Must change password" - both suggest it works.
 */
export function loginStatus(user) {
  if (!user.active) return ['off', 'Switched off'];
  if (user.must_change) return ['change', 'Must change password'];
  if (!user.last_login_at) return ['never', 'Never signed in'];
  return ['on', 'Active'];
}
