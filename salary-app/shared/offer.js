/**
 * Final selection, approval, and the offer letter.
 *
 * The last two steps before somebody becomes an employee, and the pair of them
 * exist to hold ONE rule, which Dinesh wrote twice in his own words:
 *
 *   "Do not automatically issue an offer letter without the required
 *    approval." / "Never automatically approve a candidate or bypass a
 *    required stage."
 *
 * So an offer has two separate acts behind it, done by two different
 * abilities. Somebody authorised APPROVES the hire at a named salary; the
 * office then SENDS the letter. Neither happens as a side effect of the other,
 * and nothing in the app can do either on its own - there is no code path that
 * sends an unapproved offer, and `check` below refuses one.
 *
 * The letter itself follows the payslip's rule exactly:
 *
 *   ONE FILE HOLDS ONE PERSON.
 *
 * It is built from one offer record, never from a list, and it carries no
 * other candidate, no other salary and nothing that loads from the internet -
 * so it is safe to forward on WhatsApp, which is how it will actually travel.
 *
 * Dependency-free, so the server writes the letter and the browser previews
 * the same one.
 */

/* ---------------- the states ---------------- */

export const OFFER_STATUSES = [
  { key: 'draft', label: 'Draft', hint: 'Being prepared — nobody has approved it' },
  { key: 'approved', label: 'Approved', hint: 'Approved, not yet sent to the candidate' },
  { key: 'sent', label: 'Sent', hint: 'With the candidate' },
  { key: 'accepted', label: 'Accepted', hint: 'They said yes' },
  { key: 'declined', label: 'Declined', hint: 'They said no' },
  { key: 'withdrawn', label: 'Withdrawn', hint: 'The office took it back' },
];

export const OFFER_STATUS_KEYS = OFFER_STATUSES.map((s) => s.key);
export const offerStatusMeta = (key) => OFFER_STATUSES.find((s) => s.key === key) || null;

/**
 * Who may move an offer where, and what it does to the application.
 *
 * `needs` is an ability this app already has - no new role, as Dinesh asked.
 * **Approving is `admin`**; preparing, sending and recording the answer are
 * `write`, which HR has. That is the honest reading of "only authorised users
 * can approve" against the four roles that exist.
 *
 * `stage` is what the APPLICATION moves to. Note what approving does: nothing.
 * An approval is permission to make an offer, not an offer - the candidate has
 * not heard a word yet, so moving them to "Offer Sent" would be a lie on the
 * board.
 */
export const OFFER_MOVES = {
  draft: [
    { to: 'approved', label: 'Approve this offer', needs: 'admin', stage: null },
  ],
  approved: [
    { to: 'sent', label: 'Mark as sent', needs: 'write', stage: 'Offer Sent' },
    { to: 'withdrawn', label: 'Withdraw', needs: 'admin', stage: null },
  ],
  sent: [
    { to: 'accepted', label: 'They accepted', needs: 'write', stage: 'Selected' },
    { to: 'declined', label: 'They declined', needs: 'write', stage: 'Rejected' },
    { to: 'withdrawn', label: 'Withdraw', needs: 'admin', stage: null },
  ],
  /*
   * Accepted is not the end of the road - they still have to turn up - but it
   * is the end of the OFFER. Joining is the separate "Add to payroll" act that
   * already existed, so nothing leads out of here.
   */
  accepted: [],
  declined: [],
  withdrawn: [],
};

export const offerMovesFrom = (status, abilities = []) =>
  (OFFER_MOVES[status] || []).filter((m) => abilities.includes(m.needs));

/**
 * May this person make this move?
 *
 * Answers a code as well as a reason, so the caller can tell a permission
 * problem (403, ask somebody else) from a step that does not exist (400, the
 * screen is out of date). Answering 403 for both tells an admin they lack
 * rights for something no right could ever allow.
 */
export function canMoveOffer(offer, to, abilities = []) {
  const from = String(offer?.status || '');
  const allowed = OFFER_MOVES[from];
  if (!allowed) return { ok: false, code: 'unknown', why: `“${from}” is not an offer status.` };
  if (!allowed.length) {
    return {
      ok: false,
      code: 'done',
      why: `This offer is already ${offerStatusMeta(from)?.label.toLowerCase()}.`,
    };
  }
  const move = allowed.find((m) => m.to === to);
  if (!move) {
    return {
      ok: false,
      code: 'bad-step',
      why: `An offer cannot go from ${offerStatusMeta(from)?.label.toLowerCase()} straight to ${
        offerStatusMeta(to)?.label?.toLowerCase() || to
      }.`,
    };
  }
  if (!abilities.includes(move.needs)) {
    return {
      ok: false,
      code: 'forbidden',
      why:
        move.needs === 'admin'
          ? 'Only an Admin login can approve or withdraw an offer.'
          : 'This login can look but not change.',
    };
  }
  return { ok: true, move };
}

/* ---------------- what an offer has to say ---------------- */

/**
 * Fit to approve?
 *
 * Only what the letter cannot be written without, and what the payroll will
 * need the moment they join. A salary of nought is refused rather than stored:
 * an offer letter quoting ₹0 goes out to a person, and a wrong number here is
 * a wrong payslip at the end of the first month.
 */
export function checkOffer(offer = {}) {
  const problems = [];
  const salary = Number(offer.salary);
  if (!Number.isFinite(salary) || salary <= 0) {
    problems.push('An offer needs the monthly salary it is offering.');
  }
  if (!String(offer.designation || '').trim()) {
    problems.push('What is the job called on the letter?');
  }
  if (!String(offer.joining_date || '').trim()) {
    problems.push('Give the date they are expected to start.');
  }
  // Valid-till is optional, but a date already past is a mistake worth
  // catching before it is printed on a letter.
  if (offer.valid_till && offer.joining_date && offer.valid_till > offer.joining_date) {
    problems.push('The offer would expire after the joining date.');
  }
  return problems;
}

/* ---------------- the letter ---------------- */

const esc = (v) =>
  String(v ?? '').replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&#39;', '"': '&quot;' }[c])
  );

const money = (v) => (Math.round(Number(v) || 0)).toLocaleString('en-IN');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

/** "12 January 2027", or the raw text when it is not a date we understand. */
export function longDate(value) {
  const text = String(value || '').trim();
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return text;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** A file name somebody can find again: Amit-Shah-Offer-Travel-Consultant.html */
export function offerFileName(offer = {}) {
  const bits = [offer.candidate_name, 'Offer', offer.designation]
    .map((s) => String(s || '').trim().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, ''))
    .filter(Boolean);
  return `${bits.join('-') || 'Offer'}.html`;
}

/**
 * The letter, as one self-contained file.
 *
 * Nothing loads from the internet - no stylesheet, no font, no image - because
 * this is opened on a phone with no signal as often as not, and because a
 * letter that phones home every time it is read is a letter that tells us when
 * a candidate shows it to a competitor.
 *
 * Everything here comes from the stored offer. It does not recalculate a
 * salary or look anything up: the figure on the letter is the figure that was
 * approved, and the two cannot disagree.
 */
export function offerLetterHtml(offer = {}, { note } = {}) {
  const lines = [
    ['Position', offer.designation],
    ['Department', offer.department],
    ['Place of work', offer.location],
    ['Reporting to', offer.reports_to],
    ['Monthly salary', offer.salary ? `₹${money(offer.salary)}` : ''],
    ['Date of joining', longDate(offer.joining_date)],
    ['Probation', offer.probation],
    ['Working hours', offer.working_hours],
    ['Offer valid till', longDate(offer.valid_till)],
  ].filter(([, v]) => String(v || '').trim());

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(offer.candidate_name)} — offer of employment</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 1.5rem 1rem; background: #f6f6f4; color: #16181d;
    font: 15px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  .sheet {
    max-width: 44rem; margin: 0 auto; background: #fff; padding: 2rem 2.2rem;
    border: 1px solid #e3e3df; border-radius: 10px;
  }
  h1 { font-size: 1.15rem; margin: 0 0 0.2rem; letter-spacing: 0.06em; color: #15284b; }
  h2 { font-size: 1rem; margin: 1.6rem 0 0.6rem; }
  .muted { color: #6a6f7a; font-size: 0.85rem; }
  .head { border-bottom: 2px solid #15284b; padding-bottom: 0.8rem; margin-bottom: 1.2rem; }
  table { width: 100%; border-collapse: collapse; margin: 0.6rem 0 1rem; }
  th, td { text-align: left; padding: 0.42rem 0.2rem; border-bottom: 1px solid #ececea; }
  th { width: 42%; font-weight: 500; color: #6a6f7a; }
  td { font-weight: 600; }
  .sign { display: flex; gap: 2rem; margin-top: 2.5rem; flex-wrap: wrap; }
  .sign div { flex: 1 1 12rem; border-top: 1px solid #16181d; padding-top: 0.4rem; font-size: 0.85rem; }
  .note { background: #f6f6f4; border-radius: 8px; padding: 0.7rem 0.9rem; font-size: 0.9rem; }
  .print { margin: 1rem auto 0; display: block; padding: 0.5rem 1rem; border: 1px solid #15284b;
           background: #15284b; color: #fff; border-radius: 6px; font: inherit; cursor: pointer; }
  @media print { body { background: #fff; padding: 0; } .sheet { border: 0; } .print { display: none; } }
</style>
</head>
<body>
<div class="sheet">
  <div class="head">
    <h1>${esc(offer.company_name || 'BOOKNFLY')}</h1>
    <p class="muted">Offer of employment${
      offer.approved_at ? ` · ${esc(longDate(String(offer.approved_at).slice(0, 10)))}` : ''
    }</p>
  </div>

  <p>Dear ${esc(offer.candidate_name)},</p>
  <p>
    Further to your interview with us, we are pleased to offer you the position of
    <strong>${esc(offer.designation)}</strong> at ${esc(offer.company_name || 'BOOKNFLY')}.
    The terms are set out below.
  </p>

  <h2>Terms</h2>
  <table>
    ${lines.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('\n    ')}
  </table>

  ${offer.terms ? `<h2>Other terms</h2><p>${esc(offer.terms)}</p>` : ''}

  <h2>What to bring on your first day</h2>
  <p class="note">
    PAN card, Aadhaar card, a cancelled cheque or bank passbook copy, your education
    certificates, and your previous employer's relieving letter if you have one. We need these to
    put you on the payroll.
  </p>

  ${note ? `<p class="note">${esc(note)}</p>` : ''}

  <p>
    Please confirm your acceptance by replying to this letter${
      offer.valid_till ? ` on or before ${esc(longDate(offer.valid_till))}` : ''
    }. We look forward to having you with us.
  </p>

  <div class="sign">
    <div>For ${esc(offer.company_name || 'BOOKNFLY')}<br><span class="muted">${esc(
      offer.approved_by || ''
    )}</span></div>
    <div>Accepted by ${esc(offer.candidate_name)}<br><span class="muted">Signature and date</span></div>
  </div>
</div>
<button class="print" onclick="window.print()">Print or save as PDF</button>
</body>
</html>`;
}
