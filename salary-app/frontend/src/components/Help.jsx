import { useEffect, useMemo, useRef, useState } from 'react';
import { HELP, searchHelp } from '../../../shared/help.js';
import { CHANGELOG, CURRENT, VERSION, since } from '../../../shared/version.js';
import Glyph from '../icons.jsx';

/**
 * Help, and what changed.
 *
 * Both are overlays rather than tabs, deliberately: the moment somebody needs
 * help is the moment they are halfway through something, and a tab would make
 * them leave it. Escape closes, the page behind is still there when it does.
 *
 * Neither reads anything from the server. The topics and the history are data
 * in `shared/`, so the single-file build carries exactly the same help the
 * hosted one does.
 */

/** `**bold**` only — enough to point at a word, no templating engine. */
function Rich({ text }) {
  const bits = String(text).split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {bits.map((bit, i) =>
        bit.startsWith('**') && bit.endsWith('**') ? (
          <strong key={i}>{bit.slice(2, -2)}</strong>
        ) : (
          <span key={i}>{bit}</span>
        )
      )}
    </>
  );
}

function Topic({ topic, onGo, onClose }) {
  return (
    <article className="help-topic">
      <h3>{topic.title}</h3>
      {(topic.lines || []).map((line, i) => (
        <p key={i}>
          <Rich text={line} />
        </p>
      ))}
      {/*
        * The trap, marked as one.
        *
        * Most of what is worth knowing about this app is what it will NOT do -
        * a pending request pays nobody, "not checked" is not "missing", the
        * machine's blank day is not an absence. Running those in with the rest
        * of the prose is how they get skimmed past.
        */}
      {topic.note ? (
        <p className="help-note">
          <Glyph name="alert" size={14} />
          <span>
            <Rich text={topic.note} />
          </span>
        </p>
      ) : null}
      {topic.tab && onGo ? (
        <button
          className="link-like"
          onClick={() => {
            onGo(topic.tab);
            onClose?.();
          }}
        >
          Open it →
        </button>
      ) : null}
    </article>
  );
}

export default function Help({ onClose, onGo, scope = 'office' }) {
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState(null);
  const box = useRef(null);

  // Staff see only what applies to them: their own page has no salary sheet,
  // no asset register and no imports, and offering help for them would send
  // somebody looking for a tab that is not there.
  const topics = useMemo(
    () => (scope === 'staff' ? HELP.filter((t) => t.staff) : HELP),
    [scope]
  );
  const results = useMemo(() => searchHelp(query, topics), [query, topics]);

  useEffect(() => {
    box.current?.focus();
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal help-panel" onClick={(e) => e.stopPropagation()}>
        <header className="help-head-row">
          <div>
            <h2>Help</h2>
            <p className="muted small">
              Search for anything — a screen, a word on it, or what you are trying to do.
            </p>
          </div>
          <button className="ghost" onClick={onClose} title="Close">
            <Glyph name="close" size={16} />
          </button>
        </header>

        <input
          ref={box}
          className="help-search"
          value={query}
          placeholder="leave, PF, sunday, excel, punch, payslip…"
          onChange={(e) => {
            setQuery(e.target.value);
            setOpenId(null);
          }}
        />

        {!results.length ? (
          <p className="empty">
            Nothing on “{query}”. Try a word that is on the screen you mean — or clear the box to
            see everything.
          </p>
        ) : (
          <>
            <p className="muted small">
              {query
                ? `${results.length} ${results.length === 1 ? 'topic' : 'topics'}`
                : `${results.length} topics — or type to search`}
            </p>
            <div className="help-list">
              {results.map(({ topic }) => (
                <div key={topic.id} className={openId === topic.id ? 'help-item open' : 'help-item'}>
                  <button
                    className="help-head"
                    onClick={() => setOpenId(openId === topic.id ? null : topic.id)}
                    aria-expanded={openId === topic.id}
                  >
                    <span className="help-title">{topic.title}</span>
                    <span className="help-chevron">{openId === topic.id ? '–' : '+'}</span>
                  </button>
                  {openId === topic.id ? (
                    <Topic topic={topic} onGo={onGo} onClose={onClose} />
                  ) : null}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * What changed, and when.
 *
 * Dinesh asked for this because the build stamp could say WHICH copy he had
 * and never what was in it — so a feature that had shipped read as missing
 * more than once.
 */
export function WhatsNew({ onClose, seen }) {
  const fresh = useMemo(() => new Set(since(seen).map((e) => e.version)), [seen]);

  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal help-panel" onClick={(e) => e.stopPropagation()}>
        <header className="help-head-row">
          <div>
            <h2>What’s new</h2>
            <p className="muted small">
              You are on <strong>v{VERSION}</strong> — {CURRENT.title}.
            </p>
          </div>
          <button className="ghost" onClick={onClose} title="Close">
            <Glyph name="close" size={16} />
          </button>
        </header>

        <div className="help-list">
          {CHANGELOG.map((entry) => (
            <section className="release" key={entry.version}>
              <h3>
                v{entry.version}
                <span className="muted small"> · {entry.date}</span>
                {fresh.has(entry.version) ? <span className="new-dot">new to you</span> : null}
              </h3>
              <p className="release-title">{entry.title}</p>
              <ul>
                {entry.items.map((item, i) => (
                  <li key={i}>
                    <Rich text={item} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
