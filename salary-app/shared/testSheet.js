/**
 * The answer sheet - what they were asked, what they chose, what was right.
 *
 * Dinesh: *"Test ka result show ho / And uski puri answer sheet bhi show ho"*.
 * A percentage on its own does not tell anybody whether somebody got the
 * accounts questions right and the English ones wrong, which is the thing that
 * actually decides whether to call them in.
 *
 * `answerRows` is the whole of it, and BOTH the screen and the printed pack
 * build from it. Two renderers working the marking out separately is how a
 * screen and a printout come to disagree about whether somebody passed.
 *
 * It ASSEMBLES, it does not mark. The marking happened once, on submission,
 * from the questions as they were drawn for that person; this reads `drawn`
 * and `answers` back and lays them out.
 *
 * THIS IS OFFICE-ONLY. The candidate's own copy of a question is built by
 * forCandidate() with no `correct` on it; everything here is the other side of
 * that line and must never be sent to a candidate's screen.
 */

import { OPTION_KEYS } from './questionBank.js';
import { esc, page } from './interviewPrint.js';

/**
 * One row per question, in the order it was put to them.
 *
 * A skipped question is `given: null` - NOT an empty string and not a wrong
 * answer. "Did not answer" and "answered wrongly" are different facts about a
 * candidate, and a sheet that shows them the same way hides the one worth
 * knowing: somebody who ran out of time looks identical to somebody who
 * guessed badly.
 */
export function answerRows(attempt = {}) {
  const drawn = attempt.drawn || [];
  const answers = attempt.answers || {};

  return drawn.map((q, i) => {
    const raw = answers[q.id] ?? answers[String(q.id)] ?? '';
    const given = String(raw || '').trim().toLowerCase() || null;
    const correct = String(q.correct || '').trim().toLowerCase();
    const options = (q.order || OPTION_KEYS)
      .filter((k) => String(q[`option_${k}`] || '').trim())
      .map((k) => ({
        key: k,
        text: q[`option_${k}`],
        chosen: given === k,
        correct: correct === k,
      }));

    return {
      n: i + 1,
      id: q.id,
      category: q.category || '',
      question: q.question,
      options,
      given,
      correct,
      given_text: given ? q[`option_${given}`] : null,
      correct_text: q[`option_${correct}`] ?? null,
      verdict: !given ? 'skipped' : given === correct ? 'right' : 'wrong',
      marks: Number(q.marks ?? 1) || 1,
    };
  });
}

/** How the sheet reads at the top, from what was stored at submission. */
export function sheetSummary(attempt = {}) {
  const rows = answerRows(attempt);
  const byCategory = [];
  for (const r of rows) {
    let group = byCategory.find((g) => g.category === r.category);
    if (!group) {
      group = { category: r.category, asked: 0, right: 0, wrong: 0, skipped: 0 };
      byCategory.push(group);
    }
    group.asked += 1;
    group[r.verdict] += 1;
  }
  return {
    asked: rows.length,
    right: rows.filter((r) => r.verdict === 'right').length,
    wrong: rows.filter((r) => r.verdict === 'wrong').length,
    skipped: rows.filter((r) => r.verdict === 'skipped').length,
    by_category: byCategory,
  };
}

/** How long they actually took, in minutes, or null when it cannot be known. */
export function minutesTaken(attempt = {}) {
  if (!attempt.started_at || !attempt.submitted_at) return null;
  const from = Date.parse(attempt.started_at);
  const to = Date.parse(attempt.submitted_at);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null;
  return Math.round((to - from) / 60000);
}

export function answerSheetFileName({ candidate_name, paper_name } = {}) {
  const bits = [candidate_name, paper_name, 'answers']
    .map((s) => String(s || '').trim().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, ''))
    .filter(Boolean);
  return `${bits.join('-') || 'Answer-sheet'}.html`;
}

/* ---------------- the printed sheet ---------------- */

const VERDICT = { right: '✓', wrong: '✗', skipped: '–' };

/** The sheet as a BLOCK, so the whole-candidate pack can embed it. */
export function answerSheetBody({ attempt = {}, candidate = {}, paper = {} } = {}) {
  const rows = answerRows(attempt);
  const sum = sheetSummary(attempt);
  const took = minutesTaken(attempt);

  if (!attempt.submitted_at) {
    return `<h2>Written test</h2>
      <p class="muted">${esc(paper.name || 'Test')} — sent${
        attempt.assigned_at ? ` on ${esc(String(attempt.assigned_at).slice(0, 10))}` : ''
      }, not sat yet. There is nothing to show until they send it.</p>`;
  }

  const head = `
    <table>
      <tr><th>Paper</th><td>${esc(paper.name || '')}</td></tr>
      <tr><th>Taken</th><td>${esc(String(attempt.submitted_at).replace('T', ' ').slice(0, 16))}${
        took === null ? '' : ` · ${took} min of ${esc(attempt.duration_minutes)}`
      }${attempt.auto_submitted ? ' · time ran out' : ''}</td></tr>
      <tr><th>Score</th><td><strong>${esc(attempt.score)} of ${esc(attempt.max_score)} · ${esc(
        attempt.percentage
      )}%</strong> — ${esc(sum.right)} right, ${esc(sum.wrong)} wrong, ${esc(
        sum.skipped
      )} not answered${
        attempt.pass_percent == null
          ? ''
          : ` · pass mark ${esc(attempt.pass_percent)}% · ${attempt.passed ? 'above it' : 'below it'}`
      }</td></tr>
      ${/*
           An attempt drawn before the category was stored has one unnamed
           group. A blank row saying "14 of 20 right" tells nobody anything,
           so it is left out rather than printed empty.
         */ ''}
      ${sum.by_category
        .filter((g) => g.category)
        .map(
          (g) =>
            `<tr><th>${esc(g.category)}</th><td>${esc(g.right)} of ${esc(g.asked)} right${
              g.skipped ? `, ${esc(g.skipped)} not answered` : ''
            }</td></tr>`
        )
        .join('')}
    </table>`;

  const sheet = rows
    .map(
      (r) => `
      <div class="qa ans ans-${r.verdict}">
        <div class="q">${r.n}. ${esc(r.question)}<span class="tag">${VERDICT[r.verdict]} ${esc(
          r.verdict === 'skipped' ? 'not answered' : r.verdict
        )}</span></div>
        ${r.options
          .map(
            (o) =>
              `<div class="opt${o.correct ? ' is-correct' : ''}${o.chosen ? ' is-chosen' : ''}">${
                o.chosen ? '●' : '○'
              } ${esc(o.text)}${o.correct ? ' <span class="muted">— the right answer</span>' : ''}</div>`
          )
          .join('')}
      </div>`
    )
    .join('');

  return `<h2>Written test — answer sheet</h2>${head}${sheet}`;
}

/** The answer sheet as a document of its own. */
export function answerSheetHtml({ attempt = {}, candidate = {}, paper = {}, company } = {}) {
  return page(
    `${candidate.name || 'Candidate'} — answer sheet`,
    `<div class="head">
       <h1>${esc(company || 'BOOKNFLY')}</h1>
       <p class="muted">Written test — answer sheet</p>
     </div>
     <table>
       <tr><th>Candidate</th><td><strong>${esc(candidate.name || '')}</strong>${
         candidate.ref_no ? ` · ${esc(candidate.ref_no)}` : ''
       }</td></tr>
     </table>
     ${answerSheetBody({ attempt, candidate, paper })}`
  );
}

/* ---------------- how it was sat ---------------- */

/**
 * The things worth noticing about HOW a paper was taken, not what it scored.
 *
 * Modelled on his ZYNTA results screen, which shows "avg 10s/Q", "2x left
 * the test", "1 question unanswered / timed out", "11 answers under 2s" and,
 * when there is nothing to say, "Clean".
 *
 * EVERY ONE OF THESE IS A FLAG, NEVER A VERDICT. A fast answer can be a known
 * answer; somebody's phone rings; a question times out because it was hard.
 * The office reads them beside the score and decides. Nothing here fails
 * anybody, and nothing here is shown to the candidate.
 */
export const FAST_ANSWER_SECONDS = 2;

/**
 * The integrity flags, to the rules Dinesh's own ZYNTA module uses.
 *
 * He sent its build spec, so these are not invented: each line below is one
 * of its rules, worded the way his admin screen words it. Keeping them
 * identical matters because he reads both screens and a flag that means
 * something different in each is worse than no flag.
 *
 * AND THE HONEST LIMIT, which his spec states and this repeats: these catch
 * tab-switching, copy and paste, impossible speed and timeouts. They cannot
 * catch a second phone or another person in the room. They are a reason to
 * ring somebody back or re-test them in the office, never proof of anything.
 */
export function integrity(attempt = {}) {
  const rows = answerRows(attempt);
  const times = attempt.times || {};
  const total = rows.length;
  const spent = rows.map((r) => Number(times[r.id] ?? times[String(r.id)])).filter(Number.isFinite);

  const avg = spent.length ? Math.round(spent.reduce((a, b) => a + b, 0) / spent.length) : null;
  const fast = rows.filter((r) => {
    const t = Number(times[r.id] ?? times[String(r.id)]);
    return r.verdict !== 'skipped' && Number.isFinite(t) && t <= FAST_ANSWER_SECONDS;
  }).length;
  const skipped = rows.filter((r) => r.verdict === 'skipped').length;

  const away = Number(attempt.left_count) || 0;
  const awaySeconds = Number(attempt.away_seconds) || 0;
  const pasteTries = Number(attempt.paste_tries) || 0;
  const took = minutesTaken(attempt);
  const seconds = took === null ? null : took * 60;

  const flags = [];
  if (away > 0) {
    flags.push(`${away}× left the test${awaySeconds ? ` (${awaySeconds}s away)` : ''}`);
  }
  if (pasteTries > 0) flags.push(`copy/paste attempts: ${pasteTries}`);
  /*
   * HALF the paper, not one question. His rule, and it is the right one: a
   * single quick answer is somebody who knew it, and flagging that would put
   * a mark on nearly every honest paper until nobody read the flags at all.
   */
  if (total && fast >= Math.ceil(total / 2)) {
    flags.push(`${fast} answers under ${FAST_ANSWER_SECONDS}s`);
  }
  /* Only where there is no per-question clock — with one, the pace is set. */
  if (!attempt.seconds_per_question && seconds !== null && total && seconds < total * 5) {
    flags.push(`finished very fast (${seconds}s)`);
  }
  if (skipped > 0) {
    flags.push(`${skipped} question${skipped === 1 ? '' : 's'} unanswered / timed out`);
  }
  if (attempt.auto_submitted) flags.push('auto-submitted (time over)');

  return {
    avg_seconds: avg,
    fast,
    skipped,
    left_count: away,
    away_seconds: awaySeconds,
    paste_tries: pasteTries,
    flags,
    /* "Clean" only when the times are actually known — an attempt sat before
     * any of this was recorded has nothing to be clean about, and saying so
     * beats a reassuring tick nobody earned. */
    known: spent.length > 0,
  };
}
