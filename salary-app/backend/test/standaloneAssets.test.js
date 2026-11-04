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

const addLaptop = (api, company, extra = {}) =>
  api('POST', '/people/assets', {
    company_id: company.id,
    kind: 'Laptop',
    label: 'Dell Latitude',
    identifier: 'SN-44218',
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
  assert.equal(amits.identifier, 'SN-44218');

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
  assert.equal(slip.items[0].serial, 'SN-44218');
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
