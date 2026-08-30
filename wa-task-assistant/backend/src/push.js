import webpush from 'web-push';
import { config, vapidEnabled } from './config.js';
import { log } from './logger.js';
import { listPushSubscriptions, deletePushSubscription } from './db.js';

if (vapidEnabled) {
  webpush.setVapidDetails(config.vapid.subject, config.vapid.publicKey, config.vapid.privateKey);
  log.info('Web push enabled.');
} else {
  log.info('Web push disabled (no VAPID keys configured).');
}

export { vapidEnabled };

/** Fan a notification out to every subscribed browser, pruning dead endpoints. */
export async function sendPush(payload) {
  if (!vapidEnabled) return { sent: 0, pruned: 0 };

  const subs = listPushSubscriptions();
  let sent = 0;
  let pruned = 0;

  await Promise.all(
    subs.map(async (sub) => {
      const subscription = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      };
      try {
        await webpush.sendNotification(subscription, JSON.stringify(payload));
        sent += 1;
      } catch (err) {
        // 404/410 mean the browser dropped the subscription - stop pushing to it.
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          deletePushSubscription(sub.endpoint);
          pruned += 1;
        } else {
          log.warn('Push failed:', err?.statusCode, err?.message || err);
        }
      }
    })
  );

  return { sent, pruned };
}
