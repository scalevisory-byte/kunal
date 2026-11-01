import { config } from './config.js';
import { log } from './logger.js';
import { createServer } from './server.js';

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
if (!config.appPassword && !config.allowOpen) {
  log.error('APP_PASSWORD is not set, so there would be no password on the dashboard or the API.');
  log.error('Everything would be readable by anyone who can reach this address: salaries, PAN');
  log.error('and Aadhaar numbers, bank accounts and CVs.');
  log.error('');
  log.error('Set APP_PASSWORD to a password, or set ALLOW_OPEN=true if you really want it open');
  log.error('(which is reasonable on your own machine, and nowhere else).');
  process.exit(1);
}

const app = createServer();

app.listen(config.port, () => {
  log.info(`Salary app listening on http://localhost:${config.port}`);
  if (!config.appPassword) {
    log.warn('Running OPEN - no password on the dashboard or the API (ALLOW_OPEN=true).');
  }
});
