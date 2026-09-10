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

/**
 * The shortest prompt each model will cache, in tokens.
 *
 * Below it nothing is cached and nothing is said about it - the request simply
 * comes back with `cache_creation_input_tokens: 0`. It is not monotonic across
 * generations, which is the trap: Haiku 4.5 needs four thousand tokens where
 * Sonnet 5 needs one, so the cheapest model per token can be the expensive one
 * to run when the same instructions are sent on every call.
 */
export const CACHE_MINIMUM = {
  'claude-sonnet-4-6': 1024,
  'claude-sonnet-5': 1024,
  'claude-opus-5': 512,
  'claude-opus-4-8': 1024,
  'claude-haiku-4-5': 4096,
};

/* Cache reads cost a tenth of the input rate; writing one costs a quarter more. */
export const CACHE_READ_RATE = 0.1;
export const CACHE_WRITE_RATE = 1.25;

/**
 * Dollars for one set of token counts. Unknown models price at zero, not a guess.
 *
 * Cached tokens are counted separately by the API - they are not part of
 * `input_tokens` - so leaving them out understated the bill the moment caching
 * was switched on. A read is a tenth of the input rate, a write a quarter more
 * than it.
 */
export function costOf({
  model, input_tokens = 0, output_tokens = 0, cache_read = 0, cache_write = 0,
}) {
  const price = PRICES[model];
  if (!price) return { usd: 0, priced: false };
  const usd =
    (input_tokens / 1e6) * price.input
    + (cache_read / 1e6) * price.input * CACHE_READ_RATE
    + (cache_write / 1e6) * price.input * CACHE_WRITE_RATE
    + (output_tokens / 1e6) * price.output;
  return { usd, priced: true };
}
