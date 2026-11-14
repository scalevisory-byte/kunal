/**
 * Everything about one candidate, as one document to print or hand over.
 *
 * Dinesh: *"Agar kisi candidate ma pura detail pdf ya print me chiaye to —
 * Resume / Interview k time me jo form fill kiya hoga o / Test wala sheet /
 * Interviewer ka observations ka form tha o — sab nikle wesa bhi kuch bana
 * dena candidate ki profile me"*.
 *
 * Until now each of those printed separately: the particulars form, the
 * evaluation, and nothing at all for the test. Somebody taking a file in to
 * the boss had to download three or four things per round and staple them.
 * This is the staple.
 *
 * It ASSEMBLES, it never recalculates. Every section is built by the SAME
 * function that draws it on its own - interviewFormBody, evaluationBody,
 * answerSheetBody - so the pack and the single document cannot disagree.
 *
 * ONE FILE HOLDS ONE PERSON. Built from one candidate's records, never from a
 * list, because this is the file most likely to be forwarded.
 *
 * THE CV IS NOT INSIDE IT, and that is not an oversight. A CV is whatever the
 * candidate sent - a PDF, a Word file, a photograph of a printout - and none
 * of those can be poured into an HTML page. Pretending otherwise would give
 * the boss a pack with a blank page where the CV should be. So the pack NAMES
 * the CV and says it comes as its own file, and the button downloads both.
 */

import { esc, evaluationBody, interviewFormBody, page } from './interviewPrint.js';
import { answerSheetBody } from './testSheet.js';
import { roundLabel } from './interviewForm.js';

const date = (v) => (v ? String(v).replace('T', ' ').slice(0, 16) : '');

export function candidatePackFileName(candidate = {}) {
  const bits = [candidate.name, 'file']
    .map((s) => String(s || '').trim().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, ''))
    .filter(Boolean);
  return `${bits.join('-') || 'Candidate'}.html`;
}

/**
 * The front page: who they are, where they have got to, and what is in here.
 *
 * The contents list is honest about what is MISSING as well as what is there -
 * "no evaluation written up yet" is the thing somebody flipping through needs
 * to know, and a pack that silently omits a section reads as a complete file.
 */
function cover({ candidate = {}, applications = [], parts = [], resume_name }) {
  const put = applications
    .map(
      (a) =>
        `<tr><th>${esc(a.vacancy_title || 'Opening')}</th><td>${esc(a.company_name || '')}${
          a.stage ? ` · ${esc(a.stage)}` : ''
        }${a.applied_at ? ` · applied ${esc(String(a.applied_at).slice(0, 10))}` : ''}</td></tr>`
    )
    .join('');

  return `
    <div class="head">
      <h1>${esc(applications[0]?.company_name || 'BOOKNFLY')}</h1>
      <p class="muted">Candidate file</p>
    </div>
    <table>
      <tr><th>Name</th><td><strong>${esc(candidate.name || '')}</strong>${
        candidate.ref_no ? ` · ${esc(candidate.ref_no)}` : ''
      }</td></tr>
      ${candidate.phone ? `<tr><th>Mobile</th><td>${esc(candidate.phone)}</td></tr>` : ''}
      ${candidate.email ? `<tr><th>Email</th><td>${esc(candidate.email)}</td></tr>` : ''}
      ${candidate.current_city ? `<tr><th>Place</th><td>${esc(candidate.current_city)}</td></tr>` : ''}
      ${
        candidate.total_experience
          ? `<tr><th>Experience</th><td>${esc(candidate.total_experience)}</td></tr>`
          : ''
      }
      ${put}
      <tr><th>Printed</th><td>${esc(date(new Date().toISOString()))}</td></tr>
    </table>

    <h2>What is in this file</h2>
    <table>
      <tr><th>Resume</th><td>${
        resume_name
          ? `${esc(resume_name)} — <span class="muted">comes as its own file, not printed here</span>`
          : '<span class="muted">none on file</span>'
      }</td></tr>
      ${parts
        .map((p) => `<tr><th>${esc(p.title)}</th><td>${esc(p.note)}</td></tr>`)
        .join('')}
    </table>`;
}

/**
 * Build the pack.
 *
 * `rounds` is one entry per interview, each optionally carrying the
 * particulars form and the evaluation for that round; `attempts` are the
 * written tests. Everything is OPTIONAL - a candidate with nothing but an
 * application still prints a one-page file, which is the right answer for
 * somebody being discussed before they have been seen.
 */
export function candidatePackHtml({
  candidate = {},
  applications = [],
  rounds = [],
  attempts = [],
  references = [],
  screening = null,
  offer = null,
  resume_name = '',
} = {}) {
  const parts = [];
  const blocks = [];

  if (screening) {
    parts.push({
      title: 'Screening',
      note: `${screening.verdict}${screening.screened_by ? ` · by ${screening.screened_by}` : ''}`,
    });
    blocks.push(`
      <div class="part">
        <h2>Initial screening</h2>
        <table>
          <tr><th>Verdict</th><td><strong>${esc(screening.verdict)}</strong></td></tr>
          ${screening.reason ? `<tr><th>Reason</th><td>${esc(screening.reason)}</td></tr>` : ''}
          ${screening.remarks ? `<tr><th>Remarks</th><td>${esc(screening.remarks)}</td></tr>` : ''}
          ${
            screening.screened_by
              ? `<tr><th>By</th><td>${esc(screening.screened_by)} · ${esc(
                  date(screening.screened_at)
                )}</td></tr>`
              : ''
          }
        </table>
      </div>`);
  }

  rounds.forEach((r) => {
    const label = roundLabel(r.interview?.round, r.interview?.round_name);
    const context = {
      ...(r.context || {}),
      round: r.interview?.round,
      round_name: r.interview?.round_name,
      at: r.interview?.scheduled_at,
      interviewer: r.interview?.interviewer,
    };

    if (r.form) {
      parts.push({
        title: `${label} — particulars`,
        note: r.form.candidate_filled_at
          ? `filled in by the candidate on ${date(r.form.candidate_filled_at)}`
          : r.form.filled_by
            ? `taken by ${r.form.filled_by}`
            : 'on file',
      });
      blocks.push(
        `<div class="part">${interviewFormBody({
          context,
          form: r.form,
          candidate,
          references,
        })}</div>`
      );
    } else {
      parts.push({ title: `${label} — particulars`, note: 'not filled in' });
    }

    if (r.evaluation) {
      parts.push({
        title: `${label} — interviewer's evaluation`,
        note: `${r.evaluation.recommendation || 'no recommendation'}${
          r.evaluation.evaluated_by ? ` · by ${r.evaluation.evaluated_by}` : ''
        } · ${r.evaluation.status || 'draft'}`,
      });
      blocks.push(
        `<div class="part">${evaluationBody({ context, evaluation: r.evaluation, candidate })}</div>`
      );
    } else {
      parts.push({ title: `${label} — interviewer's evaluation`, note: 'not written up' });
    }
  });

  attempts.forEach((a) => {
    const attempt = a.attempt || a;
    const paper = a.paper || {};
    parts.push({
      title: `Written test${paper.name ? ` — ${paper.name}` : ''}`,
      note: attempt.submitted_at
        ? `${attempt.percentage}% · ${attempt.passed ? 'above the pass mark' : 'below the pass mark'}`
        : 'sent, not sat yet',
    });
    blocks.push(`<div class="part">${answerSheetBody({ attempt, candidate, paper })}</div>`);
  });

  if (offer) {
    parts.push({ title: 'Offer', note: `${offer.status}${offer.salary ? ` · ₹${offer.salary}` : ''}` });
    blocks.push(`
      <div class="part">
        <h2>Offer</h2>
        <table>
          <tr><th>Status</th><td><strong>${esc(offer.status)}</strong></td></tr>
          ${offer.designation ? `<tr><th>Designation</th><td>${esc(offer.designation)}</td></tr>` : ''}
          ${offer.salary ? `<tr><th>Monthly salary</th><td>₹${esc(offer.salary)}</td></tr>` : ''}
          ${offer.joining_date ? `<tr><th>Joining</th><td>${esc(offer.joining_date)}</td></tr>` : ''}
          ${offer.approved_by ? `<tr><th>Approved by</th><td>${esc(offer.approved_by)}</td></tr>` : ''}
        </table>
      </div>`);
  }

  if (!blocks.length) {
    blocks.push(
      '<div class="part"><p class="muted">Nothing has been recorded for this candidate yet — no screening, no interview, no test.</p></div>'
    );
  }

  return page(
    `${candidate.name || 'Candidate'} — file`,
    cover({ candidate, applications, parts, resume_name }) + blocks.join('')
  );
}
