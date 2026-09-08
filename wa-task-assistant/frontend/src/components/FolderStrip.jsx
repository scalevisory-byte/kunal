import Icon from './Icon.jsx';
import { isDone } from '../lib/task.js';

/**
 * The businesses as a row of small tiles, above the list.
 *
 * The sidebar has them too, but the sidebar is navigation - it leaves the
 * board and opens a folder's own page. This is the other half: a filter you
 * press without going anywhere, so "just the Book N Fly ones" and back again
 * costs two clicks and no page change. It is also the only place the folders
 * are visible as a set while you are reading a list of mixed work, which is
 * exactly when you want to file something.
 *
 * Counts are of open work, taken from the same tasks the board is showing, so
 * the tiles and the sections agree. A set-aside folder is the one exception:
 * its work is deliberately off the board, so it reports the count the server
 * keeps and opens its own page rather than filtering a list it is not in.
 */
export default function FolderStrip({ groups = [], tasks = [], active, onPick, onOpenGroup, onManage }) {
  if (!groups.length) return null;

  const open = tasks.filter((t) => !isDone(t) && !t.group_separate);
  const loose = open.filter((t) => !t.group_id).length;
  const held = new Map();
  for (const task of open) {
    if (task.group_id) held.set(task.group_id, (held.get(task.group_id) || 0) + 1);
  }

  const tile = (key, label, count, extra = {}) => ({ key, label, count, ...extra });
  const tiles = [
    tile('all', 'All', open.length, { icon: 'list', on: !active }),
    ...groups.map((g) => tile(
      `g${g.id}`,
      g.name,
      g.separate ? (g.counts?.open || 0) : (held.get(g.id) || 0),
      { dot: g.colour || 'teal', on: active === g.id, group: g },
    )),
  ];
  if (loose) tiles.push(tile('none', 'No folder', loose, { icon: 'inbox', on: active === 'none' }));

  return (
    <div className="folder-strip" role="group" aria-label="Folders">
      <div className="folder-scroll">
        {tiles.map((t) => (
          <button
            key={t.key}
            className={`folder-tile ${t.on ? 'on' : ''} ${t.group?.separate ? 'aside' : ''}`}
            aria-pressed={t.on}
            title={t.group?.separate ? `${t.label} — kept out of the main list` : t.label}
            onClick={() => {
              if (t.group?.separate) onOpenGroup?.(t.group.id);
              else if (t.key === 'all') onPick(null);
              else if (t.key === 'none') onPick('none');
              else onPick(t.group.id);
            }}
          >
            {t.dot
              ? <span className={`board-dot c-${t.dot}`} aria-hidden="true" />
              : <Icon name={t.icon} size={14} />}
            <span className="folder-name">{t.label}</span>
            <span className="folder-count">{t.count}</span>
          </button>
        ))}
      </div>
      {onManage && (
        <button className="folder-tile add" onClick={onManage} title="Add or edit folders">
          <Icon name="plus" size={14} />
        </button>
      )}
    </div>
  );
}
