import { useState } from 'react';
import { HIRING_STEPS } from '../../../../shared/hiringSteps.js';

/**
 * How an interview goes, on the tab where it happens.
 *
 * Folded away by default once somebody has closed it, and the choice is
 * remembered - a nine-step explainer above the list every single day becomes
 * something people scroll past, and then it is not an explainer.
 *
 * `useState` + localStorage rather than an uncontrolled <details>: this tab
 * reloads itself after every change, and a details element resets when React
 * re-renders around it. That cost a morning on the roll call's uniform fold.
 */
const KEY = 'bnf-hiring-steps-open';

export default function ProcessSteps({ onGo }) {
  const [open, setOpen] = useState(() => {
    try {
      return window.localStorage.getItem(KEY) !== 'no';
    } catch {
      // A private window throws on even touching localStorage, and a
      // convenience must not take the page down.
      return true;
    }
  });

  const toggle = () => {
    setOpen((was) => {
      try {
        window.localStorage.setItem(KEY, was ? 'no' : 'yes');
      } catch { /* nothing to do: it is only a preference */ }
      return !was;
    });
  };

  return (
    <div className="card steps-card">
      <button className="steps-head" onClick={toggle} aria-expanded={open}>
        <span className="steps-title">How an interview goes</span>
        <span className="muted small">
          {open ? 'hide' : `${HIRING_STEPS.length} steps — show`}
        </span>
      </button>

      {open ? (
        <ol className="steps">
          {HIRING_STEPS.map((s) => (
            <li key={s.n}>
              <span className="steps-n">{s.n}</span>
              <div>
                <strong>{s.title}</strong>
                <div className="muted small">
                  {onGo && s.where ? (
                    <button className="link-like" onClick={() => onGo(s.tab || tabFor(s.where))}>
                      {s.where}
                    </button>
                  ) : (
                    s.where
                  )}
                  {' · '}
                  {s.how}
                </div>
                {/*
                  * The thing about this step that is NOT obvious - mostly what
                  * it does not do. Each of these cost a bug to learn.
                  */}
                {s.note ? <div className="steps-note">{s.note}</div> : null}
              </div>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

/** The tab a step's "where" names, so the label is also the way there. */
function tabFor(where) {
  const first = String(where).split('→')[0].trim().toLowerCase();
  return (
    { candidates: 'candidates', screening: 'screening', interviews: 'interviews',
      vacancies: 'openings', tests: 'tests', reports: 'reports' }[first] || 'candidates'
  );
}
