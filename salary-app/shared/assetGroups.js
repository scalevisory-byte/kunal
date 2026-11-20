/**
 * ASSET GROUPS - Computer, Furniture, Mobile and the rest.
 *
 * Dinesh: *"need asset group also, like computer, furniture, mobile"*. His
 * register holds a thousand rows of forty-seven different things, and nobody
 * wants to scroll past 97 lights to find the laptops.
 *
 * THE GROUP IS DERIVED FROM THE KIND, NEVER STORED BESIDE IT.
 *
 * Storing it would be a second opinion, and the first time somebody edited a
 * chair's kind to "Table" its group would still read Computer because the
 * column was written months earlier. Exactly the mistake shared/assetStatus.js
 * exists to avoid: a status column beside an employee_id is not a status, it
 * is a disagreement waiting to happen. So the group is worked out, every
 * time, from the kind the asset actually carries - and correcting the map
 * below reclassifies the whole register at once.
 *
 * A kind nobody has mapped falls into "Other". That is honest: it means
 * nobody has said where it belongs, and it is visible on screen as a count
 * rather than quietly absorbed into Computer.
 *
 * Dependency-free, so the server, the dashboard and the export cannot put the
 * same asset in three different groups.
 */

/** Group key, what to call it, and the kinds it holds. In office order. */
export const ASSET_GROUPS = [
  [
    'computer',
    'Computer',
    [
      'laptop', 'desktop', 'monitor', 'printer', 'server', 'tablet',
      'keyboard', 'mouse', 'ups', 'cable', 'storage-device', 'scanner',
      'docking-station', 'webcam', 'headset', 'graphics-card',
    ],
  ],
  /*
   * "mobile" ITSELF was missing, which is the word the group is called and
   * the word anybody types. A row whose kind reads "Mobile" fell through to
   * Other - on the staff-wise register, three mobiles against one person sat
   * under "Other" while the group button above said Mobile. Same shape as
   * the "ac" / "air conditioner" note below: the register holds whatever the
   * office typed, not what the import happened to map.
   */
  ['mobile', 'Mobile', ['mobile', 'mobile phone', 'mobile-phone', 'smartphone', 'handset', 'phone', 'sim', 'charger', 'powerbank']],
  [
    'furniture',
    'Furniture',
    ['furniture', 'chair', 'table', 'cupboard', 'sofa', 'rack', 'partition'],
  ],
  [
    'network',
    'Network',
    ['router', 'switch', 'access-point', 'dongle', 'firewall', 'modem'],
  ],
  [
    'electrical',
    'Electrical',
    /*
     * "ac" AND "air conditioner", because the register holds whatever the
     * office typed: the import maps the kind to `ac`, a row typed by hand
     * says "Air conditioner", and the whole-word matcher (rightly) will not
     * find "ac" inside "air". Six of his rows read as Other until this was
     * here.
     */
    ['light', 'ac', 'air conditioner', 'air-conditioner', 'fan', 'water-cooler', 'water cooler', 'fridge', 'tv', 'inverter', 'geyser'],
  ],
  [
    'security',
    'Security',
    ['cctv', 'nvr', 'dvr', 'camera', 'biometric', 'access-card', 'id-card'],
  ],
  ['office', 'Office equipment', ['calculator', 'speaker', 'projector', 'shredder', 'telephone']],
  ['vehicle', 'Vehicle', ['vehicle', 'bike', 'car']],
  ['tools', 'Tools', ['tools', 'toolkit']],
];

/** kind -> group key, built once from the table above. */
const GROUP_OF = new Map();
for (const [group, , kinds] of ASSET_GROUPS) {
  for (const kind of kinds) GROUP_OF.set(kind, group);
}

export const GROUP_LABELS = new Map([
  ...ASSET_GROUPS.map(([key, label]) => [key, label]),
  ['other', 'Other'],
]);

/* ---------------------------------------------------------------------
 * THE OFFICE'S OWN GROUPS.
 *
 * Dinesh: *"ASSET ME NEW GROP KAHA SE ADD HOTA HE"*. It could not be: the
 * nine above are written here, and a kind nobody mapped read as Other for
 * ever. Meanwhile **Lists → Categories and Types already existed** and did
 * nothing at all for this - a Category added there reclassified nothing,
 * which is the shape this app keeps running into: the thing exists and is
 * not joined up.
 *
 * So a Category under Lists IS a group now, and the Types under it are its
 * kinds. Adding one is a line somebody types, not a release.
 *
 * TWO RULES, both of them the ones the built-in table already follows:
 *
 *   **THE OFFICE'S MAP WINS.** Somebody who files Printers under "IT
 *   equipment" has said where printers go; this file's opinion that a
 *   printer is a Computer is a default, not a correction.
 *
 *   **NOTHING IS STORED ON THE ASSET.** The group is still worked out from
 *   the kind every time, so moving a Type to another Category reclassifies
 *   the whole register at once and no column can disagree with the row it
 *   sits in.
 *
 * It is module state because `groupOf` is called from a dozen places that
 * have no business being handed a map; the server sets it from the database
 * and the browser from the same list it already loads. Untouched, this file
 * behaves exactly as it did before - there is a test saying so.
 * ------------------------------------------------------------------- */

/** category key -> label, and kind (normalised) -> category key. */
let CUSTOM_LABELS = new Map();
let CUSTOM_OF = new Map();

const keyOf = (name) => `own:${String(name).trim().toLowerCase()}`;

/**
 * Hand it the office's own lists.
 *
 * @param categories [{ name }] from Lists → Categories
 * @param types      [{ name, parent_name }] from Lists → Types
 */
export function setOwnGroups(categories = [], types = []) {
  CUSTOM_LABELS = new Map();
  CUSTOM_OF = new Map();
  for (const category of categories) {
    const name = String(category?.name || '').trim();
    if (name) CUSTOM_LABELS.set(keyOf(name), name);
  }
  for (const type of types) {
    const kind = String(type?.name || '').trim();
    const parent = String(type?.parent_name || '').trim();
    if (!kind || !parent) continue;
    // A type under a category nobody listed still names its group.
    if (!CUSTOM_LABELS.has(keyOf(parent))) CUSTOM_LABELS.set(keyOf(parent), parent);
    CUSTOM_OF.set(norm(kind), keyOf(parent));
  }
}

/** For a test, and for the standalone build starting from nothing. */
export const clearOwnGroups = () => setOwnGroups([], []);

export const groupLabel = (key) => CUSTOM_LABELS.get(key) || GROUP_LABELS.get(key) || 'Other';

/**
 * Every group a filter can offer: the office's own first, because they are
 * the ones somebody chose, then the built-ins, then Other - the leftovers,
 * always last.
 */
export const groupKeys = () => [
  ...CUSTOM_LABELS.keys(),
  ...ASSET_GROUPS.map(([key]) => key),
  'other',
];

/** The old constant, kept so nothing that imported it breaks. */
export const GROUP_KEYS = [...ASSET_GROUPS.map(([key]) => key), 'other'];

const norm = (v) => String(v ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/*
 * WHOLE WORDS. "ac" is a mapped kind and two letters long, so a substring
 * test puts BLACK BOARD under Electrical - there is an "ac" inside "black".
 * Caught by reading the output rather than by trusting the code.
 */
const says = (haystack, word) =>
  new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`).test(haystack);

/**
 * Which group an asset belongs to.
 *
 * The KIND decides. The label is only consulted when the kind says nothing,
 * which is the case for a register typed straight into the app where somebody
 * left the category alone - the name on the sticker is then the only evidence
 * there is, and guessing from it beats answering "Other" to everything.
 */
export function groupOf(kind, label = '') {
  const k = norm(kind);
  /*
   * THE OFFICE'S OWN MAP FIRST. Somebody who filed Printers under "IT
   * equipment" has said where printers go, and this file saying Computer is
   * a default rather than a correction.
   */
  if (k && CUSTOM_OF.has(k)) return CUSTOM_OF.get(k);
  // The table is keyed with dashes ("access-point"); norm gives spaces.
  if (k && GROUP_OF.has(k.replace(/ /g, '-'))) return GROUP_OF.get(k.replace(/ /g, '-'));

  // A kind nobody mapped, but whose name holds one that is mapped:
  // "storage device", "wi fi dongle", "sofa 2 seater".
  if (k) {
    for (const [mapped, group] of GROUP_OF) {
      if (says(k, mapped.replace(/-/g, ' '))) return group;
    }
  }

  const name = norm(label);
  if (name) {
    for (const [mapped, group] of CUSTOM_OF) {
      if (says(name, mapped)) return group;
    }
  }
  if (name) {
    for (const [mapped, group] of GROUP_OF) {
      if (says(name, mapped.replace(/-/g, ' '))) return group;
    }
  }
  return 'other';
}

/**
 * How many, and worth how much, in each group.
 *
 * Returns every group that has something in it, biggest first, so a register
 * of forty-seven kinds reads as eight lines. A group with nothing in it is
 * left out rather than shown as a zero - the point is what you HAVE.
 */
export function groupTally(assets = []) {
  const rows = new Map();
  for (const asset of assets) {
    const key = groupOf(asset.kind, asset.label);
    if (!rows.has(key)) rows.set(key, { group: key, label: groupLabel(key), count: 0, cost: 0, kinds: new Set() });
    const row = rows.get(key);
    row.count += 1;
    row.cost += Number(asset.purchase_cost) || 0;
    if (asset.kind) row.kinds.add(asset.kind);
  }
  return [...rows.values()]
    .map((r) => ({ ...r, kinds: [...r.kinds].sort() }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
