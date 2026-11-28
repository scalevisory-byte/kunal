/**
 * Where a piece of maintenance work has got to.
 *
 * Until v2.45.0 a service record was only ever something already DONE: it
 * was typed in with the bill in hand. The brief asked for work in progress -
 * a laptop booked in for Monday, a printer at the shop, a part on order - and
 * that is a different thing with one rule hanging off it:
 *
 *   **MONEY IS SPENT ONLY ON WORK THAT IS COMPLETED.** A quote on a job not
 *   yet done is not a cost of owning the thing, and a cancelled job never
 *   was one. Every total - cost of ownership, the year's spend, the
 *   dashboard's repair figure - counts `isSpent` rows and nothing else.
 *
 * `null` (every record made before this existed) reads as completed, because
 * that is what those records are. Dependency-free, like the rest of shared/.
 */
export const SERVICE_STATUSES = [
  ['scheduled', 'Scheduled'],
  ['in_progress', 'In progress'],
  ['waiting_parts', 'Waiting for parts'],
  ['done', 'Completed'],
  ['cancelled', 'Cancelled'],
];

export const OPEN_SERVICE_STATUSES = ['scheduled', 'in_progress', 'waiting_parts'];

const KNOWN = new Set(SERVICE_STATUSES.map(([k]) => k));

/** The status a stored row is in. Nothing stored means it was done. */
export const statusOfService = (row) => (KNOWN.has(row?.status) ? row.status : 'done');

export const serviceStatusLabel = (row) =>
  SERVICE_STATUSES.find(([k]) => k === statusOfService(row))?.[1] || 'Completed';

/** Counted as money spent: completed work, and only completed work. */
export const isSpent = (row) => statusOfService(row) === 'done';

/** Still to happen or still happening. */
export const isOpenService = (row) => OPEN_SERVICE_STATUSES.includes(statusOfService(row));

/** A status as typed, or a refusal naming the choices. Blank is completed. */
export function cleanServiceStatus(value) {
  const v = String(value ?? '').trim();
  if (!v) return 'done';
  if (!KNOWN.has(v)) {
    throw new Error(`a service is ${SERVICE_STATUSES.map(([, l]) => l.toLowerCase()).join(', ')} — not "${v}"`);
  }
  return v;
}

/** Open work, the soonest first; undated last. */
export const openWork = (services = []) =>
  services
    .filter(isOpenService)
    .sort((a, b) => String(a.serviced_on || '9999').localeCompare(String(b.serviced_on || '9999')) || a.id - b.id);
