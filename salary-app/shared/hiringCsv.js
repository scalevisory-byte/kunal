import { toCsv } from './statutory.js';

/**
 * The hiring exports. `toCsv` is the salary app's own - same BOM, same quoting,
 * so a candidate list and a PF register open in Excel the same way.
 */
export { toCsv };

export const CSV_COLUMNS = {
  pipeline: [
    ['Ref', 'candidate_ref'], ['Candidate', 'candidate_name'], ['Mobile', 'phone'],
    ['Opening', 'vacancy_ref'], ['Job title', 'job_title'], ['Company', 'company_name'],
    ['Department', 'department'],
    ['Stage', 'stage'], ['Match %', 'match_score'], ['Test %', 'test_score'],
    ['Experience', 'experience'], ['Location', 'location'],
    ['Expected salary', 'expected_salary'], ['Offered', 'offer_salary'],
    ['Notice period', 'notice_period'], ['Joining date', 'joining_date'],
    ['On payroll', 'employee_id'],
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
};
