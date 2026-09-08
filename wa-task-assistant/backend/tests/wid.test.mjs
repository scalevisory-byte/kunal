import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isLid, isRawId, phoneFromWid, scrubStoredIds } from '../src/wid.js';

describe('what is a name and what is an id', () => {
  it('a lid is an id, whatever it is wearing', () => {
    assert.equal(isLid('202383321759941@lid'), true);
    assert.equal(isLid('919909993565@c.us'), false);
    assert.equal(isRawId('202383321759941:33'), true);
    assert.equal(isRawId('202383321759941@lid'), true);
    assert.equal(isRawId('120363044@g.us'), true);
  });

  it('a phone number is not an id — you can ring it', () => {
    assert.equal(isRawId('+919909993565'), false);
    assert.equal(isRawId('919909993565'), false);
    assert.equal(isRawId('98250 12345'), false);
  });

  it('a name is never an id, however it is punctuated', () => {
    for (const name of ['Preeti Khandelwal', 'Vikas Travel | Pinetree', 'Mummy ❤️', 'HTC Accounts']) {
      assert.equal(isRawId(name), false, name);
    }
  });

  it('only a c.us wid yields a number', () => {
    assert.equal(phoneFromWid('919909993565@c.us'), '+919909993565');
    assert.equal(phoneFromWid('919909993565:33@c.us'), '+919909993565');
    assert.equal(phoneFromWid('202383321759941@lid'), null);
    assert.equal(phoneFromWid('120363044@g.us'), null);
    assert.equal(phoneFromWid(undefined), null);
  });
});

/** A stand-in for better-sqlite3, enough to run the sweep against. */
function fakeDb(tasks, messages) {
  const tables = { tasks, messages };
  return {
    prepare(sql) {
      const select = sql.match(/SELECT id, (\w+) AS value FROM (\w+)/);
      if (select) {
        const [, column, table] = select;
        return { all: () => tables[table]
          .filter((r) => r[column] !== null && r[column] !== undefined && r[column] !== '')
          .map((r) => ({ id: r.id, value: r[column] })) };
      }
      const update = sql.match(/UPDATE (\w+) SET (.+) WHERE id = \?/);
      const [, table, sets] = update;
      const columns = sets.split(',').map((s) => s.trim().split(' ')[0]);
      return { run: (id) => {
        const row = tables[table].find((r) => r.id === id);
        for (const c of columns) row[c] = null;
      } };
    },
  };
}

describe('taking the ids back off', () => {
  it('clears an id and leaves every real name alone', () => {
    const tasks = [
      { id: 1, contact: '202383321759941:33', assigned_to: null, requested_by: null, assigned_to_wid: null },
      { id: 2, contact: 'Preeti Khandelwal', assigned_to: '206218677239001', requested_by: null, assigned_to_wid: 'x@lid' },
      { id: 3, contact: '+919909993565', assigned_to: 'Uma', requested_by: 'Sahil Khalasi', assigned_to_wid: null },
    ];
    const messages = [
      { id: 10, contact_name: '202383321759941:33' },
      { id: 11, contact_name: 'Meera' },
    ];
    const cleared = scrubStoredIds(fakeDb(tasks, messages));

    assert.deepEqual(cleared, { contact: 1, assigned_to: 1, requested_by: 0, messages: 1 });
    assert.equal(tasks[0].contact, null, 'the lid went');
    assert.equal(tasks[1].contact, 'Preeti Khandelwal', 'the name stayed');
    assert.equal(tasks[1].assigned_to, null, 'the id assignee went');
    assert.equal(tasks[1].assigned_to_wid, null, 'and so did the wid that went with it');
    assert.equal(tasks[2].contact, '+919909993565', 'a number you can ring stayed');
    assert.equal(tasks[2].assigned_to, 'Uma');
    assert.equal(tasks[2].requested_by, 'Sahil Khalasi');
    assert.equal(messages[0].contact_name, null);
    assert.equal(messages[1].contact_name, 'Meera');
  });

  it('is safe to run twice — the second pass finds nothing', () => {
    const tasks = [{ id: 1, contact: '202383321759941:33', assigned_to: null, requested_by: null, assigned_to_wid: null }];
    const messages = [];
    scrubStoredIds(fakeDb(tasks, messages));
    const again = scrubStoredIds(fakeDb(tasks, messages));
    assert.deepEqual(again, { contact: 0, assigned_to: 0, requested_by: 0, messages: 0 });
  });
});
