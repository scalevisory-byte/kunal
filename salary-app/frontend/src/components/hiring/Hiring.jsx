import { useCallback, useEffect, useState } from 'react';
import { api, download } from '../../api.js';
import ApplicationPanel from './ApplicationPanel.jsx';
import CandidatePanel from './CandidatePanel.jsx';
import HiringOverview from './HiringOverview.jsx';
import HiringTasks from './HiringTasks.jsx';
import Interviews from './Interviews.jsx';
import NotifyBar from './NotifyBar.jsx';
import Pipeline from './Pipeline.jsx';
import VacancyPanel from './VacancyPanel.jsx';
import Vacancies from './Vacancies.jsx';
import Candidates from './Candidates.jsx';

const VIEWS = [
  ['overview', 'Overview'],
  ['pipeline', 'Pipeline'],
  ['openings', 'Openings'],
  ['candidates', 'Candidates'],
  ['interviews', 'Interviews'],
  ['tasks', 'Follow-ups'],
];

/**
 * The fifth HRMS module, and the one that feeds the other four: somebody hired
 * here becomes an employee row, so they land on the salary sheet and the
 * attendance grid without their name being typed twice.
 *
 * The company filter running across the rest of the app narrows this too - an
 * opening belongs to one of our companies, so "BOOKNFLY" on the strip above
 * means this tab shows BOOKNFLY's hiring.
 */
export default function Hiring({ companies, companyId, onEmployeesChanged, onError }) {
  const [view, setView] = useState('overview');
  const [config, setConfig] = useState(null);
  const [overview, setOverview] = useState(null);
  const [vacancies, setVacancies] = useState([]);
  const [applications, setApplications] = useState([]);
  const [candidates, setCandidates] = useState({ rows: [], total: 0 });
  const [candidateQuery, setCandidateQuery] = useState('');
  const [interviews, setInterviews] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [digest, setDigest] = useState(null);

  const [openVacancy, setOpenVacancy] = useState(null);
  const [openCandidate, setOpenCandidate] = useState(null);
  const [openApplication, setOpenApplication] = useState(null);
  const [notify, setNotify] = useState(null);
  const [toast, setToast] = useState('');

  const say = useCallback((message) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2200);
  }, []);

  const load = useCallback(async () => {
    try {
      const company = companyId ? `?company_id=${companyId}` : '';
      const [cfg, over, vac, apps, cands, ivs, tsk, dig] = await Promise.all([
        api.get('/hiring/config'),
        api.get('/hiring/overview'),
        api.get(`/hiring/vacancies${company}`),
        api.get(`/hiring/applications${company}`),
        api.get(`/hiring/candidates${candidateQuery ? `?q=${encodeURIComponent(candidateQuery)}` : ''}`),
        api.get('/hiring/interviews'),
        api.get('/hiring/tasks'),
        api.get('/hiring/digest'),
      ]);
      setConfig(cfg);
      setOverview(over);
      setVacancies(vac.vacancies);
      setApplications(apps.rows);
      setCandidates(cands);
      setInterviews(ivs.interviews);
      setTasks(tsk.tasks);
      setDigest(dig);
    } catch (err) {
      onError(err);
    }
  }, [companyId, candidateQuery, onError]);

  useEffect(() => {
    load();
  }, [load]);

  const guard = (fn) => async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      onError(err);
      throw err;
    }
  };

  const createVacancy = guard(async (body) => {
    await api.post('/hiring/vacancies', body);
    say('Saved as a draft');
    await load();
  });

  const patchVacancy = guard(async (id, body) => {
    await api.patch(`/hiring/vacancies/${id}`, body);
    await load();
  });

  const deleteVacancy = guard(async (id) => {
    await api.del(`/hiring/vacancies/${id}`);
    await load();
  });

  const createCandidate = guard(async (body) => {
    await api.post('/hiring/candidates', body);
    say('Added');
    await load();
  });

  const move = guard(async (id, stage) => {
    const res = await api.post(`/hiring/applications/${id}/stage`, { stage });
    await load();
    if (res.notify) {
      // The move on its own tells nobody anything, so the message it produced
      // goes into the corner with a send button on it.
      setNotify({ ...res.notify, who: res.application.candidate_name, stage });
    } else {
      say(`Moved to ${stage}`);
    }
  });

  // Somebody going on the payroll changes the employee list the rest of the
  // app is drawn from, so that has to be reloaded too.
  const afterChange = useCallback(async () => {
    await load();
    onEmployeesChanged?.();
  }, [load, onEmployeesChanged]);

  const exportCsv = (what) =>
    download(`/hiring/export/${what}.csv`, `${what}.csv`).catch(onError);

  return (
    <div className="hiring">
      <nav className="tabs sub-tabs" style={{ marginBottom: '0.9rem' }}>
        {VIEWS.map(([key, label]) => (
          <button key={key} className={view === key ? 'active' : ''} onClick={() => setView(key)}>
            {label}
          </button>
        ))}
        <span className="spacer" />
        {config?.public_url ? (
          <a className="btn" href="/jobs" target="_blank" rel="noreferrer">
            Careers page
          </a>
        ) : null}
      </nav>

      {view === 'overview' ? (
        <HiringOverview data={overview} onGo={setView} onOpenApplication={setOpenApplication} />
      ) : null}

      {view === 'pipeline' ? (
        <Pipeline
          applications={applications}
          vacancies={vacancies}
          onMove={move}
          onOpen={setOpenApplication}
          onExport={() => exportCsv('pipeline')}
        />
      ) : null}

      {view === 'openings' ? (
        <Vacancies
          vacancies={vacancies}
          companies={companies}
          companyId={companyId}
          onCreate={createVacancy}
          onPatch={patchVacancy}
          onDelete={deleteVacancy}
          onOpen={setOpenVacancy}
        />
      ) : null}

      {view === 'candidates' ? (
        <Candidates
          candidates={candidates.rows}
          total={candidates.total}
          query={candidateQuery}
          onQuery={setCandidateQuery}
          onCreate={createCandidate}
          onOpen={setOpenCandidate}
          onExport={() => exportCsv('candidates')}
        />
      ) : null}

      {view === 'interviews' ? (
        <Interviews interviews={interviews} onOpen={setOpenApplication} onReload={load} onError={onError} />
      ) : null}

      {view === 'tasks' ? (
        <HiringTasks
          followups={tasks}
          digest={digest}
          onReload={load}
          onOpen={setOpenApplication}
          onError={onError}
          onToast={say}
        />
      ) : null}

      {openVacancy ? (
        <VacancyPanel
          vacancyId={openVacancy}
          onClose={() => {
            setOpenVacancy(null);
            load();
          }}
          onPatch={patchVacancy}
          onOpenApplication={(id) => {
            setOpenVacancy(null);
            setOpenApplication(id);
          }}
          onToast={say}
          onError={onError}
        />
      ) : null}

      {openCandidate ? (
        <CandidatePanel
          candidateId={openCandidate}
          config={config}
          onClose={() => setOpenCandidate(null)}
          onChanged={load}
          onOpenApplication={(id) => {
            setOpenCandidate(null);
            setOpenApplication(id);
          }}
          onToast={say}
          onError={onError}
        />
      ) : null}

      {openApplication ? (
        <ApplicationPanel
          applicationId={openApplication}
          config={config}
          onClose={() => setOpenApplication(null)}
          onChanged={afterChange}
          onToast={say}
          onError={onError}
        />
      ) : null}

      <NotifyBar
        notify={notify}
        onDismiss={() => setNotify(null)}
        onCopy={async (text) => {
          await navigator.clipboard?.writeText(text);
          say('Copied');
        }}
      />

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}
