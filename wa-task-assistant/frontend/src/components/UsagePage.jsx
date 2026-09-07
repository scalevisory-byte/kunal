import { useCallback, useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import { api } from '../api.js';

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

  const { today, month, total, days, prices, usdInr } = data;
  const nothingYet = total.calls === 0;

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
                  <span className="u-tokens">{tokens(d.input_tokens + d.output_tokens)}</span>
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
