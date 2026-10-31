import { useEffect, useState } from 'react';
import { api } from '../api.js';

/** Every published opening, for a link that is shared once and kept. */
export default function Jobs() {
  const [brand, setBrand] = useState(null);
  const [jobs, setJobs] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        setBrand(await api.public.get('/config'));
        setJobs((await api.public.get('/vacancies')).vacancies);
      } catch {
        setJobs([]);
      }
    })();
  }, []);

  if (!jobs) return <p className="loading">Loading…</p>;

  return (
    <div className="public">
      <header>
        <span className="brand">{brand?.brand || 'Placement services'}</span>
        <h1>Open positions</h1>
        <span className="where">
          {jobs.length ? `${jobs.length} opening${jobs.length === 1 ? '' : 's'}` : 'Nothing open just now'}
        </span>
      </header>

      <ul className="jobs">
        {jobs.map((j) => (
          <li key={j.ref_no}>
            <a href={`/apply/${j.ref_no}`}>
              <div className="t">{j.title}</div>
              <div className="muted small">
                {[j.company, j.location, j.experience_band, j.salary].filter(Boolean).join(' · ')}
              </div>
            </a>
          </li>
        ))}
      </ul>

      {!jobs.length ? (
        <p className="empty">Check back soon, or message us and we will keep you in mind.</p>
      ) : null}

      {brand?.whatsapp ? (
        <p className="note" style={{ marginTop: '2rem' }}>
          <a href={`https://wa.me/${brand.whatsapp}`} target="_blank" rel="noreferrer">
            Message us on WhatsApp
          </a>
        </p>
      ) : null}
    </div>
  );
}
