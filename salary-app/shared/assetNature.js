/**
 * Fixed or movable.
 *
 * Dinesh: "Fixed / Movable assets different group". The register already
 * sorts things into Computer / Furniture / Mobile; this is the question one
 * level up, and it is a different one. A FIXED asset belongs to a place - the
 * AC, the desks, the CCTV, the desktop on a counter. A MOVABLE one goes with a
 * person or out of the door - a laptop, a phone, a SIM, a vehicle. The stock
 * take walks the first kind room by room and chases the second kind person by
 * person, which is why they want to be seen apart.
 *
 * WHAT IS STORED AND WHAT IS WORKED OUT. `assets.nature` is what somebody
 * SAID, and it always wins. Where nobody has said, the kind gives a starting
 * answer - and the screen marks it as a guess, because a thousand imported
 * rows that all quietly read "fixed" would be believed. A kind this file does
 * not know gets NO answer rather than a wrong one: "not said" is a pile the
 * office can clear, a wrong guess is one nobody looks at again.
 *
 * IT MOVES NO MONEY AND NO ASSET. Nothing here decides who may hold a thing
 * or what it is worth; it is a way of looking at the register.
 */
import { groupOf } from './assetGroups.js';

export const NATURES = [
  ['fixed', 'Fixed', 'Stays where it is put: furniture, AC, desktop, CCTV, network gear'],
  ['movable', 'Movable', 'Goes with a person or out of the door: laptop, phone, SIM, vehicle'],
];
export const NATURE_KEYS = NATURES.map(([key]) => key);
export const natureLabel = (key) => NATURES.find(([k]) => k === key)?.[1] || '';

const norm = (v) => String(v ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/* A group that is one thing all the way through. */
const GROUP_NATURE = {
  furniture: 'fixed',
  network: 'fixed',
  electrical: 'fixed',
  mobile: 'movable',
  vehicle: 'movable',
  tools: 'movable',
};

/*
 * The groups that are NOT one thing: a desktop and a laptop are both
 * "Computer", a CCTV camera and an ID card are both "Security". These are
 * settled kind by kind, and a kind not listed here is left unsaid.
 */
const KIND_NATURE = new Map(
  Object.entries({
    laptop: 'movable', tablet: 'movable', headset: 'movable', webcam: 'movable',
    'storage device': 'movable', 'docking station': 'movable', mouse: 'movable', keyboard: 'movable',
    desktop: 'fixed', monitor: 'fixed', printer: 'fixed', server: 'fixed', ups: 'fixed',
    scanner: 'fixed', cable: 'fixed', 'graphics card': 'fixed',
    cctv: 'fixed', nvr: 'fixed', dvr: 'fixed', camera: 'fixed', biometric: 'fixed',
    'access card': 'movable', 'id card': 'movable', 'sim card': 'movable',
    projector: 'fixed', shredder: 'fixed', telephone: 'fixed', speaker: 'fixed',
    calculator: 'movable', dongle: 'movable',
  })
);

/** The kind's own answer, or '' when this file does not know the kind. */
export function guessNature(kind, label = '') {
  const k = norm(kind);
  if (k && KIND_NATURE.has(k)) return KIND_NATURE.get(k);
  const group = groupOf(kind, label);
  if (GROUP_NATURE[group]) return GROUP_NATURE[group];
  // A kind the office made up, or "Other": the name alone may still say.
  for (const word of norm(label).split(' ')) {
    if (KIND_NATURE.has(word)) return KIND_NATURE.get(word);
  }
  return '';
}

/**
 * `{ nature, guessed }` for one asset.
 *
 * `guessed` is true only when the answer came from the kind. `nature` is ''
 * when nobody has said and the kind does not say either.
 */
export function natureOf(asset = {}) {
  const said = norm(asset.nature);
  if (NATURE_KEYS.includes(said)) return { nature: said, guessed: false };
  const guess = guessNature(asset.kind, asset.label);
  return { nature: guess, guessed: Boolean(guess) };
}

/** What may be stored: one of the two, or null for "decide from the kind". */
export function tidyNature(value) {
  const v = norm(value);
  if (!v) return null;
  if (!NATURE_KEYS.includes(v)) throw new Error('an asset is fixed or movable');
  return v;
}

/** Counts for the chips: every asset lands in exactly one of the three. */
export function natureTally(assets = []) {
  const out = { fixed: 0, movable: 0, unsaid: 0, guessed: 0 };
  for (const asset of assets) {
    const { nature, guessed } = natureOf(asset);
    if (!nature) out.unsaid += 1;
    else out[nature] += 1;
    if (guessed) out.guessed += 1;
  }
  return out;
}

/** Does this asset belong under the chip that was pressed? */
export function matchesNature(asset, picked) {
  if (!picked) return true;
  const { nature } = natureOf(asset);
  return picked === 'unsaid' ? !nature : nature === picked;
}
