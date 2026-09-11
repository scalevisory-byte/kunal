import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

/**
 * Only meaningful in AI mode: names listed here are never read or stored.
 * Matching is loose, so "Mummy" also blocks "Mummy ❤️".
 */
/**
 * A name with the spacing and punctuation taken out.
 *
 * The same rule the server blocks by, so what this list shows as a match is
 * exactly what blocking it would catch. "shubham prajapati" is filed as
 * `shubhamprajapatis747`, and a literal search for it finds nothing - which is
 * how five of seven blocks added in one evening never fired.
 */
const flatten = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * How long ago, in the words a person would use.
 *
 * The server stores UTC without a zone marker, which `new Date()` would read as
 * local time and report as hours in the future.
 */
const ago = (stamp) => {
  if (!stamp) return '';
  const at = new Date(`${String(stamp).replace(' ', 'T')}Z`);
  const mins = Math.round((Date.now() - at.getTime()) / 60000);
  if (!Number.isFinite(mins)) return '';
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
};

export default function BlockedChats({ mode, onError }) {
  const [open, setOpen] = useState(false);
  const [blocked, setBlocked] = useState([]);
  const [recent, setRecent] = useState([]);
  const [effect, setEffect] = useState([]);
  const [value, setValue] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await api.blockedChats();
      setBlocked(data.blocked);
      setRecent(data.recent);
      setEffect(data.effect || []);
    } catch (err) {
      onError?.(err);
    }
  }, [onError]);

  // Load on mount so the toggle can show the count without being opened first.
  useEffect(() => {
    if (mode === 'ai') load();
  }, [mode, load]);

  const add = async (pattern) => {
    const trimmed = String(pattern || '').trim();
    if (!trimmed) return;
    try {
      await api.blockChat(trimmed);
      setValue('');
      // Reloaded rather than patched, because what matters next is what the
      // block actually caught - and only the server can say.
      await load();
    } catch (err) {
      onError?.(err);
    }
  };

  const remove = async (id) => {
    try {
      await api.unblockChat(id);
      await load();
    } catch (err) {
      onError?.(err);
    }
  };

  if (mode !== 'ai') return null;

  /*
   * The box searches the chats the app has actually seen.
   *
   * It used to be a plain pattern field with eight of the most recent chats
   * under it, which is fine only if the chat you want is one of those eight -
   * and the one you want to block is usually a group you have stopped reading,
   * so it is not. Typing now filters every chat on record by name, and pressing
   * Block still blocks exactly what was typed, so a chat that has never sent a
   * message can be blocked before it does.
   */
  const query = value.trim().toLowerCase();
  /*
   * Already-covered chats leave the list.
   *
   * The server marks them, because a pattern covers a chat by its rule and not
   * by being equal to its name - "aditya" blocks "Aditya Consultancy", and
   * offering that chat again to be blocked reads as if the first block failed.
   */
  const available = recent.filter((c) => c.chat_name && !c.blocked);

  const flatQuery = flatten(query);
  const matches = query
    ? available
      .filter((c) => (flatQuery
        ? flatten(c.chat_name).includes(flatQuery)
        : c.chat_name.toLowerCase().includes(query)))
      // When searching, the loudest match first: that is the one worth blocking.
      .sort((a, b) => b.messages - a.messages)
      .slice(0, 12)
    : available.slice(0, 8);

  return (
    <section className="panel-block">
      <button className="link block-toggle" onClick={() => setOpen((v) => !v)}>
        {open ? 'Hide' : 'Manage'} blocked chats{blocked.length ? ` (${blocked.length})` : ''}
      </button>

      {open && (
        <div className="block-body">
          <p className="hint">
            Chats listed here are never read and never stored. Part of a name is enough.
            Blocking a <b>group</b> blocks the whole group — nothing anybody writes in it
            is read.{' '}
            {/*
              * Said here because the figures beside each block raise it: a large
              * count against a block that is now working is the normal shape of
              * a fix, and only the "since the app restarted" figure is a fault.
              */}
            The count beside each one is everything that got through since you added it —
            what matters is whether any arrived <b>since the app restarted</b>, because
            that is the version running now.
          </p>

          <form
            className="add-row"
            onSubmit={(event) => {
              event.preventDefault();
              add(value);
            }}
          >
            <input
              className="grow"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="Search a chat, or type a name or number…"
              autoComplete="off"
            />
            <button className="btn primary" type="submit" disabled={!value.trim()}>
              Block
            </button>
          </form>

          {blocked.length > 0 && (
            /*
             * Each block with what it actually stopped.
             *
             * A bare list of names cannot answer the only question anybody asks
             * of it - "I added these, why are the messages still coming?" - and
             * the answer is usually that the name here is not the name the chat
             * is filed under. Since a blocked chat is dropped before anything is
             * stored, "nothing since" is proof, not a guess.
             */
            <ul className="block-list">
              {blocked.map((b) => {
                const e = effect.find((x) => x.id === b.id) || {};
                /*
                 * Leaking means leaking NOW.
                 *
                 * A block added last night, with the matching fixed this
                 * evening, has a large "since" behind it and is working
                 * perfectly. What separates the two is whether anything has
                 * arrived since the version now running came up.
                 */
                const state = e.sinceBoot > 0 ? 'leaking' : e.since > 0 ? 'mixed' : e.before > 0 ? 'working' : 'idle';
                return (
                  <li key={b.id} className={state}>
                    <span className="bl-name">{b.pattern}</span>
                    <span className="bl-state">
                      {e.sinceBoot > 0
                        ? `${e.sinceBoot} arrived since the app restarted`
                        : e.since > 0
                          ? `${e.since} got through before the last restart — none since`
                          : e.before > 0
                            ? `nothing since — ${e.before} read before`
                            : e.suggest
                              ? `never matched — did you mean “${e.suggest}”?`
                              : 'never matched a message'}
                    </span>
                    {/* Only while it is still arriving: beside "none since the
                        restart", a timestamp reads like a contradiction. */}
                    {e.lastAt && e.sinceBoot > 0 && <span className="bl-when">last {ago(e.lastAt)}</span>}
                    {e.suggest && !e.since && !e.before && (
                      <button className="link" onClick={() => add(e.suggest)}>
                        Block that instead
                      </button>
                    )}
                    {/*
                      * A group whose name WhatsApp had not resolved was stored
                      * under its id, so the name this block is written against
                      * did not exist when the message arrived. The id did.
                      */}
                    {e.sinceBoot > 0 && (e.ids || []).map((id) => (
                      <button
                        key={id}
                        className="link"
                        title="A group WhatsApp had not named yet is stored under its id, so a block written against the name could not match. The id never changes."
                        onClick={() => add(id)}
                      >
                        Block its id too
                      </button>
                    ))}
                    <button className="chip-x" onClick={() => remove(b.id)} aria-label={`Unblock ${b.pattern}`}>
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {matches.length > 0 && (
            <>
              <p className="hint">
                {query
                  ? `${matches.length} chat${matches.length === 1 ? '' : 's'} match — tap to block:`
                  : 'Recent chats — tap to block:'}
              </p>
              <ul className="chip-list">
                {matches.map((c) => (
                  <li key={c.chat_id}>
                    <button className="chip ghost" onClick={() => add(c.chat_name)}>
                      {c.chat_name}
                      {/* Which of these is a group matters here more than anywhere
                          else: blocking one silences every person in it. */}
                      {Boolean(c.is_group) && <span className="chip-tag">group</span>}
                      <span className="chip-count">{c.messages}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {/*
            * Nothing matched, which is not a dead end: the name is still
            * blockable. A chat that has never sent a message is not on this
            * list and is exactly the one you would want to block in advance.
            */}
          {query && matches.length === 0 && (
            <p className="hint warn">
              <b>No chat on record matches “{value.trim()}”.</b> Blocking it will stop
              nothing that is arriving now — a block only fires on the name a chat is
              actually filed under. Search for the chat above and tap it instead. Press{' '}
              <b>Block</b> only if you mean a chat that has not written yet.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
