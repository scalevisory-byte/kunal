/**
 * Which religion a festival belongs to.
 *
 * The app cannot work this out on its own, so somebody has to say it. That was
 * a tick-box per religion and nothing else, which means knowing - and
 * remembering - that Diwali is Hindu and Bakri Eid is Muslim every time one is
 * added. This is that knowledge, written down once: type or pick the festival
 * and the religions it covers are ticked for you. They can still be changed,
 * because an office is entitled to do what it likes.
 *
 * TWO THINGS THIS DELIBERATELY DOES NOT DO.
 *
 * It does not guess a date. Almost every festival here follows a lunar
 * calendar and moves by a fortnight or more from one year to the next; a date
 * guessed here would be wrong far more often than right, and wrong in a way
 * that costs a day's pay. Only the handful with a genuinely fixed date carry
 * one, and those are the national holidays and Christmas.
 *
 * It is not a complete list, and it is not a ruling on who observes what. It is
 * a starting point for the tick boxes - nothing here is enforced.
 *
 * Dependency-free like the rest of shared/, so it works in Node and in the
 * standalone browser file alike.
 */

/** The religions the list uses, spelt the way the pickers suggest them. */
export const HINDU = 'Hindu';
export const MUSLIM = 'Muslim';
export const CHRISTIAN = 'Christian';
export const SIKH = 'Sikh';
export const JAIN = 'Jain';
export const BUDDHIST = 'Buddhist';
export const PARSI = 'Parsi';

/**
 * name      what it is called here
 * aliases   the other spellings people type
 * religions who it is a holiday for; empty means the whole office
 * fixed     { month, day } only where the date genuinely does not move
 */
export const FESTIVALS = [
  // --- everybody: the national holidays, and the ones with a fixed date ---
  { name: 'Republic Day', religions: [], fixed: { month: 1, day: 26 } },
  { name: 'Independence Day', religions: [], fixed: { month: 8, day: 15 } },
  { name: 'Gandhi Jayanti', aliases: ['Gandhi Jayanthi'], religions: [], fixed: { month: 10, day: 2 } },
  { name: 'Labour Day', aliases: ['May Day'], religions: [], fixed: { month: 5, day: 1 } },
  {
    name: 'Makar Sankranti',
    aliases: ['Uttarayan', 'Uttrayan', 'Sankranti', 'Pongal', 'Kite festival'],
    religions: [HINDU],
    fixed: { month: 1, day: 14 },
    note: 'Uttarayan in Gujarat. One of the few that keeps to the same date.',
  },

  // --- Hindu ---
  { name: 'Diwali', aliases: ['Deepavali', 'Dipawali', 'Laxmi Puja', 'Lakshmi Pujan'], religions: [HINDU, JAIN, SIKH] },
  { name: 'Dhanteras', aliases: ['Dhanatrayodashi'], religions: [HINDU] },
  { name: 'Gujarati New Year', aliases: ['Bestu Varas', 'Nutan Varsh', 'Padwa', 'Annakut'], religions: [HINDU] },
  { name: 'Bhai Dooj', aliases: ['Bhai Beej', 'Bhaubeej'], religions: [HINDU] },
  { name: 'Holi', aliases: ['Dhuleti', 'Dhulandi', 'Holika Dahan'], religions: [HINDU] },
  { name: 'Dussehra', aliases: ['Dasara', 'Vijayadashami', 'Vijaya Dashami'], religions: [HINDU] },
  { name: 'Navratri', aliases: ['Navaratri', 'Garba'], religions: [HINDU] },
  { name: 'Janmashtami', aliases: ['Krishna Janmashtami', 'Gokulashtami'], religions: [HINDU] },
  { name: 'Ganesh Chaturthi', aliases: ['Ganesh Chturthi', 'Vinayaka Chaturthi'], religions: [HINDU] },
  { name: 'Raksha Bandhan', aliases: ['Rakhi', 'Rakshabandhan'], religions: [HINDU] },
  { name: 'Ram Navami', aliases: ['Rama Navami'], religions: [HINDU] },
  { name: 'Maha Shivaratri', aliases: ['Mahashivratri', 'Shivratri'], religions: [HINDU] },
  { name: 'Hanuman Jayanti', religions: [HINDU] },
  { name: 'Durga Puja', religions: [HINDU] },
  { name: 'Chhath Puja', aliases: ['Chhath'], religions: [HINDU] },
  { name: 'Onam', religions: [HINDU] },

  // --- Muslim ---
  {
    name: 'Eid-ul-Fitr',
    aliases: ['Eid', 'Id', 'Ramzan Eid', 'Ramadan Eid', 'Eid al Fitr', 'Meethi Eid'],
    religions: [MUSLIM],
  },
  {
    name: 'Eid-ul-Adha',
    aliases: ['Bakri Eid', 'Bakrid', 'Bakra Eid', 'Eid al Adha', 'Qurbani Eid'],
    religions: [MUSLIM],
  },
  { name: 'Muharram', aliases: ['Moharram', 'Ashura'], religions: [MUSLIM] },
  { name: 'Milad-un-Nabi', aliases: ['Eid-e-Milad', 'Barawafat', 'Mawlid'], religions: [MUSLIM] },
  { name: 'Shab-e-Barat', aliases: ['Shab e Barat'], religions: [MUSLIM] },
  { name: 'Jumat-ul-Vida', aliases: ['Alvida Jumma'], religions: [MUSLIM] },

  // --- Christian ---
  { name: 'Christmas', aliases: ['Xmas', 'Nataal'], religions: [CHRISTIAN], fixed: { month: 12, day: 25 } },
  { name: 'Good Friday', religions: [CHRISTIAN] },
  { name: 'Easter', aliases: ['Easter Sunday', 'Easter Monday'], religions: [CHRISTIAN] },

  // --- Sikh ---
  { name: 'Guru Nanak Jayanti', aliases: ['Gurpurab', 'Gurupurab', 'Guru Nanak Birthday'], religions: [SIKH] },
  { name: 'Guru Gobind Singh Jayanti', religions: [SIKH] },
  { name: 'Baisakhi', aliases: ['Vaisakhi'], religions: [SIKH, HINDU] },

  // --- Jain ---
  { name: 'Mahavir Jayanti', aliases: ['Mahaveer Jayanti'], religions: [JAIN] },
  { name: 'Paryushan', aliases: ['Paryushana', 'Samvatsari'], religions: [JAIN] },

  // --- Buddhist ---
  { name: 'Buddha Purnima', aliases: ['Buddha Jayanti', 'Vesak'], religions: [BUDDHIST] },

  // --- Parsi ---
  { name: 'Navroz', aliases: ['Nauroz', 'Pateti', 'Parsi New Year'], religions: [PARSI] },
  { name: 'Khordad Sal', religions: [PARSI] },
];

const norm = (text) =>
  String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * The festival somebody meant by what they typed, or null.
 *
 * An exact match on the name or an alias first, then a match on the start of
 * one - so "diw" finds Diwali and "bakri" finds Eid-ul-Adha - and nothing
 * shorter than three letters, because "e" should not silently become Eid.
 */
export function matchFestival(text) {
  const wanted = norm(text);
  if (wanted.length < 3) return null;

  const namesOf = (f) => [f.name, ...(f.aliases || [])].map(norm);

  for (const festival of FESTIVALS) {
    if (namesOf(festival).includes(wanted)) return festival;
  }
  for (const festival of FESTIVALS) {
    if (namesOf(festival).some((n) => n.startsWith(wanted) || wanted.startsWith(n))) return festival;
  }
  return null;
}

/** Every name and alias, for the suggestion list on the box. */
export function festivalNames() {
  return FESTIVALS.map((f) => f.name).sort((a, b) => a.localeCompare(b));
}

/** The ones whose date genuinely does not move, for a given month. */
export function fixedFestivalsIn(month) {
  return FESTIVALS.filter((f) => f.fixed?.month === Number(month));
}

/**
 * The religions to tick for a festival, narrowed to the ones actually in use
 * on the staff list - ticking "Jain" when nobody is marked Jain would apply
 * the holiday to nobody at all, which looks like a fault rather than a fact.
 *
 * @returns { tick, missing } - what to tick, and what the festival covers that
 *          nobody on the list carries.
 */
export function religionsToTick(festival, inUse = []) {
  if (!festival?.religions?.length) return { tick: [], missing: [] };
  const have = new Map(inUse.map((r) => [norm(r), r]));
  const tick = [];
  const missing = [];
  for (const religion of festival.religions) {
    const found = have.get(norm(religion));
    if (found) tick.push(found);
    else missing.push(religion);
  }
  return { tick, missing };
}
