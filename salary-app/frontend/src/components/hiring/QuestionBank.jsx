import { useEffect, useState } from 'react';
import { api, STANDALONE } from '../../api.js';
import { DIFFICULTIES, OPTION_KEYS, paperSize } from '../../../../shared/questionBank.js';

/**
 * The question bank and the papers drawn from it.
 *
 * Questions are grouped by a CATEGORY, which in practice is the position -
 * "Travel Consultant", "Accounts", "English". A paper then says how many to
 * draw from each, and every candidate gets a different selection.
 *
 * The office never sees a candidate's link here by accident: a paper is
 * assigned from the candidate's own application, where somebody is deciding
 * about one person.
 */
export default function QuestionBank({ companies, onError, onToast }) {
  const [view, setView] = useState('questions');
  const [categories, setCategories] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [papers, setPapers] = useState([]);
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState(null);
  const [paper, setPaper] = useState(null);

  const load = async () => {
    try {
      const [{ categories: cats }, { questions: qs }, { papers: ps }] = await Promise.all([
        api.get('/hiring/bank/categories'),
        api.get(`/hiring/bank/questions${filter ? `?category=${encodeURIComponent(filter)}` : ''}`),
        api.get('/hiring/papers'),
      ]);
      setCategories(cats);
      setQuestions(qs);
      setPapers(ps);
    } catch (err) {
      onError(err);
    }
  };

  useEffect(() => {
    if (!STANDALONE) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  if (STANDALONE) {
    return (
      <div className="card">
        <h2>Tests</h2>
        <p className="empty">
          A test is sat from a link over the internet, so it needs the server. This single file
          cannot hand one out.
        </p>
      </div>
    );
  }

  const saveQuestion = async (body) => {
    try {
      await api.put('/hiring/bank/questions', body);
      onToast(body.id ? 'Question saved' : 'Question added');
      setEditing(null);
      await load();
    } catch (err) {
      onError(err);
    }
  };

  const removeQuestion = async (id) => {
    try {
      const out = await api.del(`/hiring/bank/questions/${id}`);
      onToast(out.retired ? 'Retired — it has already been asked, so the record stays' : 'Deleted');
      await load();
    } catch (err) {
      onError(err);
    }
  };

  const savePaper = async (body) => {
    try {
      await api.put('/hiring/papers', body);
      onToast('Paper saved');
      setPaper(null);
      await load();
    } catch (err) {
      onError(err);
    }
  };

  return (
    <>
      <div className="row" style={{ marginBottom: '0.7rem' }}>
        <div className="chips">
          {[['questions', `Questions (${questions.length})`], ['papers', `Papers (${papers.length})`]].map(
            ([key, label]) => (
              <button key={key} className={view === key ? 'chip active' : 'chip'} onClick={() => setView(key)}>
                {label}
              </button>
            )
          )}
        </div>
        <span className="spacer" />
        {view === 'questions' ? (
          <button className="primary" onClick={() => setEditing({ marks: 1, negative_marks: 0, active: 1 })}>
            + Add question
          </button>
        ) : (
          <button
            className="primary"
            onClick={() => setPaper({ pass_percent: 50, duration_minutes: 20, sections: [{ category: '', count: 5 }] })}
          >
            + New paper
          </button>
        )}
      </div>

      {view === 'questions' ? (
        <div className="card scroll">
          <div className="chips" style={{ marginBottom: '0.5rem' }}>
            <button className={filter === '' ? 'chip active' : 'chip'} onClick={() => setFilter('')}>
              All positions
            </button>
            {categories.map((c) => (
              <button
                key={c.category}
                className={filter === c.category ? 'chip active' : 'chip'}
                onClick={() => setFilter(c.category)}
              >
                {c.category} ({c.usable})
              </button>
            ))}
          </div>
          <table className="sheet hiring-table">
            <thead>
              <tr>
                <th>Position / topic</th>
                <th className="grow">Question</th>
                <th>Answer</th>
                <th className="num">Marks</th>
                <th className="num">Negative</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {questions.map((q) => (
                <tr key={q.id} className={q.active ? '' : 'retired'}>
                  <td className="small">{q.category}</td>
                  <td>
                    {q.question}
                    {!q.active ? <span className="muted small"> · retired</span> : null}
                  </td>
                  {/*
                    * The right answer IS shown here - this is the office's own
                    * screen, behind a login. It is the candidate's copy that
                    * must never carry it, and that is enforced on the server.
                    */}
                  <td className="small">
                    {String(q.correct).toUpperCase()} · {q[`option_${q.correct}`]}
                  </td>
                  <td className="num">{q.marks}</td>
                  <td className="num">{q.negative_marks || '—'}</td>
                  <td className="row-actions">
                    <button onClick={() => setEditing(q)}>Edit</button>
                    <button className="danger" onClick={() => removeQuestion(q.id)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!questions.length ? (
            <p className="empty">
              No questions yet. Add them under a position — “Travel Consultant”, “Accounts” — and a
              paper draws from whichever positions it names.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="card scroll">
          <table className="sheet hiring-table">
            <thead>
              <tr>
                <th className="grow">Paper</th>
                <th>Draws</th>
                <th className="num">Questions</th>
                <th className="num">Pass</th>
                <th className="num">Minutes</th>
                <th className="num">Sat</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {papers.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td className="small">
                    {p.sections.map((s) => `${s.count} × ${s.category}`).join(', ') || '—'}
                  </td>
                  <td className="num">{p.questions}</td>
                  <td className="num">{p.pass_percent}%</td>
                  <td className="num">{p.duration_minutes}</td>
                  <td className="num">{p.attempts}</td>
                  <td className="row-actions">
                    <button onClick={() => setPaper(p)}>Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!papers.length ? (
            <p className="empty">
              No papers yet. A paper says how many questions to draw from each position — so every
              candidate gets a different set from the same bank.
            </p>
          ) : null}
        </div>
      )}

      {editing ? (
        <QuestionForm
          question={editing}
          categories={categories.map((c) => c.category)}
          onSave={saveQuestion}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {paper ? (
        <PaperForm
          paper={paper}
          companies={companies}
          categories={categories}
          onSave={savePaper}
          onClose={() => setPaper(null)}
        />
      ) : null}
    </>
  );
}

function QuestionForm({ question, categories, onSave, onClose }) {
  const [q, setQ] = useState(question);
  const set = (k, v) => setQ((old) => ({ ...old, [k]: v }));
  return (
    <div className="backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel">
        <header>
          <h1>{q.id ? 'Edit question' : 'New question'}</h1>
          <button className="close" onClick={onClose}>Close</button>
        </header>
        <label className="field">
          Position or topic
          <input list="bank-cats" value={q.category ?? ''} onChange={(e) => set('category', e.target.value)} />
          <datalist id="bank-cats">
            {categories.map((c) => <option key={c} value={c} />)}
          </datalist>
        </label>
        <label className="field">
          Question
          <textarea rows={2} value={q.question ?? ''} onChange={(e) => set('question', e.target.value)} />
        </label>
        {OPTION_KEYS.map((k) => (
          <label className="field" key={k}>
            <span>
              Option {k.toUpperCase()}
              {' '}
              <button
                className={String(q.correct).toLowerCase() === k ? 'chip active tiny' : 'chip tiny'}
                onClick={() => set('correct', k)}
                type="button"
              >
                {String(q.correct).toLowerCase() === k ? 'correct' : 'mark correct'}
              </button>
            </span>
            <input value={q[`option_${k}`] ?? ''} onChange={(e) => set(`option_${k}`, e.target.value)} />
          </label>
        ))}
        <div className="iv-grid">
          <label className="field">
            Marks
            <input type="number" step="0.5" value={q.marks ?? 1} onChange={(e) => set('marks', e.target.value)} />
          </label>
          <label className="field">
            Negative marks
            <input type="number" step="0.25" value={q.negative_marks ?? 0}
              onChange={(e) => set('negative_marks', e.target.value)} />
            <span className="muted small">Typed positive; it is subtracted for a wrong answer.</span>
          </label>
          <label className="field">
            Difficulty
            <select value={q.difficulty ?? ''} onChange={(e) => set('difficulty', e.target.value)}>
              <option value="">—</option>
              {DIFFICULTIES.map((d) => <option key={d}>{d}</option>)}
            </select>
          </label>
        </div>
        <footer className="iv-actions">
          <span className="spacer" />
          <button className="primary" onClick={() => onSave(q)}>Save question</button>
        </footer>
      </div>
    </div>
  );
}

function PaperForm({ paper, companies, categories, onSave, onClose }) {
  const [p, setP] = useState({ ...paper, sections: paper.sections?.length ? paper.sections : [{ category: '', count: 5 }] });
  const set = (k, v) => setP((old) => ({ ...old, [k]: v }));
  const setSection = (i, k, v) =>
    setP((old) => ({
      ...old,
      sections: old.sections.map((s, j) => (j === i ? { ...s, [k]: v } : s)),
    }));

  // What the bank can actually supply, so a paper asking for more than exists
  // says so here rather than at the moment a candidate opens it.
  const have = Object.fromEntries(categories.map((c) => [c.category, c.usable]));
  const short = p.sections.filter((s) => s.category && Number(s.count) > (have[s.category] || 0));

  return (
    <div className="backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel">
        <header>
          <h1>{p.id ? 'Edit paper' : 'New paper'}</h1>
          <button className="close" onClick={onClose}>Close</button>
        </header>
        <label className="field">
          Name
          <input value={p.name ?? ''} placeholder="Travel Consultant test"
            onChange={(e) => set('name', e.target.value)} />
        </label>
        <label className="field">
          Company
          <select value={p.company_id ?? ''} onChange={(e) => set('company_id', e.target.value || null)}>
            <option value="">Any</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>

        <h3>What it draws</h3>
        <p className="muted small">
          Every candidate gets a different selection from these — that is what makes the paper
          rotate.
        </p>
        {p.sections.map((s, i) => (
          <div className="row" key={i} style={{ gap: '0.4rem', marginBottom: '0.3rem' }}>
            <input type="number" min="0" style={{ width: '4.5rem' }} value={s.count ?? 0}
              onChange={(e) => setSection(i, 'count', e.target.value)} />
            <span className="muted small">from</span>
            <select value={s.category ?? ''} onChange={(e) => setSection(i, 'category', e.target.value)}>
              <option value="">Choose a position…</option>
              {categories.map((c) => (
                <option key={c.category} value={c.category}>{c.category} ({c.usable} in the bank)</option>
              ))}
            </select>
            <button onClick={() => setP((o) => ({ ...o, sections: o.sections.filter((_, j) => j !== i) }))}>
              Remove
            </button>
          </div>
        ))}
        <button onClick={() => setP((o) => ({ ...o, sections: [...o.sections, { category: '', count: 5 }] }))}>
          + Another position
        </button>

        {short.length ? (
          <p className="banner bad" style={{ marginTop: '0.6rem' }}>
            The bank cannot fill this yet: {short.map((s) => `${s.category} has ${have[s.category] || 0} of ${s.count}`).join('; ')}.
          </p>
        ) : null}

        <div className="iv-grid" style={{ marginTop: '0.6rem' }}>
          <label className="field">
            Pass mark %
            <input type="number" value={p.pass_percent ?? 50} onChange={(e) => set('pass_percent', e.target.value)} />
          </label>
          <label className="field">
            Minutes
            <input type="number" value={p.duration_minutes ?? 20}
              onChange={(e) => set('duration_minutes', e.target.value)} />
          </label>
        </div>
        <label className="field">
          Instructions shown to the candidate
          <textarea rows={2} value={p.instructions ?? ''} onChange={(e) => set('instructions', e.target.value)} />
        </label>

        <footer className="iv-actions">
          <span className="muted small">{paperSize(p.sections)} questions</span>
          <span className="spacer" />
          <button className="primary" onClick={() => onSave(p)}>Save paper</button>
        </footer>
      </div>
    </div>
  );
}
