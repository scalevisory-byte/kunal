import { useState } from 'react';
import Icon from './Icon.jsx';
import { api } from '../api.js';

/**
 * Tidying up the titles already on the list.
 *
 * Case is fixed by rule when a task is created — a shouted title is put into
 * readable case, a lower-case one has its first letter raised and its acronyms
 * restored. Spelling and proper nouns are not: no rule knows that "odisha" is a
 * place, that "nidhi" is a person, or which word "pendig" was meant to be, and
 * a rule that guessed would eventually rewrite somebody's name into a different
 * word. That needs the model.
 *
 * Two reasons it is a button rather than something that happens on its own: it
 * costs an API call, and titles typed by hand never go near the model at all,
 * so this is the only place they can be reached. It proposes and waits —
 * a title is read back for weeks, and one quietly rewritten into something
 * unrecognisable is worse than the typo it fixed.
 */
export default function TidyTitles({ onError, onChanged }) {
  const [state, setState] = useState('idle');
  const [proposals, setProposals] = useState([]);
  const [skipped, setSkipped] = useState(new Set());
  const [result, setResult] = useState(null);

  const look = async () => {
    setState('looking');
    setResult(null);
    try {
      const { proposals: found, considered } = await api.tidyPreview();
      setProposals(found);
      setSkipped(new Set());
      setState('looked');
      if (!found.length) setResult(`Looked at ${considered} titles — they all read fine.`);
    } catch (err) {
      setState('idle');
      onError(err);
    }
  };

  const apply = async () => {
    const wanted = proposals.filter((p) => !skipped.has(p.id)).map((p) => ({ id: p.id, title: p.to }));
    if (!wanted.length) return;
    setState('applying');
    try {
      const { applied } = await api.tidyApply(wanted);
      setProposals([]);
      setState('idle');
      setResult(`${applied.length} ${applied.length === 1 ? 'title' : 'titles'} tidied.`);
      onChanged?.();
    } catch (err) {
      setState('looked');
      onError(err);
    }
  };

  const toggle = (id) =>
    setSkipped((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const keeping = proposals.filter((p) => !skipped.has(p.id)).length;

  return (
    <section className="settings-block">
      <header className="settings-head">
        <h3>Tidy up titles</h3>
        <span>{state === 'looking' ? 'Reading them…' : 'Costs one AI call'}</span>
      </header>

      <div className="set-row">
        <div className="set-label">
          <strong>Spelling, names, and what a task is actually about</strong>
          <small>
            Shouting and lower case are fixed when a task is made. Spelling and names are
            not — no rule knows that &ldquo;odisha&rdquo; is a place or which word
            &ldquo;pendig&rdquo; was meant to be, and one that guessed would eventually
            rewrite somebody&rsquo;s name.{' '}
            {/*
              * The reason the button exists twice over now: a title naming only
              * a person cannot be told apart from the next one with the same
              * person, and the subject is in the message it came from.
              */}
            It also fills in titles that name only a person — &ldquo;Talk with Vikas
            Gupta&rdquo; — using the original WhatsApp message, so two different
            conversations stop reading as the same task. Nothing is invented: where the
            message does not say what it was about either, the title is left alone.
            This asks Claude, shows you every change it wants to make, and applies only
            the ones you keep.
          </small>
        </div>
        <div className="set-control">
          <button className="btn" onClick={look} disabled={state === 'looking' || state === 'applying'}>
            {state === 'looking' ? 'Reading…' : 'See what would change'}
          </button>
        </div>
      </div>

      {result && <p className="field-note ok-text">{result}</p>}

      {proposals.length > 0 && (
        <>
          <ul className="tidy-list">
            {proposals.map((p) => {
              const off = skipped.has(p.id);
              return (
                <li key={p.id} className={off ? 'off' : ''}>
                  <label className="check-inline">
                    <input type="checkbox" checked={!off} onChange={() => toggle(p.id)} />
                    <span className="tidy-pair">
                      <s>{p.from}</s>
                      <b><Icon name="arrowRight" size={13} /> {p.to}</b>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>

          <div className="template-form-foot">
            <button className="btn primary" onClick={apply} disabled={!keeping || state === 'applying'}>
              {state === 'applying' ? 'Applying…' : `Apply ${keeping}`}
            </button>
            <button className="btn ghost" onClick={() => { setProposals([]); setState('idle'); }}>
              Cancel
            </button>
          </div>
        </>
      )}
    </section>
  );
}
