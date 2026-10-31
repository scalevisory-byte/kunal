import { db, getEmployee, getPeriod, listEmployees, setAttendance } from './db.js';
import { config } from './config.js';
import { log } from './logger.js';
import { judgePunch, punchAllowed, punchesToDay } from '../../shared/punchClock.js';
import { canDecide, entryFor, validateRequest } from '../../shared/attendanceRequests.js';

/*
 * The employee's own side of attendance: punching from a phone, and asking for
 * a day to be fixed.
 *
 * Both end up in exactly the same place as everything else - the `attendance`
 * row's mark and clock times - so a phone punch, a biometric import and a time
 * typed on the Time tab are worth the same money with nothing else touched.
 */

/* ---------------- office locations ---------------- */

export const listOffices = ({ active = true } = {}) =>
  db
    .prepare(
      `SELECT o.*, c.name AS company_name FROM office_locations o
       LEFT JOIN companies c ON c.id = o.company_id
       ${active ? 'WHERE o.active = 1' : ''} ORDER BY o.name`
    )
    .all();

export function createOffice(body) {
  const lat = Number(body?.lat);
  const lng = Number(body?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('an office needs a latitude and a longitude');
  if (!String(body?.name || '').trim()) throw new Error('an office needs a name');
  const id = db
    .prepare(
      `INSERT INTO office_locations (company_id, name, lat, lng, radius_m)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(Number(body.company_id) || null, String(body.name).trim(), lat, lng, Number(body.radius_m) || 200)
    .lastInsertRowid;
  return db.prepare(`SELECT * FROM office_locations WHERE id = ?`).get(id);
}

export function updateOffice(id, body) {
  const fields = [];
  const values = [];
  for (const key of ['company_id', 'name', 'lat', 'lng', 'radius_m', 'active']) {
    if (!(key in (body || {}))) continue;
    fields.push(`${key} = ?`);
    values.push(key === 'active' ? (body[key] ? 1 : 0) : body[key]);
  }
  if (fields.length) db.prepare(`UPDATE office_locations SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);
  return db.prepare(`SELECT * FROM office_locations WHERE id = ?`).get(id);
}

export const deleteOffice = (id) =>
  db.prepare(`DELETE FROM office_locations WHERE id = ?`).run(id).changes > 0;

/* ---------------- punches ---------------- */

export const listPunches = ({ employee_id, day, from, to, limit = 500 } = {}) => {
  const where = [];
  const params = { limit };
  if (employee_id) {
    where.push('p.employee_id = @employee_id');
    params.employee_id = employee_id;
  }
  if (day) {
    where.push('p.day = @day');
    params.day = day;
  }
  if (from) {
    where.push('p.day >= @from');
    params.from = from;
  }
  if (to) {
    where.push('p.day <= @to');
    params.to = to;
  }
  return db
    .prepare(
      `SELECT p.*, e.name AS employee_name, o.name AS office_name
       FROM punch_events p
       JOIN employees e ON e.id = p.employee_id
       LEFT JOIN office_locations o ON o.id = p.office_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY p.at DESC LIMIT @limit`
    )
    .all(params)
    .map((row) => ({ ...row, located: !!row.located, inside_fence: row.inside_fence === null ? null : !!row.inside_fence }));
};

/**
 * Record one punch and roll the day up onto the attendance row.
 *
 * The roll-up only ever writes `in_time` and `out_time`; the mark is left to
 * the grid, the importer or an approved request. A punch says when somebody
 * was there, not what the day should be worth.
 */
export function recordPunch({ employee, kind, point, accuracy, source = 'phone', ip, restrictions, at = new Date() }) {
  const offices = listOffices().filter(
    (o) => !o.company_id || !employee.company_id || o.company_id === employee.company_id
  );
  const judgement = judgePunch({ point, accuracy, offices }, restrictions);
  const allowed = punchAllowed(judgement, restrictions);
  if (!allowed.ok) return { ok: false, reason: allowed.reason, judgement };

  const stamp = at instanceof Date ? at : new Date(at);
  const day = stamp.toISOString().slice(0, 10);

  db.prepare(
    `INSERT INTO punch_events
      (employee_id, at, day, kind, lat, lng, accuracy_m, office_id, distance_m, inside_fence, located, note, source, ip)
     VALUES (@employee_id, @at, @day, @kind, @lat, @lng, @accuracy_m, @office_id, @distance_m, @inside_fence, @located, @note, @source, @ip)`
  ).run({
    employee_id: employee.id,
    at: stamp.toISOString(),
    day,
    kind: kind === 'out' ? 'out' : 'in',
    lat: point ? Number(point.lat) : null,
    lng: point ? Number(point.lng) : null,
    accuracy_m: Number(accuracy) || null,
    office_id: judgement.office_id,
    distance_m: judgement.distance_m,
    inside_fence: judgement.inside_fence === null ? null : judgement.inside_fence ? 1 : 0,
    located: judgement.located ? 1 : 0,
    note: judgement.note,
    source,
    ip: ip || null,
  });

  const written = rollUpDay(employee.id, day);
  return { ok: true, judgement, day: written, punches: listPunches({ employee_id: employee.id, day }) };
}

/**
 * The day's punches, turned into that day's in and out on the grid.
 *
 * Nothing happens unless the day falls inside an open month: punching on a day
 * that has no period yet is still recorded, it just has nowhere to land until
 * the month is opened.
 */
export function rollUpDay(employeeId, isoDay) {
  const punches = listPunches({ employee_id: employeeId, day: isoDay });
  const rolled = punchesToDay(punches);
  if (!rolled) return null;

  const [year, month, dayOfMonth] = isoDay.split('-').map(Number);
  const period = db.prepare(`SELECT * FROM periods WHERE year = ? AND month = ?`).get(year, month);
  if (!period || period.locked) return { ...rolled, written: false, reason: period ? 'month is locked' : 'month not open' };

  setAttendance(period.id, [
    {
      employee_id: employeeId,
      day: dayOfMonth,
      in_time: rolled.in_time,
      ...(rolled.out_time ? { out_time: rolled.out_time } : {}),
    },
  ]);
  return { ...rolled, written: true, period_id: period.id };
}

/* ---------------- requests ---------------- */

export const listRequests = ({ status, employee_id, period_id } = {}) => {
  const where = [];
  const params = {};
  if (status) {
    where.push('r.status = @status');
    params.status = status;
  }
  if (employee_id) {
    where.push('r.employee_id = @employee_id');
    params.employee_id = employee_id;
  }
  if (period_id) {
    where.push('r.period_id = @period_id');
    params.period_id = period_id;
  }
  return db
    .prepare(
      `SELECT r.*, e.name AS employee_name, e.code AS employee_code, c.name AS company_name,
              p.label AS period_label, p.year, p.month
       FROM attendance_requests r
       JOIN employees e ON e.id = r.employee_id
       JOIN companies c ON c.id = e.company_id
       JOIN periods p ON p.id = r.period_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY (r.status != 'pending'), r.created_at ASC`
    )
    .all(params);
};

export const getRequest = (id) =>
  db.prepare(`SELECT * FROM attendance_requests WHERE id = ?`).get(id) || null;

export function createRequest(body) {
  const { ok, problems } = validateRequest(body);
  if (!ok) throw new Error(problems.join('; '));
  const id = db
    .prepare(
      `INSERT INTO attendance_requests
        (employee_id, period_id, day, kind, code, in_time, lunch_out, lunch_in, out_time, reason)
       VALUES (@employee_id, @period_id, @day, @kind, @code, @in_time, @lunch_out, @lunch_in, @out_time, @reason)`
    )
    .run({
      employee_id: Number(body.employee_id),
      period_id: Number(body.period_id),
      day: Number(body.day),
      kind: body.kind,
      code: body.code || null,
      in_time: body.in_time || null,
      lunch_out: body.lunch_out || null,
      lunch_in: body.lunch_in || null,
      out_time: body.out_time || null,
      reason: String(body.reason).trim(),
    }).lastInsertRowid;
  return getRequest(id);
}

/**
 * The decision. Approving is the ONLY thing in this module that writes
 * attendance; rejecting writes nothing at all beyond the decision itself.
 */
export function decideRequest(id, { approve, by = 'office', note } = {}) {
  const request = getRequest(id);
  const period = request ? getPeriod(request.period_id) : null;
  const may = canDecide(request, { periodLocked: !!period?.locked });
  if (!may.ok) throw new Error(may.reason);

  if (approve) {
    setAttendance(request.period_id, [entryFor(request)]);
    log.info(`Attendance request ${id} approved by ${by}`);
  }

  db.prepare(
    `UPDATE attendance_requests SET status = ?, decided_by = ?, decided_at = datetime('now'), decision_note = ?
     WHERE id = ?`
  ).run(approve ? 'approved' : 'rejected', by, note || null, id);
  return getRequest(id);
}

export const withdrawRequest = (id, employeeId) => {
  const request = getRequest(id);
  if (!request || request.employee_id !== Number(employeeId)) return null;
  if (request.status !== 'pending') throw new Error(`this was already ${request.status}`);
  db.prepare(`UPDATE attendance_requests SET status = 'withdrawn' WHERE id = ?`).run(id);
  return getRequest(id);
};

/** Whoever this punch link belongs to, for the phone page. */
export const employeeForSelfService = (id) => {
  const employee = getEmployee(Number(id));
  return employee && employee.active ? employee : null;
};

export const activeEmployees = () => listEmployees({ active: true });

export const selfServiceConfig = () => ({
  enabled: config.punchEnabled,
  requireLocation: config.punchRequireLocation,
  allowOutsideFence: config.punchAllowOutside,
  fenceMetres: config.punchFenceMetres,
});
