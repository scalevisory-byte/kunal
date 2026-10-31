/**
 * Match scoring - decision SUPPORT, not a decision.
 *
 * This puts a number on how well a candidate lines up with a vacancy so a
 * person can work down an ordered queue instead of a pile. That is all it
 * does. Nothing in this system selects or rejects anybody on a score, and the
 * score is always shown with its working so it can be disagreed with.
 *
 * Five factors, weighted:
 *
 *   skills      34   how much of what the job asks for the person has
 *   experience  24   years, against the band the job wants
 *   location    18   where they are, against where the job is
 *   salary      14   what they want, against what the job pays
 *   education   10   what the job asks for, if it asks for anything
 *
 * A factor the vacancy says nothing about scores full rather than zero - a job
 * with no education requirement should not push everybody down.
 *
 * Dependency-free: the server scores on write and the dashboard re-scores on
 * screen, from this one file.
 */

export const WEIGHTS = { skills: 34, experience: 24, location: 18, salary: 14, education: 10 };

/* ---------------- reading what people actually type ---------------- */

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Like norm, but a hyphen survives - "1-3 yrs" is a range and loses its
 * meaning the moment the dash becomes a space, which is how a candidate with
 * two years came out as short of a band that starts at one.
 */
const numText = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9+.\-\s]/g, ' ')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Skills arrive as an array, or as one lump of text. The separators are the
 * ones people actually use in a job description: commas, slashes, pipes,
 * bullets - and the words "and" and "&", because "Tally and Busy" is two
 * skills and was being read as one skill nobody has.
 *
 * "and" needs its word boundaries: Android, demand and handling must survive.
 */
export function toSkills(value) {
  const parts = Array.isArray(value)
    ? value
    : String(value || '').split(/[,|;/\\\n•·]+|\s+(?:and|&)\s+/i);
  const out = [];
  const seen = new Set();
  for (const part of parts) {
    const s = norm(part);
    if (!s || s.length < 2 || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/**
 * Years of experience out of whatever was written: "5", "5 years", "1-3 yrs",
 * "7yrs 8mos", "10+ years", "6 months", "fresher".
 *
 * A range gives its lower end for a candidate (what they certainly have) and
 * both ends for a vacancy (the band it will take).
 */
export function toYears(value) {
  const text = numText(value);
  if (!text) return null;
  if (/fresher|fresh\b|no experience/.test(text)) return 0;

  const range = text.match(/(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)/);
  if (range) return Number(range[1]);

  let years = 0;
  let found = false;
  const y = text.match(/(\d+(?:\.\d+)?)\s*(?:\+)?\s*(?:y|yr|yrs|year|years)/);
  if (y) {
    years += Number(y[1]);
    found = true;
  }
  const m = text.match(/(\d+(?:\.\d+)?)\s*(?:m|mo|mos|month|months)/);
  if (m) {
    years += Number(m[1]) / 12;
    found = true;
  }
  if (found) return Math.round(years * 100) / 100;

  const bare = text.match(/^(\d+(?:\.\d+)?)\s*\+?$/);
  return bare ? Number(bare[1]) : null;
}

/** The band a vacancy will take: { min, max }, either end possibly null. */
export function toYearBand(value) {
  const text = numText(value);
  if (!text) return { min: null, max: null };
  if (/fresher/.test(text)) return { min: 0, max: toYears(text) ?? 1 };

  const range = text.match(/(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)/);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };
  if (/\d\s*\+/.test(text)) return { min: toYears(text), max: null };

  const one = toYears(text);
  return one === null ? { min: null, max: null } : { min: one, max: null };
}

/**
 * Money, however it was written: "18000", "₹10-18k/month", "3.6 LPA",
 * "25k", "2.5 lakh". Always returned as rupees PER MONTH, because that is what
 * these roles are quoted in; a yearly figure is divided by twelve.
 */
export function toMonthlySalary(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  const text = numText(value);
  if (!text) return null;

  const yearly = /lpa|per annum|p\.a|annual|yearly|year/.test(text);
  // "3.6 LPA" is three point six LAKH per annum. The unit is inside the
  // abbreviation rather than written out, so it has to be read off separately
  // or the figure comes out as three rupees and sixty paise a month.
  const lpa = /\blpa\b/.test(text);
  const parts = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(k|lakh|lac|l\b)?/g)]
    .map((m) => ({ n: Number(m[1]), unit: m[2] || '' }))
    .filter((p) => Number.isFinite(p.n) && p.n > 0);
  if (!parts.length) return null;

  // "10-18k" means ten thousand to eighteen thousand: the unit is written once,
  // at the end, and belongs to both. Without this the lower end reads as ten
  // rupees a month.
  const unit = parts.find((p) => p.unit)?.unit || '';
  const scale = (p) => {
    const u = p.unit || unit;
    if (u === 'k') return p.n * 1000;
    if (u && u[0] === 'l') return p.n * 100000;
    return p.n;
  };

  // A range is taken at its lower end here; callers that want the whole band
  // read salary_min and salary_max themselves.
  let amount = scale(parts[0]);
  if (lpa && !parts[0].unit && !unit) amount *= 100000;
  if (yearly || amount >= 100000) amount /= 12;
  return Math.round(amount);
}

/* ---------------- the factors ---------------- */

/** Full marks when the vacancy asks for nothing - it cannot be failed. */
const unasked = (weight) => ({ score: weight, of: weight, note: 'not asked for' });

function scoreSkills(candidate, vacancy) {
  const want = toSkills(vacancy.skills);
  const w = WEIGHTS.skills;
  if (!want.length) return { ...unasked(w), missing: [] };

  const have = toSkills(candidate.skills);
  const haystack = `${have.join(' ')} ${norm(candidate.role)} ${norm(candidate.notes_text)}`;

  const matched = [];
  const missing = [];
  for (const skill of want) {
    // A skill counts if it is written anywhere the candidate described
    // themselves - "advanced excel" should satisfy a job asking for "excel".
    const hit = haystack.includes(skill) || have.some((h) => h.includes(skill) || skill.includes(h));
    (hit ? matched : missing).push(skill);
  }
  const share = matched.length / want.length;
  return {
    score: Math.round(share * w),
    of: w,
    note: `${matched.length} of ${want.length} skills`,
    missing,
  };
}

function scoreExperience(candidate, vacancy) {
  const w = WEIGHTS.experience;
  const band = toYearBand(vacancy.experience_band);
  if (band.min === null && band.max === null) return unasked(w);

  const years = toYears(candidate.experience);
  if (years === null) return { score: Math.round(w * 0.5), of: w, note: 'experience not stated' };

  const min = band.min ?? 0;
  if (years >= min) {
    // Being over the band is not a fault - it costs a little, because an
    // overqualified person often will not take the job, and nothing more.
    if (band.max !== null && years > band.max + 2) {
      return { score: Math.round(w * 0.8), of: w, note: `${years}y, over the band` };
    }
    return { score: w, of: w, note: `${years}y, in band` };
  }
  const share = min > 0 ? years / min : 1;
  return { score: Math.round(w * Math.max(0, share)), of: w, note: `${years}y, wants ${min}y+` };
}

function scoreLocation(candidate, vacancy) {
  const w = WEIGHTS.location;
  const want = norm(vacancy.location);
  if (!want) return unasked(w);
  if (/remote|work from home|wfh/.test(norm(vacancy.work_mode))) {
    return { score: w, of: w, note: 'remote' };
  }

  const words = (s) => new Set(norm(s).split(' ').filter((x) => x.length > 2));
  const target = words(want);
  const here = words(candidate.location);
  const wants = words(candidate.preferred_location);

  const overlap = (set) => [...target].filter((t) => set.has(t)).length;
  const best = Math.max(overlap(here), overlap(wants));
  if (!best) return { score: 0, of: w, note: 'different city' };

  // "Bhayli, Vadodara" against "Vadodara, Gujarat" is the same city and a
  // different area, which is a good match and not half of one. Everything
  // matching is full marks; the city alone is most of them.
  const whole = best >= target.size;
  const willMove = overlap(wants) > overlap(here);
  return {
    score: whole ? w : Math.round(w * 0.75),
    of: w,
    note: willMove ? 'wants to move there' : whole ? 'same place' : 'same city',
  };
}

function scoreSalary(candidate, vacancy) {
  const w = WEIGHTS.salary;
  const min = toMonthlySalary(vacancy.salary_min);
  const max = toMonthlySalary(vacancy.salary_max);
  if (min === null && max === null) return unasked(w);

  const asking = toMonthlySalary(candidate.expected_salary) ?? toMonthlySalary(candidate.current_salary);
  if (asking === null) return { score: Math.round(w * 0.5), of: w, note: 'expectation not stated' };

  const ceiling = max ?? min;
  if (asking <= ceiling) return { score: w, of: w, note: 'within budget' };

  // Over budget tapers rather than failing outright: ten per cent over is
  // usually negotiable, double is not.
  const over = (asking - ceiling) / ceiling;
  const share = Math.max(0, 1 - over * 2);
  return { score: Math.round(w * share), of: w, note: `${Math.round(over * 100)}% over budget` };
}

const EDUCATION_RANK = [
  [/phd|doctorate/, 6],
  [/m\.?tech|m\.?e\b|mba|m\.?sc|m\.?com|m\.?a\b|masters|post ?graduate|pg\b/, 5],
  [/b\.?tech|b\.?e\b|bca|b\.?sc|b\.?com|b\.?a\b|bba|bachelor|graduate|degree/, 4],
  [/diploma|iti\b/, 3],
  [/12th|hsc|higher secondary|intermediate/, 2],
  [/10th|ssc|matric|secondary/, 1],
];

const educationRank = (text) => {
  const t = norm(text);
  for (const [re, rank] of EDUCATION_RANK) if (re.test(t)) return rank;
  return null;
};

function scoreEducation(candidate, vacancy) {
  const w = WEIGHTS.education;
  const want = educationRank(vacancy.education);
  if (want === null) return unasked(w);

  const has = educationRank(candidate.education);
  if (has === null) return { score: Math.round(w * 0.5), of: w, note: 'education not stated' };
  if (has >= want) return { score: w, of: w, note: 'meets it' };
  return { score: Math.round(w * (has / want)), of: w, note: 'below what is asked' };
}

/* ---------------- the score ---------------- */

/**
 * @returns {
 *   total       0-100, for ordering a queue and nothing else
 *   factors     { skills, experience, location, salary, education } each
 *               { score, of, note } so the number can be argued with
 *   missing     the skills the vacancy asked for and the candidate has not
 * }
 */
export function matchScore(candidate = {}, vacancy = {}) {
  const skills = scoreSkills(candidate, vacancy);
  const factors = {
    skills,
    experience: scoreExperience(candidate, vacancy),
    location: scoreLocation(candidate, vacancy),
    salary: scoreSalary(candidate, vacancy),
    education: scoreEducation(candidate, vacancy),
  };
  const total = Object.values(factors).reduce((sum, f) => sum + f.score, 0);
  return { total: Math.max(0, Math.min(100, Math.round(total))), factors, missing: skills.missing || [] };
}
