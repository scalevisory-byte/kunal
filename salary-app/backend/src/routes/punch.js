import { Router } from 'express';
import {
  createRequest,
  employeeForSelfService,
  listOffices,
  listPunches,
  listRequests,
  recordPunch,
  selfServiceConfig,
  withdrawRequest,
} from '../attendanceSelf.js';
import { db, listPeriods } from '../db.js';
import { log } from '../logger.js';
import { makeToken, readToken } from '../tokens.js';
import { nextKind } from '../../../shared/punchClock.js';
import { REQUEST_KINDS } from '../../../shared/attendanceRequests.js';
import {
  TICKET_CATEGORIES,
  createTicket,
  getTicket,
  listTasks,
  listTickets,
  replyToTicket,
  setTaskStatus,
} from '../people.js';

export const punchRouter = Router();

/*
 * The employee's own page: punch in, punch out, ask for a day to be fixed.
 *
 * There is no password here and there cannot be one - a hundred and fifteen
 * people are not going to be given logins. Instead each person has a personal
 * link carrying a signed token that says who they are and nothing else.
 *
 * What that token can do is deliberately small: punch as that one person, see
 * their own punches and requests, and raise a request. It cannot read anybody
 * else, cannot see a salary, and cannot approve anything - approving is the
 * office's, behind the password.
 *
 * A link can be forwarded and a phone can be handed over. The geofence narrows
 * that, the log makes it visible, and that is the honest limit of punching
 * from a phone. It is not a claim to have stopped buddy punching.
 */

/** A long-lived link, because somebody bookmarks this once and uses it daily. */
export const punchLink = (employee, { days = 365 } = {}) =>
  `/punch/${makeToken('punch', { e: employee.id }, { minutes: days * 24 * 60 })}`;

const whoever = (req, res) => {
  const claim = readToken('punch', req.params.token);
  if (!claim) {
    res.status(403).json({ error: 'This link is not valid any more. Ask the office for a new one.' });
    return null;
  }
  const employee = employeeForSelfService(claim.e);
  if (!employee) {
    res.status(404).json({ error: 'not found' });
    return null;
  }
  return employee;
};

/**
 * A crude per-link rate limit: a punch is one tap, not forty.
 *
 * The counter is per link AND per route. It used to be per link alone, which
 * meant the limits interfered: twenty punches would use up the allowance for
 * raising a ticket, and the strictest route on the page was starved by traffic
 * to the loosest. Each route now has its own bucket for the minute.
 */
const hits = new Map();
const rateLimit = (max, bucket) => (req, res, next) => {
  const key = `${req.params.token}:${bucket}:${Math.floor(Date.now() / 60000)}`;
  const n = (hits.get(key) || 0) + 1;
  hits.set(key, n);
  if (hits.size > 5000) hits.clear();
  if (n > max) return res.status(429).json({ error: 'Too many taps. Wait a minute.' });
  next();
};

const today = () => new Date().toISOString().slice(0, 10);

/** Everything the phone page needs: who they are, and what to offer next. */
punchRouter.get('/:token', (req, res) => {
  const employee = whoever(req, res);
  if (!employee) return;

  const mine = listPunches({ employee_id: employee.id, day: today() });
  res.json({
    employee: {
      id: employee.id,
      name: employee.name,
      code: employee.code,
      company_name: employee.company_name,
      designation: employee.designation,
    },
    settings: selfServiceConfig(),
    offices: listOffices().map((o) => ({ id: o.id, name: o.name, lat: o.lat, lng: o.lng, radius_m: o.radius_m })),
    today: today(),
    punches: mine,
    next: nextKind(mine),
    // Their own requests only. Nobody else's are visible from a punch link.
    requests: listRequests({ employee_id: employee.id }).slice(0, 20),
    kinds: REQUEST_KINDS,
    periods: listPeriods()
      .filter((p) => !p.locked)
      .map((p) => ({ id: p.id, label: p.label, year: p.year, month: p.month })),
    // Their own work and their own tickets. Same fence as everything else here:
    // the id comes from the token, so there is no way to read anybody else's.
    tasks: listTasks({ employee_id: employee.id }).slice(0, 30),
    tickets: listTickets({ employee_id: employee.id }).slice(0, 20),
    ticket_categories: TICKET_CATEGORIES,
  });
});

punchRouter.post('/:token/punch', rateLimit(20, 'punch'), (req, res) => {
  const employee = whoever(req, res);
  if (!employee) return;

  const body = req.body || {};
  const result = recordPunch({
    employee,
    kind: body.kind,
    point:
      body.lat !== undefined && body.lng !== undefined
        ? { lat: Number(body.lat), lng: Number(body.lng) }
        : null,
    accuracy: body.accuracy,
    source: 'phone',
    ip: req.ip,
    restrictions: selfServiceConfig(),
  });

  if (!result.ok) return res.status(400).json({ error: result.reason, judgement: result.judgement });
  log.info(`Punch ${body.kind} by ${employee.name}: ${result.judgement.note}`);
  res.status(201).json({
    ok: true,
    at: new Date().toISOString(),
    where: result.judgement.note,
    inside: result.judgement.inside_fence,
    punches: result.punches,
    next: nextKind(result.punches),
    day: result.day,
  });
});

punchRouter.post('/:token/requests', rateLimit(10, 'requests'), (req, res) => {
  const employee = whoever(req, res);
  if (!employee) return;
  try {
    // The employee id comes from the token, never from the body - otherwise a
    // punch link could raise a request in somebody else's name.
    res.status(201).json(createRequest({ ...(req.body || {}), employee_id: employee.id }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

punchRouter.post('/:token/requests/:id/withdraw', (req, res) => {
  const employee = whoever(req, res);
  if (!employee) return;
  try {
    const request = withdrawRequest(Number(req.params.id), employee.id);
    if (!request) return res.status(404).json({ error: 'not found' });
    res.json(request);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* ---------------- their own work ---------------- */

/**
 * Tick a task off, or put it back. Only their own, and only between open and
 * done - a task cannot be dropped from here, because dropping work somebody
 * gave you is the office's decision, not yours.
 */
punchRouter.post('/:token/tasks/:id/status', rateLimit(30, 'tasks'), (req, res) => {
  const employee = whoever(req, res);
  if (!employee) return;
  const tasks = listTasks({ employee_id: employee.id });
  const mine = tasks.find((t) => t.id === Number(req.params.id));
  if (!mine) return res.status(404).json({ error: 'not found' });
  const status = req.body?.status === 'open' ? 'open' : 'done';
  try {
    res.json(setTaskStatus(mine.id, { status, note: req.body?.note, by: employee.name }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* ---------------- the helpdesk, their side ---------------- */

punchRouter.post('/:token/tickets', rateLimit(5, 'tickets'), (req, res) => {
  const employee = whoever(req, res);
  if (!employee) return;
  try {
    // Again: the id is the token's, never the body's.
    res.status(201).json(createTicket(employee.id, { ...(req.body || {}), by: employee.name }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

punchRouter.get('/:token/tickets/:id', (req, res) => {
  const employee = whoever(req, res);
  if (!employee) return;
  const ticket = getTicket(Number(req.params.id));
  if (!ticket || ticket.employee_id !== employee.id) return res.status(404).json({ error: 'not found' });
  res.json(ticket);
});

punchRouter.post('/:token/tickets/:id/reply', rateLimit(20, 'ticket-replies'), (req, res) => {
  const employee = whoever(req, res);
  if (!employee) return;
  const ticket = getTicket(Number(req.params.id));
  if (!ticket || ticket.employee_id !== employee.id) return res.status(404).json({ error: 'not found' });
  try {
    res.json(replyToTicket(ticket.id, { side: 'employee', author: employee.name, body: req.body?.body }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

punchRouter.use((req, res) => res.status(404).json({ error: 'not found' }));

/** The office asking for somebody's link, to send it to them. */
export function linkFor(employeeId, baseUrl = '') {
  const employee = employeeForSelfService(employeeId);
  if (!employee) return null;
  const path = punchLink(employee);
  return { employee_id: employee.id, name: employee.name, path, url: baseUrl ? `${baseUrl}${path}` : null };
}

export { db };
