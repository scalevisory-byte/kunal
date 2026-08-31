import { useCallback, useEffect, useState } from 'react';
import { AuthError, api, clearToken, getToken, setToken } from './api.js';
import Attendance from './components/Attendance.jsx';
import Employees from './components/Employees.jsx';
import Login from './components/Login.jsx';
import Payslip from './components/Payslip.jsx';
import PeriodBar from './components/PeriodBar.jsx';
import Reports from './components/Reports.jsx';
import SalarySheet from './components/SalarySheet.jsx';

const TABS = [
  ['sheet', 'Salary sheet'],
  ['attendance', 'Attendance'],
  ['employees', 'Employees'],
  ['reports', 'Reports'],
];

const PERIOD_KEY = 'salary-app-period';

export default function App() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [authError, setAuthError] = useState('');

  const [tab, setTab] = useState('sheet');
  const [periods, setPeriods] = useState([]);
  const [periodId, setPeriodId] = useState(Number(localStorage.getItem(PERIOD_KEY)) || null);
  const [payroll, setPayroll] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [codes, setCodes] = useState({});
  const [payslip, setPayslip] = useState(null);
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

  // First load: a 401 sends us to the password screen instead of an error.
  useEffect(() => {
    (async () => {
      try {
        await api.get('/config');
        setAuthed(true);
      } catch (err) {
        if (!(err instanceof AuthError)) setError(err.message);
      } finally {
        setReady(true);
      }
    })();
  }, []);

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

  const masterAction = (fn) => async (...args) => {
    try {
      await fn(...args);
      await loadMaster();
      await loadPayroll(periodId);
    } catch (err) {
      handle(err);
      throw err;
    }
  };

  /* ---- render ---- */

  if (!ready) return <div className="loading">Loading…</div>;

  if (!authed) {
    return (
      <Login
        error={authError}
        onSubmit={async (password) => {
          setToken(password);
          try {
            await api.get('/config');
            setAuthed(true);
            setAuthError('');
          } catch (err) {
            clearToken();
            setAuthError(err instanceof AuthError ? 'Wrong password' : err.message);
          }
        }}
      />
    );
  }

  const period = periods.find((p) => p.id === periodId) || null;
  const locked = !!period?.locked;

  return (
    <div className="app">
      <header>
        <h1>Salary Sheet</h1>
        <PeriodBar
          periods={periods}
          period={period}
          onSelect={setPeriodId}
          onCreate={createPeriod}
          onPatch={patchPeriod}
          onSync={syncPeriod}
          onDelete={deletePeriod}
        />
        <nav className="tabs">
          {TABS.map(([key, label]) => (
            <button key={key} className={tab === key ? 'active' : undefined} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
          {getToken() && (
            <button
              className="ghost"
              onClick={() => {
                clearToken();
                setAuthed(false);
              }}
            >
              Sign out
            </button>
          )}
        </nav>
      </header>

      {error && (
        <p className="error banner">
          {error}
          <button className="ghost tiny" onClick={() => setError('')}>dismiss</button>
        </p>
      )}

      <main>
        {!period && tab !== 'employees' && (
          <p className="card muted">
            No month is open yet. Use <strong>New month</strong> above to start one — then add
            employees, or import last month's sheet from <strong>Reports</strong>.
          </p>
        )}

        {tab === 'sheet' && period && payroll && (
          <SalarySheet
            period={period}
            rows={payroll.rows}
            saving={saving}
            locked={locked}
            onPatchRow={patchRow}
            onPayslip={setPayslip}
          />
        )}

        {tab === 'attendance' && period && payroll && (
          <Attendance
            period={period}
            rows={payroll.rows}
            codes={codes}
            locked={locked}
            onSave={saveAttendance}
          />
        )}

        {tab === 'employees' && (
          <Employees
            companies={companies}
            employees={employees}
            onCreate={masterAction((body) => api.post('/employees', body))}
            onPatch={masterAction((id, patch) => api.patch(`/employees/${id}`, patch))}
            onDelete={masterAction((id) => api.del(`/employees/${id}`))}
            onCreateCompany={masterAction((body) => api.post('/companies', body))}
          />
        )}

        {tab === 'reports' && <Reports period={period} payroll={payroll} onReload={loadAll} />}
      </main>

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
