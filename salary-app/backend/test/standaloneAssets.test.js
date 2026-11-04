import test from 'node:test';
import assert from 'node:assert/strict';

/*
 * The asset register in the single-file build.
 *
 * It was switched off with the same sentence People was - records have to
 * outlive one browser - and the same answer applies: this file already holds
 * 115 people and a year of payslips. One thing genuinely needs a server, a
 * PHOTOGRAPH, because a file cannot live inside an HTML page.
 *
 * These pin the rules that lose money or lose a record if the two halves
 * differ: a code is never reused, "not checked" is not "missing", anything
 * ever issued is written off rather than deleted, and a handover is never
 * overwritten.
 */

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  };
}

let nonce = 0;
async function freshStore() {
  globalThis.localStorage = fakeStorage();
  const mod = await import(`../../frontend/src/localStore.js?a=${nonce++}`);
  const api = (method, path, body) => mod.handle(method, path, body);
  const company = await api('POST', '/companies', { name: 'BOOKNFLY PRIVATE LIMITED' });
  const amit = await api('POST', '/employees', {
    company_id: company.id, name: 'Amit Shah', monthly_salary: 24000,
  });
  const riya = await api('POST', '/employees', {
    company_id: company.id, name: 'Riya Pal', monthly_salary: 21000,
  });
  return { api, mod, company, amit, riya };
}

/*
 * A serial per asset. They used to share one, which the duplicate check now
 * (rightly) stops - a serial already on the register is a question.
 */
let serialNo = 0;
const addLaptop = (api, company, extra = {}) =>
  api('POST', '/people/assets', {
    company_id: company.id,
    kind: 'Laptop',
    label: 'Dell Latitude',
    identifier: `SN-${44218 + serialNo++}`,
    purchase_cost: 54000,
    purchase_date: '2025-06-10',
    ...extra,
  });

test('an asset gets a code, and a typed one is kept', async () => {
  const { api, company } = await freshStore();
  const made = await addLaptop(api, company);
  assert.match(made.code, /^[A-Z]+-LAP-\d{3}$/, `unexpected code ${made.code}`);
  assert.equal(made.company_name, 'BOOKNFLY PRIVATE LIMITED');
  assert.equal(made.purchase_cost, 54000);

  // An office with stickers on the laptops already keeps them.
  const typed = await addLaptop(api, company, { code: 'bpl-lap-099', label: 'HP ProBook' });
  assert.equal(typed.code, 'BPL-LAP-099');
  await assert.rejects(
    () => addLaptop(api, company, { code: 'BPL-LAP-099', label: 'Another' }),
    /already on something else/
  );
});

test('the series counts up, and only an asset with NO history can be deleted', async () => {
  const { api, company } = await freshStore();
  const first = await addLaptop(api, company);
  const second = await addLaptop(api, company, { label: 'Second' });
  const n = (code) => Number(String(code).split('-').pop());
  assert.equal(n(second.code), n(first.code) + 1, 'the series reads the highest used, not a count');

  /*
   * Deleting is only for an asset nothing has ever happened to - a typo
   * typed in a minute ago. Its code was never on a sticker or a bill, so the
   * next one taking that number loses nothing.
   *
   * The checks below used to be ONE check, on handovers, so an asset that had
   * been serviced but never issued could be deleted - taking a bill that
   * carries its code with it. Both halves check all three now.
   */
  await api('DELETE', `/people/assets/${second.id}`);

  const serviced = await addLaptop(api, company, { label: 'Serviced' });
  await api('POST', `/people/assets/${serviced.id}/services`, { serviced_on: '2026-02-01', cost: 500 });
  await assert.rejects(() => api('DELETE', `/people/assets/${serviced.id}`), /service on its record/);

  const checked = await addLaptop(api, company, { label: 'Counted' });
  await api('POST', `/people/assets/${checked.id}/verify`, { round: 'Nov 2026' });
  await assert.rejects(() => api('DELETE', `/people/assets/${checked.id}`), /stock take/);
});

test('issuing, passing on and returning keeps every handover', async () => {
  const { api, company, amit, riya } = await freshStore();
  const asset = await addLaptop(api, company);

  await api('POST', `/people/assets/${asset.id}/issue`, {
    employee_id: amit.id, issued_on: '2026-01-05', condition: 'new', by: 'Dinesh',
  });
  let now = (await api('GET', '/people/assets')).assets.find((a) => a.id === asset.id);
  assert.equal(now.employee_name, 'Amit Shah');
  assert.equal(now.returned_on, null);

  // Passed straight to somebody else: the first handover CLOSES, it is not lost.
  await api('POST', `/people/assets/${asset.id}/issue`, {
    employee_id: riya.id, issued_on: '2026-04-01', by: 'Dinesh',
  });
  const { handovers } = await api('GET', `/people/assets/handovers?asset_id=${asset.id}`);
  assert.equal(handovers.length, 2);
  const amits = handovers.find((h) => h.employee_name === 'Amit Shah');
  assert.equal(amits.returned_on, '2026-04-01');
  assert.equal(amits.condition_in, 'passed on directly');
  // The slip carries the serial, which is what identifies the actual object.
  assert.match(amits.identifier, /^SN-\d+$/);

  await api('POST', `/people/assets/${asset.id}/return`, { returned_on: '2026-06-30', condition: 'scratched lid' });
  now = (await api('GET', '/people/assets')).assets.find((a) => a.id === asset.id);
  assert.equal(now.returned_on, '2026-06-30');
  // Nobody against it means IN THE OFFICE, not lost.
  const open = await api('GET', '/people/assets/handovers?open=true');
  assert.equal(open.handovers.length, 0);
});

test('a stock take says what was NOT CHECKED, separately from what is missing', async () => {
  const { api, company } = await freshStore();
  const a = await addLaptop(api, company, { label: 'One' });
  const b = await addLaptop(api, company, { label: 'Two' });
  await addLaptop(api, company, { label: 'Three' }); // never looked at

  await api('POST', `/people/assets/${a.id}/verify`, { round: 'Nov 2026', found: true, by: 'Dinesh' });
  await api('POST', `/people/assets/${b.id}/verify`, { round: 'Nov 2026', found: false, note: 'not on the desk' });

  const round = await api('GET', '/people/rounds/Nov%202026');
  assert.equal(round.total, 3);
  assert.equal(round.found, 1);
  assert.equal(round.missing, 1);
  assert.equal(round.not_checked, 1, 'an asset nobody looked at is not a loss');
  assert.equal(round.missing_value, 54000);

  // Checking it again REPLACES the verdict rather than leaving two that disagree.
  await api('POST', `/people/assets/${b.id}/verify`, { round: 'Nov 2026', found: true, note: 'in the drawer' });
  const after = await api('GET', '/people/rounds/Nov%202026');
  assert.equal(after.found, 2);
  assert.equal(after.missing, 0);

  const { rounds } = await api('GET', '/people/rounds');
  assert.equal(rounds.length, 1);
  assert.equal(rounds[0].checked, 2);
});

test('a round needs a name, because a verdict with no round means nothing', async () => {
  const { api, company } = await freshStore();
  const a = await addLaptop(api, company);
  await assert.rejects(() => api('POST', `/people/assets/${a.id}/verify`, {}), /which round/);
});

test('anything ever issued is written off, never deleted', async () => {
  const { api, company, amit } = await freshStore();
  const asset = await addLaptop(api, company);
  await api('POST', `/people/assets/${asset.id}/issue`, { employee_id: amit.id });

  await assert.rejects(() => api('DELETE', `/people/assets/${asset.id}`), /write it off instead/);
  await assert.rejects(() => api('POST', `/people/assets/${asset.id}/write-off`, {}), /say why/);

  const gone = await api('POST', `/people/assets/${asset.id}/write-off`, {
    why: 'screen cracked beyond repair', on: '2026-11-01', by: 'Dinesh',
  });
  assert.equal(gone.written_off_on, '2026-11-01');
  // Brought back first, so nobody is left holding something that no longer exists.
  assert.equal(gone.returned_on, '2026-11-01');
  // It keeps its row and its code - an old bill and a signed slip still refer to it.
  assert.ok(gone.code);

  const onRegister = await api('GET', '/people/assets');
  assert.equal(onRegister.assets.length, 0, 'off the register');
  const all = await api('GET', '/people/assets?written_off=true');
  assert.equal(all.assets.length, 1, 'but still on file');

  await assert.rejects(
    () => api('POST', `/people/assets/${asset.id}/issue`, { employee_id: amit.id }),
    /written off/
  );
});

test('two identical repairs on one day ASK rather than refuse', async () => {
  const { api, company } = await freshStore();
  const asset = await addLaptop(api, company);
  await api('POST', `/people/assets/${asset.id}/services`, {
    serviced_on: '2026-10-02', kind: 'Repair', work: 'battery', cost: 3500,
  });

  // Same asset, same day, same amount: a question, carrying the row it resembles.
  await assert.rejects(
    () => api('POST', `/people/assets/${asset.id}/services`, { serviced_on: '2026-10-02', cost: 3500 }),
    (err) => {
      assert.equal(err.status, 409);
      assert.match(err.message, /Add it anyway/);
      assert.ok(err.duplicate, 'it hands back what it resembles, so the screen can ask');
      return true;
    }
  );
  // And goes through when somebody says yes.
  const second = await api('POST', `/people/assets/${asset.id}/services`, {
    serviced_on: '2026-10-02', cost: 3500, force: true,
  });
  assert.equal(second.cost, 3500);

  const { services } = await api('GET', `/people/maintenance/services?asset_id=${asset.id}`);
  assert.equal(services.length, 2);
  // The SERVICE's kind, not the asset's - "Laptop" where it means "Repair"
  // is the bug the server was bitten by.
  assert.equal(services.find((s) => s.work === 'battery').kind, 'Repair');
  assert.equal(services[0].asset_kind, 'Laptop');
});

test('a service date is never computed, and free warranty work still counts', async () => {
  const { api, company } = await freshStore();
  const asset = await addLaptop(api, company);
  const free = await api('POST', `/people/assets/${asset.id}/services`, {
    serviced_on: '2026-03-01', kind: 'Service', cost: 0, under_warranty: true,
  });
  assert.equal(free.under_warranty, true, 'a boolean, the same shape the list gives');
  assert.equal(free.next_service_on, null, 'no date means not scheduled, never overdue');

  const { services } = await api('GET', `/people/maintenance/services?asset_id=${asset.id}`);
  assert.equal(services[0].under_warranty, true, 'and the POST echo and the list agree');
});

test('the timeline reads in date order, from the rows that already hold it', async () => {
  const { api, company, amit } = await freshStore();
  const asset = await addLaptop(api, company);
  await api('POST', `/people/assets/${asset.id}/issue`, { employee_id: amit.id, issued_on: '2026-01-05' });
  await api('POST', `/people/assets/${asset.id}/services`, { serviced_on: '2026-08-01', kind: 'Repair', cost: 1200 });
  await api('POST', `/people/assets/${asset.id}/return`, { returned_on: '2026-09-30' });

  const { events } = await api('GET', `/people/assets/${asset.id}/history`);
  const dates = events.map((e) => e.on);
  assert.deepEqual([...dates].sort(), dates, 'in date order');
  assert.deepEqual(events.map((e) => e.what), ['Bought', 'Issued', 'Repair', 'Returned']);
  assert.equal(events[1].who, 'Amit Shah');
});

test('scanning a code finds it, and an unknown code says so', async () => {
  const { api, company } = await freshStore();
  const made = await addLaptop(api, company, { code: 'BPL-LAP-014' });
  const found = await api('GET', '/people/assets/by-code/bpl-lap-014');
  assert.equal(found.id, made.id);
  await assert.rejects(() => api('GET', '/people/assets/by-code/BPL-LAP-999'), /nothing on the register/);
});

test('a handover slip lists only what somebody still has', async () => {
  const { api, company, amit } = await freshStore();
  const keep = await addLaptop(api, company, { label: 'Still out' });
  const back = await addLaptop(api, company, { label: 'Given back' });
  await api('POST', `/people/assets/${keep.id}/issue`, { employee_id: amit.id });
  await api('POST', `/people/assets/${back.id}/issue`, { employee_id: amit.id });
  await api('POST', `/people/assets/${back.id}/return`, {});

  const slip = await api('GET', `/people/assets/slip/${amit.id}`);
  assert.equal(slip.employee, 'Amit Shah');
  assert.equal(slip.items.length, 1, 'only what they still have');
  assert.match(slip.items[0].what, /Still out/);
  assert.match(slip.items[0].serial, /^SN-\d+$/);
  // Said on the slip itself, because the point of signing is agreeing to it.
  assert.match(slip.undertaking, /I have received/);
});

test('a photograph refuses honestly instead of half-working', async () => {
  const { api, company } = await freshStore();
  const asset = await addLaptop(api, company);
  // A list of none, which is what the screen already knows how to read.
  assert.deepEqual(await api('GET', `/people/assets/${asset.id}/photos`), { photos: [] });
  await assert.rejects(
    () => api('POST', `/people/assets/${asset.id}/photos`, {}),
    /server version/
  );
});

test('the four downloads come out as CSV', async () => {
  const { api, mod, company, amit } = await freshStore();
  const asset = await addLaptop(api, company);
  await api('POST', `/people/assets/${asset.id}/issue`, { employee_id: amit.id });
  await api('POST', `/people/assets/${asset.id}/services`, { serviced_on: '2026-08-01', cost: 1200 });

  for (const [path, must] of [
    ['/people/assets/register.csv', /Dell Latitude/],
    ['/people/assets/handovers.csv', /Amit Shah/],
    ['/people/maintenance/services.csv', /1200/],
    ['/people/maintenance/ownership.csv', /Dell Latitude/],
  ]) {
    const text = await (await mod.file(path)).text();
    assert.match(text, must, `${path} did not carry what it should`);
  }
});

test('the register and what it costs to keep survive a reload', async () => {
  globalThis.localStorage = fakeStorage();
  const first = await import(`../../frontend/src/localStore.js?a=reload-x${nonce++}`);
  const company = await first.handle('POST', '/companies', { name: 'BOOKNFLY' });
  const made = await first.handle('POST', '/people/assets', {
    company_id: company.id, kind: 'Mobile', label: 'Redmi', purchase_cost: 12000,
  });
  await first.handle('POST', `/people/assets/${made.id}/services`, { serviced_on: '2026-05-01', cost: 900 });

  const second = await import(`../../frontend/src/localStore.js?a=reload-y${nonce++}`);
  const { assets, totals } = await second.handle('GET', '/people/assets');
  assert.equal(assets.length, 1);
  assert.equal(assets[0].code, made.code);
  assert.ok(totals);
  const { services } = await second.handle('GET', '/people/maintenance/services');
  assert.equal(services.length, 1);
});

/* ---------------- the complete-module work ---------------- */

test('a serial already on the register ASKS rather than refuses', async () => {
  const { api, company } = await freshStore();
  const first = await api('POST', '/people/assets', {
    company_id: company.id, kind: 'Laptop', label: 'One', identifier: 'SN-SAME',
  });
  await assert.rejects(
    () => api('POST', '/people/assets', {
      company_id: company.id, kind: 'Laptop', label: 'Two', identifier: 'SN-SAME',
    }),
    (err) => {
      assert.equal(err.status, 409);
      assert.match(err.message, /Add it anyway/);
      assert.equal(err.duplicate.id, first.id, 'it hands back what it clashes with');
      return true;
    }
  );
  // Two boxes really do ship with the same number on them.
  const forced = await api('POST', '/people/assets', {
    company_id: company.id, kind: 'Laptop', label: 'Two', identifier: 'SN-SAME', force: true,
  });
  assert.equal(forced.identifier, 'SN-SAME');
  // The case it was typed in does not matter.
  await assert.rejects(
    () => api('POST', '/people/assets', {
      company_id: company.id, kind: 'Laptop', label: 'Three', identifier: 'sn-same',
    }),
    /Add it anyway/
  );
});

test('only an available asset can be allocated, and the refusal says why', async () => {
  const { api, company, amit, riya } = await freshStore();
  const asset = await addLaptop(api, company);

  await api('POST', `/people/assets/${asset.id}/state`, { state: 'maintenance', note: 'screen' });
  await assert.rejects(
    () => api('POST', `/people/assets/${asset.id}/issue`, { employee_id: amit.id }),
    /under maintenance/
  );

  // Back in use, and it goes out.
  await api('POST', `/people/assets/${asset.id}/state`, { state: '' });
  const out = await api('POST', `/people/assets/${asset.id}/issue`, { employee_id: amit.id });
  assert.equal(out.employee_name, 'Amit Shah');
  // Passing it straight on is the one exception, and it still works.
  const passed = await api('POST', `/people/assets/${asset.id}/issue`, { employee_id: riya.id });
  assert.equal(passed.employee_name, 'Riya Pal');
});

test('status is worked out, never stored - so it cannot contradict the log', async () => {
  const { api, company, amit } = await freshStore();
  const asset = await addLaptop(api, company);
  const status = async (id) =>
    (await api('GET', '/people/assets?written_off=true')).assets.find((a) => a.id === id);

  let now = await status(asset.id);
  assert.equal(now.state, null, 'nothing special is going on, which is not a status');

  await api('POST', `/people/assets/${asset.id}/issue`, { employee_id: amit.id });
  now = await status(asset.id);
  assert.equal(now.state, null, 'being out with somebody is a FACT, not a stored state');
  assert.ok(now.employee_id);

  // Away being repaired while it is out: both are true, and both are kept.
  await api('POST', `/people/assets/${asset.id}/state`, { state: 'maintenance', note: 'keyboard' });
  now = await status(asset.id);
  assert.equal(now.state, 'maintenance');
  assert.equal(now.state_note, 'keyboard');
  assert.ok(now.state_since);
  assert.ok(now.employee_id, 'it has not stopped being theirs');

  // A nonsense state is refused rather than stored.
  await assert.rejects(
    () => api('POST', `/people/assets/${asset.id}/state`, { state: 'lost in the post' }),
    /a state is one of/
  );
});

test('an allocation carries what was handed over, and gets signed for', async () => {
  const { api, company, amit } = await freshStore();
  const asset = await addLaptop(api, company);
  await api('POST', `/people/assets/${asset.id}/issue`, {
    employee_id: amit.id,
    issued_on: '2026-09-01',
    expected_return_on: '2026-10-01',
    accessories: 'bag, charger, mouse',
    condition: 'new',
  });
  const { handovers } = await api('GET', `/people/assets/handovers?asset_id=${asset.id}`);
  assert.equal(handovers[0].expected_return_on, '2026-10-01');
  assert.equal(handovers[0].accessories, 'bag, charger, mouse');
  assert.equal(handovers[0].acknowledged_on, null, 'nobody has signed yet');

  const signed = await api('POST', `/people/assets/handovers/${handovers[0].id}/acknowledge`, {
    on: '2026-09-02', by: 'Amit Shah',
  });
  assert.equal(signed.acknowledged_on, '2026-09-02');
  assert.equal(signed.acknowledged_by, 'Amit Shah');

  // Signing twice does not move the date.
  const again = await api('POST', `/people/assets/handovers/${handovers[0].id}/acknowledge`, {
    on: '2026-12-25',
  });
  assert.equal(again.acknowledged_on, '2026-09-02');
});

test('the dashboard counts the register, and each card hands back its filter', async () => {
  const { api, company, amit } = await freshStore();
  const out = await addLaptop(api, company, { label: 'Out' });
  const free = await addLaptop(api, company, { label: 'Free' });
  const broken = await addLaptop(api, company, { label: 'Broken' });
  await api('POST', `/people/assets/${out.id}/issue`, {
    employee_id: amit.id, issued_on: '2026-08-01', expected_return_on: '2026-09-01',
  });
  await api('POST', `/people/assets/${broken.id}/state`, { state: 'damaged' });

  const d = await api('GET', '/people/assets/dashboard');
  const card = (key) => d.cards.find((c) => c.key === key);
  assert.equal(card('all').n, 3);
  assert.equal(card('assigned').n, 1);
  assert.equal(card('available').n, 1, 'the damaged one is not available');
  assert.equal(card('maintenance').n, 0);
  assert.equal(d.spent, 54000 * 3, 'what the company has spent on kit');
  assert.deepEqual(card('assigned').filter, { status: 'assigned' }, 'the card carries its own filter');

  // An expected return that has passed.
  const late = d.alerts.find((a) => a.key === 'overdue_returns');
  assert.ok(late, 'an overdue return is an alert');
  assert.equal(late.n, 1);
  assert.ok(late.rows[0].overdue_days > 0);

  assert.ok(d.years.includes('2025-26'), 'bought in June 2025, which is 2025-26');
  assert.deepEqual(d.categories, ['Laptop']);
  assert.ok(free.id);
});

test('an allocation with no return date is open-ended, never overdue', async () => {
  const { api, company, amit } = await freshStore();
  const asset = await addLaptop(api, company);
  await api('POST', `/people/assets/${asset.id}/issue`, { employee_id: amit.id, issued_on: '2020-01-01' });
  const d = await api('GET', '/people/assets/dashboard');
  assert.equal(
    d.alerts.find((a) => a.key === 'overdue_returns'),
    undefined,
    'most allocations name no date, and calling those late makes the alert useless'
  );
});

test('the masters are four lists, and a type belongs to a category', async () => {
  const { api } = await freshStore();
  const cat = await api('POST', '/people/asset-masters', { kind: 'category', name: 'IT equipment' });
  const type = await api('POST', '/people/asset-masters', {
    kind: 'type', name: 'Laptop', parent_id: cat.id,
  });
  assert.equal(type.parent_name, 'IT equipment');

  await assert.rejects(
    () => api('POST', '/people/asset-masters', { kind: 'type', name: 'Loose' }),
    /which category/
  );
  await assert.rejects(
    () => api('POST', '/people/asset-masters', { kind: 'category', name: 'IT equipment' }),
    /already on the list/
  );
  await assert.rejects(
    () => api('POST', '/people/asset-masters', { kind: 'colour', name: 'Blue' }),
    /a master is one of/
  );

  const { masters } = await api('GET', '/people/asset-masters?kind=category');
  assert.equal(masters.length, 1);

  // Deleting a category takes its types, and nothing else.
  await api('DELETE', `/people/asset-masters/${cat.id}`);
  assert.equal((await api('GET', '/people/asset-masters')).masters.length, 0);
});

test('a name off the master list does not rewrite the assets carrying it', async () => {
  const { api, company } = await freshStore();
  const vendor = await api('POST', '/people/asset-masters', { kind: 'vendor', name: 'Rashmi Computers' });
  const asset = await addLaptop(api, company, { vendor: 'Rashmi Computers' });
  await api('DELETE', `/people/asset-masters/${vendor.id}`);

  const still = (await api('GET', '/people/assets')).assets.find((a) => a.id === asset.id);
  assert.equal(still.vendor, 'Rashmi Computers', 'a master makes typing easy; it is not a key');
});
