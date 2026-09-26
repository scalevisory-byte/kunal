/*
 * What changed in each version, newest first.
 *
 * It ships inside the dashboard bundle, so the list on screen is always the
 * list for the code that is actually running: a deploy that has not landed
 * still shows the old top entry, which is the answer to "is it live yet?".
 * Add an entry with every change a person would notice.
 */
export const CHANGELOG = [
  {
    version: '1.18',
    date: '2026-09-26',
    title: 'Mark done in one click from the table',
    changes: [
      'All Tasks → Table: a green ✓ on every open row marks the task done in one click. Its reminders stop.',
      'A line at the top says “Marked … done” with Undo, in case of a wrong click.',
    ],
  },
  {
    version: '1.17',
    date: '2026-09-26',
    title: 'No Priority column in the table',
    changes: [
      'All Tasks → Table: the Priority column is gone. Priority is still in the task drawer and the Filter.',
    ],
  },
  {
    version: '1.16',
    date: '2026-09-26',
    title: 'Quiet own number, assign from the table',
    changes: [
      'Task reminders and task lists no longer come to your own WhatsApp. They still reach the bell and the browser notification.',
      'Settings → Where reminders go → “Task messages on my WhatsApp” turns them back on. It covers the twice-daily list, deadline reminders, follow-ups, note and lead reminders, the morning briefing and the weekly review.',
      'Still sent: replies to commands you type (done 2, notes), the tax and legal digests, and messages to staff. Each time the app messages a staff member it also says so in the bell.',
      'All Tasks → Table: the Assignee column is now the Staff button. One press, pick or type a name, Give.',
      'On a phone, the bottom bar’s My day, Open and All now open the task list instead of staying on the dashboard.',
      'Fixed: the table on a phone no longer makes the whole page scroll sideways.',
    ],
  },
  {
    version: '1.15',
    date: '2026-09-24',
    title: 'Doubtful tasks are asked, not listed',
    changes: [
      'When Claude is not sure a message is a task, it goes to “Is this a task?” on the dashboard instead of your list. Yes keeps it, Not a task removes it.',
      'Those tasks are on no list, in no figure and get no reminders until you say yes.',
      'Claude is told that plain talk (“ok”, “haan theek hai”, “dekhte hain”, catching up) is not a task.',
      'If you remove 3 or more tasks from one chat, and that is at least half of what you decided for it, new tasks from that chat are asked first too. The box says so.',
      'Your own notes-to-self chat is never held.',
    ],
  },
  {
    version: '1.14',
    date: '2026-09-24',
    title: 'Version history',
    changes: [
      'New page: System → What’s new. Every version, what it changed, and which one is running.',
      'After an update, a line at the top of the page says which version arrived and links here.',
      'The version number is shown beside the build in Settings.',
    ],
  },
  {
    version: '1.13',
    date: '2026-09-23',
    title: 'New dashboard, table view, staff reminders',
    changes: [
      'Read only the chats you list: Settings → Which chats are read. Off by default, so every chat is still read until you switch it on.',
      'Dashboard rebuilt to your drawing: six figures, calendar beside them, task overview ring, week chart, Completed today and Added today.',
      'All Tasks can be shown as a table: sort by any column, 20 / 50 / 100 per page, delete from the row.',
      'The app can remind the person a task was given to on WhatsApp by itself, and tells you each time it does.',
      'Giving someone a task can message them at the same moment.',
      'Task allotted: set the deadline, mark done and delete from the row; each row says when the next reminder goes, or why it will not.',
      'Every message sent to a staff member is listed under the task.',
      'Task drawer is shorter: what you act on first, the rest behind “More details”.',
      'Needs attention removed; Focus today is the one list of what is due.',
    ],
  },
  {
    version: '1.12',
    date: '2026-09-16',
    title: 'Sign-in screen and lock',
    changes: [
      'A new sign-in screen with the Scale Visory name and mark.',
      'Lock button: sign out of the dashboard from a borrowed screen.',
      'Settings says which chats are blocked.',
    ],
  },
  {
    version: '1.11',
    date: '2026-09-15',
    title: 'Backups, months and relinking WhatsApp',
    changes: [
      'Nightly backup of the whole database, last 7 kept, with a Download button.',
      'Month chips above the list; a past month keeps its chip while work in it is still pending.',
      'Relink WhatsApp from the dashboard when the phone has unlinked the device.',
      'The QR code stops asking WhatsApp for new codes after about 4 minutes, which caused “Try again later”.',
      'The linked device is named “WA Tasks” on your phone.',
      'A password with a hidden space at the end no longer locks you out.',
    ],
  },
  {
    version: '1.10',
    date: '2026-09-14',
    title: 'Chat names and staff list',
    changes: [
      'The chat name shows on every task row at every screen width.',
      'Rows with no chat name now fetch it, or say why they cannot.',
      'A staff list, so names are there before the first task is given.',
      'Received and Allotted shortcuts on the dashboard and task list.',
      'When a task came in is the first thing on the row.',
      'Settings shows which build is running.',
    ],
  },
  {
    version: '1.9',
    date: '2026-09-13',
    title: 'Select many, and the duplicate-task root cause',
    changes: [
      'Fixed: the app was reading its own reminder messages back in as new tasks. This was the main source of duplicates.',
      'Select several tasks and delete them, or give them to somebody, in one go.',
      'Work given to somebody moves off the board to Task allotted.',
      'Folder chips are the same size as the day chips.',
    ],
  },
  {
    version: '1.8',
    date: '2026-09-12',
    title: 'Rename like Excel',
    changes: [
      'Rename a task in the list: F2 or double-click, Enter to keep, Escape to cancel. On a phone, Rename is in the ⋮ menu.',
    ],
  },
  {
    version: '1.7',
    date: '2026-09-11',
    title: 'Fewer duplicates, blocks that work, Section 138 watch',
    changes: [
      'Duplicate check fixed: a description no longer stops a copy being recognised; GSTR-1 and GSTR-9 are no longer treated as one.',
      'Blocks now match names with different spacing (“sai samart” finds “Sai Samarth Residency”).',
      'Each block says what it actually stopped.',
      'Watch list for law updates, starting with Section 138; a watch searches the last 30 days on its own.',
      'The task Time field now sets the deadline time.',
    ],
  },
  {
    version: '1.6',
    date: '2026-09-10',
    title: 'Law and legal updates, AI cost down',
    changes: [
      'Daily tax & compliance digest on WhatsApp, with its own page.',
      'Legal & court updates as a separate module.',
      'AI cost cut: the prompt is cached and messages are sent in bigger batches.',
      'AI Usage shows which chats cost the most and lets you block them there.',
      'A blocked chat could still get through; fixed.',
      'Notes and folders can be set from the task row.',
    ],
  },
  {
    version: '1.5',
    date: '2026-09-09',
    title: 'Reliability fixes',
    changes: [
      'Fixed: a batch of messages was sometimes never sent to the AI, so tasks were missed.',
      'Fixed: a long AI reply was read as “no tasks”.',
      'Today, Tomorrow and a date on the task lists.',
    ],
  },
  {
    version: '1.4',
    date: '2026-09-08',
    title: 'Leads, quick add, calendar',
    changes: [
      'Leads page for people who might buy something, read from ad leads.',
      'Quick add: type a line and a day, press Enter.',
      'A calendar you can add tasks on.',
      'Staff and folder buttons on every row.',
      'Group names are fetched from WhatsApp.',
    ],
  },
  {
    version: '1.3',
    date: '2026-09-07',
    title: 'Businesses, delegation, checklists',
    changes: [
      'Each business gets its own group and page.',
      'Task received and Task allotted: work with other people.',
      'Checklists, dependencies, templates and file attachments on a task.',
      'Tasks the AI is unsure about wait in “Is this a task?” instead of being chased.',
      'Photos are read; voice notes too when a speech service is set up.',
      'Monthly statutory deadlines.',
      'Light and dark theme.',
    ],
  },
  {
    version: '1.2',
    date: '2026-09-06',
    title: 'Reminder engine and deploy',
    changes: [
      'Reminder engine: before the deadline, at it, then follow-ups until done.',
      'Daily WhatsApp briefing and weekly review.',
      'Work history of everything finished.',
      'AI cost tracking in rupees.',
      'Your own messages are read too, so a note you type becomes a task.',
      'New app layout with a sidebar.',
      'Runs on Railway.',
    ],
  },
  {
    version: '1.1',
    date: '2026-09-01',
    title: 'Reply commands and blocked chats',
    changes: [
      'Reply “done 2” or “snooze 2” to the digest on WhatsApp.',
      'Block chats that should never be read.',
      'Reminders at an exact time (“5 baje”).',
      'Dashboard redesigned around what is urgent.',
    ],
  },
  {
    version: '1.0',
    date: '2026-08-30',
    title: 'First version',
    changes: [
      'Reads your WhatsApp, turns messages into tasks with AI, and reminds you twice a day until they are done.',
      'Manual mode that needs no AI.',
      'Dashboard that installs on the phone.',
    ],
  },
];

export const CURRENT = CHANGELOG[0];

/* Compares "1.9" and "1.13" as numbers, not text. */
export function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

const SEEN = 'wa.whatsnew.seen';

/* The last version this browser was shown. Null on a first visit or when storage is blocked. */
export function lastSeen() {
  try { return localStorage.getItem(SEEN); } catch { return null; }
}

export function markSeen() {
  try { localStorage.setItem(SEEN, CURRENT.version); } catch { /* private window */ }
}

/* Versions newer than the one last seen. A first visit counts nothing as new. */
export function unseen(seen = lastSeen()) {
  if (!seen) return [];
  return CHANGELOG.filter((r) => compareVersions(r.version, seen) > 0);
}
