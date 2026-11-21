/**
 * HOW LONG TO WAIT AFTER A RUN OF WRONG PASSWORDS.
 *
 * There was no limit at all: `/api/auth/login` would answer as fast as it was
 * asked, for ever, so a short password was only as safe as the number of
 * guesses somebody could be bothered to send. On an address reachable from the
 * internet that is the whole lock.
 *
 * THE RULE THIS IS BUILT ON: it is a wait, NEVER a lockout.
 *
 * A login that locks after five wrong passwords is a lock anybody can turn
 * against the person holding the key - whoever knows that Dinesh signs in as
 * `dinesh` can shut him out of his own payroll on the day it has to go out,
 * from anywhere, by typing rubbish six times. So the account is never closed.
 * The answers simply slow down, and they come back on their own.
 *
 *   - the first five wrong passwords cost nothing. Fingers slip, and caps
 *     lock is on more often than anybody admits.
 *   - the sixth is answered after fifteen seconds, and each one after that
 *     doubles - thirty, a minute, two, four - up to five minutes.
 *   - the wait is counted from the LAST wrong password. Stop guessing for
 *     five minutes and the whole thing is open again.
 *   - a password that is RIGHT clears the count at once, because the count is
 *     "wrong ones since the last time somebody got in". Two typos and then the
 *     real password leaves nothing behind.
 *
 * What that costs an attacker: a thousand guesses took seconds and now takes
 * the better part of three days. What it costs the office: nothing, unless
 * they get it wrong six times in half an hour.
 *
 * AN ATTEMPT THAT WAS TURNED AWAY DOES NOT COUNT. Only a password that was
 * actually checked adds to the tally, so somebody hammering the door while
 * they are being made to wait cannot drive the wait up to its cap and hold it
 * there - which would be the lockout by another name, and against the real
 * person. The wait grows only as fast as real guesses get through it.
 *
 * COUNTED PER USERNAME, NOT PER ADDRESS, and that is deliberate. The app sits
 * behind a tunnel with `trust proxy` on, so the address a request claims to
 * come from is a header the caller writes - a per-address limit would be
 * stepped around by changing one line and would read as a protection that is
 * not there. The username cannot be faked: it is the thing being guessed.
 */

export const LOGIN_THROTTLE = {
  /** Wrong passwords older than this are no longer held against anybody. */
  window_minutes: 30,
  /** How many cost nothing at all. */
  free: 5,
  /** What the first one past that costs. */
  first_wait_seconds: 15,
  /** And the most it can ever grow to. A wait, not a lockout. */
  max_wait_seconds: 300,
};

/**
 * The wait earned by `failures` wrong passwords. Nought while under the free
 * ones, then doubling from `first_wait_seconds` up to the cap.
 */
export function waitSeconds(failures, rule = LOGIN_THROTTLE) {
  const over = Math.floor(Number(failures) || 0) - rule.free;
  if (over <= 0) return 0;
  const grown = rule.first_wait_seconds * 2 ** (over - 1);
  return Math.min(rule.max_wait_seconds, grown);
}

/**
 * Whether this login has to wait, and for how much longer.
 *
 * `secondsSinceLast` is how long ago the last wrong password was. Null means
 * there has not been one, which is not the same as one a long time ago.
 */
export function throttleState({ failures = 0, secondsSinceLast = null } = {}, rule = LOGIN_THROTTLE) {
  const wait = waitSeconds(failures, rule);
  if (!wait || secondsSinceLast === null) {
    return { blocked: false, failures, wait_seconds: wait, seconds_left: 0 };
  }
  const left = Math.ceil(wait - secondsSinceLast);
  return {
    blocked: left > 0,
    failures,
    wait_seconds: wait,
    seconds_left: Math.max(0, left),
  };
}

/** "15 seconds", "2 minutes" - for a sentence somebody reads while cross. */
export function waitInWords(seconds) {
  const n = Math.max(0, Math.ceil(Number(seconds) || 0));
  if (n < 60) return `${n} second${n === 1 ? '' : 's'}`;
  const mins = Math.ceil(n / 60);
  return `${mins} minute${mins === 1 ? '' : 's'}`;
}
