/**
 * The stages of work you have handed to somebody else.
 *
 * Every one of these is *derived* from fields a task already has — status, the
 * deadline, the follow-up counter, `needs_attention`. Nothing here is stored,
 * so a task cannot be in a stage and in a contradictory state at the same
 * time, and no migration is needed to start using it.
 *
 * It is deliberately not a workflow. Nothing forces given → in progress →
 * done: a task can go straight from given to done, or round the houses through
 * waiting and back. The stage is a reading of where a task is right now, and
 * the moment the underlying facts change, so does it.
 *
 * Order matters: the first match wins, worst news first, so a task that is
 * both overdue and awaiting follow-up is filed under the thing you would act
 * on. One task appears in exactly one stage.
 */
export const STAGES = [
  {
    key: 'done',
    label: 'Done',
    match: (t) => t.status === 'done',
    note: 'Finished. Reminders and follow-ups for these have been cancelled.',
  },
  {
    key: 'followup',
    label: 'Follow-up',
    match: (t) => t.needs_attention || (t.follow_up_count > 0 && t.state === 'overdue'),
    note: 'The engine has been round at least once and the work is still not done.',
  },
  {
    key: 'overdue',
    label: 'Overdue',
    match: (t) => t.state === 'overdue',
    note: 'The deadline has gone.',
  },
  /*
   * Status before the clock.
   *
   * Waiting and in-progress are things somebody decided and said; "due soon"
   * is only the hour. A task being worked on with a deadline this afternoon
   * belongs under In progress — filing it under Due soon loses the one fact
   * you were told, and leaves In progress empty on exactly the days it matters.
   * A passed deadline still wins over both, because that is no longer a plan.
   */
  {
    key: 'waiting',
    label: 'Waiting',
    match: (t) => t.status === 'waiting',
    note: 'Waiting on the person it was given to.',
  },
  {
    key: 'progress',
    label: 'In progress',
    match: (t) => t.status === 'in_progress',
    note: 'Being worked on.',
  },
  {
    key: 'duesoon',
    label: 'Due soon',
    // Not a second deadline — the same due_at, read against the clock.
    match: (t) => t.state === 'due' || withinHours(t.due_at, 24),
    note: 'The deadline is inside the next day, and nobody has said it is started.',
  },
  {
    key: 'given',
    label: 'Given',
    match: () => true,
    note: 'Handed over, with nothing back yet.',
  },
];

function withinHours(iso, hours) {
  if (!iso) return false;
  const ms = new Date(iso).getTime() - Date.now();
  return ms >= 0 && ms <= hours * 3600_000;
}

/** The one stage a task is in. */
export const stageOf = (task) => STAGES.find((s) => s.match(task)) || STAGES[STAGES.length - 1];

/**
 * Every stage with the tasks in it, in the order they are worth looking at.
 *
 * Given first and done last on screen, which is the reverse of the matching
 * order above: the matcher reads worst-news-first so nothing falls through the
 * wrong branch, and the board reads left-to-right the way the work moves.
 */
const BOARD_ORDER = ['given', 'progress', 'waiting', 'duesoon', 'overdue', 'followup', 'done'];

export function pipeline(tasks) {
  const byStage = new Map(BOARD_ORDER.map((k) => [k, []]));
  for (const task of tasks) byStage.get(stageOf(task).key).push(task);

  return BOARD_ORDER.map((key) => {
    const stage = STAGES.find((s) => s.key === key);
    return { ...stage, items: byStage.get(key).sort(soonestFirst) };
  });
}

/** Nearest deadline first; undated work after it, most recently given first. */
export function soonestFirst(a, b) {
  const ad = a.due_at || '';
  const bd = b.due_at || '';
  if (ad && bd && ad !== bd) return ad < bd ? -1 : 1;
  if (ad && !bd) return -1;
  if (!ad && bd) return 1;
  return String(b.created_at || '').localeCompare(String(a.created_at || ''));
}

/** Counts for the summary strip, straight off the same derivation. */
export function stageCounts(tasks) {
  const counts = Object.fromEntries(BOARD_ORDER.map((k) => [k, 0]));
  for (const task of tasks) counts[stageOf(task).key] += 1;
  return { total: tasks.length, ...counts };
}

/**
 * The people work has been given to, with what each is carrying.
 *
 * Built from `assigned_to` on the tasks themselves, so somebody appears here
 * the moment work is handed to them. Nobody needs an account, or a row in a
 * table of users, to be chased about a job — they need a name, which the task
 * already has.
 */
export function peopleFrom(tasks) {
  const by = new Map();
  for (const task of tasks) {
    const name = task.assigned_to;
    if (!name) continue;
    if (!by.has(name)) by.set(name, { name, wid: task.assigned_to_wid || null, tasks: [] });
    by.get(name).tasks.push(task);
  }
  return [...by.values()]
    .map((p) => {
      const active = p.tasks.filter((t) => t.status !== 'done');
      return {
        ...p,
        active: active.length,
        overdue: active.filter((t) => t.state === 'overdue' || t.needs_attention).length,
        done: p.tasks.length - active.length,
      };
    })
    .sort((a, b) => b.overdue - a.overdue || b.active - a.active || a.name.localeCompare(b.name));
}

/**
 * How long since anything moved, in the words you would use about it.
 *
 * Not a timestamp: "given 3 days ago" and "no update for 6 hours" are the two
 * things worth knowing about work in somebody else's hands, and both are
 * distances rather than points.
 */
export function lastActivityLabel(task) {
  const last = task.last_activity;
  const at = last?.at || task.updated_at || task.created_at;
  if (!at) return null;
  const iso = String(at).includes('T') ? at : `${String(at).replace(' ', 'T')}Z`;
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return null;

  const mins = Math.round(ms / 60000);
  const distance = mins < 1 ? 'just now'
    : mins < 60 ? `${mins}m ago`
    : mins < 1440 ? `${Math.round(mins / 60)}h ago`
    : `${Math.round(mins / 1440)}d ago`;

  // The kind, where there is one worth naming. "Status changed" and "edited"
  // are the app's own words for what a person did, and are worth repeating;
  // scheduling noise is not, so it falls back to the plain distance.
  const WORTH_SAYING = {
    created: 'Given',
    assigned: 'Given to',
    'follow-up sent': 'Nudged',
    'status changed': 'Status changed',
    'progress noted': 'Update',
    'stage changed': 'Stage',
    completed: 'Completed',
    'deadline changed': 'Deadline moved',
  };
  const said = last?.kind && WORTH_SAYING[last.kind];
  return said ? `${said} · ${distance}` : `No update · ${distance}`;
}
