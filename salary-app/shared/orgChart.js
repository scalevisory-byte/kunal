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
