import { useCallback, useEffect, useState } from 'react';
import { AuthError, STANDALONE, api, clearToken } from './api.js';
import Attendance from './components/Attendance.jsx';
import Dashboard from './components/Dashboard.jsx';
import Employees from './components/Employees.jsx';
import Festivals from './components/Festivals.jsx';
import HolidayDetail from './components/HolidayDetail.jsx';
import Apply from './components/hiring/Apply.jsx';
import Hiring from './components/hiring/Hiring.jsx';
import Jobs from './components/hiring/Jobs.jsx';
import PunchPage from './components/PunchPage.jsx';
import Leave from './components/Leave.jsx';
import Loans from './components/Loans.jsx';
import Login from './components/Login.jsx';
import Payslip from './components/Payslip.jsx';
import PeriodBar from './components/PeriodBar.jsx';
import Reports from './components/Reports.jsx';
import SalarySheet from './components/SalarySheet.jsx';
import SundayRegister from './components/SundayRegister.jsx';
import TimeSheet from './components/TimeSheet.jsx';
import Admin from './components/admin/Admin.jsx';
import People from './components/people/People.jsx';
import AssetsTab from './components/AssetsTab.jsx';
import Glyph from './icons.jsx';

/*
 * Which tabs are about a MONTH. The month picker and its settings - working
 * days, hours a day, the PT slab, lock, delete - were on every screen, so the
 * asset register carried "Working days 26 · PT above 12000" across the top of
 * it. None of that means anything to a laptop, a candidate or a staff note.
 *
 * These tabs READ a month, so they keep the picker. Only the Salary sheet
 * SETS one, so only it gets the settings (see PeriodBar's allowSettings) -
 * otherwise Reports carried a Delete month button two clicks from a report.
 */
const MONTHLY_TABS = new Set([
  'dashboard', 'sheet', 'attendance', 'time', 'leave', 'loans', 'reports',
]);

/* key, what it is called, its icon */
const TABS = [
  ['dashboard', 'Dashboard', 'dashboard'],
  ['sheet', 'Salary sheet', 'sheet'],
  ['attendance', 'Attendance', 'attendance'],
  ['time', 'Time', 'clock'],
  ['leave', 'Leave', 'leave'],
  ['loans', 'Loans', 'loans'],
  ['employees', 'Employees', 'employees'],
  ['assets', 'Assets', 'asset'],
  ['hiring', 'Hiring', 'hiring'],
  ['people', 'People', 'person'],
  ['reports', 'Reports', 'reports'],
  ['admin', 'Admin', 'admin'],
];

const PERIOD_KEY = 'salary-app-period';

/**
 * The date this file was built, stamped in by vite.config.js. Every download
 * lands as "SalarySheet (2).html", "(3)" and so on, so there is otherwise no
 * way to tell an old copy from the newest one.
 */
const BUILT_ON = (() => {
  try {
    return new Date(__BUILT__).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '';
  }
})();
const COMPANY_KEY = 'salary-app-company';

/**
 * Two surfaces in one bundle, told apart by the path. /apply/JOB-003 and /jobs
 * are the candidate's side and have no password; everything else is the
 * office's and does. No router: there are two public paths and the rest is tabs.
 *
 * Only on the server build - the single-file build is opened from a file:// URL
 * by one person and has no public address to hand out.
 */
export default function App() {
  if (!STANDALONE) {
    const applying = window.location.pathname.match(/^\/apply\/([^/]+)/);
    if (applying) return <Apply ref_no={decodeURIComponent(applying[1])} />;
    if (/^\/jobs\/?$/.test(window.location.pathname)) return <Jobs />;
    // An employee's own punch link. No password - the token is the identity.
    const punching = window.location.pathname.match(/^\/punch\/([^/]+)/);
    if (punching) return <PunchPage token={decodeURIComponent(punching[1])} />;
  }
  return <Shell />;
}

function Shell() {
  const [ready, setReady] = useState(false);
  // Declared with the rest: this sits above two early returns, and a hook
  // after one of those is React error #310.
  const [navOpen, setNavOpen] = useState(false);
  /*
   * A sticker on a laptop lid was scanned. The path is read once, at the top,
   * and then taken out of the address bar - so a refresh does not reopen the
   * same asset, and the link can still be pasted to somebody.
   *
   * It survives the sign-in screen on purpose: an asset register is not public,
   * so scanning while signed out should ask who you are and THEN show the
   * laptop, rather than losing it and landing on the dashboard.
   */
  const [scanned, setScanned] = useState(() => {
    if (STANDALONE) return '';
    const found = window.location.pathname.match(/^\/a\/([^/]+)/);
    if (!found) return '';
    window.history.replaceState({}, '', '/');
    return decodeURIComponent(found[1]);
  });
  const [authed, setAuthed] = useState(false);
  // Who is signed in, and what their role carries. Used to hide what they
  // cannot do - the server refuses it regardless, so this is courtesy rather
  // than the control.
  const [me, setMe] = useState(null);

  const [tab, setTab] = useState('dashboard');
  const [periods, setPeriods] = useState([]);
  const [periodId, setPeriodId] = useState(Number(localStorage.getItem(PERIOD_KEY)) || null);
  const [payroll, setPayroll] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [codes, setCodes] = useState({});
  const [payslip, setPayslip] = useState(null);
  // Clicking a company anywhere narrows every tab to it. Null is all of them.
  const [companyId, setCompanyId] = useState(Number(localStorage.getItem(COMPANY_KEY)) || null);
  const [saving, setSaving] = useState(0);
  const [error, setError] = useState('');

  const handle = useCallback((err) => {
    if (err instanceof AuthError) {
      clearToken();
      setAuthed(false);
      setAuthError('Session expired - enter the password again.');
      return;
    }
    setError(err.message);
  }, []);

  /* ---- loading ---- */

  const loadPeriods = useCallback(async () => {
    const { periods: list, codes: marks } = await api.get('/periods');
    setPeriods(list);
    setCodes(marks);
    setPeriodId((current) => {
      if (current && list.some((p) => p.id === current)) return current;
      return list[0]?.id || null;
    });
    return list;
  }, []);

  const loadPayroll = useCallback(async (id) => {
    if (!id) {
      setPayroll(null);
      return;
    }
    setPayroll(await api.get(`/periods/${id}/payroll`));
  }, []);

  const loadMaster = useCallback(async () => {
    const [{ companies: c }, { employees: e }] = await Promise.all([
      api.get('/companies'),
      api.get('/employees'),
    ]);
    setCompanies(c);
    setEmployees(e);
  }, []);

  const loadAll = useCallback(async () => {
    setError('');
    try {
      const list = await loadPeriods();
      const id = periodId && list.some((p) => p.id === periodId) ? periodId : list[0]?.id || null;
      await Promise.all([loadPayroll(id), loadMaster()]);
    } catch (err) {
      handle(err);
    }
  }, [handle, loadMaster, loadPayroll, loadPeriods, periodId]);

  // First load: a 401 sends us to the sign-in screen instead of an error.
  useEffect(() => {
    (async () => {
      try {
        const [, state] = await Promise.all([api.get('/config'), api.get('/auth/state')]);
        setMe(state.signed_in);
        setAuthed(true);
      } catch (err) {
        if (!(err instanceof AuthError)) setError(err.message);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (authed && scanned) setTab('assets');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, scanned]);

  useEffect(() => {
    if (authed) loadAll();
    // loadAll changes with periodId, which would loop; the period effect below
    // handles switching months.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  useEffect(() => {
    if (!authed || !periodId) return;
    localStorage.setItem(PERIOD_KEY, String(periodId));
    loadPayroll(periodId).catch(handle);
  }, [authed, periodId, loadPayroll, handle]);

  /* ---- mutations ---- */

  /**
   * Applies the edit to the on-screen row first so the sheet recalculates
   * instantly, then saves. If the save fails the row is flagged rather than
   * silently reverted, so nothing typed disappears without a word.
   */
  const patchRow = useCallback(
    async (rowId, patch) => {
      setPayroll((current) => {
        if (!current) return current;
        return {
          ...current,
          rows: current.rows.map((r) =>
            r.id === rowId
              ? { ...r, ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v === '' ? null : v])), error: null }
              : r
          ),
        };
      });
      setSaving((n) => n + 1);
      try {
        const saved = await api.patch(`/periods/${periodId}/rows/${rowId}`, patch);
        setPayroll((current) =>
          current
            ? { ...current, rows: current.rows.map((r) => (r.id === rowId ? { ...r, ...saved, error: null } : r)) }
            : current
        );
      } catch (err) {
        if (err instanceof AuthError) return handle(err);
        setPayroll((current) =>
          current
            ? { ...current, rows: current.rows.map((r) => (r.id === rowId ? { ...r, error: err.message } : r)) }
            : current
        );
        setError(`Could not save: ${err.message}`);
      } finally {
        setSaving((n) => n - 1);
      }
    },
    [periodId, handle]
  );

  const saveAttendance = useCallback(
    async (entries) => {
      await api.post(`/periods/${periodId}/attendance`, { entries });
      await loadPayroll(periodId);
    },
    [periodId, loadPayroll]
  );

  const patchPeriod = useCallback(
    async (patch) => {
      try {
        await api.patch(`/periods/${periodId}`, patch);
        await loadPeriods();
        await loadPayroll(periodId);
      } catch (err) {
        handle(err);
      }
    },
    [periodId, loadPeriods, loadPayroll, handle]
  );

  const createPeriod = async (body) => {
    const created = await api.post('/periods', body);
    await loadPeriods();
    setPeriodId(created.id);
  };

  const deletePeriod = async () => {
    try {
      await api.del(`/periods/${periodId}`);
      setPeriodId(null);
      localStorage.removeItem(PERIOD_KEY);
      const list = await loadPeriods();
      await loadPayroll(list[0]?.id || null);
    } catch (err) {
      handle(err);
    }
  };

  const syncPeriod = async () => {
    try {
      await api.post(`/periods/${periodId}/sync`);
      await loadPayroll(periodId);
    } catch (err) {
      handle(err);
    }
  };

  // Hands back whatever the call returned, so a caller that needs the row it
  // just created - "Add employee", which then opens that person's record to
  // attach their documents - has it.
  const masterAction = (fn) => async (...args) => {
    try {
      const made = await fn(...args);
      await loadMaster();
      await loadPayroll(periodId);
      return made;
    } catch (err) {
      handle(err);
      throw err;
    }
  };

  /* ---- render ---- */

  if (!ready) return <div className="loading">Loading…</div>;

  // The single-file build stores everything in this browser; there is nothing
  // on a server to put a password in front of.
  if (!authed && !STANDALONE) {
    return (
      <Login
        onSignedIn={async () => {
          /*
           * Read the actor back off /auth/state rather than trusting what the
           * login call returned. The login response is a user row and carries
           * no `via`, so taking it at face value made somebody signed in with a
           * username read as being here on the API key - which the audit-trail
           * page then said out loud.
           */
          try {
            const state = await api.get('/auth/state');
            setMe(state.signed_in);
          } catch {
            // Signed in but could not read the state back: carry on rather
            // than bouncing them to the login screen they just used.
          }
          setAuthed(true);
        }}
        onError={(err) => setError(err.message)}
      />
    );
  }

  const period = periods.find((p) => p.id === periodId) || null;
  const locked = !!period?.locked;

  /*
   * Admin is hidden from everybody else. Courtesy rather than the control - the
   * server refuses those calls by role whoever asks - but a tab that only ever
   * says "this is not yours" is a tab worth not showing. The single-file build
   * has no server to sign in to, so it keeps it and explains itself inside.
   */
  const visibleTabs = TABS.filter(
    ([key]) => key !== 'admin' || STANDALONE || me?.abilities?.includes('admin')
  );

  // A company that has been deleted must not keep filtering everything away.
  const activeCompany = companies.find((c) => c.id === companyId) || null;
  const pickCompany = (id) => {
    const next = id === companyId ? null : id || null;
    setCompanyId(next);
    if (next) localStorage.setItem(COMPANY_KEY, String(next));
    else localStorage.removeItem(COMPANY_KEY);
  };
  const visibleRows = payroll
    ? activeCompany
      ? payroll.rows.filter((r) => r.company_id === activeCompany.id)
      : payroll.rows
    : [];

  return (
    <div className={`app${navOpen ? ' nav-open' : ''}`}>
      {/*
        * The modules live down the side, not across the top. Twelve of them
        * wrapped onto three lines on a phone and pushed every figure off the
        * screen; down the side they are one list, and the top of the page is
        * left for what this month is.
        *
        * On a phone the list slides in over the page and closes on the way
        * out, so it costs nothing until it is asked for.
        */}
      <aside className="sidebar">
        <div className="side-brand">
          <span className="side-mark">BH</span>
          <span className="side-name">
            BOOKNFLY <strong>HRMS</strong>
            <span className="built" title="When this file was built.">{BUILT_ON}</span>
          </span>
          <button
            className="ghost side-close"
            onClick={() => setNavOpen(false)}
            title="Close the menu"
          >
            <Glyph name="close" size={16} />
          </button>
        </div>

        <nav className="side-nav">
          {visibleTabs.map(([key, label, icon]) => (
            <button
              key={key}
              className={tab === key ? 'active' : undefined}
              onClick={() => {
                setTab(key);
                setNavOpen(false);
              }}
            >
              <Glyph name={icon} size={16} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        {!STANDALONE && (
          <div className="side-foot">
            <button
              className="ghost"
              title={me ? `${me.name} — ${me.role}` : 'Sign out'}
              onClick={async () => {
                try {
                  await api.post('/auth/logout', {});
                } catch {
                  // Signing out locally still matters even if that call failed.
                }
                clearToken();
                setMe(null);
                setAuthed(false);
              }}
            >
              {me?.name ? `Sign out (${me.name})` : 'Sign out'}
            </button>
          </div>
        )}
      </aside>

      {/* Tapping the page behind the menu closes it, as it should. */}
      <div className="side-scrim" onClick={() => setNavOpen(false)} />

      <div className="page">
        <header>
        <button
          className="ghost side-open"
          onClick={() => setNavOpen(true)}
          title="Menu"
          aria-label="Menu"
        >
          <Glyph name="menu" size={18} />
        </button>
        <h1 className="here">{visibleTabs.find(([k]) => k === tab)?.[1] || 'Dashboard'}</h1>
        {/*
          * The month and the company filter share one line. The companies were
          * a row of chips, which is five of them across two lines on a phone
          * before a single figure - and the names are long. A picker is one
          * control, and the list scrolls as far as it needs to.
          *
          * Renaming and deleting a company stays on the Employees tab, where
          * it always was; this is only the filter.
          */}
        <div className="top-row">
          {MONTHLY_TABS.has(tab) && (
          <PeriodBar
            periods={periods}
            period={period}
            onSelect={setPeriodId}
            onCreate={createPeriod}
            onPatch={patchPeriod}
            onSync={syncPeriod}
            onDelete={deletePeriod}
            /* The Salary sheet is the one screen those settings pay from. */
            allowSettings={tab === 'sheet'}
          />
          )}
          {/* The company filter stays everywhere but Admin: assets, candidates
              and staff notes all belong to a company, even though none of them
              belong to a month. */}
          <label className="company-pick" title="Show one company, or all of them">
            Company
            <select
              value={activeCompany?.id || ''}
              onChange={(e) => pickCompany(Number(e.target.value) || null)}
            >
              {/*
                * No total beside "All": the per-company counts are of people on
                * the master, and the month can carry somebody who has since
                * left - a total that reads 84 beside a payroll of 85 looks
                * like an error rather than the two true things it is.
                */}
              <option value="">All companies</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.employee_count})
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      {error && (
        <p className="error banner">
          {error}
          <button className="ghost tiny" onClick={() => setError('')}>dismiss</button>
        </p>
      )}

      <main>
        {!period && !['employees', 'dashboard', 'hiring'].includes(tab) && (
          <p className="card muted">
            No month is open yet. Use <strong>New month</strong> above to start one — then add
            employees, or import last month's sheet from <strong>Reports</strong>.
          </p>
        )}

        {tab === 'dashboard' && (
          <Dashboard
            period={period}
            periods={periods}
            payroll={payroll && { ...payroll, rows: visibleRows }}
            employees={employees}
            companyId={companyId}
            companyName={companies.find((c) => c.id === companyId)?.name || ''}
            onGo={setTab}
            onPeriod={setPeriodId}
          />
        )}

        {tab === 'sheet' && period && payroll && (
          <SalarySheet
            period={period}
            rows={visibleRows}
            saving={saving}
            locked={locked}
            onPatchRow={patchRow}
            onPayslip={setPayslip}
            onCompany={pickCompany}
          />
        )}

        {tab === 'attendance' && period && payroll && (
          <div className="stack">
            {/*
              * Folded away by default. It is half a screen of explanation and
              * it is needed a few times a year, while the grid under it is
              * needed every day - it was pushing the actual work below the
              * fold. Still one click away, and it says what it is.
              */}
            <details className="card fold">
              <summary>
                <strong>Festivals &amp; holidays</strong>
                <span className="muted small">
                  {' '}
                  — a paid day off for some or all of the staff
                </span>
              </summary>
              <Festivals
                period={period}
                codes={codes}
                employees={employees}
                locked={locked}
                onApplied={() => loadPayroll(periodId)}
              />
            </details>
            <Attendance
            period={period}
            rows={visibleRows}
            codes={codes}
              locked={locked}
              onSave={saveAttendance}
            />

            {/*
              * The Sunday register moved here from its own tab, as asked, and
              * it is still the ONLY place Sunday pay is settled - it is not
              * in the month's net, so losing it would lose the money. Folded,
              * because it is looked at once a month.
              */}
            <details className="card fold">
              <summary>
                <strong>Sunday working</strong>
                <span className="muted small">
                  {' '}
                  — who worked which Sundays, and what they are owed for them.
                  Paid from here, never in the month&apos;s salary.
                </span>
              </summary>
              <SundayRegister
                period={period}
                rows={visibleRows}
                locked={locked}
                onPatchRow={patchRow}
              />
            </details>

            <details className="card fold">
              <summary>
                <strong>Paid holidays</strong>
                <span className="muted small">
                  {' '}
                  — which days were given off, and who worked them anyway
                </span>
              </summary>
              <HolidayDetail period={period} rows={visibleRows} />
            </details>
          </div>
        )}

        {tab === 'time' && period && payroll && (
          <TimeSheet
            period={period}
            rows={visibleRows}
            locked={locked}
            onSave={saveAttendance}
            onPatchPeriod={patchPeriod}
          />
        )}

        {tab === 'leave' && (
          <Leave
            periods={periods}
            employees={employees}
            companies={companies}
            period={period}
            payrollRows={visibleRows}
            locked={locked}
            onPatch={masterAction((id, patch) => api.patch(`/employees/${id}`, patch))}
            onPatchCompany={masterAction((id, patch) => api.patch(`/companies/${id}`, patch))}
            onSaveAttendance={saveAttendance}
          />
        )}

        {tab === 'loans' && (
          <Loans
            period={period}
            employees={employees}
            onReload={() => loadPayroll(periodId)}
          />
        )}

        {tab === 'employees' && (
          <Employees
            companies={companies}
            employees={employees}
            companyId={companyId}
            onCompany={pickCompany}
            onCreate={masterAction((body) => api.post('/employees', body))}
            onPatch={masterAction((id, patch) => api.patch(`/employees/${id}`, patch))}
            onDelete={masterAction((id) => api.del(`/employees/${id}`))}
            onBulkPatch={masterAction((ids, patch) =>
              // One reload at the end rather than one per employee.
              Promise.all(ids.map((id) => api.patch(`/employees/${id}`, patch)))
            )}
            onCreateCompany={masterAction((body) => api.post('/companies', body))}
            onPatchCompany={masterAction((id, patch) => api.patch(`/companies/${id}`, patch))}
            onDeleteCompany={masterAction((id) => api.del(`/companies/${id}`))}
          />
        )}

        {tab === 'hiring' && (
          <>
            {/*
              * This used to be the whole tab: one card saying hiring needs the
              * server, and nothing else. But only two things actually need it
              * - a candidate opening an apply link, and a CV file - and both
              * of those are at the edges. The openings, the people, the board,
              * interviews, the test results and, above all, putting somebody
              * on the payroll are just records, and this file already keeps
              * records. So they work here, and the two that cannot say so
              * where they are rather than blanking the module.
              */}
            {STANDALONE && (
              <p className="muted small">
                Offline: vacancies, candidates, the board, interviews, test scores and
                “Add to payroll” all work in this file. What needs the server version is
                the apply link a candidate opens and keeping their CV — an address on the
                internet and somewhere to put a file, neither of which a file on your
                laptop has.
              </p>
            )}
            <Hiring
              companies={companies}
              companyId={companyId}
              onEmployeesChanged={loadAll}
              onError={handle}
            />
          </>
        )}

        {tab === 'people' && (
          <People
            employees={employees}
            companies={companies}
            period={period}
            me={me}
            onError={handle}
            onReload={loadAll}
          />
        )}

        {tab === 'assets' && (
          <AssetsTab
            employees={employees}
            companies={companies}
            period={period}
            me={me}
            scanned={scanned}
            onScanned={() => setScanned('')}
            onError={handle}
            onReload={loadAll}
          />
        )}

        {tab === 'reports' && (
          <Reports
            period={period}
            payroll={payroll}
            onReload={loadAll}
            onGo={setTab}
            employees={employees}
            companies={companies}
          />
        )}

        {tab === 'admin' && (
          <Admin
            me={me}
            companies={companies}
            period={period}
            locked={locked}
            onPatchPeriod={patchPeriod}
            onError={handle}
            onReload={loadAll}
          />
        )}
      </main>
      </div>

      {payslip && period && (
        <Payslip
          period={period}
          row={payroll.rows.find((r) => r.id === payslip.id) || payslip}
          onClose={() => setPayslip(null)}
        />
      )}
    </div>
  );
}
