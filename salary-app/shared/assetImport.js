/**
 * Bringing an existing asset list in from a spreadsheet.
 *
 * Every office that has been running a while already has this list in Excel.
 * Typing a hundred and twenty laptops in by hand is how it never gets done at
 * all, so this reads the sheet the office already keeps.
 *
 * Dependency-free: the caller reads the workbook (ExcelJS on the server,
 * SheetJS for an older .xls) and hands over plain rows, exactly as the punch
 * importer does.
 *
 * Two rules it is built around:
 *
 *  - **A dry run first, always.** Nothing is written until somebody has seen
 *    what would be. An import that silently creates two hundred duplicates is
 *    worse than no import.
 *  - **A row it cannot place is NAMED, never dropped.** Skipping the four
 *    rows with no label leaves somebody believing a hundred and twenty came
 *    in when a hundred and sixteen did.
 */

/** What a column can be called. The first one found wins. */
export const ASSET_COLUMNS = [
  ['label', ['asset', 'asset name', 'name', 'item', 'item name', 'description', 'particulars', 'label']],
  ['kind', ['kind', 'type', 'category', 'asset type']],
  /*
   * "Modal" is not a typo to correct, it is what the column is called in
   * every asset sheet this office has ever written. Recognising only "model"
   * threw the whole column away.
   */
  ['model', ['model', 'modal', 'make model', 'model no']],
  ['location', ['location', 'site', 'office', 'premises', 'place']],
  ['floor_room', ['room', 'floor', 'cabin', 'seat', 'seat no', 'desk', 'floor room']],
  ['condition', ['condition', 'state of asset']],
  ['status', ['status', 'asset status']],
  /*
   * NOT 'sr no'. In an Indian office's spreadsheet that is the row number in
   * column A, not the asset's serial - and reading it as one matched every
   * asset to the wrong thing. 'Serial No' is a different column entirely.
   */
  ['identifier', ['serial', 'serial no', 'serial number', 'imei', 'identifier', 'sim', 'sim no']],
  ['code', ['code', 'asset code', 'tag', 'asset id', 'asset no']],
  ['company', ['company', 'firm', 'entity', 'branch']],
  ['purchase_cost', ['cost', 'value', 'amount', 'purchase cost', 'price', 'rate']],
  ['purchase_date', ['purchase date', 'purchased date', 'bought', 'date of purchase', 'bill date', 'date']],
  ['vendor', ['vendor', 'supplier', 'seller', 'party', 'shop']],
  ['invoice_no', ['invoice', 'invoice no', 'bill no', 'bill number', 'purchase invoice', 'invoice number']],
  /*
   * "Warenty" is spelt that way on the sheet in front of us. A column is
   * matched on what it SAYS, not on what it should have said.
   */
  ['warranty_until', ['warranty', 'warenty', 'warranty date', 'warenty date', 'warranty until', 'warranty upto', 'warranty till', 'guarantee']],
  ['holder', ['holder', 'issued to', 'given to', 'employee', 'staff', 'user', 'with', 'assignee', 'allotted to', 'allocated to', 'assigned to']],
  ['note', ['note', 'notes', 'remark', 'remarks']],
];

/*
 * A DASH IS NOT A VALUE.
 *
 * This office fills every empty cell with "-", and a few with "0", rather
 * than leaving it blank. Read literally, 550 assets come in with a condition
 * of "-", a vendor of "-" and a model of "0" - which is worse than empty,
 * because a blank says "not recorded" and a dash says it confidently.
 *
 * Only for text. A real 0 in a PRICE column is a price of nothing, which is
 * a fact; amountOf deals with that separately.
 */
const PLACEHOLDERS = new Set(['-', '--', '---', 'n/a', 'na', 'nil', 'none', 'null', '0', '.']);

const clean = (v) => {
  const text = String(v ?? '').trim();
  return PLACEHOLDERS.has(text.toLowerCase()) ? '' : text;
};
const key = (v) => clean(v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Which row is the header, and which column is which.
 *
 * Read off the sheet's own words rather than assumed, because every office
 * lays this out differently - and the header is rarely row 1, since these
 * files start with a title and a blank line.
 */
export function detectLayout(rows = []) {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const cells = (rows[r] || []).map(key);
    const found = {};
    for (const [field, names] of ASSET_COLUMNS) {
      /*
       * THE ALIAS ORDER DECIDES, not the column order.
       *
       * His sheet has "seat No." and "Room" side by side. Scanning the
       * columns left to right took the seat number - which is "-" on
       * practically every row - and the room, which carries HOTEL, ACCOUNT,
       * Training Room, was thrown away. Each field's names are written
       * best-first, so the best one present wins wherever it sits.
       */
      for (const name of names) {
        const at = cells.indexOf(name);
        if (at >= 0) {
          found[field] = at;
          break;
        }
      }
    }
    // A label column is the one thing an asset cannot do without.
    if (found.label !== undefined) return { headerRow: r, columns: found };
  }
  return { headerRow: -1, columns: {} };
}

/*
 * What an office actually writes on an asset list.
 *
 * His thousand rows produced 457 "other" - a register where half of
 * everything is uncategorised is a register nobody can filter. The words
 * below are taken from HIS sheet: LIGHT, MOUSE, CALCULATOR, KEYBOARD,
 * STORAGE, CCTV, AC, PENDRIVE, WI-FI DONGAL, FREEDGE, ALMARI, among others,
 * spelt the way they are spelt there.
 *
 * Order matters: the first match wins, so the specific ones come before the
 * general. "CHARGER CABLE" must find charger before cable, and
 * "STORAGE WITH DROWER KEY" must find storage before anything else.
 */
const KINDS = {
  laptop: ['laptop', 'notebook', 'macbook'],
  monitor: ['monitor', 'screen', 'display', 'led'],
  printer: ['printer', 'scanner', 'mfp', 'xerox'],
  keyboard: ['keyboard', 'key board'],
  mouse: ['mouse'],
  ups: ['ups', 'inverter battery'],
  'storage-device': ['pendrive', 'pen drive', 'hard disk', 'harddisk', 'hdd', 'ssd', 'usb drive'],
  server: ['server', 'nas'],
  tablet: ['tablet', 'ipad'],
  headset: ['headphone', 'headset', 'earphone'],
  webcam: ['webcam', 'web cam'],
  // Before desktop, or "CPU CABLE" reads as a computer.
  charger: ['charger'],
  cable: ['cable', 'wire', 'cord', 'adapter'],
  desktop: ['desktop', 'cpu', 'computer', 'pc'],

  sim: ['sim', 'sim card'],
  phone: ['phone', 'mobile', 'handset', 'smartphone'],
  powerbank: ['power bank', 'powerbank'],

  // Before furniture, so "STORAGE WITH DROWER KEY" is not a desk.
  cupboard: ['storage', 'almari', 'almirah', 'cupboard', 'locker', 'wardrobe'],
  sofa: ['sofa', 'couch'],
  rack: ['rack', 'shelf', 'shelves'],
  chair: ['chair', 'stool'],
  table: ['table', 'desk', 'workstation'],
  partition: ['partition', 'cubicle'],
  furniture: ['furniture', 'cabinet'],

  'access-point': ['access point', 'accesspoint'],
  dongle: ['dongle', 'dongal'],
  router: ['router'],
  switch: ['switch', 'poe'],
  modem: ['modem'],
  firewall: ['firewall'],

  // Before cctv, because "CCTV-NVR" is a recorder.
  nvr: ['nvr', 'dvr'],
  cctv: ['cctv', 'surveillance'],
  biometric: ['biometric', 'essl', 'punch machine', 'attendance machine'],
  camera: ['camera'],
  'access-card': ['access card'],
  'id-card': ['id card', 'identity card'],

  ac: ['ac', 'air conditioner', 'aircon', 'split ac'],
  fridge: ['fridge', 'freedge', 'refrigerator'],
  'water-cooler': ['water cooler', 'water purifier', 'ro'],
  tv: ['tv', 'television'],
  fan: ['fan'],
  geyser: ['geyser'],
  light: ['light', 'lamp', 'tube'],

  calculator: ['calculator'],
  speaker: ['speaker', 'sound box'],
  projector: ['projector'],
  shredder: ['shredder'],
  telephone: ['telephone', 'intercom', 'epabx'],

  vehicle: ['bike', 'scooter', 'car', 'vehicle'],
  tools: ['toolkit', 'tool kit'],
};

/** A kind from what the sheet says, or from the item's own name. */
/*
 * WHOLE WORDS, NOT SUBSTRINGS.
 *
 * "ac" is a kind and it is two letters long, so a substring match turns RACK,
 * BLACK BOARD and every ACCESS POINT into an air conditioner. The same trap
 * the skills parser hit, where "and" inside "demand planning" made a skill
 * nobody had. A trailing s is allowed, because an office writes CHAIRS.
 */
const says = (haystack, word) =>
  new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`).test(haystack);

export function kindOf(stated, label) {
  const said = key(stated);
  if (said) {
    for (const [kind, words] of Object.entries(KINDS)) {
      if (words.some((w) => says(said, w))) return kind;
    }
    return said.replace(/\s+/g, '-');
  }
  const name = key(label);
  for (const [kind, words] of Object.entries(KINDS)) {
    if (words.some((w) => says(name, w))) return kind;
  }
  return 'other';
}

/** "₹ 42,000.00" -> 42000. Anything unreadable is nothing, never a guess. */
export function amountOf(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
  const digits = String(value).replace(/[^0-9.-]/g, '');
  const n = Number(digits);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/** A date the sheet can state several ways; unreadable is blank, not today. */
export function dateOf(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const text = clean(value);
  let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    // Day first: this is an Indian office's spreadsheet, not an American one.
    return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : '';
}

const sameName = (a, b) => key(a) === key(b) && key(a) !== '';

/**
 * A SERIAL EXCEL HAS ALREADY DESTROYED.
 *
 * A 15-digit IMEI typed into a General cell becomes a number, and Excel
 * shows it as 3.52E+14. What it SAVES is the rounded figure, so the file we
 * are handed carries 352000000000000 - the real IMEI is gone before this
 * code ever sees it, and there is no way to recover it.
 *
 * Two of his phones came out with that identical value. Read as serials they
 * are the same device, so the second one was skipped as a duplicate: a real
 * asset silently missing from the register because of a cell format.
 *
 * So a number this shape is treated as NOT RECORDED - not as an identifier,
 * and not as grounds for calling two rows the same asset - and the rows are
 * named so the IMEIs can be typed back in. A genuine serial does not end in
 * nine zeros.
 */
export function serialLost(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  const n = Math.abs(value);
  return n >= 1e11 && n % 1e9 === 0;
}

/**
 * The sheet's Status column, against the four states this app actually
 * stores.
 *
 * Three of the seven statuses are DERIVED here and must never be written:
 * Available, Assigned and Written off are facts the rows already hold (see
 * shared/assetStatus.js). A sheet saying "Allocated" beside a holder it also
 * names is agreeing with us, not telling us something new - and writing it
 * would create the second opinion that whole module exists to avoid.
 *
 * So only the two that cannot be derived from anything are carried across:
 * in for repair, and taken out of service.
 */
const STATES = [
  ['maintenance', ['repair', 'maintenance', 'servicing', 'service', 'workshop']],
  ['disposed', ['retired', 'disposed', 'scrapped', 'sold', 'discarded', 'condemned']],
  ['damaged', ['damaged', 'broken', 'faulty', 'not working']],
  ['missing', ['missing', 'lost', 'untraceable']],
];

export function stateOf(status) {
  const said = key(status);
  if (!said) return '';
  for (const [state, words] of STATES) {
    if (words.some((w) => said.includes(w))) return state;
  }
  // Available, Allocated, Occupied, In Use - all of them are worked out from
  // the holder, so there is nothing to store and nothing to report.
  return '';
}

/**
 * What the file would do, before it does anything.
 *
 * `existing` is the register as it stands, `employees` the staff list, so a
 * row can be matched to an asset already on file and a holder to a real
 * person. Matching is on the CODE first and the serial second - two laptops
 * can share a model name, they cannot share a serial.
 */
export function planAssetImport({ rows = [], existing = [], employees = [], companies = [] } = {}) {
  const { headerRow, columns } = detectLayout(rows);
  if (headerRow < 0) {
    return {
      headerRow: -1,
      columns: {},
      create: [],
      update: [],
      skipped: [],
      problem:
        'No header row found. The sheet needs a column called Asset, Item, Name or Description.',
    };
  }

  const byCode = new Map(existing.filter((a) => a.code).map((a) => [key(a.code), a]));
  const bySerial = new Map(existing.filter((a) => a.identifier).map((a) => [key(a.identifier), a]));

  const create = [];
  const update = [];
  const skipped = [];
  const seen = new Set();

  for (let r = headerRow + 1; r < rows.length; r++) {
    const cells = rows[r] || [];
    const at = (field) => (columns[field] === undefined ? '' : cells[columns[field]]);
    const label = clean(at('label'));
    const code = clean(at('code'));
    const rawSerial = at('identifier');
    const lostSerial = serialLost(rawSerial);
    const identifier = lostSerial ? '' : clean(rawSerial);

    // A blank line in the middle of a sheet is normal and is not a problem.
    if (!label && !code && !identifier && !clean(at('purchase_cost'))) continue;

    /*
     * A total row, wherever it says so. Real sheets put TOTAL in column A, not
     * in the asset column, so checking only the label read it as "no asset
     * name" - true, but it told nobody that the line they were missing is the
     * one that was supposed to be missing.
     *
     * Its SUM carries a cached result, so importing one gives an asset worth
     * the whole register. The same trap the salary sheet importer hit.
     */
    if (cells.slice(0, 3).some((c) => /^(total|grand total|sub ?total)$/i.test(clean(c)))) {
      skipped.push({ row: r + 1, why: 'a total row', code, identifier });
      continue;
    }
    if (!label) {
      skipped.push({ row: r + 1, why: 'no asset name', code, identifier });
      continue;
    }

    /*
     * The same asset twice IN THE FILE must not quietly become two assets.
     *
     * Both the code AND the serial are tracked, not whichever the row happens
     * to carry: one line with a code and another with the same serial and no
     * code are the same laptop, and keying on "code or serial" let that pair
     * straight through.
     */
    const marks = [key(code), key(identifier)].filter(Boolean);
    if (marks.some((m) => seen.has(m))) {
      skipped.push({ row: r + 1, why: 'the same code or serial appears earlier in this file', code, identifier });
      continue;
    }
    for (const m of marks) seen.add(m);

    const holderName = clean(at('holder'));
    const holder = holderName
      ? employees.find((e) => sameName(e.name, holderName)) || null
      : null;
    const companyName = clean(at('company'));
    const company = companyName
      ? companies.find((c) => sameName(c.name, companyName)) || null
      : null;

    const asset = {
      row: r + 1,
      label,
      code,
      kind: kindOf(at('kind'), label),
      identifier,
      purchase_cost: amountOf(at('purchase_cost')),
      purchase_date: dateOf(at('purchase_date')),
      vendor: clean(at('vendor')),
      invoice_no: clean(at('invoice_no')),
      warranty_until: dateOf(at('warranty_until')),
      model: clean(at('model')),
      location: clean(at('location')),
      floor_room: clean(at('floor_room')),
      condition: clean(at('condition')),
      /* Only the states that cannot be derived; see stateOf. */
      state: stateOf(at('status')),
      note: clean(at('note')),
      company_id: company?.id ?? null,
      company_name: company?.name || companyName,
      employee_id: holder?.id ?? null,
      holder_name: holderName,
      // Its serial was a number in scientific notation, so the sheet no
      // longer holds the real one. Named rather than imported wrong.
      serial_lost: lostSerial,
      // A name the staff list does not have is reported, not invented and not
      // silently dropped - somebody is holding that laptop.
      holder_unknown: Boolean(holderName && !holder),
      company_unknown: Boolean(companyName && !company),
    };

    /*
     * Matched on the CODE first and the serial second. Two laptops can share a
     * model name; they cannot share a serial.
     *
     * A row with NEITHER cannot be matched at all, so importing the same file
     * twice would make a second one. It is still created - it is a real chair -
     * but it is named in `unmatchable` so that is a known fact rather than a
     * surprise next month. Guessing on the name instead would be worse: an
     * office with four "Office chair" rows really does have four chairs.
     */
    asset.unmatchable = !code && !identifier;
    const already = byCode.get(key(code)) || bySerial.get(key(identifier));
    if (already) update.push({ ...asset, id: already.id, was: already });
    else create.push(asset);
  }

  return {
    headerRow,
    columns,
    create,
    update,
    skipped,
    problem: '',
    holders_unknown: [...create, ...update].filter((a) => a.holder_unknown),
    // No code and no serial: nothing to recognise it by on a second import.
    unmatchable: create.filter((a) => a.unmatchable),
    companies_unknown: [...create, ...update].filter((a) => a.company_unknown),
    /*
     * Rows whose serial Excel had already destroyed before we were handed the
     * file. They ARE imported - the asset is real - but without a serial, and
     * they are named here so the IMEIs can be typed back in.
     */
    serials_lost: [...create, ...update].filter((a) => a.serial_lost),
  };
}
