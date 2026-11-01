import { config } from './config.js';
import { log } from './logger.js';
import { createServer } from './server.js';
import { countUsers } from './users.js';
import { startBackups } from './backup.js';

/*
 * Refuse to run wide open unless somebody asked for it.
 *
 * `APP_PASSWORD` unset disables the wall entirely. That is right on a laptop
 * and never right on an address anybody else can reach - and it used to be the
 * silent default, with only a warning in a log nobody reads. On this app that
 * meant every salary, PAN, Aadhaar, bank account and CV readable by anyone who
 * found the URL.
 *
 * So it now has to be asked for: either set a password, or set
 * ALLOW_OPEN=true and mean it.
 */
const guarded = Boolean(config.appPassword) || countUsers() > 0;

if (!guarded && !config.allowOpen) {
  log.error('APP_PASSWORD is not set, so there would be no password on the dashboard or the API.');
  log.error('Everything would be readable by anyone who can reach this address: salaries, PAN');
  log.error('and Aadhaar numbers, bank accounts and CVs.');
  log.error('');
  log.error('Fix it either way:');
  log.error('  - start it once with ALLOW_OPEN=true and create the first admin login on the');
  log.error('    sign-in screen, which closes this hole for good; or');
  log.error('  - set APP_PASSWORD, which is the key anything on a schedule uses.');
  process.exit(1);
}

const app = createServer();

app.listen(config.port, () => {
  log.info(`Salary app listening on http://localhost:${config.port}`);
  startBackups();
  if (!guarded) {
    log.warn('Running OPEN - no logins and no API key (ALLOW_OPEN=true).');
    log.warn('Create the first admin on the sign-in screen to close it.');
  }
});
