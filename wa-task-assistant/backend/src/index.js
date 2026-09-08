/**
 * Boot order matters here.
 *
 * The HTTP server is bound FIRST, before anything that can throw. Everything
 * else - the database, the WhatsApp client, the schedulers - is loaded after,
 * and a failure in any of it leaves a running server that explains itself.
 *
 * The reason is that this runs on Railway, where a process that dies during
 * startup produces one thing: "Application failed to respond". No cause, and
 * the logs are behind a UI that is hard to read on a phone. A boot that fails
 * loudly, on the URL the user already has open, is worth the small amount of
 * ceremony below.
 */
import http from 'node:http';

// Read straight from the environment: importing config.js touches the disk, and
// the disk is one of the things that can be broken.
const port = Number(process.env.PORT) || 3001;

let handler = null;      // the Express app, once it has loaded
let bootError = null;    // what stopped it, if anything

const escape = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/** What a browser gets while the app is not up. */
function bootErrorPage() {
  const message = escape(bootError?.message || 'Unknown error');
  const disk = /SQLITE_FULL|disk (is )?full|ENOSPC/i.test(bootError?.message || '');
  const hint = disk
    ? 'The data volume is full. Chromium\'s cache is the usual cause; clear it from the Railway volume, or attach a larger one.'
    : 'Check the deploy logs for the full stack trace.';
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>WA Tasks — did not start</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; padding:24px;
         font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif; background:#faf8f5; color:#1c1a17; }
  @media (prefers-color-scheme: dark) { body { background:#141312; color:#eee9e3; } }
  main { max-width:34rem; }
  h1 { font-size:1.35rem; margin:0 0 .5rem; }
  code { display:block; padding:12px 14px; margin:16px 0; border-radius:8px;
         background:rgba(127,127,127,.14); font-family:ui-monospace,monospace; font-size:.85rem;
         white-space:pre-wrap; word-break:break-word; }
  p { margin:.6rem 0; } small { opacity:.7; }
</style>
<main>
  <h1>WA Tasks did not start</h1>
  <p>The server is running and answering, but the application failed to load. Your tasks and your WhatsApp login are untouched.</p>
  <code>${message}</code>
  <p>${hint}</p>
  <p><small>Fix the cause and redeploy. This page is served by the fallback handler, not the app.</small></p>
</main>`;
}

const server = http.createServer((req, res) => {
  if (handler) return handler(req, res);

  // 200, not 503, and deliberately so: Railway's healthcheck would otherwise
  // fail the deploy and put the generic error page back, which is exactly the
  // page that tells the user nothing. The body says plainly that it is not well.
  if (req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: false, degraded: true, error: bootError?.message || 'starting' }));
  }

  res.writeHead(bootError ? 500 : 503, { 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': '10' });
  res.end(bootError ? bootErrorPage() : '<!doctype html><meta charset="utf-8"><title>Starting…</title><p>Starting…');
});

server.listen(port, () => {
  console.log(`[boot] listening on ${port}`);
});

let shutdownApp = async () => {};

try {
  const { log } = await import('./logger.js');
  const { createServer } = await import('./server.js');
  const { startWhatsApp, shutdown } = await import('./whatsapp.js');
  const { startReminderJobs } = await import('./reminders.js');
  const { reportBoot } = await import('./diagnostics.js');
  await import('./scheduling.js');
  // Bytes left on the volume by a crash between the write and the insert.
  const { pruneOrphanFiles } = await import('./attachments.js');
  pruneOrphanFiles();

  // Made once, on the first boot that has this code. Its own try/catch: a
  // convenience must never be the reason the application does not come up.
  try {
    const { seedVacancyGroup } = await import('./groups.js');
    seedVacancyGroup();
  } catch (err) {
    log.warn('Could not set up the Vacancies group:', err?.message || err);
  }

  /*
   * Group names, as far as the database alone can settle them.
   *
   * The rest needs WhatsApp and happens when the session is ready, which can be
   * minutes away or never on a bad sync - and a row that has been wrong for a
   * week should not wait on that when another message from the same chat has
   * the name on it already.
   */
  try {
    const { linkChatIds, repairFromStored } = await import('./group-names.js');
    linkChatIds();
    repairFromStored();
  } catch (err) {
    log.warn('Could not name the groups from stored messages:', err?.message || err);
  }

  /*
   * And take the WhatsApp ids off the rows that are wearing them as names.
   * Cheap - it reads only the rows that have a value at all - and it has to
   * run here rather than on `ready`, since nothing about it needs WhatsApp.
   */
  try {
    const { scrubStoredIds } = await import('./wid.js');
    const { db } = await import('./db.js');
    const cleared = scrubStoredIds(db);
    const total = Object.values(cleared).reduce((a, b) => a + b, 0);
    if (total) log.info(`Cleared ${total} WhatsApp ids standing in for names`, cleared);
  } catch (err) {
    log.warn('Could not clear stored WhatsApp ids:', err?.message || err);
  }

  reportBoot(log);
  handler = createServer();
  shutdownApp = shutdown;
  log.info(`API listening on http://localhost:${port}`);

  // Independent on purpose: WhatsApp failing to launch must not also cancel the
  // reminder schedule, and neither should blank the dashboard that is now up.
  try { startWhatsApp(); } catch (err) { log.error('WhatsApp failed to start:', err?.message || err); }
  try { startReminderJobs(); } catch (err) { log.error('Reminder jobs failed to start:', err?.message || err); }
} catch (err) {
  bootError = err;
  console.error('[boot] the application failed to load:', err?.stack || err);
}

let shuttingDown = false;
async function stop(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[boot] ${signal} received, shutting down.`);
  server.close();
  try { await shutdownApp(); } catch { /* already gone */ }
  process.exit(0);
}

process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
process.on('unhandledRejection', (reason) => console.error('[boot] Unhandled rejection:', reason));
