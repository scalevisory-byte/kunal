/**
 * The words that go out to a candidate, in one place.
 *
 * This is Dinesh's own companies hiring for themselves - Book N Fly, Scale
 * Visory, Arrohan Living, BNF Ventures - so the company is NAMED. There is no
 * client to keep anonymous: a candidate who does not know who is hiring does
 * not turn up for the interview.
 *
 * Nothing here sends anything. Every message comes back as text plus a wa.me
 * link that opens WhatsApp on the company's own number, and a person presses
 * send. An employer auto-messaging strangers is how a number gets blocked, and
 * these messages want a human eye anyway.
 *
 * Dependency-free on purpose, so the dashboard builds the same text the server
 * does and the two cannot drift.
 */

/** Keeps the last 10 digits and puts India's country code in front. */
export function waNumber(phone, countryCode = '91') {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length > 10) return digits;           // already carries a country code
  return `${countryCode}${digits}`;
}

/** A tap-to-send link. Empty when there is no number to send to. */
export function waLink(phone, text) {
  const to = waNumber(phone);
  if (!to) return '';
  return `https://wa.me/${to}?text=${encodeURIComponent(text || '')}`;
}

const lines = (...parts) =>
  parts.flat().filter((p) => p !== null && p !== undefined && p !== '').join('\n');

/** Rupees, written the way a person writes them. */
export function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return '';
  return `₹${n.toLocaleString('en-IN')}`;
}

const salaryRange = (v) => {
  if (v.salary_min && v.salary_max) return `${v.salary_min} - ${v.salary_max}`;
  return v.salary_max || v.salary_min || '';
};

/**
 * What an opening looks like to somebody outside. Everything a candidate needs
 * to decide and nothing the office keeps to itself - the budget band is shown
 * because a salary nobody states wastes both sides' time, but the internal
 * notes and who it reports to are not.
 */
export function publicVacancy(v) {
  return {
    ref_no: v.ref_no,
    title: v.title,
    company: v.company_name || '',
    department: v.department,
    location: v.location,
    work_mode: v.work_mode,
    employment_type: v.employment_type,
    experience_band: v.experience_band,
    education: v.education,
    positions: v.positions,
    salary: salaryRange(v),
    skills: v.skills,
    description: v.description,
    responsibilities: v.responsibilities,
    requirements: v.requirements,
    benefits: v.benefits,
    status: v.status,
  };
}

export const applyUrl = (baseUrl, v) =>
  `${String(baseUrl || '').replace(/\/+$/, '')}/apply/${v.ref_no}`;

/** The advert, ready to paste into WhatsApp or a group. */
export function vacancyBroadcast(v, { baseUrl } = {}) {
  const p = publicVacancy(v);
  return lines(
    `*${p.title}*${p.location ? ` — ${p.location}` : ''}`,
    p.company ? `${p.company}${p.department ? `, ${p.department}` : ''}` : '',
    p.experience_band ? `Experience: ${p.experience_band}` : '',
    p.salary ? `Salary: ${p.salary}` : '',
    p.education ? `Qualification: ${p.education}` : '',
    p.skills ? `Skills: ${p.skills}` : '',
    p.employment_type || p.work_mode
      ? `Type: ${[p.employment_type, p.work_mode].filter(Boolean).join(' / ')}`
      : '',
    p.positions > 1 ? `Openings: ${p.positions}` : '',
    '',
    p.description || '',
    '',
    baseUrl ? `Apply here: ${applyUrl(baseUrl, v)}` : 'Reply with your CV to apply.',
    `Ref: ${p.ref_no}`,
    p.company ? `\n— ${p.company}` : ''
  );
}

/* ---------------- one candidate, one message ---------------- */

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'there';

/**
 * Keyed by the stage an application has just moved to, so the dashboard offers
 * the right message the moment a card is dragged.
 *
 * Returns null where a stage has nothing worth sending - nobody needs to be
 * told they are "Under Review" - and a rejection is written to keep the person
 * on file, because the next opening is a month away.
 */
export function stageMessage(stage, { candidate, vacancy, interview, offer } = {}) {
  const name = firstName(candidate?.name);
  const job = vacancy?.title || 'the role';
  const at = vacancy?.company_name ? ` at ${vacancy.company_name}` : '';
  const place = vacancy?.location ? ` in ${vacancy.location}` : '';
  const sign = vacancy?.company_name ? `\n— ${vacancy.company_name}` : '';

  switch (stage) {
    case 'Shortlisted':
      return lines(
        `Hi ${name},`,
        '',
        `Good news — your profile has been shortlisted for *${job}*${at}${place}.`,
        'We will share the interview details shortly. Please keep your documents ready.',
        sign
      );
    case 'Interview':
      return lines(
        `Hi ${name},`,
        '',
        `Your interview for *${job}*${at} is scheduled.`,
        interview?.at ? `Date & time: ${interview.at}` : '',
        interview?.mode ? `Mode: ${interview.mode}` : '',
        interview?.location_or_link ? `Where: ${interview.location_or_link}` : '',
        '',
        'Please confirm by replying to this message.',
        sign
      );
    case 'Offer Sent':
      return lines(
        `Hi ${name},`,
        '',
        `We would like to offer you *${job}*${at}${place}.`,
        offer?.salary ? `Salary: ${money(offer.salary) || offer.salary} per month` : '',
        offer?.joining_date ? `Joining date: ${offer.joining_date}` : '',
        '',
        'Let us know if you accept and we will send the letter.',
        sign
      );
    case 'Selected':
      return lines(
        `Hi ${name},`,
        '',
        `Congratulations! You have been selected for *${job}*${at}${place}.`,
        'Please bring your PAN, Aadhaar, bank passbook and your last payslip on your first day.',
        sign
      );
    case 'Joined':
      return lines(
        `Hi ${name},`,
        '',
        `Welcome to ${vacancy?.company_name || 'the team'}. All the best for your first day as *${job}*.`,
        sign
      );
    case 'Rejected':
      return lines(
        `Hi ${name},`,
        '',
        `Thank you for your time on *${job}*. This one has not worked out, but we are keeping your profile on file and will come back to you when something closer comes up.`,
        sign
      );
    default:
      return null;
  }
}

/** Asking for the CV that never arrived. */
export function resumeRequest({ candidate, vacancy, baseUrl } = {}) {
  return lines(
    `Hi ${firstName(candidate?.name)},`,
    '',
    vacancy
      ? `Thanks for applying for *${vacancy.title}*. We still need your CV to take it forward.`
      : 'We still need your CV to take your application forward.',
    baseUrl && vacancy ? `Upload it here: ${applyUrl(baseUrl, vacancy)}` : 'Please send it to this number.',
    vacancy?.company_name ? `\n— ${vacancy.company_name}` : ''
  );
}

/** The test invite, once a test URL is configured. */
export function testInvite({ candidate, vacancy, url } = {}) {
  return lines(
    `Hi ${firstName(candidate?.name)},`,
    '',
    `Next step for *${vacancy?.title || 'the role'}* is a short assessment.`,
    url ? `Start it here: ${url}` : '',
    'Do it in one sitting — it does not take long.',
    vacancy?.company_name ? `\n— ${vacancy.company_name}` : ''
  );
}

/** The hiring day as one message that reads on a phone. */
export function hiringDigest({ interviews = [], tasks = [], newApplications = 0 } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const overdue = tasks.filter((t) => t.due_on && t.due_on < today);
  return lines(
    '*Hiring today*',
    newApplications ? `${newApplications} new application${newApplications === 1 ? '' : 's'}` : '',
    interviews.length ? '\n*Interviews*' : '',
    interviews.map((i) => `• ${i.at?.slice(11, 16) || ''} ${i.candidate_name} — ${i.job_title}`),
    tasks.length ? '\n*To do*' : '',
    tasks.slice(0, 15).map((t) => `• ${t.title}${t.due_on ? ` (${t.due_on})` : ''}`),
    overdue.length ? `\n${overdue.length} overdue.` : '',
    !interviews.length && !tasks.length && !newApplications ? 'Nothing pending.' : ''
  );
}
