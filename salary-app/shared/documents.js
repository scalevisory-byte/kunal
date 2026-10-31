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

  return {
    count: documents.length,
    kinds: [...byKind.keys()],
    missing_kyc: missingKyc,
    missing_kyc_labels: missingKyc.map(kindLabel),
    expired,
    complete: missingKyc.length === 0 && expired.length === 0,
  };
}
