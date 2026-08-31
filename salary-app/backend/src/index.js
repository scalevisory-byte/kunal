import { config } from './config.js';
import { log } from './logger.js';
import { createServer } from './server.js';

const app = createServer();

app.listen(config.port, () => {
  log.info(`Salary app listening on http://localhost:${config.port}`);
  if (!config.appPassword) {
    log.warn('APP_PASSWORD is not set - the API and dashboard are open to anyone who can reach them.');
  }
});
