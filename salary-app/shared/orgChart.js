/**
 * The reporting line, as a tree.
 *
 * Each employee carries `reports_to_id` - a link to another employee rather
 * than a manager's name typed in, so the chart is a join and cannot go stale
 * the day somebody leaves. This turns that flat list into something that can
 * be drawn.
 *
 * Three things it refuses to do, each of which is a way a chart lies:
 *
 *  - **It never loops forever.** The record screen prevents a cycle, but a row
 *    edited straight in the database could still carry one, and a chart that
 *    hangs the page is worse than one that says "this is wrong".
 *  - **It never silently drops anybody.** Somebody whose manager is not in the
 *    list - left the company, or filtered out by company - comes back in
 *    `orphans`, named, rather than vanishing from a chart that then looks
 *    complete.
 *  - **It does not guess who is at the top.** Nobody above you means you are a
 *    root. Two roots is two roots, not an error.
 */

/** A person with nobody above them, as far as this list knows. */
const isRoot = (person, byId) => !person.reports_to_id || !byId.has(person.reports_to_id);

export function orgChart(employees = []) {
  const people = employees.filter((e) => e && e.id != null);
  const byId = new Map(people.map((e) => [e.id, e]));

  const children = new Map();
  for (const person of people) {
    if (isRoot(person, byId)) continue;
    const list = children.get(person.reports_to_id) || [];
    list.push(person);
    children.set(person.reports_to_id, list);
  }
  for (const list of children.values()) {
    list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }

  /*
   * Walked with an explicit seen-set rather than trusting the data. A cycle
   * gets cut where it closes and named, so the rest of the chart still draws.
   */
  const looped = [];
  const seen = new Set();
  const walk = (person, depth, above) => {
    if (above.has(person.id)) {
      looped.push(person);
      return [];
    }
    seen.add(person.id);
    const path = new Set(above).add(person.id);
    const kids = (children.get(person.id) || []).flatMap((kid) => walk(kid, depth + 1, path));
    return [
      {
        id: person.id,
        name: person.name,
        designation: person.designation || '',
        department: person.department || '',
        company: person.company_name || '',
        depth,
        reports: (children.get(person.id) || []).length,
        // Everybody under them, however far down: what a manager is actually
        // responsible for, as against who reports to them directly.
        below: kids.length,
        person,
      },
      ...kids,
    ];
  };

  /*
   * Actual reporting lines first, then the people nobody has placed yet.
   *
   * Sorted by name alone, twenty-six unplaced staff came before the one real
   * tree and buried it - the chart was accurate and useless. A root with
   * people under it is a hierarchy; a root with nobody is somebody whose
   * manager has not been set.
   */
  const under = (e) => (children.get(e.id) || []).length;
  const roots = people
    .filter((e) => isRoot(e, byId))
    .sort(
      (a, b) =>
        (under(b) > 0) - (under(a) > 0) ||
        under(b) - under(a) ||
        String(a.name || '').localeCompare(String(b.name || ''))
    );

  const rows = roots.flatMap((root) => walk(root, 0, new Set()));

  // Anybody the walk never reached: their manager is in a cycle, or the data
  // is stranger than that. Named rather than dropped.
  const orphans = people.filter((e) => !seen.has(e.id));

  return {
    rows,
    roots: roots.length,
    // Somebody with nobody above and nobody below is not in a reporting line
    // at all - usually just somebody whose manager has not been set yet.
    unassigned: rows.filter((r) => r.depth === 0 && r.reports === 0).length,
    managers: rows.filter((r) => r.reports > 0).length,
    deepest: rows.reduce((n, r) => Math.max(n, r.depth), 0),
    looped,
    orphans,
  };
}

/** Would setting `managerId` over `personId` make a loop? */
export function wouldLoop(employees, personId, managerId) {
  if (!managerId) return false;
  if (Number(personId) === Number(managerId)) return true;
  const byId = new Map(employees.map((e) => [e.id, e]));
  const seen = new Set();
  let at = byId.get(Number(managerId));
  while (at) {
    if (seen.has(at.id)) return true;
    if (at.id === Number(personId)) return true;
    seen.add(at.id);
    at = at.reports_to_id ? byId.get(at.reports_to_id) : null;
  }
  return false;
}

/**
 * Setting one manager over everybody ticked, worked out BEFORE anything is
 * saved.
 *
 * Doing this one record at a time is fine for a team of four and hopeless for
 * a hundred and fifteen, but a manager is not a religion: tick everybody,
 * choose a manager, and two things go wrong at once. The manager is almost
 * always among the people ticked - "select all, report to Vaibhav" asks
 * Vaibhav to report to himself - and anybody the manager already reports to
 * would close a circle.
 *
 * So the plan is worked out first and says what it will and will not do. The
 * refusals are NAMED, never silently dropped: a bulk action that quietly skips
 * three people leaves somebody believing the chart is complete.
 *
 * Judging each person against the list as it stands now is enough. Everybody
 * ticked gets the SAME manager, so the only chain that could move above the
 * manager belongs to one of their own ancestors - and an ancestor is exactly
 * what `circular` refuses, so that chain stays where it is.
 *
 * `managerId` empty means take the manager away, which can never loop.
 */
export function bulkManagerPlan(employees = [], ids = [], managerId = null) {
  const byId = new Map(employees.filter((e) => e && e.id != null).map((e) => [e.id, e]));
  const wanted = managerId ? Number(managerId) : null;
  const manager = wanted ? byId.get(wanted) || null : null;

  const plan = {
    manager,
    clearing: !wanted,
    // The manager was chosen but is not on the list at all. Possible if the
    // list was filtered or they were deleted between choosing and clicking.
    missing: Boolean(wanted) && !manager,
    setting: [],
    replacing: [],
    already: [],
    self: [],
    circular: [],
  };
  if (plan.missing) return plan;

  for (const id of [...new Set(ids.map(Number))]) {
    const person = byId.get(id);
    if (!person) continue;
    const now = person.reports_to_id || null;
    if ((now || null) === (wanted || null)) {
      plan.already.push(person);
      continue;
    }
    if (wanted) {
      if (id === wanted) {
        plan.self.push(person);
        continue;
      }
      if (wouldLoop(employees, id, wanted)) {
        plan.circular.push(person);
        continue;
      }
    }
    plan.setting.push(person);
    // Already placed under somebody else: this replaces that line rather than
    // filling a blank, which is worth saying out loud before it happens.
    if (now) plan.replacing.push(person);
  }

  return plan;
}

/** The department somebody is in, or '' for nobody-said. */
const deptOf = (person) => String(person.department || '').trim();

/**
 * The staff grouped by department, for setting a manager over a whole one at
 * a time.
 *
 * People with no department are kept as a group of their own rather than
 * dropped or lumped into the first one: on a real list that is usually the
 * biggest group, and hiding it is how somebody ends up with no manager and no
 * sign of it.
 */
export function departmentGroups(employees = []) {
  const groups = new Map();
  for (const person of employees) {
    if (!person || person.id == null) continue;
    const name = deptOf(person);
    const list = groups.get(name) || [];
    list.push(person);
    groups.set(name, list);
  }
  return [...groups.entries()]
    .map(([name, people]) => ({
      name,
      people,
      count: people.length,
      // Somebody already managing people inside this department is the
      // obvious head. Offered, never chosen - nothing decides itself.
      inside: people.filter((p) => people.some((q) => q.reports_to_id === p.id)),
    }))
    .sort(
      // Named departments first, "no department" last however it sorts.
      (a, b) => (a.name === '') - (b.name === '') || a.name.localeCompare(b.name)
    );
}

/**
 * One manager per department, several departments at once.
 *
 * `choices` is {department name: manager id}; a department left out, or set
 * to nothing, is not touched at all - which is NOT the same as being set to
 * "no manager". Clearing a whole department's line is deliberate enough to
 * need its own action, and a blank dropdown is how a mis-click would do it by
 * accident.
 *
 * Each department is planned with the same rules as the bulk setter, against
 * the WHOLE list, so the head of a department keeps whoever they report to
 * and a loop is refused by name.
 */
export function departmentManagerPlan(employees = [], choices = {}) {
  const rows = departmentGroups(employees)
    .filter((group) => choices[group.name])
    .map((group) => ({
      department: group.name,
      count: group.count,
      plan: bulkManagerPlan(
        employees,
        group.people.map((p) => p.id),
        choices[group.name]
      ),
    }));

  return {
    rows,
    // What one click would do, totalled, so the button can say it.
    setting: rows.reduce((n, r) => n + r.plan.setting.length, 0),
    replacing: rows.reduce((n, r) => n + r.plan.replacing.length, 0),
    leaving: rows.reduce((n, r) => n + r.plan.self.length + r.plan.circular.length, 0),
    departments: rows.length,
  };
}
