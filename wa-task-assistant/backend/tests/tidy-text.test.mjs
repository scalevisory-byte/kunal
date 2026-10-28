/*
 * "Sare task name and details apne aap proper likhe jaye - kuch small kuch
 * capital, spelling mistake nahi". Names, notes and steps are tidied as they
 * are written, by a rule narrow enough never to turn a name into a word.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-tidy-'));
process.env.EXTRACTION_MODE = 'manual';
delete process.env.DASHBOARD_PASSWORD;

const { tidyText, correctWord } = await import('../src/tidy-text.js');
const DB = await import('../src/db.js');
const P = await import('../src/progress.js');
const S = await import('../src/subtasks.js');
const E = await import('../src/task-events.js');
const { tidyExistingOnce } = await import('../src/tidy-existing.js');
const { createServer } = await import('../src/server.js');

describe('his typos are fixed', () => {
  const cases = {
    'need to file a case agaienst IBFW': 'Need to file a case against IBFW',
    'Icici Bank Od Rebewal and Upgrade for BNF PVT LTD': 'ICICI Bank OD Renewal and Upgrade for BNF PVT LTD',
    'Sena It Return 25-26': 'Sena IT Return 25-26',
    'Nidhi Regstartion': 'Nidhi Registration',
    'ALL DOCUMNET SUBMITED TO BANK': 'All Document Submitted to Bank',
    'BNF PVT LTD rent agreemner reviwe and confirm': 'BNF PVT LTD rent agreement review and confirm',
    'sunshine TDS retuin q2': 'Sunshine TDS return Q2',
    'Followup with HImansu rawat': 'Follow-up with Himansu rawat',
    'Airfix gst adress change by Tommorow': 'Airfix GST address change by Tomorrow',
  };
  for (const [typed, meant] of Object.entries(cases)) {
    it(typed, () => assert.equal(tidyText(typed), meant));
  }
});

describe('a name or a Hinglish word is never "corrected"', () => {
  it('names one letter from an English word stay names', () => {
    for (const w of ['Vikas', 'Daman', 'Astar', 'cibil', 'Sawant', 'Monika', 'Hasmukh', 'Rakesh', 'Kunal', 'Komal', 'Payal', 'Bhavesh']) {
      assert.equal(correctWord(w), null, w);
    }
  });
  it('Hinglish stays Hinglish', () => {
    for (const w of ['karna', 'dekhna', 'bhejna', 'milega', 'chahiye', 'wapas', 'paisa', 'hisab', 'udhar', 'rokda']) {
      assert.equal(correctWord(w), null, w);
    }
  });
  it('a real word is left alone, and a guess between two words is not made', () => {
    assert.equal(correctWord('advance'), null);
    assert.equal(correctWord('swant'), null, 'scant, slant, swan… too many to choose');
  });
  it('an email or a link at the start keeps its case and its spelling', () => {
    assert.equal(tidyText('abc@gmail.com documnet www.documnet.com'), 'abc@gmail.com document www.documnet.com');
  });
  it('a line starting with a number is not raised: 1st Floor, not 1St Floor', () => {
    assert.equal(tidyText('LAXMI TOURS AND TRAVELS\n1st Floor 8 Heta Complex'), 'Laxmi Tours and Travels\n1st Floor 8 Heta Complex');
  });
  it('null stays null, and a description keeps its lines', () => {
    assert.equal(tidyText(null), null);
    assert.equal(tidyText('line one documnet\n\nline two'), 'Line one document\n\nLine two');
  });
});

describe('where it applies', () => {
  it('a new task, its details, a note and a step are tidied as written', () => {
    const t = DB.createTask({ title: 'cosmos bank renewal documnet', description: 'all documnet submited' });
    assert.equal(t.title, 'Cosmos bank renewal document');
    assert.equal(DB.getTask(t.id).description, 'All document submitted');
    assert.equal(P.addUpdate(t.id, { body: 'networth certifcate sent to ca' }).body, 'Networth certificate sent to CA');
    assert.equal(S.addSubtask(t.id, 'check sep and oct billing statment').title, 'Check sep and oct billing statement');
  });

  it('a rename by hand is kept exactly as typed - he corrects the app, never the reverse', async () => {
    const t = DB.createTask({ title: 'Something' });
    const server = await new Promise((r) => { const s = createServer().listen(0, () => r(s)); });
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/tasks/${t.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'meet Astar re documnet' }),
      });
      assert.equal(res.status, 200);
      assert.equal(DB.getTask(t.id).title, 'meet Astar re documnet');
    } finally { server.close(); }
  });

  it('what is already on the list is tidied once, with the old name kept in its history', () => {
    const id = DB.db.prepare(`INSERT INTO tasks (title, status, source, origin) VALUES ('nidhi regstartion', 'open', 'manual', 'manual')`).run().lastInsertRowid;
    const first = tidyExistingOnce();
    assert.equal(first.ran, true);
    assert.equal(DB.getTask(id).title, 'Nidhi registration');
    const ev = E.eventsForTask(id).find((e) => e.kind === 'edited');
    assert.match(ev.detail, /renamed from "nidhi regstartion"/);
    DB.db.prepare(`UPDATE tasks SET title = 'nidhi regstartion' WHERE id = ?`).run(id);
    assert.equal(tidyExistingOnce().ran, false, 'once only: a name put back by hand stays');
    assert.equal(DB.getTask(id).title, 'nidhi regstartion');
  });
});
