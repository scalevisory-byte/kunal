import { Router } from 'express';
import {
  STAGES, SOURCES, listLeads, heldLeads, getLead, createLead, updateLead, confirmLead,
  deleteLead, markContacted, leadEvents, stageCounts,
} from '../leads.js';
import { getGroup } from '../groups.js';
import { normalizeInstant } from '../dates.js';

export const leadsRouter = Router();

/**
 * Leads are the account's own, like everything else here, and nothing on these
 * routes sends anything to anybody: the follow-up is a link that opens the
 * chat with the words ready, and a person presses send.
 */

leadsRouter.get('/', (req, res) => {
  res.json({
    leads: listLeads({ includeClosed: req.query.closed !== '0' }),
    held: heldLeads(),
    counts: stageCounts(),
    stages: STAGES,
    sources: SOURCES,
  });
});

leadsRouter.get('/:id', (req, res) => {
  const lead = getLead(Number(req.params.id));
  if (!lead) return res.status(404).json({ error: 'not found' });
  res.json({ lead, events: leadEvents(lead.id) });
});

const badGroup = (body) =>
  body.group_id !== undefined && body.group_id !== null && body.group_id !== ''
  && !getGroup(Number(body.group_id));

leadsRouter.post('/', (req, res) => {
  const body = req.body || {};
  if (badGroup(body)) return res.status(400).json({ error: 'that business no longer exists' });
  try {
    const lead = createLead({ ...body, next_action_at: normalizeInstant(body.next_action_at) });
    res.status(201).json({ lead });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

leadsRouter.patch('/:id', (req, res) => {
  const body = req.body || {};
  if (badGroup(body)) return res.status(400).json({ error: 'that business no longer exists' });
  const patch = { ...body };
  if ('next_action_at' in patch) patch.next_action_at = normalizeInstant(patch.next_action_at);

  const lead = updateLead(Number(req.params.id), patch);
  if (!lead) return res.status(404).json({ error: 'not found' });
  res.json({ lead, counts: stageCounts() });
});

/** "I have just spoken to them" — the move the board is actually about. */
leadsRouter.post('/:id/contacted', (req, res) => {
  const body = req.body || {};
  const lead = markContacted(Number(req.params.id), {
    nextAt: normalizeInstant(body.next_action_at),
    note: body.note ? String(body.note).slice(0, 500) : null,
  });
  if (!lead) return res.status(404).json({ error: 'not found' });
  res.json({ lead, counts: stageCounts() });
});

leadsRouter.post('/:id/confirm', (req, res) => {
  const lead = confirmLead(Number(req.params.id));
  if (!lead) return res.status(404).json({ error: 'not found' });
  res.json({ lead, held: heldLeads(), counts: stageCounts() });
});

/** Rejecting a captured candidate removes it: it was never a lead. */
leadsRouter.delete('/:id', (req, res) => {
  if (!getLead(Number(req.params.id))) return res.status(404).json({ error: 'not found' });
  deleteLead(Number(req.params.id));
  res.json({ deleted: true, held: heldLeads(), counts: stageCounts() });
});
