/**
 * The documents an employee record is expected to carry.
 *
 * The KYC *numbers* - PAN, Aadhaar, UAN, ESIC - already live on the employee.
 * What was missing is the paper behind them, which is what an inspector, an
 * auditor or a bank actually asks to see.
 *
 * Dependency-free, so the server and the dashboard agree on the list.
 */

export const DOCUMENT_KINDS = [
  { key: 'pan', label: 'PAN card', kyc: true, why: 'KYC, and the TDS return quotes it' },
  { key: 'aadhaar', label: 'Aadhaar', kyc: true, why: 'KYC, and the UAN is seeded from it' },
  { key: 'photo', label: 'Photograph', kyc: true, why: 'ID card and the ESIC record' },
  { key: 'bank_proof', label: 'Cancelled cheque or passbook', kyc: true, why: 'proves the account the salary goes to' },
  { key: 'offer_letter', label: 'Offer letter', kyc: false, why: 'what was agreed, in writing' },
  { key: 'appointment', label: 'Appointment letter', kyc: false, why: 'the terms of employment' },
  { key: 'qualification', label: 'Qualification certificate', kyc: false, why: 'the degree or diploma claimed' },
  { key: 'experience', label: 'Experience / relieving letter', kyc: false, why: 'from the last employer' },
  { key: 'previous_payslip', label: 'Previous payslip', kyc: false, why: 'backs the salary that was agreed' },
  { key: 'other', label: 'Something else', kyc: false, why: '' },
];

export const kindLabel = (key) =>
  DOCUMENT_KINDS.find((k) => k.key === key)?.label || key || 'Document';

/** The ones a record is not really complete without. */
export const KYC_KINDS = DOCUMENT_KINDS.filter((k) => k.kyc).map((k) => k.key);

/**
 * What is on file and what is not.
 *
 * `expires_on` is for the few that do expire - a contract, a work permit, a
 * driving licence filed under "something else". Anything past its date is
 * named rather than quietly counted as present.
 */
export function documentStatus(documents = [], { today = new Date().toISOString().slice(0, 10) } = {}) {
  const byKind = new Map();
  for (const doc of documents) {
    if (!byKind.has(doc.kind)) byKind.set(doc.kind, []);
    byKind.get(doc.kind).push(doc);
  }

  const expired = documents.filter((d) => d.expires_on && d.expires_on < today);
  const missingKyc = KYC_KINDS.filter((kind) => !byKind.has(kind));

  /*
   * CHECKED IS A THIRD THING, not the opposite of rejected.
   *
   * `verified` is null until somebody looks. A register that counted every
   * un-checked PAN card as refused would be a page of red on the day it
   * shipped, and nobody would read it twice.
   */
  const verified = documents.filter((d) => d.verified === 1 || d.verified === true);
  const rejected = documents.filter((d) => d.verified === 0 || d.verified === false);
  const unchecked = documents.filter((d) => d.verified === null || d.verified === undefined);

  return {
    count: documents.length,
    kinds: [...byKind.keys()],
    missing_kyc: missingKyc,
    missing_kyc_labels: missingKyc.map(kindLabel),
    expired,
    verified: verified.length,
    rejected: rejected.length,
    unchecked: unchecked.length,
    /* On file and in order. A rejected document is ON FILE and NOT in
       order, which "complete" alone could never say. */
    complete: missingKyc.length === 0 && expired.length === 0,
    checked: missingKyc.length === 0 && expired.length === 0 && rejected.length === 0 && unchecked.length === 0,
  };
}

/** What one document's state is, in a word. */
export function documentState(doc = {}, { today = new Date().toISOString().slice(0, 10) } = {}) {
  if (doc.expires_on && doc.expires_on < today) return { key: 'expired', label: 'Expired', tone: 'bad' };
  if (doc.verified === 0 || doc.verified === false) return { key: 'rejected', label: 'Rejected', tone: 'bad' };
  if (doc.verified === 1 || doc.verified === true) return { key: 'verified', label: 'Verified', tone: 'ok' };
  return { key: 'unchecked', label: 'Not checked', tone: 'muted' };
}

/**
 * THE REGISTER AN AUDIT ASKS FOR: every person, every KYC document, on one
 * page. Built from the same `documentStatus` each record shows, so a row
 * here and the record behind it cannot disagree.
 */
export function documentRegister(employees = [], documentsFor = () => [], opts = {}) {
  const rows = employees.map((employee) => {
    const docs = documentsFor(employee.id) || [];
    const status = documentStatus(docs, opts);
    const byKind = {};
    for (const kind of KYC_KINDS) {
      const found = docs.filter((d) => d.kind === kind);
      byKind[kind] = found.length
        ? documentState(found[found.length - 1], opts)
        : { key: 'missing', label: 'Not on file', tone: 'bad' };
    }
    return {
      employee_id: employee.id,
      name: employee.name,
      code: employee.code || '',
      company_name: employee.company_name || '',
      department: employee.department || '',
      kinds: byKind,
      count: status.count,
      missing: status.missing_kyc_labels,
      expired: status.expired.length,
      unchecked: status.unchecked,
      rejected: status.rejected,
      complete: status.complete,
      checked: status.checked,
    };
  });
  return {
    rows,
    totals: {
      people: rows.length,
      complete: rows.filter((r) => r.complete).length,
      /* Named apart on purpose: "all four on file" and "all four checked"
         are different questions, and an audit asks the second. */
      checked: rows.filter((r) => r.checked).length,
      missing_something: rows.filter((r) => r.missing.length).length,
      rejected: rows.filter((r) => r.rejected).length,
      expired: rows.filter((r) => r.expired).length,
    },
  };
}
