import { config } from './config.js';
import { log } from './logger.js';
import { createServer } from './server.js';
import { startWhatsApp, shutdown } from './whatsapp.js';
import { startReminderJobs } from './reminders.js';

const app = createServer();

const server = app.listen(config.port, () => {
  log.info(`API listening on http://localhost:${config.port}`);
});

startWhatsApp();
startReminderJobs();

let shuttingDown = false;
async function stop(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`${signal} received, shutting down.`);
  server.close();
  await shutdown();
  process.exit(0);
}

process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
process.on('unhandledRejection', (reason) => log.error('Unhandled rejection:', reason));
