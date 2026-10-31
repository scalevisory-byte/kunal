/**
 * CSV, the same way the salary app does it: a BOM in front so Excel on a
 * Windows machine opens Gujarati names and the rupee sign correctly instead of
 * mojibake, and quotes only where they are needed.
 *
 * `columns` is [[label, key], ...] so the export's column order is written out
 * once, next to its heading, rather than being whatever Object.keys returns.
 */
export function toCsv(columns, rows) {
  const escape = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map(([label]) => label).join(',')];
  for (const row of rows) lines.push(columns.map(([, key]) => escape(row[key])).join(','));
  return `﻿${lines.join('\n')}\n`;
}

export const CSV_COLUMNS = {
  pipeline: [
    ['Ref', 'candidate_ref'], ['Candidate', 'candidate_name'], ['Mobile', 'phone'],
    ['Vacancy', 'vacancy_ref'], ['Job title', 'job_title'], ['Client', 'client_company'],
    ['Stage', 'stage'], ['Match %', 'match_score'], ['Test %', 'test_score'],
    ['Experience', 'experience'], ['Location', 'location'],
    ['Expected salary', 'expected_salary'], ['Notice period', 'notice_period'],
    ['Applied on', 'created_at'], ['Stage changed', 'stage_changed_at'],
  ],
  candidates: [
    ['Ref', 'ref_no'], ['Name', 'name'], ['Mobile', 'phone'], ['Email', 'email'],
    ['Location', 'location'], ['Preferred location', 'preferred_location'],
    ['Education', 'education'], ['Experience', 'experience'], ['Role', 'role'],
    ['Skills', 'skills'], ['Industry', 'industry'],
    ['Current company', 'current_company'], ['Current salary', 'current_salary'],
    ['Expected salary', 'expected_salary'], ['Notice period', 'notice_period'],
    ['CV', 'has_resume'], ['Source', 'source'], ['Added on', 'created_at'],
  ],
  placements: [
    ['Candidate', 'candidate_name'], ['Mobile', 'phone'], ['Vacancy', 'vacancy_ref'],
    ['Job title', 'job_title'], ['Client', 'client_company'], ['Joined on', 'joined_on'],
    ['CTC', 'ctc'], ['Fee %', 'fee_percent'], ['Fee basis', 'fee_basis'],
    ['Fee', 'fee_amount'], ['GST', 'gst_amount'], ['Invoice', 'invoice_status'],
    ['Replacement until', 'replacement_until'], ['Status', 'status'],
  ],
};
