import { todayIso } from './today.js';
/**
 * ONE PERSON'S ASSET LEDGER — everything they have ever been given.
 *
 * Dinesh: *"konse employee ke paas kya-kya asset he, uska ledger nikalna he"*.
 *
 * The app already had two halves of this and not the thing itself: **Who holds
 * what** lists what somebody STILL has (and prints a slip for them to sign),
 * and an asset's own page shows that ASSET's history. Neither answers "put
 * everything Amit has ever held on one page" — which is what gets asked when
 * somebody leaves, when a laptop cannot be found, or when the auditor asks.
 *
 * THREE RULES IT IS BUILT ON.
 *
 *   **THE REGISTER SAYS WHO HAS IT NOW; THE LOG SAYS WHAT HAPPENED.** Those
 *   are different questions and this ledger asks both, rather than working one
 *   out from the other. An asset standing against somebody on the register
 *   with no open handover row is reported as **held with no slip on file** —
 *   not as "never issued", and not quietly dropped. That is the honest state
 *   for anything imported with a holder, or issued before handovers existed.
 *
 *   **IT ASSEMBLES, IT NEVER RECALCULATES.** Every date and every figure comes
 *   from the handover row or the register row it is printed beside.
 *
 *   **VALUE IS REPORTED, NEVER A DEDUCTION.** What somebody is holding is
 *   stated so a decision can be made; the same rule the full and final
 *   follows, because a laptop docked and then found in a drawer cannot be
 *   undone.
 *
 * Dependency-free, like the rest of shared/.
 */

const day = (v) => String(v ?? '').slice(0, 10);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const DAY = 24 * 60 * 60 * 1000;

/** Whole days between two dates; null when either is missing or unreadable. */
export function daysBetween(from, to) {
  if (!from || !to) return null;
  const a = new Date(`${day(from)}T00:00:00Z`);
  const b = new Date(`${day(to)}T00:00:00Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.round((b - a) / DAY);
}

/**
 * @param employee   the person
 * @param handovers  their handover rows (issued / returned), any order
 * @param assets     register rows currently standing against them
 * @param today      ISO date, for how long something has been out
 */
export function assetLedger({ employee, handovers = [], assets = [], today = todayIso() } = {}) {
  const lines = handovers
    .filter((h) => !employee || Number(h.employee_id) === Number(employee.id))
    .map((h) => ({
      source: 'handover',
      id: h.id,
      asset_id: h.asset_id,
      code: h.code || '',
      kind: h.kind || '',
      label: h.label || '',
      identifier: h.identifier || '',
      company_name: h.company_name || '',
      issued_on: day(h.issued_on) || '',
      issued_by: h.issued_by || '',
      returned_on: day(h.returned_on) || '',
      returned_by: h.returned_by || '',
      condition_out: h.condition_out || '',
      condition_in: h.condition_in || '',
      acknowledged_on: day(h.acknowledged_on) || '',
      note: h.note || '',
      value: num(h.purchase_cost),
      open: !h.returned_on,
      // To the day it came back, or to today for something still out.
      days: daysBetween(h.issued_on, h.returned_on || today),
    }));

  /*
   * Anything on the register against them that no OPEN handover covers.
   *
   * This is the case the two existing screens miss entirely: a thousand
   * imported rows carry a holder and no slip, and so does anything issued
   * before the handover log existed. Saying "no slip on file" is the whole
   * point - it is a thing to go and get signed, not a thing to hide.
   */
  /*
   * What the register says about each asset, for the two things the handover
   * log cannot know: whether it is marked as being repaired, and its serial.
   * Looked up, never copied into the log.
   */
  const fromRegister = new Map(assets.map((a) => [Number(a.id), a]));
  for (const line of lines) {
    const asset = fromRegister.get(Number(line.asset_id));
    if (!asset) continue;
    line.state = asset.state || '';
    if (!line.identifier) line.identifier = asset.identifier || '';
  }

  const covered = new Set(lines.filter((l) => l.open).map((l) => Number(l.asset_id)));
  for (const asset of assets) {
    if (asset.written_off_on) continue;
    if (asset.returned_on) continue;                       // back in the office
    if (!employee || Number(asset.employee_id) !== Number(employee.id)) continue;
    if (covered.has(Number(asset.id))) continue;
    lines.push({
      source: 'register',
      id: `a${asset.id}`,
      asset_id: asset.id,
      code: asset.code || '',
      kind: asset.kind || '',
      label: asset.label || '',
      identifier: asset.identifier || '',
      company_name: asset.company_name || '',
      issued_on: day(asset.issued_on) || '',
      issued_by: '',
      returned_on: '',
      returned_by: '',
      condition_out: asset.condition || '',
      condition_in: '',
      acknowledged_on: '',
      note: '',
      state: asset.state || '',
      value: num(asset.purchase_cost),
      open: true,
      days: asset.issued_on ? daysBetween(asset.issued_on, today) : null,
      // Said out loud on the page, and counted on its own below.
      no_slip: true,
    });
  }

  // Still out first - that is what somebody opened this page for - then by
  // date, newest first.
  lines.sort(
    (a, b) =>
      Number(b.open) - Number(a.open) ||
      String(b.issued_on).localeCompare(String(a.issued_on)) ||
      String(a.code).localeCompare(String(b.code))
  );

  const out = lines.filter((l) => l.open);
  const back = lines.filter((l) => !l.open);
  const unsigned = out.filter((l) => l.no_slip || !l.acknowledged_on);

  return {
    employee: employee
      ? {
          id: employee.id,
          name: employee.name,
          code: employee.code || '',
          designation: employee.designation || '',
          department: employee.department || '',
          company_name: employee.company_name || '',
          branch_name: employee.branch_name || '',
          // Working or left: the header says which, and a page about somebody
          // who has gone should not look like a page about somebody who has not.
          active: employee.active === 0 ? 0 : 1,
        }
      : null,
    lines,
    holding: out,
    returned: back,
    totals: {
      out: out.length,
      out_value: out.reduce((sum, l) => sum + l.value, 0),
      returned: back.length,
      ever: lines.length,
      // Held with nothing signed for it: either no handover row at all, or one
      // the employee never acknowledged.
      unsigned: unsigned.length,
      no_slip: out.filter((l) => l.no_slip).length,
      // The longest-standing thing they hold, which is usually the question
      // behind "what has he got".
      oldest_out: out.map((l) => l.issued_on).filter(Boolean).sort()[0] || '',
    },
    today,
  };
}

/** One line per asset, for the CSV and the printed page. */
export const LEDGER_COLUMNS = [
  ['Code', (l) => l.code],
  ['Kind', (l) => l.kind],
  ['What', (l) => l.label],
  ['Serial', (l) => l.identifier],
  ['Company', (l) => l.company_name],
  ['Issued', (l) => l.issued_on],
  ['Issued by', (l) => l.issued_by],
  ['Returned', (l) => l.returned_on],
  ['Taken back by', (l) => l.returned_by],
  ['Days held', (l) => (l.days === null ? '' : l.days)],
  ['Still with them', (l) => (l.open ? 'yes' : '')],
  ['Signed for', (l) => (l.no_slip ? 'no slip on file' : l.acknowledged_on || 'not acknowledged')],
  ['Condition out', (l) => l.condition_out],
  ['Condition in', (l) => l.condition_in],
  ['Cost to buy', (l) => l.value],
  ['Note', (l) => l.note],
];

export const escapeCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const escape = escapeCell;

/** CSV with a BOM, so Excel opens it with the rupee signs intact. */
export function ledgerCsv(ledger) {
  const lines = [LEDGER_COLUMNS.map(([head]) => escape(head)).join(',')];
  for (const line of ledger.lines) {
    lines.push(LEDGER_COLUMNS.map(([, get]) => escape(get(line))).join(','));
  }
  return `﻿${lines.join('\n')}`;
}

/* ================================================================= *
 * THE LEDGER PROPER — every movement, in order, with a running balance.
 *
 * Dinesh asked for this in the shape of a party ledger in Tally: a line per
 * movement, a running quantity, an opening and a closing balance.
 *
 * WHAT IS DERIVED AND WHAT IS NOT:
 *
 *   **Issued** and **Returned** are the handover log's own two facts.
 *
 *   **Transferred in / out** is derived, and only where the evidence is
 *   there: somebody else's handover of the SAME asset starting the day this
 *   one ends (or ending the day this one starts). Without that, a return is
 *   just a return - this app does not invent a movement it cannot see.
 *
 *   **Maintenance** lines come from the service log, and only for the stretch
 *   the asset was actually with this person. They carry a cost and move no
 *   quantity, because a repair is not a handover.
 *
 * NOTHING IS COUNTED TWICE: one handover is one issue and at most one return,
 * and an asset covered by an open handover is never also taken from the
 * register (see `assetLedger` above).
 * ================================================================= */

/*
 * A name worth printing, or nothing.
 *
 * An installation running open records the actor as "nobody (open)", and one
 * writing through the API key records "the API key". Printing "Issued by
 * nobody (open)" on a ledger somebody hands over is worse than printing
 * "Issued" - it says nothing, at length.
 */
const realName = (who) => {
  const name = String(who || '').trim();
  if (!name || /\(open\)/i.test(name) || /^the api key$/i.test(name)) return '';
  return name;
};

const sameDayish = (a, b) => {
  if (!a || !b) return false;
  const gap = daysBetween(a, b);
  return gap !== null && Math.abs(gap) <= 1;
};

/**
 * @param lines    this person's ledger lines, as `assetLedger` built them
 * @param others   handovers of the SAME assets belonging to anybody else
 * @param services service rows for those assets
 * @param from/to  the window, as ISO dates; anything before `from` is opening
 */
export function ledgerTransactions({ lines = [], others = [], services = [], from = '', to = '', today = todayIso() } = {}) {
  const events = [];

  const otherFor = (assetId) => others.filter((o) => Number(o.asset_id) === Number(assetId));

  for (const line of lines) {
    const theirs = otherFor(line.asset_id);

    /* out of the office and into their hands */
    const cameFrom = theirs.find((o) => o.returned_on && sameDayish(o.returned_on, line.issued_on));
    events.push({
      on: day(line.issued_on),
      type: cameFrom ? 'Transferred in' : 'Asset issued',
      particulars: cameFrom
        ? `Taken over from ${cameFrom.employee_name || 'somebody'}`
        : line.no_slip
          ? 'Standing against them on the register — no slip on file'
          : `Issued${realName(line.issued_by) ? ` by ${realName(line.issued_by)}` : ''}`,
      code: line.code,
      label: line.label,
      kind: line.kind,
      asset_id: line.asset_id,
      in: 1,
      out: 0,
      value: line.value,
      note: line.condition_out || '',
    });

    if (line.returned_on) {
      const wentTo = theirs.find((o) => o.issued_on && sameDayish(o.issued_on, line.returned_on));
      events.push({
        on: day(line.returned_on),
        type: wentTo ? 'Transferred out' : 'Asset returned',
        particulars: wentTo
          ? `Passed to ${wentTo.employee_name || 'somebody'}`
          : `Returned${realName(line.returned_by) ? ` to ${realName(line.returned_by)}` : ''}`,
        code: line.code,
        label: line.label,
        kind: line.kind,
        asset_id: line.asset_id,
        in: 0,
        out: 1,
        value: line.value,
        note: line.condition_in || '',
      });
    }

    /*
     * Repairs, but only those that happened while the asset was with THEM.
     * A service from before they were given it belongs on the asset's own
     * history, not on this person's ledger.
     */
    for (const service of services.filter((s) => Number(s.asset_id) === Number(line.asset_id))) {
      const on = day(service.serviced_on);
      if (!on || !line.issued_on || on < day(line.issued_on)) continue;
      if (line.returned_on && on > day(line.returned_on)) continue;
      events.push({
        on,
        type: 'Maintenance',
        particulars: [service.kind, service.work, service.vendor].filter(Boolean).join(' — ') || 'Service',
        code: line.code,
        label: line.label,
        kind: line.kind,
        asset_id: line.asset_id,
        in: 0,
        out: 0,
        value: Number(service.cost) || 0,
        note: service.under_warranty ? 'under warranty' : '',
      });
    }
  }

  // Oldest first, and a return never sorts above the issue it closes.
  const order = { 'Asset issued': 0, 'Transferred in': 0, Maintenance: 1, 'Asset returned': 2, 'Transferred out': 2 };
  events.sort(
    (a, b) => String(a.on).localeCompare(String(b.on)) || (order[a.type] ?? 1) - (order[b.type] ?? 1)
  );

  /* Anything before the window is the opening balance, not a row. */
  const before = from ? events.filter((e) => e.on && e.on < day(from)) : [];
  const within = events.filter((e) => {
    if (from && e.on && e.on < day(from)) return false;
    if (to && e.on && e.on > day(to)) return false;
    return true;
  });

  const opening = {
    qty: before.reduce((n, e) => n + e.in - e.out, 0),
    value: before.reduce((n, e) => n + (e.in ? e.value : 0) - (e.out ? e.value : 0), 0),
  };

  let qty = opening.qty;
  let value = opening.value;
  const rows = within.map((event) => {
    qty += event.in - event.out;
    if (event.in) value += event.value;
    if (event.out) value -= event.value;
    return { ...event, balance: qty, balance_value: Math.round(value) };
  });

  const spent = within.filter((e) => e.type === 'Maintenance').reduce((n, e) => n + e.value, 0);

  return {
    opening,
    rows,
    closing: { qty, value: Math.round(value) },
    totals: {
      issued: within.reduce((n, e) => n + e.in, 0),
      returned: within.reduce((n, e) => n + e.out, 0),
      maintenance: within.filter((e) => e.type === 'Maintenance').length,
      maintenance_cost: Math.round(spent),
    },
    from: day(from) || '',
    to: day(to) || '',
    today,
  };
}

/** The ledger as a CSV, in the order it is printed. */
export const TRANSACTION_COLUMNS = [
  ['Date', (r) => r.on],
  ['Particulars', (r) => r.particulars],
  ['Asset code', (r) => r.code],
  ['Asset', (r) => `${r.kind || ''} ${r.label || ''}`.trim()],
  ['Transaction', (r) => r.type],
  ['Issued', (r) => r.in || ''],
  ['Returned', (r) => r.out || ''],
  ['Balance', (r) => r.balance],
  ['Value', (r) => r.value || ''],
  ['Note', (r) => r.note || ''],
];

export function transactionsCsv(ledger, book) {
  const lines = [TRANSACTION_COLUMNS.map(([head]) => escapeCell(head)).join(',')];
  lines.push(
    ['', 'Opening balance', '', '', 'Opening Balance', '', '', book.opening.qty, book.opening.value, '']
      .map(escapeCell)
      .join(',')
  );
  for (const row of book.rows) {
    lines.push(TRANSACTION_COLUMNS.map(([, get]) => escapeCell(get(row))).join(','));
  }
  lines.push(
    ['', 'Closing balance', '', '', 'Closing Balance', book.totals.issued, book.totals.returned, book.closing.qty, book.closing.value, '']
      .map(escapeCell)
      .join(',')
  );
  return `﻿${lines.join('\n')}`;
}
