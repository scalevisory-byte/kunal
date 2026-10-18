/**
 * The ZynTask mark: a Z whose last stroke turns into a tick - the task that
 * came in and the task that got done, in one letter.
 *
 * Drawn inline rather than loaded, so it takes no request and no second file
 * can drift from public/icon.svg (the same paths, kept in step by a test).
 * `tile` puts it on its navy square, as on the home screen; without it the
 * strokes sit straight on whatever is behind them, which on the navy sidebar
 * is the square already.
 */
export default function Logo({ size = 34, tile = true, title }) {
  return (
    <svg
      className="zt-logo"
      viewBox="0 0 512 512" width={size} height={size}
      role={title ? 'img' : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : 'true'}
    >
      {tile && <rect width="512" height="512" rx="116" fill="#1f2a6e" />}
      <g fill="none" strokeWidth="54" strokeLinecap="round" strokeLinejoin="round" transform="translate(-5 -12)">
        <path d="M144 140H354L150 352H230" stroke="#fff" />
        <path d="M230 352L280 402L380 290" stroke="#ea580c" />
      </g>
    </svg>
  );
}
