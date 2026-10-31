import { config } from './config.js';
import { log } from './logger.js';
import { createServer } from './server.js';

const app = createServer();

app.listen(config.port, () => {
  log.info(`Recruitment app listening on http://localhost:${config.port}`);
  if (!config.appPassword) {
    log.warn(
      'APP_PASSWORD is not set - the recruiter side is open to anyone who can reach it. ' +
        'This app is meant to have a public URL, so set it before deploying.'
    );
  }
  if (!config.linkSecret) {
    log.warn('LINK_SECRET is not set - CV links and apply tokens break on every restart.');
  }
  if (!config.publicUrl) {
    log.warn('PUBLIC_URL is not set - apply links cannot be generated for sharing.');
  }
});
