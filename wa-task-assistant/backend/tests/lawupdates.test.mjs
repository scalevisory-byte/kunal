/**
 * Law updates as records rather than as a paragraph.
 *
 * The digest was one block of text, which is right for WhatsApp and useless for
 * a team: you cannot search it, mark one line of it reviewed, or find in
 * October the notification you half-remember from September. These cases hold
 * the three things that make the record trustworthy - the same notification
 * arriving twice is one row, an unconfirmed deadline stays marked unconfirmed,
 * and whether a source is official is read off its domain rather than asked of
 * the model.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-lawupd-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'manual';
process.env.TIMEZONE = 'Asia/Kolkata';

const { db } = await import('../src/db.js');
const U = await import('../src/law-updates.js');

const base = (over = {}) => ({
  day: '2026-09-10',
  category: 'GST Notifications',
  title: 'GSTR-3B late fee waived for FY 2024-25',
  summary: 'Late fee waived where the return is filed by 30 September 2026.',
  source_url: 'https://taxguru.in/gst/one.html',
  source_name: 'GST',
  priority: 'important',
  ...over,
});

beforeEach(() => db.prepare('DELETE FROM law_updates').run());

describe('where an update came from', () => {
  it('is read off the domain, not taken on trust', () => {
    assert.equal(U.classifySource('https://cbic.gov.in/x').kind, 'official');
    assert.equal(U.classifySource('https://www.rbi.org.in/y').authority, 'RBI');
    assert.equal(U.classifySource('https://taxguru.in/z', 'TaxGuru').kind, 'secondary');
    assert.equal(U.classifySource('not a url').kind, 'secondary', 'unreadable is never official');
  });

  it('is stored with the row, so the page can say which it is', () => {
    U.saveUpdate(base({ source_url: 'https://cbic.gov.in/circular-230.pdf' }));
    const [row] = U.listUpdates({}).updates;
    assert.equal(row.source_kind, 'official');
    assert.equal(row.source_authority, 'CBIC');
  });
});

describe('the same notification twice', () => {
  it('is one row when the document number matches', () => {
    const first = U.saveUpdate(base({ doc_number: 'Notification No. 17/2026-Central Tax' }));
    const second = U.saveUpdate(base({
      title: 'CBIC waives GSTR-3B late fee — Notification 17/2026',
      source_url: 'https://taxguru.in/gst/somewhere-else.html',
      doc_number: 'notification no. 17/2026-central tax',
    }));

    assert.equal(first.created, true);
    assert.equal(second.created, false, 'the same circular from two feeds is one circular');
    assert.equal(second.id, first.id);
    assert.equal(U.listUpdates({}).total, 1);
  });

  it('is one row when the same link arrives twice', () => {
    U.saveUpdate(base());
    U.saveUpdate(base({ title: 'A different headline entirely, same page' }));
    assert.equal(U.listUpdates({}).total, 1);
  });

  it('keeps both developments when one article reports two', () => {
    /*
     * A round-up naming two judgments is two updates. This used to be refused
     * by a unique index on the URL - one article, one row - and the second one
     * disappeared without a word.
     */
    const page = 'https://livelaw.in/weekly-round-up.html';
    U.saveUpdate(base({ module: 'legal', title: 'First case', case_number: 'CA 1/2026', source_url: page }));
    U.saveUpdate(base({ module: 'legal', title: 'Second case', case_number: 'CA 2/2026', source_url: page }));
    assert.equal(U.listUpdates({ module: 'legal' }).total, 2);
  });

  it('keeps two genuinely different updates apart', () => {
    U.saveUpdate(base({ doc_number: 'Notification 17/2026' }));
    U.saveUpdate(base({
      title: 'ITR-6 utility updated for AY 2026-27',
      category: 'Income Tax Updates',
      source_url: 'https://taxguru.in/income-tax/itr6.html',
      doc_number: 'Notification 18/2026',
    }));
    assert.equal(U.listUpdates({}).total, 2);
  });
});

describe('a deadline', () => {
  it('is marked unconfirmed unless the article stated it', () => {
    U.saveUpdate(base({ deadline: '2026-09-30', deadline_confirmed: false }));
    const [row] = U.listUpdates({}).updates;
    assert.equal(row.deadline, '2026-09-30');
    assert.equal(row.deadline_confirmed, 0, 'shown, but never asserted as fact');
  });

  it('is confirmed when it was', () => {
    U.saveUpdate(base({ deadline: '2026-09-30', deadline_confirmed: true }));
    assert.equal(U.listUpdates({}).updates[0].deadline_confirmed, 1);
  });

  it('cannot be confirmed without a date to confirm', () => {
    U.saveUpdate(base({ deadline: '', deadline_confirmed: true }));
    const [row] = U.listUpdates({}).updates;
    assert.equal(row.deadline, null);
    assert.equal(row.deadline_confirmed, 0);
  });
});

describe('finding one again', () => {
  beforeEach(() => {
    U.saveUpdate(base({ doc_number: 'Notification 17/2026', category: 'GST Notifications' }));
    U.saveUpdate(base({
      title: 'Section 87A rebate covers 111A STCG',
      category: 'Case Laws – Income Tax',
      summary: 'ITAT holds the rebate applies; the Finance Act 2025 restriction is prospective.',
      source_url: 'https://taxguru.in/income-tax/87a.html',
      priority: 'critical',
    }));
  });

  it('searches the number, the heading and the text', () => {
    assert.equal(U.listUpdates({ q: '17/2026' }).total, 1);
    assert.equal(U.listUpdates({ q: '111A' }).total, 1);
    assert.equal(U.listUpdates({ q: 'prospective' }).total, 1, 'the body is searched too');
    assert.equal(U.listUpdates({ q: 'nothing like this' }).total, 0);
  });

  it('filters by group, priority and category', () => {
    assert.equal(U.listUpdates({ group: 'gst' }).total, 1);
    assert.equal(U.listUpdates({ group: 'case_law' }).total, 1);
    assert.equal(U.listUpdates({ priority: 'critical' }).total, 1);
    assert.equal(U.listUpdates({ category: 'GST Notifications' }).total, 1);
  });

  it('puts the urgent ones first', () => {
    assert.equal(U.listUpdates({}).updates[0].priority, 'critical');
  });
});

describe('what the team does with one', () => {
  it('records who reviewed it and when, and clears both if undone', () => {
    const { id } = U.saveUpdate(base());
    const reviewed = U.markUpdate(id, { status: 'reviewed', reviewedBy: 'Dinesh' });
    assert.equal(reviewed.status, 'reviewed');
    assert.equal(reviewed.reviewed_by, 'Dinesh');
    assert.ok(reviewed.reviewed_at);

    const undone = U.markUpdate(id, { status: 'new' });
    assert.equal(undone.reviewed_by, null, 'a name against a state that is no longer true is worse than none');
    assert.equal(undone.reviewed_at, null);
  });

  it('keeps an archived update out of the list but not out of the database', () => {
    const { id } = U.saveUpdate(base());
    U.markUpdate(id, { status: 'archived' });
    assert.equal(U.listUpdates({}).total, 0, 'out of the way');
    assert.equal(U.listUpdates({ status: 'archived' }).total, 1, 'still there when asked for');
    assert.equal(U.updateCounts('tax').archived, 1);
  });

  it('stars one without reviewing it', () => {
    const { id } = U.saveUpdate(base());
    const starred = U.markUpdate(id, { important: true });
    assert.equal(starred.important, 1);
    assert.equal(starred.status, 'new', 'starring is not reviewing');
  });
});

describe('the message a client is sent', () => {
  it('carries the facts and names nobody', () => {
    const { id } = U.saveUpdate(base({
      deadline: '2026-09-30',
      deadline_confirmed: true,
      action_required: 'File GSTR-3B before the date to avoid the late fee.',
      applies_to: 'All GST registrants with a pending FY 2024-25 return',
      source_url: 'https://cbic.gov.in/circular.pdf',
    }));
    const update = U.getUpdate(id);

    const whatsapp = U.clientMessage(update, 'whatsapp');
    assert.match(whatsapp, /GSTR-3B/);
    assert.match(whatsapp, /30 September 2026/);
    assert.match(whatsapp, /cbic\.gov\.in/);
    assert.ok(!/client/i.test(whatsapp.replace('Client', '')), 'no client is named or mapped');

    const email = U.clientMessage(update, 'email');
    assert.match(email, /^Subject: /);
    assert.match(email, /Action required/);
  });

  it('says a deadline is unconfirmed when it is', () => {
    const { id } = U.saveUpdate(base({ deadline: '2026-09-30', deadline_confirmed: false }));
    assert.match(U.clientMessage(U.getUpdate(id), 'whatsapp'), /to be confirmed/);
  });
});

describe('the digest built from the rows', () => {
  it('groups by section, lifts the urgent ones and lists only confirmed deadlines', () => {
    U.saveUpdate(base({ priority: 'critical', title: 'Last date extended to 30 Sept', deadline: '2026-09-30', deadline_confirmed: true }));
    U.saveUpdate(base({
      title: 'ITR-6 utility updated', category: 'Income Tax Updates',
      source_url: 'https://taxguru.in/income-tax/itr6.html', priority: 'general',
    }));
    // In a different group, so GST is left with nothing of its own after the
    // critical one is lifted - which is the case the wording has to get right.
    U.saveUpdate(base({
      title: 'Guessed date', category: 'ROC / MCA Updates', deadline: '2026-10-31', deadline_confirmed: false,
      source_url: 'https://taxguru.in/mca/guess.html',
    }));

    const out = U.composeDigest('2026-09-10', { heading: '📋 *Law Update*', nothingNew: 'nothing' });
    assert.match(out.text, /🔴 \*Urgent\*/);
    assert.match(out.text, /Last date extended/);
    assert.match(out.text, /\*Income Tax \/ TDS:\*/);
    assert.match(out.text, /\*Case law:\* koi naya update nahi/, 'a section with nothing says so');
    assert.match(
      out.text, /\*GST:\* upar Urgent me diya hai/,
      'and a section whose update was lifted to Urgent does NOT claim to be empty'
    );
    assert.match(out.text, /📅 \*Deadlines\*/);
    assert.ok(!out.text.includes('31 October'), 'an unconfirmed deadline is not put in front of a client');
    assert.equal(out.count, 3);
  });

  it('says nothing new when the day has no rows', () => {
    const out = U.composeDigest('2026-09-09', { heading: 'h', nothingNew: 'Aaj koi naya notification nahi' });
    assert.match(out.text, /Aaj koi naya notification nahi/);
    assert.equal(out.count, 0);
  });
});

describe('which day an update belongs to', () => {
  it('counts on the user\'s calendar, not the server\'s', () => {
    /*
     * The machine runs on UTC and the work is in India. SQLite's
     * date('now','localtime') reads the machine, so between midnight and 05:30
     * IST every "today" count silently answered for yesterday - on the very
     * rows that had just been stored under today's Indian date.
     */
    const istToday = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());

    U.saveUpdate(base({ day: istToday, source_url: 'https://taxguru.in/today.html' }));
    assert.equal(U.updateCounts('tax').today, 1);
    assert.equal(U.listUpdates({ when: 'today' }).total, 1);
  });
});

describe('the two modules stay apart', () => {
  it('never shows a legal update in the tax list', () => {
    U.saveUpdate(base());
    U.saveUpdate(base({
      module: 'legal',
      title: 'Supreme Court on Section 69A',
      source_url: 'https://sci.gov.in/judgment.pdf',
    }));
    assert.equal(U.listUpdates({ module: 'tax' }).total, 1);
    assert.equal(U.listUpdates({ module: 'legal' }).total, 1);
  });
});
