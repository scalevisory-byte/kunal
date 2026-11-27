/*
 * /api/desk - the Task & Approval Desk.
 *
 * ONE DOOR FOR BOTH KINDS OF LOGIN. Every other router here is either the
 * office's (it needs `read`) or a staff login's own (/api/me). The desk is
 * neither: the same screen is used by a director and by somebody at a
 * counter, and what each may see is decided by who they ARE on the desk, not
 * by which side of the app they signed into. So it is mounted behind
 * requireAuth alone, and every handler works out the caller from req.actor.
 *
 * Nothing here takes a person from a URL or a body as "who is asking".
 */
import { Router } from 'express';
import { requireAbility } from '../auth.js';
import {
  addApprovalUpdate,
  addTaskUpdate,
  createDeskApproval,
  createDeskTask,
  decideDeskApproval,
  deskApprovalDetail,
  deskBootstrap,
  deskSettings,
  deskTaskDetail,
  deskWaiting,
  linkDeskLogin,
  markDeskSeen,
  setDeskRank,
} from '../desk.js';

export const deskRouter = Router();

/** Run it; turn a thrown error into the status it carries, or a 400. */
const answer = (res, status, work) => {
  try {
    res.status(status).json(work());
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
};

deskRouter.get('/', (req, res) => answer(res, 200, () => deskBootstrap(req.actor)));
deskRouter.get('/waiting', (req, res) => answer(res, 200, () => deskWaiting(req.actor)));
deskRouter.post('/seen', (req, res) => answer(res, 200, () => markDeskSeen(req.actor)));

deskRouter.post('/tasks', (req, res) => answer(res, 201, () => createDeskTask(req.actor, req.body || {})));
deskRouter.get('/tasks/:id', (req, res) => answer(res, 200, () => deskTaskDetail(req.actor, req.params.id)));
deskRouter.post('/tasks/:id/updates', (req, res) =>
  answer(res, 201, () => addTaskUpdate(req.actor, req.params.id, req.body || {}))
);

deskRouter.post('/approvals', (req, res) => answer(res, 201, () => createDeskApproval(req.actor, req.body || {})));
deskRouter.get('/approvals/:id', (req, res) => answer(res, 200, () => deskApprovalDetail(req.actor, req.params.id)));
deskRouter.post('/approvals/:id/decide', (req, res) =>
  answer(res, 200, () => decideDeskApproval(req.actor, req.params.id, req.body || {}))
);
deskRouter.post('/approvals/:id/updates', (req, res) =>
  answer(res, 201, () => addApprovalUpdate(req.actor, req.params.id, req.body || {}))
);

/*
 * Who stands where, and which office login is which employee. An Admin's two
 * settings: a rank decides whose work somebody can see, so it is not
 * something a person sets for themselves.
 */
deskRouter.get('/settings', requireAbility('admin'), (req, res) => answer(res, 200, () => deskSettings()));
deskRouter.put('/ranks/:key', requireAbility('admin'), (req, res) =>
  answer(res, 200, () => setDeskRank(req.actor, req.params.key, req.body?.level))
);
deskRouter.put('/logins/:userId', requireAbility('admin'), (req, res) =>
  answer(res, 200, () => linkDeskLogin(req.actor, req.params.userId, req.body?.employee_id))
);
