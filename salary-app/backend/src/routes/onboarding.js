import { Router } from 'express';
import {
  approve,
  cancelInvitation,
  createInvitation,
  getInvitation,
  invitationFromToken,
  invitationToken,
  listInvitations,
  markOpened,
  returnForCorrection,
  saveDraft,
  submit,
  updateInvitation,
} from '../onboarding.js';
import { config } from '../config.js';
import { deleteDocumentFile, uploadDocument } from '../documents.js';
import {
  addInvitationDocument,
  listInvitationDocuments,
  removeInvitationDocument,
} from '../onboarding.js';
import { OFFICE_SET } from '../../../shared/onboardingFlow.js';

/**
 * Two routers, because there are two sides and only one of them has a
 * password.
 *
 *   `onboardingRouter`  the office: invite, watch, check, return, approve.
 *   `onboardSelfRouter` the person filling it in, who has a LINK and nothing
 *                       else. The token says which invitation, and the
 *                       invitation id is taken from the TOKEN - never from
 *                       the URL or the body - so one link cannot reach
 *                       another person's form however the request is
 *                       written. The same rule the punch link follows.
 */
export const onboardingRouter = Router();
export const onboardSelfRouter = Router();

const who = (req) => req.actor?.name || 'office';
const bad = (res, err) => res.status(400).json({ error: err.message });

onboardingRouter.get('/', (req, res) =>
  res.json({
    invitations: listInvitations({
      status: req.query.status || undefined,
      company_id: Number(req.query.company_id) || undefined,
    }),
  })
);

onboardingRouter.post('/', (req, res) => {
  try {
    const invitation = createInvitation(req.body || {}, who(req));
    res.status(201).json(withLink(invitation));
  } catch (err) {
    bad(res, err);
  }
});

onboardingRouter.get('/:id', (req, res) => {
  const invitation = getInvitation(Number(req.params.id));
  if (!invitation) return res.status(404).json({ error: 'not found' });
  res.json(withLink(invitation));
});

onboardingRouter.patch('/:id', (req, res) => {
  try {
    res.json(withLink(updateInvitation(Number(req.params.id), req.body || {}, who(req))));
  } catch (err) {
    bad(res, err);
  }
});

onboardingRouter.post('/:id/cancel', (req, res) => {
  try {
    res.json(cancelInvitation(Number(req.params.id), who(req), req.body?.why));
  } catch (err) {
    bad(res, err);
  }
});

onboardingRouter.post('/:id/return', (req, res) => {
  try {
    res.json(returnForCorrection(Number(req.params.id), req.body || {}, who(req)));
  } catch (err) {
    bad(res, err);
  }
});

onboardingRouter.post('/:id/approve', (req, res) => {
  try {
    res.json(approve(Number(req.params.id), req.body || {}, who(req)));
  } catch (err) {
    bad(res, err);
  }
});

/*
 * The link to hand over.
 *
 * Built where PUBLIC_URL is known. Without one it still returns the path, so
 * the office can see what it is - and the screen says plainly that the
 * address has to be set before the link works from outside.
 */
function withLink(invitation) {
  const path = `/join/${invitationToken(invitation)}`;
  return {
    ...invitation,
    link: config.publicUrl ? `${config.publicUrl}${path}` : path,
    link_ready: Boolean(config.publicUrl),
  };
}

/* ---------------- the person's own side: a link, no password ---------------- */

/** Everything on this router reads the invitation from the TOKEN. */
const mine = (req, res, next) => {
  const invitation = invitationFromToken(req.params.token || req.body?.token);
  if (!invitation) {
    return res.status(404).json({
      error: 'this link has expired or been withdrawn — ask the office for a new one',
    });
  }
  req.invitation = invitation;
  return next();
};

/** What they see: their own draft, and what the office decided, read-only. */
const forThem = (invitation) => ({
  id: invitation.id,
  name: invitation.name,
  status: invitation.status,
  expires_on: invitation.expires_on,
  remarks: invitation.remarks || '',
  declared: invitation.declared,
  draft: invitation.draft,
  progress: invitation.progress,
  /* The office's own decisions, by name and never by id - an id is no use
     to them and a list of ids is a map of the company. */
  office: Object.fromEntries(OFFICE_SET.map((f) => [f, invitation[f] ?? ''])),
});

onboardSelfRouter.get('/:token', mine, (req, res) => {
  markOpened(req.invitation.id);
  res.json(forThem(getInvitation(req.invitation.id)));
});

onboardSelfRouter.patch('/:token', mine, (req, res) => {
  try {
    res.json(forThem(saveDraft(req.invitation.id, req.body || {})));
  } catch (err) {
    bad(res, err);
  }
});

/*
 * THEIR OWN PAPERWORK: a PAN card, an Aadhaar, a photograph, a cancelled
 * cheque.
 *
 * The file goes straight into the employee document store, so approval does
 * not have to move anything - and like every other document in this app, the
 * uploaded filename is discarded (it is user input and this is a path) and
 * the server's own name is what is kept.
 *
 * What comes BACK never carries the path. Nothing on this router can read a
 * file either: a document is read on the office's side, where there is a
 * password and a signed link.
 */
onboardSelfRouter.post('/:token/documents', mine, uploadDocument, (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file came through' });
  try {
    const doc = addInvitationDocument(req.invitation.id, {
      kind: req.body?.kind || 'other',
      file_path: req.file.path,
      file_name: req.file.originalname,
      number: req.body?.number,
    });
    const { file_path, ...rest } = doc;
    res.status(201).json(rest);
  } catch (err) {
    bad(res, err);
  }
});

onboardSelfRouter.get('/:token/documents', mine, (req, res) =>
  res.json({ documents: listInvitationDocuments(req.invitation.id) })
);

onboardSelfRouter.delete('/:token/documents/:id', mine, (req, res) => {
  try {
    const gone = removeInvitationDocument(req.invitation.id, Number(req.params.id));
    if (gone) deleteDocumentFile(gone);
    res.json({ deleted: Boolean(gone) });
  } catch (err) {
    bad(res, err);
  }
});

onboardSelfRouter.post('/:token/submit', mine, (req, res) => {
  try {
    res.json(forThem(submit(req.invitation.id, req.body || {})));
  } catch (err) {
    bad(res, err);
  }
});
