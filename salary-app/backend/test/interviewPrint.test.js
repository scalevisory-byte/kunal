import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluationHtml,
  interviewFormFileName,
  interviewFormHtml,
} from '../../shared/interviewPrint.js';

const context = {
  company: 'BOOKNFLY PVT LTD', position: 'Travel Consultant', department: 'Operations',
  round: 1, round_name: 'HR Round', at: '2026-11-20T11:00', interviewer: 'Priya Nair',
};
const candidate = {
  name: 'Amit Shah', ref_no: 'CAN-003', education: 'B.Com',
  current_city: 'Surat', current_pin: '395009', expected_salary: '26000',
};

test('the printed form carries every section, not just the open ones', () => {
  /*
   * The whole reason this module exists. The form on screen is collapsible
   * sections, so window.print() printed the two that happened to be open and
   * silently dropped the rest - which is what Dinesh found when he tried to
   * hand one over.
   */
  const html = interviewFormHtml({
    context,
    candidate,
    form: {
      college: 'MS University', languages: ['Gujarati', 'Hindi'], english_level: 'Good',
      answers: { about: 'Two years in ticketing.' },
    },
    references: [{ person_name: 'R Patel', phone: '9999999999' }],
  });

  for (const want of ['Educational qualification', 'Language and communication',
    'Interview questions', 'Address', 'References']) {
    assert.ok(html.includes(want), `the printed form is missing "${want}"`);
  }
  assert.match(html, /Gujarati, Hindi/);
  assert.match(html, /Two years in ticketing/);
  assert.match(html, /I confirm that the details/);
});

test('a blank field is left out, not printed as an empty row', () => {
  const html = interviewFormHtml({
    context,
    candidate: { name: 'Blank Person' },
    form: { college: 'Somewhere' },
  });

  /*
   * A page of dashes reads as a form nobody filled in, which is a different
   * thing from a short form. Nothing empty is printed at all - and a section
   * with nothing in it does not print its heading either.
   */
  assert.ok(!/<td><\/td>/.test(html), 'an empty row was printed');
  assert.match(html, /Educational qualification/);
  assert.ok(!/Computer and technical knowledge/.test(html), 'an empty section printed its heading');
  assert.ok(!/Interview questions/.test(html));

  // Only when there is genuinely nothing does it say so.
  const empty = interviewFormHtml({ context, candidate: {}, form: {} });
  assert.match(empty, /Nothing has been filled in yet/);
});

test('ONE PRINTED FORM HOLDS ONE PERSON, and loads nothing', () => {
  const html = interviewFormHtml({
    context, candidate, form: { college: 'MS University' },
  });
  assert.match(html, /Amit Shah/);
  assert.ok(!/https?:\/\//.test(html), 'the printed form carries a URL');
  assert.ok(!/<img/.test(html), 'the printed form carries an image');
  assert.ok(!/\ssrc=/.test(html));
  assert.ok(!/\shref=/.test(html));
  const handlers = html.match(/\son\w+="[^"]*"/g) || [];
  assert.deepEqual(handlers, [' onclick="window.print()"']);
});

test('a script in a name is escaped on the printed copy', () => {
  const html = interviewFormHtml({
    context, candidate: { name: '<script>alert(1)</script>' }, form: { college: 'X' },
  });
  assert.ok(!/<script>alert/.test(html));
  assert.match(html, /&lt;script&gt;/);
});

test('the printed evaluation names the evaluator and states the score as a note', () => {
  const html = evaluationHtml({
    context,
    candidate,
    evaluation: {
      evaluated_by: 'Priya Nair', approved_by: 'Dinesh Parmar', status: 'approved',
      ratings: { communication: 5, attitude: 4 },
      rating_remarks: { communication: 'Clear and quick' },
      recommendation: 'Recommended', next_action: 'Final Selection',
    },
  });
  assert.match(html, /Priya Nair/);
  assert.match(html, /Clear and quick/);
  assert.match(html, /9 of 10, average 4\.5/);
  // Never the thing that decided it.
  assert.match(html, /a note beside the recommendation, not the decision/);
  // Only what was rated is printed - eight unrated parameters are not eight
  // zeros.
  assert.ok(!/Problem-solving/.test(html));
});

test('the file is named after the person and the round', () => {
  assert.equal(
    interviewFormFileName({ candidate_name: 'Amit Shah', round: 2 }),
    'Amit-Shah-Interview-Round-2.html'
  );
});
