/**
 * The interview paperwork, as a document somebody can print or hand over.
 *
 * Dinesh: *"form proper printable nahi he / usko proper print kar sake and pdf
 * me export kar sake esa banavo — if boss dekhna chahe to esa print ya pdf
 * thodi de payenge"*. He is right, and the reason is structural: the form on
 * screen is a side panel of COLLAPSIBLE sections, so window.print() prints the
 * two sections that happened to be open and none of the rest.
 *
 * So the printable version is built here instead, the same way the payslip and
 * the offer letter are: one self-contained HTML file, everything open, nothing
 * loaded from the internet, opens on any machine and prints to PDF.
 *
 * ONE FILE HOLDS ONE PERSON. Built from one interview's records and never from
 * a list, so what gets forwarded carries nobody else's answers.
 *
 * It ASSEMBLES. Every figure and every word was typed on a screen and stored;
 * nothing here works anything out, including the evaluation's totals, which
 * come from summarise() exactly as the screen shows them.
 */

import { ADDRESS_PARTS, DECLARATION, QUESTIONS, SECTIONS, roundLabel } from './interviewForm.js';
import { PARAMETERS, RATINGS, ratingLabel, summarise } from './interviewEval.js';

const esc = (v) =>
  String(v ?? '').replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&#39;', '"': '&quot;' }[c])
  );

const STYLE = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 1.4rem 1rem; background: #f6f6f4; color: #16181d;
    font: 13.5px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  .sheet { max-width: 46rem; margin: 0 auto; background: #fff; padding: 1.8rem 2rem;
           border: 1px solid #e3e3df; border-radius: 10px; }
  h1 { font-size: 1.1rem; margin: 0 0 0.15rem; letter-spacing: 0.06em; color: #15284b; }
  h2 { font-size: 0.86rem; margin: 1.4rem 0 0.4rem; text-transform: uppercase;
       letter-spacing: 0.06em; color: #15284b; border-bottom: 1px solid #e3e3df;
       padding-bottom: 0.25rem; }
  .muted { color: #6a6f7a; font-size: 0.82rem; }
  .head { border-bottom: 2px solid #15284b; padding-bottom: 0.7rem; margin-bottom: 0.4rem; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 0.3rem 0.2rem; border-bottom: 1px solid #ececea;
           vertical-align: top; }
  th { width: 38%; font-weight: 500; color: #6a6f7a; }
  .qa { margin: 0.5rem 0; }
  .qa .q { color: #6a6f7a; font-size: 0.82rem; }
  .qa .a { white-space: pre-wrap; }
  .pill { display: inline-block; border: 1px solid #c9ccd3; border-radius: 10px;
          padding: 0.02rem 0.45rem; margin: 0 0.2rem 0.2rem 0; font-size: 0.8rem; }
  .pill.on { background: #15284b; border-color: #15284b; color: #fff; }
  .declare { margin-top: 1.4rem; padding: 0.7rem 0.9rem; background: #f6f6f4;
             border-radius: 8px; font-size: 0.84rem; }
  .sign { display: flex; gap: 2rem; margin-top: 2rem; flex-wrap: wrap; }
  .sign div { flex: 1 1 12rem; border-top: 1px solid #16181d; padding-top: 0.35rem;
              font-size: 0.8rem; }
  .print { margin: 1rem auto 0; display: block; padding: 0.5rem 1rem; border: 1px solid #15284b;
           background: #15284b; color: #fff; border-radius: 6px; font: inherit; cursor: pointer; }
  @media print {
    body { background: #fff; padding: 0; font-size: 11.5pt; }
    .sheet { border: 0; border-radius: 0; max-width: none; padding: 0; }
    .print { display: none; }
    h2 { break-after: avoid; }
    .qa, tr { break-inside: avoid; }
  }`;

const page = (title, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>${STYLE}</style></head>
<body><div class="sheet">${body}</div>
<button class="print" onclick="window.print()">Print or save as PDF</button>
</body></html>`;

const header = (c) => `
  <div class="head">
    <h1>${esc(c.company || 'BOOKNFLY')}</h1>
    <p class="muted">${esc(c.title)}</p>
  </div>
  <table>
    <tr><th>Candidate</th><td><strong>${esc(c.candidate_name)}</strong>${
      c.ref_no ? ` · ${esc(c.ref_no)}` : ''
    }</td></tr>
    <tr><th>Position</th><td>${esc(c.position)}${c.department ? ` · ${esc(c.department)}` : ''}</td></tr>
    <tr><th>Interview</th><td>${esc(c.round_label)}${
      c.at ? ` · ${esc(String(c.at).replace('T', ' ').slice(0, 16))}` : ''
    }</td></tr>
    ${c.interviewer ? `<tr><th>Interviewer</th><td>${esc(c.interviewer)}</td></tr>` : ''}
  </table>`;

/** Blank rows are left OUT, not printed empty: a page of dashes reads as a form nobody filled in. */
const rows = (pairs) =>
  pairs
    .filter(([, v]) => String(v ?? '').trim())
    .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`)
    .join('');

export function interviewFormFileName(ctx = {}) {
  const bits = [ctx.candidate_name, 'Interview', `Round-${ctx.round ?? 1}`]
    .map((s) => String(s || '').trim().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, ''))
    .filter(Boolean);
  return `${bits.join('-') || 'Interview'}.html`;
}

/** The candidate's particulars, every section open, ready to print. */
export function interviewFormHtml({ context = {}, form = {}, candidate = {}, references = [] } = {}) {
  const head = header({
    ...context,
    title: 'Candidate particulars',
    candidate_name: candidate.name,
    ref_no: candidate.ref_no,
    round_label: roundLabel(context.round, context.round_name),
  });

  const body = SECTIONS.map((section) => {
    if (section.questions) {
      const asked = QUESTIONS.filter((q) => String(form.answers?.[q.key] || '').trim());
      if (!asked.length) return '';
      return `<h2>${esc(section.title)}</h2>${asked
        .map(
          (q, i) =>
            `<div class="qa"><div class="q">${i + 1}. ${esc(q.q)}</div><div class="a">${esc(
              form.answers[q.key]
            )}</div></div>`
        )
        .join('')}`;
    }
    if (section.address) {
      const block = (which, label) => {
        const parts = ADDRESS_PARTS.map((p) => candidate[`${which}_${p.key}`]).filter((v) =>
          String(v ?? '').trim()
        );
        return parts.length ? `<tr><th>${label}</th><td>${esc(parts.join(', '))}</td></tr>` : '';
      };
      const inner = block('current', 'Current address') + block('permanent', 'Permanent address');
      return inner ? `<h2>${esc(section.title)}</h2><table>${inner}</table>` : '';
    }
    if (section.references) {
      if (!references.length) return '';
      return `<h2>${esc(section.title)}</h2>${references
        .map(
          (r) =>
            `<table>${rows([
              ['Name', r.person_name],
              ['Type', r.ref_type],
              ['Company', r.organisation],
              ['Designation', r.designation],
              ['Contact', r.phone],
              ['Relationship', r.relationship],
              ['Remarks', r.remarks],
              ['Verification', r.verification],
            ])}</table>`
        )
        .join('')}`;
    }

    const pairs = (section.fields || []).map((f) => {
      if (f.key === 'languages') return [f.label, (form.languages || []).join(', ')];
      return [f.label, f.from ? candidate[f.from] : form[f.key]];
    });
    const inner = rows(pairs);
    return inner ? `<h2>${esc(section.title)}</h2><table>${inner}</table>` : '';
  }).join('');

  return page(`${candidate.name || 'Candidate'} — interview particulars`, `
    ${head}
    ${body || '<p class="muted">Nothing has been filled in yet.</p>'}
    <div class="declare">${esc(DECLARATION)}</div>
    <div class="sign">
      <div>Candidate's signature<br><span class="muted">${esc(candidate.name || '')}</span></div>
      <div>Taken by<br><span class="muted">${esc(form.filled_by || '')}</span></div>
    </div>`);
}

export function evaluationFileName(ctx = {}) {
  const bits = [ctx.candidate_name, 'Evaluation', `Round-${ctx.round ?? 1}`]
    .map((s) => String(s || '').trim().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, ''))
    .filter(Boolean);
  return `${bits.join('-') || 'Evaluation'}.html`;
}

/** The interviewer's evaluation, with the ratings drawn out as a table. */
export function evaluationHtml({ context = {}, evaluation = {}, candidate = {} } = {}) {
  const head = header({
    ...context,
    title: "Interviewer's evaluation",
    candidate_name: candidate.name,
    ref_no: candidate.ref_no,
    round_label: roundLabel(context.round, context.round_name),
  });

  const s = summarise(evaluation.ratings || {});
  const rated = PARAMETERS.filter((p) => evaluation.ratings?.[p.key]);

  const ratingTable = rated.length
    ? `<h2>Evaluation</h2><table>
        <tr><th>Parameter</th><td><strong>Rating</strong></td></tr>
        ${rated
          .map(
            (p) =>
              `<tr><th>${esc(p.label)}</th><td>${RATINGS.map(
                (r) =>
                  `<span class="pill${
                    Number(evaluation.ratings[p.key]) === r.value ? ' on' : ''
                  }">${r.value}</span>`
              ).join('')} ${esc(ratingLabel(evaluation.ratings[p.key]))}${
                evaluation.rating_remarks?.[p.key]
                  ? `<br><span class="muted">${esc(evaluation.rating_remarks[p.key])}</span>`
                  : ''
              }</td></tr>`
          )
          .join('')}
       </table>
       <p class="muted">
         ${s.total} of ${s.out_of}, average ${s.average} — ${s.rated} of ${s.of} rated.
         The score is a note beside the recommendation, not the decision.
       </p>`
    : '';

  const block = (title, pairs) => {
    const inner = rows(pairs);
    return inner ? `<h2>${esc(title)}</h2><table>${inner}</table>` : '';
  };

  return page(`${candidate.name || 'Candidate'} — evaluation`, `
    ${head}
    ${ratingTable}
    ${block('Practical knowledge', [
      ['Practical knowledge', evaluation.practical_level],
      ['Understands the job', evaluation.understands_role],
      ['Software knowledge', evaluation.software_knowledge],
      ['Can handle the work', evaluation.can_handle_work],
      ['Practical test needed', evaluation.practical_test_required],
      ['Practical test remarks', evaluation.practical_test_remarks],
    ])}
    ${block('Inspection', [
      ['Strengths', evaluation.strengths],
      ['Weaknesses / concerns', evaluation.weaknesses],
      ['Positive observations', evaluation.positive_observations],
      ['Negative observations', evaluation.negative_observations],
      ['Skill gap', evaluation.skill_gap],
      ['Training needed', evaluation.training_required],
      ['Training remarks', evaluation.training_remarks],
    ])}
    ${block('Salary and suitability', [
      ['Expected by candidate', candidate.expected_salary],
      ['Recommended salary', evaluation.recommended_salary],
      ['Negotiable', evaluation.negotiable],
      ['Suitable for this position', evaluation.suitable_for_role],
      ['Suitable for another position', evaluation.suitable_for_other],
      ['Suggested alternative', evaluation.alternative_position],
    ])}
    ${block('Recommendation', [
      ['Recommendation', evaluation.recommendation],
      ['What should happen next', evaluation.next_action],
      ['Next round', evaluation.next_round],
      ['Suggested interviewer', evaluation.next_interviewer],
      ['Overall remarks', evaluation.overall_remarks],
      ['Reason', evaluation.recommendation_reason],
      ['Additional comments', evaluation.additional_comments],
    ])}
    ${block('Where it got to', [
      ['Status', evaluation.status],
      ['Submitted by', evaluation.evaluated_by],
      ['Reviewed by', evaluation.reviewed_by],
      ['Decided by', evaluation.approved_by],
      ['Review remarks', evaluation.review_remarks],
    ])}
    <div class="sign">
      <div>Interviewer<br><span class="muted">${esc(evaluation.evaluated_by || '')}</span></div>
      <div>Approved by<br><span class="muted">${esc(evaluation.approved_by || '')}</span></div>
    </div>`);
}
