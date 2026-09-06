/**
 * List prices in US dollars per million tokens, as published by Anthropic.
 * These are the rates the estimate is built from - the authoritative number is
 * always the bill in the Anthropic Console, which this app cannot read.
 */
export const PRICES = {
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

export const PRICES_UPDATED = '2026-06-24';

/** Dollars for one set of token counts. Unknown models price at zero, not a guess. */
export function costOf({ model, input_tokens = 0, output_tokens = 0 }) {
  const price = PRICES[model];
  if (!price) return { usd: 0, priced: false };
  const usd = (input_tokens / 1e6) * price.input + (output_tokens / 1e6) * price.output;
  return { usd, priced: true };
}
