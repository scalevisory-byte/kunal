import { CHANGELOG, CURRENT, compareVersions } from '../changelog.js';

const day = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString([], {
  day: 'numeric', month: 'short', year: 'numeric',
});

/**
 * Every version, newest first. `seenBefore` is the version this browser had
 * been shown before this visit, so what arrived since is marked New.
 */
export default function WhatsNew({ seenBefore, build }) {
  return (
    <div className="whatsnew">
      <p className="whatsnew-running">
        Running <strong>v{CURRENT.version}</strong>, released {day(CURRENT.date)}
        {build?.commit && <> · build <code>{build.commit}</code></>}
      </p>

      <ol className="whatsnew-list">
        {CHANGELOG.map((release) => {
          const isNew = seenBefore && compareVersions(release.version, seenBefore) > 0;
          return (
            <li key={release.version} className={`release ${isNew ? 'new' : ''}`}>
              <header className="release-head">
                <span className="release-version">v{release.version}</span>
                <h3>{release.title}</h3>
                {release === CURRENT && <span className="release-tag">Running now</span>}
                {isNew && <span className="release-tag new">New</span>}
                <time dateTime={release.date}>{day(release.date)}</time>
              </header>
              <ul>
                {release.changes.map((line) => <li key={line}>{line}</li>)}
              </ul>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
