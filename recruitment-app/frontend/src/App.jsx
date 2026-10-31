import { useCallback, useEffect, useState } from 'react';
import { AuthError, api, clearToken, download, getToken, setToken } from './api.js';
import Apply from './components/Apply.jsx';
import ApplicationPanel from './components/ApplicationPanel.jsx';
import CandidatePanel from './components/CandidatePanel.jsx';
import Candidates from './components/Candidates.jsx';
import Followups from './components/Followups.jsx';
import Interviews from './components/Interviews.jsx';
import Jobs from './components/Jobs.jsx';
import Login from './components/Login.jsx';
import NotifyBar from './components/NotifyBar.jsx';
import Overview from './components/Overview.jsx';
import Pipeline from './components/Pipeline.jsx';
import Placements from './components/Placements.jsx';
import Reports from './components/Reports.jsx';
import VacancyPanel from './components/VacancyPanel.jsx';
import Vacancies from './components/Vacancies.jsx';

const TABS = [
  ['overview', 'Overview'],
  ['pipeline', 'Pipeline'],
  ['vacancies', 'Vacancies'],
  ['candidates', 'Candidates'],
  ['interviews', 'Interviews'],
  ['followups', 'Follow-ups'],
  ['placements', 'Placements'],
  ['reports', 'Reports'],
];

/** Stamped in by vite.config.js, so a screenshot can be dated. */
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

/**
 * Two apps in one bundle, told apart by the path. /apply/REQ-003 and /jobs are
 * the candidate's side and have no password; everything else is the recruiter's
 * and does. No router: there are two public paths and the rest is tabs.
 */
export default function App() {
  const path = window.location.pathname;
  const applyMatch = path.match(/^\/apply\/([^/]+)/);
  if (applyMatch) return <Apply ref_no={decodeURIComponent(applyMatch[1])} />;
  if (path === '/jobs' || path === '/jobs/') return <Jobs />;
  return <Dashboard />;
}

function Dashboard() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [authError, setAuthError] = useState('');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const [tab, setTab] = useState('overview');
  const [config, setConfig] = useState(null);
  const [overview, setOverview] = useState(null);
  const [vacancies, setVacancies] = useState([]);
  const [applications, setApplications] = useState([]);
  const [candidates, setCandidates] = useState({ rows: [], total: 0 });
  const [candidateQuery, setCandidateQuery] = useState('');
  const [interviews, setInterviews] = useState([]);
  const [followups, setFollowups] = useState([]);
  const [digest, setDigest] = useState(null);
  const [placements, setPlacements] = useState({ placements: [], defaults: null });

  // The message a stage move produced, waiting to be sent.
  const [notify, setNotify] = useState(null);

  const [openVacancy, setOpenVacancy] = useState(null);
  const [openCandidate, setOpenCandidate] = useState(null);
  const [openApplication, setOpenApplication] = useState(null);

  const say = useCallback((message) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2200);
  }, []);

  const handle = useCallback((err) => {
    if (err instanceof AuthError) {
      clearToken();
      setAuthed(false);
      setAuthError('Session expired — enter the password again.');
      return;
    }
    setError(err.message);
    window.setTimeout(() => setError(''), 6000);
  }, []);

  const loadAll = useCallback(async () => {
    try {
      const [cfg, over, vac, apps, cands, ivs, fups, dig, place] = await Promise.all([
        api.get('/config'),
        api.get('/reports/overview'),
        api.get('/vacancies'),
        api.get('/applications'),
        api.get(`/candidates${candidateQuery ? `?q=${encodeURIComponent(candidateQuery)}` : ''}`),
        api.get('/interviews'),
        api.get('/followups'),
        api.get('/reports/digest'),
        api.get('/placements'),
      ]);
      setConfig(cfg);
      setOverview(over);
      setVacancies(vac.vacancies);
      setApplications(apps.rows);
      setCandidates(cands);
      setInterviews(ivs.interviews);
      setFollowups(fups.followups);
      setDigest(dig);
      setPlacements(place);
      setAuthed(true);
    } catch (err) {
      handle(err);
    } finally {
      setReady(true);
    }
  }, [candidateQuery, handle]);

  // First load. Only with a stored token: firing nine requests at a locked API
  // just to be told nine times that it is locked is nine 401s in the console
  // and a slower password screen.
  useEffect(() => {
    if (getToken()) loadAll();
    else setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Searching candidates goes to the server rather than filtering in the page,
  // because the whole list is not loaded.
  useEffect(() => {
    if (!authed) return;
    const t = window.setTimeout(async () => {
      try {
        setCandidates(await api.get(`/candidates${candidateQuery ? `?q=${encodeURIComponent(candidateQuery)}` : ''}`));
      } catch (err) {
        handle(err);
      }
    }, 250);
    return () => window.clearTimeout(t);
  }, [candidateQuery, authed, handle]);

  const signIn = async (password) => {
    setToken(password);
    setAuthError('');
    try {
      await api.get('/config');
      await loadAll();
    } catch (err) {
      clearToken();
      setAuthError(err instanceof AuthError ? 'Wrong password' : err.message);
    }
  };

  const guard = (fn) => async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      handle(err);
      throw err;
    }
  };

  const createVacancy = guard(async (body) => {
    await api.post('/vacancies', body);
    say('Saved as a draft');
    await loadAll();
  });

  const patchVacancy = guard(async (id, body) => {
    await api.patch(`/vacancies/${id}`, body);
    await loadAll();
  });

  const deleteVacancy = guard(async (id) => {
    await api.del(`/vacancies/${id}`);
    await loadAll();
  });

  const createCandidate = guard(async (body) => {
    await api.post('/candidates', body);
    say('Added');
    await loadAll();
  });

  const move = guard(async (id, stage) => {
    const res = await api.post(`/applications/${id}/stage`, { stage });
    await loadAll();
    if (res.notify) {
      // The move on its own tells nobody anything, so the message it produced
      // goes straight into the corner with a send button on it.
      setNotify({ ...res.notify, who: res.application.candidate_name, stage });
    } else {
      say(`Moved to ${stage}`);
    }
  });

  const exportCsv = (what) =>
    download(`/reports/export/${what}.csv`, `${what}.csv`).catch(handle);

  if (!ready) return <p className="loading">Loading…</p>;
  if (!authed) return <Login onSubmit={signIn} error={authError} brand={config?.brand} />;

  const joinable = applications.filter((a) => a.stage === 'Selected' || a.stage === 'Joined');
  const counts = {
    pipeline: applications.length,
    vacancies: vacancies.filter((v) => v.status === 'published').length,
    candidates: candidates.total,
    interviews: interviews.filter((i) => i.status === 'Scheduled').length,
    followups: followups.filter((f) => f.status === 'open').length,
    placements: placements.placements.length,
  };

  return (
    <div className="app">
      <header>
        <div className="row">
          <h1>
            {config?.brand || 'Recruitment'}
            {BUILT_ON ? <span className="built">build {BUILT_ON}</span> : null}
          </h1>
          <span className="spacer" />
          {config?.public_url ? (
            <a className="btn" href="/jobs" target="_blank" rel="noreferrer">
              Open the jobs page
            </a>
          ) : null}
          <button
            onClick={() => {
              clearToken();
              setAuthed(false);
            }}
          >
            Lock
          </button>
        </div>
        {!config?.auth_required ? (
          <div className="banner bad">
            APP_PASSWORD is not set, so anyone who can reach this URL can read every
            candidate&apos;s details. Set it before this is deployed.
          </div>
        ) : null}
        <nav className="tabs">
          {TABS.map(([key, label]) => (
            <button key={key} className={tab === key ? 'on' : ''} onClick={() => setTab(key)}>
              {label}
              {counts[key] ? <span className="pip">{counts[key]}</span> : null}
            </button>
          ))}
        </nav>
      </header>

      <main>
        {error ? <div className="banner bad">{error}</div> : null}

        {tab === 'overview' ? (
          <Overview data={overview} onGo={setTab} onOpenApplication={setOpenApplication} />
        ) : null}

        {tab === 'pipeline' ? (
          <Pipeline
            applications={applications}
            vacancies={vacancies}
            onMove={move}
            onOpen={setOpenApplication}
            onExport={() => exportCsv('pipeline')}
          />
        ) : null}

        {tab === 'vacancies' ? (
          <Vacancies
            vacancies={vacancies}
            onCreate={createVacancy}
            onPatch={patchVacancy}
            onDelete={deleteVacancy}
            onOpen={setOpenVacancy}
          />
        ) : null}

        {tab === 'candidates' ? (
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

        {tab === 'interviews' ? (
          <Interviews
            interviews={interviews}
            onOpen={setOpenApplication}
            onReload={loadAll}
            onError={handle}
          />
        ) : null}

        {tab === 'followups' ? (
          <Followups
            followups={followups}
            digest={digest}
            onReload={loadAll}
            onOpen={setOpenApplication}
            onError={handle}
            onToast={say}
          />
        ) : null}

        {tab === 'placements' ? (
          <Placements
            placements={placements.placements}
            defaults={placements.defaults}
            joinable={joinable}
            onReload={loadAll}
            onExport={() => exportCsv('placements')}
            onError={handle}
            onToast={say}
          />
        ) : null}

        {tab === 'reports' ? (
          <Reports overview={overview} config={config} onExport={exportCsv} />
        ) : null}
      </main>

      {openVacancy ? (
        <VacancyPanel
          vacancyId={openVacancy}
          onClose={() => {
            setOpenVacancy(null);
            loadAll();
          }}
          onPatch={patchVacancy}
          onOpenApplication={(id) => {
            setOpenVacancy(null);
            setOpenApplication(id);
          }}
          onToast={say}
          onError={handle}
        />
      ) : null}

      {openCandidate ? (
        <CandidatePanel
          candidateId={openCandidate}
          config={config}
          onClose={() => setOpenCandidate(null)}
          onChanged={loadAll}
          onOpenApplication={(id) => {
            setOpenCandidate(null);
            setOpenApplication(id);
          }}
          onToast={say}
          onError={handle}
        />
      ) : null}

      {openApplication ? (
        <ApplicationPanel
          applicationId={openApplication}
          config={config}
          onClose={() => setOpenApplication(null)}
          onChanged={loadAll}
          onToast={say}
          onError={handle}
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
