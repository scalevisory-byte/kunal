import { useEffect, useRef, useState } from 'react';

/**
 * Renaming a task where it is read, by Excel's rules.
 *
 * One copy of the behaviour, because there are three lists that show a task
 * title and a rule that differed between them would be worse than no rule at
 * all: F2 or a double-click starts, Enter keeps, Escape throws away, clicking
 * elsewhere keeps - the same as stepping off a cell - and an empty title
 * cancels, because a task with no name is not a task.
 *
 * `openLater` exists because the browser reports the first click of a
 * double-click before the double-click itself. Without it the row's own open
 * had already fired and the second click landed on whatever that put in the
 * way. A fifth of a second is below what anybody notices and is what lets the
 * second click reach the title.
 */
export function useRename(task, onRename, { canEdit = true } = {}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const enabled = Boolean(onRename) && canEdit;

  const start = () => {
    clearTimeout(timer.current);
    if (!enabled) return;
    setDraft(task.title);
    setEditing(true);
  };

  const cancel = () => {
    setDraft(task.title);
    setEditing(false);
  };

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (!next || next === task.title) return;
    onRename(task, next);
  };

  const openLater = (open) => {
    clearTimeout(timer.current);
    if (!enabled) return open();
    timer.current = setTimeout(open, 180);
  };

  /** Everything the field needs, so no list has to remember the rules. */
  const fieldProps = {
    className: 't-title-edit',
    value: draft,
    autoFocus: true,
    'aria-label': `Rename ${task.title}`,
    onChange: (e) => setDraft(e.target.value),
    onFocus: (e) => e.target.select(),
    onBlur: commit,
    onKeyDown: (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      // Escape has to put the old title back before the blur that follows it,
      // or blurring would save the draft that was just abandoned.
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    },
    onClick: (e) => e.stopPropagation(),
    onDoubleClick: (e) => e.stopPropagation(),
  };

  return { editing, enabled, start, cancel, commit, openLater, fieldProps };
}
