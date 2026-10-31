/**
 * The words that go out to people, in one place.
 *
 * There is no WhatsApp API behind this app. Everything here produces TEXT plus
 * a wa.me link, which the recruiter taps to send from his own number. That is
 * deliberate: a placement agency messaging strangers from an automated sender
 * is how a number gets blocked, and these messages want a human to glance at
 * them anyway. The salary app's sibling (the task assistant) holds the only
 * automated WhatsApp session here, and it only ever messages Dinesh himself.
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

const lines = (...parts) => parts.flat().filter((p) => p !== null && p !== undefined && p !== '').join('\n');

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
 * What the public may see about a vacancy. The CLIENT'S NAME IS NOT IN HERE:
 * an agency that broadcasts "hiring for X" has given away the one thing it
 * was paid for, and the candidate can be told once they are shortlisted.
 */
export function publicVacancy(v) {
  return {
    ref_no: v.ref_no,
    title: v.title,
    company: v.public_company || v.industry || 'A client company',
    industry: v.industry,
    category: v.category,
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

/** The broadcast. One job, everything a candidate needs to decide, then the link. */
export function vacancyBroadcast(v, { baseUrl, brand } = {}) {
  const p = publicVacancy(v);
  return lines(
    `*${p.title}*${p.location ? ` — ${p.location}` : ''}`,
    p.company ? `Company: ${p.company}` : '',
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
    brand ? `\n— ${brand}` : ''
  );
}

/* ---------------- one candidate, one message ---------------- */

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'there';

/**
 * Keyed by the stage the application has just moved to, so the dashboard can
 * offer the right message the moment a card is dragged. Returns null where a
 * stage has nothing worth sending (nobody needs to be told they are "Under
 * Review"), and a rejection is written to keep the person on the books,
 * because next month there is another job.
 */
export function stageMessage(stage, { candidate, vacancy, interview, offer, brand } = {}) {
  const name = firstName(candidate?.name);
  const job = vacancy?.title || 'the role';
  const place = vacancy?.location ? ` in ${vacancy.location}` : '';
  const sign = brand ? `\n— ${brand}` : '';

  switch (stage) {
    case 'Shortlisted':
      return lines(
        `Hi ${name},`,
        '',
        `Good news — your profile has been shortlisted for *${job}*${place}.`,
        `We will share the interview details shortly. Please keep your documents ready.`,
        sign
      );
    case 'Interview':
      return lines(
        `Hi ${name},`,
        '',
        `Your interview for *${job}* is scheduled.`,
        interview?.at ? `Date & time: ${interview.at}` : '',
        interview?.mode ? `Mode: ${interview.mode}` : '',
        interview?.location_or_link ? `Where: ${interview.location_or_link}` : '',
        '',
        `Please confirm by replying to this message.`,
        sign
      );
    case 'Offer Sent':
      return lines(
        `Hi ${name},`,
        '',
        `We have an offer for you for *${job}*${place}.`,
        offer?.ctc ? `CTC: ${offer.ctc}` : '',
        offer?.joining_date ? `Proposed joining: ${offer.joining_date}` : '',
        '',
        `Let us know if you accept and we will take it forward.`,
        sign
      );
    case 'Selected':
      return lines(
        `Hi ${name},`,
        '',
        `Congratulations! You have been selected for *${job}*${place}.`,
        `We will confirm your joining formalities next.`,
        sign
      );
    case 'Joined':
      return lines(
        `Hi ${name},`,
        '',
        `Congratulations on your first day at *${job}*${place}. All the best!`,
        `Do stay in touch — and if you know someone looking for a job, send them our way.`,
        sign
      );
    case 'Rejected':
      return lines(
        `Hi ${name},`,
        '',
        `Thank you for your time on *${job}*. This one has not worked out, but your profile stays with us and we will come back to you when something closer comes up.`,
        sign
      );
    default:
      return null;
  }
}

/** Asking for the CV that never arrived. */
export function resumeRequest({ candidate, vacancy, baseUrl, brand } = {}) {
  return lines(
    `Hi ${firstName(candidate?.name)},`,
    '',
    vacancy
      ? `Thanks for applying for *${vacancy.title}*. We still need your CV to take it forward.`
      : `We still need your CV to put your profile forward.`,
    baseUrl && vacancy ? `Upload it here: ${applyUrl(baseUrl, vacancy)}` : 'Please send it to this number.',
    brand ? `\n— ${brand}` : ''
  );
}

/** The test invite, once a test URL is configured. */
export function testInvite({ candidate, vacancy, url, brand } = {}) {
  return lines(
    `Hi ${firstName(candidate?.name)},`,
    '',
    `Next step for *${vacancy?.title || 'the role'}* is a short assessment.`,
    url ? `Start it here: ${url}` : '',
    `Do it in one sitting — it does not take long.`,
    brand ? `\n— ${brand}` : ''
  );
}

/** The recruiter's own morning list, as one message he can read on a phone. */
export function recruiterDigest({ interviews = [], followups = [], newApplications = 0 } = {}) {
  const overdue = followups.filter((f) => f.due_on && f.due_on < new Date().toISOString().slice(0, 10));
  return lines(
    `*Today*`,
    newApplications ? `${newApplications} new application${newApplications === 1 ? '' : 's'}` : '',
    interviews.length ? `\n*Interviews*` : '',
    interviews.map((i) => `• ${i.at?.slice(11, 16) || ''} ${i.candidate_name} — ${i.job_title}`),
    followups.length ? `\n*Follow-ups*` : '',
    followups.slice(0, 15).map((f) => `• ${f.title}${f.due_on ? ` (${f.due_on})` : ''}`),
    overdue.length ? `\n${overdue.length} overdue.` : '',
    !interviews.length && !followups.length && !newApplications ? 'Nothing pending.' : ''
  );
}
