import { useCallback, useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import { api } from '../api.js';
import { spanLabel, tooSoonToTell } from '../lib/task.js';

const money = (usd) => (usd >= 1 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(4)}`);

/*
 * Rupees, to the paisa until the figures get big.
 *
 * Rounded to whole rupees this read "₹88" beside a note saying "at ₹88 per $",
 * and there was no way to tell the amount from the rate — they happened to be
 * the same number. Two decimals until a thousand keeps them distinguishable
 * and matches how a bill this size is actually read.
 */
const rupees = (usd, rate) => {
  const inr = usd * rate;
  return `₹${inr >= 1000 ? Math.round(inr).toLocaleString('en-IN') : inr.toFixed(2)}`;
};
const tokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/** What each spender is, in the words of the person paying for it. */
const KIND = {
  extract: { label: 'Reading chats', note: 'Turning WhatsApp messages into tasks' },
  tidy: { label: 'Tidy up titles', note: 'Only when you press the button' },
  law_digest: { label: 'Law digest', note: 'One run each morning' },
};

const dayLabel = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString([], { day: 'numeric', month: 'short', timeZone: 'UTC' });

/**
 * What the AI has cost. Every token count here was reported by the API on a
 * real call; the money is those counts at Anthropic's published list prices.
 * It is an estimate, and the page says so - the bill itself is in the Console.
 */
export default function UsagePage({ onError }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.usage(30));
    } catch (err) {
      onError(err);
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  if (loading && !data) {
    return <div className="empty" aria-busy="true"><strong>Loading usage…</strong></div>;
  }
  if (!data) return null;

  const {
    today, month, total, days, prices, usdInr,
    byKind = [], chats = [], quiet = [], blocking = [], bootedAt = null, caching,
  } = data;
  const nothingYet = total.calls === 0;

  /*
   * What a single call carries.
   *
   * The figure that explains the bill. Every call sends the same instructions
   * and the same business list before it sends a word of WhatsApp, so a day of
   * six hundred small calls is mostly the same three thousand tokens six
   * hundred times over. Tokens-per-call next to messages-per-call is that
   * sentence as two numbers.
   */
  const perCall = total.calls
    ? {
      tokens: Math.round((total.input_tokens + total.cache_read) / total.calls),
      messages: (total.messages / total.calls).toFixed(1),
    }
    : null;

  return (
    <div className="usage">
      <section className="kpis">
        {[
          { key: 'today', label: 'Today', usd: today.usd, note: `${today.calls || 0} AI ${today.calls === 1 ? 'run' : 'runs'}` },
          { key: 'month', label: 'This month', usd: month.usd, note: `${month.tasks} tasks created` },
          { key: 'total', label: 'All time', usd: total.usd, note: total.since ? `since ${dayLabel(total.since)}` : 'nothing yet' },
        ].map((c) => (
          <div key={c.key} className="kpi static">
            <span className="kpi-top">
              <span className="kpi-label">{c.label}</span>
            </span>
            {/* Rupees lead: this is what the bill will feel like to the person
                reading it. The dollars stay because that is the currency
                Anthropic actually charges in, and the only one that is not an
                estimate on top of an estimate. */}
            <span className="kpi-num">{rupees(c.usd, usdInr)}</span>
            <span className="kpi-note"><b className="kpi-usd">{money(c.usd)}</b> · {c.note}</span>
          </div>
        ))}
        <div className="kpi static">
          <span className="kpi-top"><span className="kpi-label">Tokens all time</span></span>
          <span className="kpi-num">{tokens(total.input_tokens + total.output_tokens)}</span>
          <span className="kpi-note">
            {tokens(total.input_tokens)} in · {tokens(total.output_tokens)} out
          </span>
        </div>
      </section>

      <div className="usage-note">
        <Icon name="alert" size={16} />
        <p>
          This is an <b>estimate</b>: token counts reported by the API, priced at Anthropic&rsquo;s
          published rates for <code>{data.model}</code>
          {prices && <> (${prices.input}/M in, ${prices.output}/M out)</>}. Your actual bill is in
          the Anthropic Console — this app cannot read it. Rupees are converted at a fixed
          <b> ₹{usdInr} to the dollar</b> — not a live rate — which you can change with{' '}
          the <code>USD_INR</code> variable.
        </p>
      </div>

      {!nothingYet && (
        <section className="usage-where">
          <header className="section-head static">
            <h3>Where it goes</h3>
            <span className="section-count">last 30 days</span>
          </header>

          <ul className="usage-kinds">
            {byKind.map((k) => (
              <li key={`${k.kind}-${k.model}`}>
                <span className="k-name">{KIND[k.kind]?.label || k.kind}</span>
                <span className="k-note">{KIND[k.kind]?.note || ''}</span>
                <span className="k-calls">{k.calls} {k.calls === 1 ? 'run' : 'runs'}</span>
                <span className="k-tokens">{tokens(k.input_tokens + k.cache_read)}</span>
                <span className="k-cost">{rupees(k.usd, usdInr)}</span>
              </li>
            ))}
          </ul>

          {perCall && (
            <p className="usage-explain">
              Each run carries <b>{tokens(perCall.tokens)} tokens</b> and reads{' '}
              <b>{perCall.messages} messages</b> on average. Most of that is the same
              instructions and business list sent again every time — which is why the
              number of runs matters more than the number of messages.
              {caching && (caching.working
                ? <> They are now cached: <b>{tokens(caching.read)}</b> tokens have been
                  served from cache at a tenth of the price.</>
                : <> They are <b>not</b> being cached
                  {caching.minimum
                    ? <>: <code>{data.model}</code> only caches a prompt of{' '}
                      {caching.minimum.toLocaleString()} tokens or more, and this one is
                      shorter</>
                    : ''}
                  . Fewer runs is what brings this down, which is what the
                  batching window is for.</>)}
            </p>
          )}

          <CacheReach caching={caching} model={data.model} />

          {blocking.length > 0 && <BlockEffect rows={blocking} bootedAt={bootedAt} />}

          {chats.length > 0 && (
            <>
              <header className="section-head static second">
                <h3>Busiest chats</h3>
                <span className="section-count">messages read · last 30 days</span>
              </header>
              <p className="usage-explain">
                Every message read is a message paid for. A chat near the top with no
                tasks beside it is cost with nothing to show for it — block it in
                Settings and it stops being read at all.{' '}
                {/*
                  * Said here because it is the question this list kept raising:
                  * the figures cover thirty days, so a chat blocked yesterday
                  * still shows what it cost before that. Whether the block is
                  * working is a different figure, and it is above.
                  */}
                These are the last 30 days, so a chat you blocked yesterday still
                shows what it cost <em>before</em> that — the panel above says
                whether anything has arrived since.
              </p>
              <ul className="usage-list chats">
                {chats.slice(0, 12).map((c) => (
                  <ChatRow
                    key={`${c.chat}-${c.is_group}`}
                    chat={c}
                    widest={chats[0].messages}
                    onError={onError}
                  />
                ))}
              </ul>

              {quiet.length > 0 && (
                <>
                  <header className="section-head static second">
                    <h3>Who is sending them</h3>
                    <span className="section-count">messages that made no task</span>
                  </header>
                  <ul className="quiet-senders">
                    {quiet.slice(0, 10).map((q) => (
                      <li key={`${q.chat}-${q.sender}`}>
                        <b>{q.sender}</b>
                        {/* `q.is_group && …` printed a bare 0 for one-to-one chats:
                            0 is falsy but React renders it. The question is
                            whether the chat adds anything the sender's name
                            does not, which is what this asks instead. */}
                        {q.chat && q.chat !== q.sender && <span className="q-in">in {q.chat}</span>}
                        <span className="q-count">{q.messages}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </section>
      )}

      <section className="usage-days">
        <header className="section-head static">
          <h3>Daily</h3>
          <span className="section-count">last 30 days</span>
        </header>

        {nothingYet ? (
          <div className="empty">
            <strong>No AI runs recorded yet.</strong>
            <p>
              {data.mode === 'ai'
                ? 'Cost appears here once messages start arriving and being read.'
                : 'Capture mode is manual, so no AI is used and nothing is charged.'}
            </p>
          </div>
        ) : (
          <ul className="usage-list">
            {days.map((d) => {
              const share = total.usd > 0 ? Math.round((d.usd / total.usd) * 100) : 0;
              return (
                <li key={`${d.day}-${d.model}`}>
                  <span className="u-day">{dayLabel(d.day)}</span>
                  <span className="u-bar"><span style={{ width: `${Math.max(share, 2)}%` }} /></span>
                  {/*
                    * Runs and messages, not just tasks.
                    *
                    * Without them the list invited a question it could not
                    * answer: a day with more tasks costing less than a day with
                    * fewer. The bill follows what was READ - the runs, each
                    * carrying the same preamble, and the messages inside them -
                    * and tasks are what came out the other end. Showing only
                    * the output made the cost look arbitrary.
                    */}
                  <span className="u-runs">{d.calls} runs · {d.messages} msg</span>
                  <span className="u-tokens">{tokens(d.input_tokens + d.cache_read + d.output_tokens)}</span>
                  <span className="u-tasks">{d.tasks} {d.tasks === 1 ? 'task' : 'tasks'}</span>
                  <span className="u-cost">
                    {rupees(d.usd, usdInr)}
                    <span className="u-usd">{money(d.usd)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * One chat, and what it actually said.
 *
 * A "0 tasks" figure is an accusation, and a figure is a poor thing to act on
 * alone: the same row can mean a group forwarding good-mornings all day, or a
 * client asking for real work in a way the extractor keeps missing. Those want
 * opposite decisions, so the messages open underneath it - and blocking is
 * offered where you have just read them, not on another page.
 */
/*
 * "So switch to a model that caches, then?"
 *
 * The obvious next question after the line above, and the one that was left
 * unanswered here for a while because the honest answer needed a measurement
 * nobody had. It has one now. A cached prefix lives five minutes from the call
 * that last touched it, so the share of calls that follow another inside five
 * minutes is a ceiling on how many could ever read one - and a call that asks
 * for a cache and misses pays a quarter MORE than a plain call. Below the rate
 * a switch needs, it is not a close decision; above it, it is worth measuring
 * for real rather than promising.
 */
function CacheReach({ caching, model }) {
  if (!caching || caching.working) return null;
  const { reach, breakEven } = caching;
  if (!reach || reach.rate === null) return null;

  const pct = (n) => `${Math.round(n * 100)}%`;
  const needs = breakEven ? breakEven.needs : null;
  const pays = needs !== null && reach.rate >= needs;

  return (
    <p className="usage-explain second">
      <b>Would another model be cheaper?</b>{' '}
      Of the {reach.runs.toLocaleString()} chat-reading runs in this window,{' '}
      <b>{reach.warm.toLocaleString()} ({pct(reach.rate)})</b> came within{' '}
      {reach.windowMinutes} minutes of the run before. A cached prompt lives{' '}
      {reach.windowMinutes} minutes, so that is the most that could ever have read
      one — every other run would pay to write a cache nothing then reads, which
      costs a quarter more than not caching at all.
      {needs === null
        ? <> No other priced model caches a prompt this short, so there is nothing
          to switch to.</>
        : pays
          ? <> <code>{breakEven.model}</code> would need {pct(needs)} at best, and this
            workload is above it — worth measuring on a real day before committing,
            because that figure assumes the whole prompt is the repeated part and
            some of it never is.</>
          : <> <code>{breakEven.model}</code> would need {pct(needs)} at best, which
            this workload does not come near, so switching to it would raise the
            bill rather than lower it. Fewer runs is the lever that works here; that is
            what the blocklist and the batching window are for.</>}
    </p>
  );
}

function ChatRow({ chat, widest, onError }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState(null);
  const [blocked, setBlocked] = useState('');
  /*
   * Whether this chat is blocked RIGHT NOW, not just whether it was blocked in
   * this session. It arrives with the row, decided by the listener's own rule,
   * and the local state only records what was just pressed.
   */
  const [cover, setCover] = useState(chat.blockedBy || null);
  const share = widest ? Math.round((chat.messages / widest) * 100) : 0;

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && !messages) {
      try {
        const out = await api.quietMessages(chat.chat);
        setMessages(out.messages);
      } catch (err) {
        onError(err);
      }
    }
  };

  const block = async () => {
    try {
      /* The route answers with the whole list; find the row just added so the
         Unblock beside it knows which pattern to lift. */
      const out = await api.blockChat(chat.chat);
      const mine = (out?.blocked || []).find((row) => row.pattern === chat.chat);
      setCover(mine ? { id: mine.id, pattern: mine.pattern } : { id: null, pattern: chat.chat });
      setBlocked('Blocked — messages from this chat are no longer read or stored.');
    } catch (err) {
      setBlocked(err?.message ? `Not blocked — ${err.message}` : 'Not blocked.');
    }
  };

  const unblock = async () => {
    if (!cover?.id) return;
    try {
      await api.unblockChat(cover.id);
      setCover(null);
      setBlocked('Unblocked — this chat will be read again, and will cost again.');
    } catch (err) {
      setBlocked(err?.message ? `Not unblocked — ${err.message}` : 'Not unblocked.');
    }
  };

  return (
    <>
      <li className={open ? 'open' : ''}>
        <button type="button" className="u-day wide as-link" onClick={toggle} aria-expanded={open}>
          {chat.chat || 'Unknown chat'}
          {/* On the row itself, because that is where the question is asked. */}
          {cover && <span className="chat-blocked">blocked</span>}
        </button>
        <span className="u-bar"><span style={{ width: `${Math.max(share, 2)}%` }} /></span>
        <span className="u-tokens">{chat.messages} msg</span>
        <span className={`u-tasks ${chat.tasks ? '' : 'none'}`}>
          {chat.tasks} {chat.tasks === 1 ? 'task' : 'tasks'}
        </span>
      </li>

      {open && (
        <li className="chat-open">
          {messages === null
            ? <small>Loading…</small>
            : messages.length === 0
              ? <small>Every message from this chat produced a task.</small>
              : (
                <ul className="quiet-msgs">
                  {messages.map((m) => (
                    <li key={m.id}>
                      <span className="qm-who">{m.from_me ? 'You' : (m.contact_name || m.contact_number || 'Unknown')}</span>
                      <span className="qm-when">{when(m.sent_at)}</span>
                      <span className="qm-body">{m.body}</span>
                    </li>
                  ))}
                </ul>
              )}
          <div className="chat-open-foot">
            {cover ? (
              <button type="button" className="btn ghost" onClick={unblock} disabled={!cover.id}>
                Unblock this chat
              </button>
            ) : (
              <button type="button" className="btn ghost" onClick={block}>
                Block this chat
              </button>
            )}
            <small>
              {blocked || (cover
                ? <>Blocked by the pattern <b>{cover.pattern}</b> — nothing from this chat is
                  stored or sent to the AI. The messages above are what it cost before that.</>
                : 'Blocked chats are dropped before anything is stored or sent to the AI.')}
            </small>
          </div>
        </li>
      )}
    </>
  );
}

/** A stored stamp is UTC without a marker; read it as one, not as local time. */
const when = (stamp) => {
  const date = new Date(`${String(stamp).replace(' ', 'T')}${/[Zz+]/.test(stamp) ? '' : 'Z'}`);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
};


/**
 * What each block actually stopped.
 *
 * "I blocked these yesterday, why are they still in the list?" has two answers
 * that look identical in the busiest-chats figures: the messages are from
 * before the block, or the block is not working. The only figure that tells
 * them apart is what has been read SINCE the pattern was added - in `ai` mode a
 * blocked chat is dropped before anything is stored, so a block that works
 * reads zero there, for ever.
 *
 * A pattern that matched nothing at all is the third answer, and the most
 * common one: the name on the list is not the name the messages are filed
 * under.
 */
function BlockEffect({ rows, bootedAt }) {
  // Leaking means leaking now: a block added before the running version came
  // up has a large "since" behind it and may be working perfectly.
  const leaking = rows.filter((r) => r.sinceBoot > 0);
  const stale = rows.filter((r) => !r.sinceBoot && r.since > 0);
  const working = rows.filter((r) => !r.since && r.before > 0);
  const idle = rows.filter((r) => !r.since && !r.before);
  /*
   * How old the restart these figures are measured from is.
   *
   * Asked as "why this blocked msg restarted?" - every row said "none since
   * the restart" against a moment the page never named, and the app restarts
   * on every deploy. Four minutes of silence and four days of silence read
   * identically and mean completely different things, so the span is said and
   * a reading too young to mean anything says so.
   */
  const up = spanLabel(bootedAt);
  const tooSoon = tooSoonToTell(bootedAt);

  return (
    <>
      <header className="section-head static second">
        <h3>Blocked chats</h3>
        <span className="section-count">
          {leaking.length ? `${leaking.length} still arriving` : 'nothing getting through'}
        </span>
      </header>
      <p className="usage-explain">
        {leaking.length
          ? `These are still being read${up ? ` — ${up} of them, since the app last restarted` : ' since the app last restarted'}. The name below is what actually arrived.`
          : stale.length
            ? `Nothing has arrived from any blocked chat in the ${up || 'time'} since the app last restarted — it restarts on every deploy, and that restart is the clock these figures run on. What got through before it is counted below, and is what the list above is still showing.`
            : 'Nothing has been read from any blocked chat since you blocked it. What the list above shows for them is what they cost before that.'}
        {stale.length > 0 && tooSoon && (
          <>
            {' '}
            {/* Said rather than implied: a fresh deploy has not had time to
                prove a block, and a green reading that means nothing yet is
                worse than an honest "not yet". */}
            <b>That is not long enough to prove much yet</b> — these chats may simply not
            have written in that time. It is worth another look tomorrow.
          </>
        )}
      </p>
      <ul className="block-effect">
        {[...leaking, ...stale, ...working, ...idle].map((row) => (
          <li key={row.id} className={row.sinceBoot > 0 ? 'leaking' : row.since > 0 ? 'mixed' : row.before > 0 ? 'working' : 'idle'}>
            <span className="be-pattern">{row.pattern}</span>
            <span className="be-state">
              {row.sinceBoot > 0
                ? `${row.sinceBoot} in the ${up || 'time'} since the app restarted`
                : row.since > 0
                  ? `${row.since} got through, none in the ${up || 'time'} since the restart`
                  : row.before > 0
                    ? 'nothing since you blocked it'
                    : 'never matched a message'}
            </span>
            <span className="be-detail">
              {row.since > 0
                ? row.chats.map((c) => `${c.chat} (${c.messages})`).join(', ')
                : row.before > 0
                  ? `${row.before} read before`
                  : row.suggest
                    // One word out of "Sai Samarth Residency" is why a pattern
                    // catches nothing, and naming it is the correction.
                    ? `nothing is filed under that name — did you mean “${row.suggest}”?`
                    : 'the name on the list is not the name these messages are filed under'}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
