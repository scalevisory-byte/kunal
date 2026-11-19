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
export function assetLedger({ employee, handovers = [], assets = [], today = new Date().toISOString().slice(0, 10) } = {}) {
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

const escape = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV with a BOM, so Excel opens it with the rupee signs intact. */
export function ledgerCsv(ledger) {
  const lines = [LEDGER_COLUMNS.map(([head]) => escape(head)).join(',')];
  for (const line of ledger.lines) {
    lines.push(LEDGER_COLUMNS.map(([, get]) => escape(get(line))).join(','));
  }
  return `﻿${lines.join('\n')}`;
}
