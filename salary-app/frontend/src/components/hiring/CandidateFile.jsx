import { useEffect, useState } from 'react';
import { STANDALONE, api } from '../../api.js';
import { SECTIONS } from '../../../../shared/interviewForm.js';
import { PARAMETERS, ratingLabel } from '../../../../shared/interviewEval.js';
import { DOCUMENT_KINDS, kindLabel } from '../../../../shared/documents.js';
import { buildTimeline } from '../../../../shared/candidateTimeline.js';

/**
 * A CANDIDATE'S WHOLE FILE, ON SCREEN.
 *
 * Dinesh: *"need candidate all history recorded here, from starting to end —
 * physical form, documents, evaluated form, test paper and answer sheet, A to
 * Z"*. Every piece of it existed and was reachable from somewhere else: the
 * particulars form from the Interviews tab, the answer sheet from a button,
 * the whole thing from a print that downloads a file. Six places and a
 * printout is not a record — a record is one page you scroll.
 *
 * It ASSEMBLES, it does not recalculate: every figure here was written by the
 * screen that owns it, and nothing on this page moves anybody a stage.
 */

const when = (v) => (v ? String(v).replace('T', ' ').slice(0, 16) : '');
const dayOf = (v) => (v ? String(v).slice(0, 10) : '');

/* ---------------------------------------------------------------- timeline */

export function Timeline({ data, history, onSheet }) {
  const events = buildTimeline({ ...data, history });
  if (!events.length) return null;
  return (
    <div className="card">
      <h3>Everything, in order</h3>
      <p className="muted small">
        Oldest first — this one reads as a story. Nothing here is worked out on this page; each
        line was written by the screen that owns it.
      </p>
      <div className="lines">
        {events.map((e, i) => (
          <div key={`${e.at}-${i}`}>
            <span className="what">
              <strong>{e.what}</strong>
              {e.detail ? <span className="muted small"> · {e.detail}</span> : null}
            </span>
            <span className="val">
              {dayOf(e.at)}
              {e.attemptId ? (
                <button className="tiny" style={{ marginLeft: '0.4rem' }} onClick={() => onSheet(e.attemptId)}>
                  Answer sheet
                </button>
              ) : null}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- documents */

export function CandidateDocuments({ candidateId, documents = [], onChanged, onError, onToast }) {
  const [kind, setKind] = useState('aadhaar');
  const [busy, setBusy] = useState(false);

  if (STANDALONE) {
    return (
      <div className="card">
        <h3>Documents</h3>
        <p className="muted small">
          Uploading needs the server — a file cannot live inside an HTML page on a laptop.
        </p>
      </div>
    );
  }

  const send = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const body = new FormData();
      body.append('document', file);
      body.append('kind', kind);
      await api.upload(`/hiring/candidates/${candidateId}/documents`, body);
      onToast?.('Saved.');
      onChanged();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h3>Documents</h3>
      {/*
        * NO "still missing" COUNT HERE, unlike the employee record.
        *
        * A candidate owes us nothing - somebody who applied this morning has
        * handed over nothing and is not incomplete. The KYC rule starts the
        * day they are hired, on their employee record, where it means
        * something.
        */}
      <p className="muted small">
        Anything they handed over — Aadhaar, PAN, a marksheet, the last payslip. The CV has its
        own box above. Nothing here is required.
      </p>

      {documents.length ? (
        <table className="sheet">
          <thead>
            <tr><th>What</th><th>File</th><th>Added</th><th /></tr>
          </thead>
          <tbody>
            {documents.map((d) => (
              <tr key={d.id}>
                <td>{kindLabel(d.kind)}</td>
                <td>
                  {d.link ? (
                    <a href={d.link.url} target="_blank" rel="noreferrer" download>
                      {d.link.filename}
                    </a>
                  ) : (
                    <span className="muted">missing from disk</span>
                  )}
                </td>
                <td className="muted small">{when(d.uploaded_at)}{d.uploaded_by ? ` · ${d.uploaded_by}` : ''}</td>
                <td>
                  <button
                    className="tiny"
                    onClick={async () => {
                      if (!window.confirm(`Remove ${kindLabel(d.kind)}? The file is deleted.`)) return;
                      try {
                        await api.del(`/hiring/candidates/${candidateId}/documents/${d.id}`);
                        onChanged();
                      } catch (err) {
                        onError(err);
                      }
                    }}
                  >
                    remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted small">Nothing on file yet.</p>
      )}

      <div className="row" style={{ marginTop: '0.6rem' }}>
        <select value={kind} onChange={(e) => setKind(e.target.value)} style={{ width: 'auto' }}>
          {DOCUMENT_KINDS.map((k) => (
            <option key={k.key} value={k.key}>{k.label}</option>
          ))}
        </select>
        <input
          type="file"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            send(file);
          }}
        />
        {busy ? <span className="muted small">Uploading…</span> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------- the form and the rating */

/** The particulars form, read-only, laid out by the same SECTIONS that fill it in. */
export function FilledForm({ values }) {
  if (!values) return null;
  return (
    <div className="file-form">
      {SECTIONS.map((section) => {
        const fields = (section.fields || []).filter((f) => {
          const v = values[f.key];
          return v !== null && v !== undefined && String(v).trim() !== '';
        });
        if (!fields.length) return null;
        return (
          <div key={section.key} style={{ marginTop: '0.6rem' }}>
            <p className="ask">{section.title}</p>
            <div className="lines">
              {fields.map((f) => (
                <div key={f.key}>
                  <span className="what">{f.label}</span>
                  <span className="val">{String(values[f.key])}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** What the interviewer scored them, out of five, with the words beside it. */
export function FilledEvaluation({ evaluation }) {
  if (!evaluation) return null;
  const ratings = evaluation.ratings || {};
  const given = PARAMETERS.filter((p) => ratings[p.key]);
  return (
    <div style={{ marginTop: '0.6rem' }}>
      {given.length ? (
        <div className="lines">
          {given.map((p) => (
            <div key={p.key}>
              <span className="what">{p.label}</span>
              <span className="val">
                {ratings[p.key]} / 5 <span className="muted small">{ratingLabel(ratings[p.key])}</span>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted small">Nothing rated yet.</p>
      )}
      {evaluation.strengths || evaluation.weaknesses || evaluation.remarks ? (
        <div className="lines" style={{ marginTop: '0.4rem' }}>
          {evaluation.strengths ? (
            <div><span className="what">Strengths</span><span className="val">{evaluation.strengths}</span></div>
          ) : null}
          {evaluation.weaknesses ? (
            <div><span className="what">Where they are weak</span><span className="val">{evaluation.weaknesses}</span></div>
          ) : null}
          {evaluation.remarks ? (
            <div><span className="what">Remarks</span><span className="val">{evaluation.remarks}</span></div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * One interview, opened out: the form they filled and the rating they got.
 *
 * Fetched only when it is OPENED. A candidate with four rounds would
 * otherwise pull eight documents to draw four collapsed lines.
 */
export function RoundDetail({ interviewId, hasForm, hasEvaluation, onError }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(null);
  const [evaluation, setEvaluation] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open || loaded || STANDALONE) return;
    (async () => {
      try {
        const [f, e] = await Promise.all([
          hasForm ? api.get(`/hiring/interviews/${interviewId}/form`) : Promise.resolve(null),
          hasEvaluation ? api.get(`/hiring/interviews/${interviewId}/evaluation`) : Promise.resolve(null),
        ]);
        setForm(f?.form || f || null);
        setEvaluation(e?.evaluation || e || null);
        setLoaded(true);
      } catch (err) {
        onError(err);
      }
    })();
  }, [open, loaded, hasForm, hasEvaluation, interviewId, onError]);

  if (!hasForm && !hasEvaluation) return null;
  return (
    <div style={{ marginTop: '0.3rem' }}>
      <button className="tiny" onClick={() => setOpen(!open)}>
        {open ? 'Close' : 'Read the form and the rating'}
      </button>
      {open ? (
        <div className="sub-card">
          {hasForm ? (
            <>
              <p className="ask" style={{ marginTop: 0 }}>Particulars form</p>
              {form ? <FilledForm values={form} /> : <p className="muted small">Loading…</p>}
            </>
          ) : null}
          {hasEvaluation ? (
            <>
              <p className="ask">Interviewer’s evaluation</p>
              {evaluation ? <FilledEvaluation evaluation={evaluation} /> : <p className="muted small">Loading…</p>}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
