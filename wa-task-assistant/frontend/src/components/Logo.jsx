/**
 * The ZynTask mark: a chat bubble with a tick in it - a WhatsApp message that
 * became a task, and the task done.
 *
 * Drawn inline rather than loaded, so it takes no request and no second file
 * can drift from public/icon.svg (the same paths, kept in step by a test).
 * `tile` puts it on its navy square, as on the home screen.
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
      <path d="M256 104c-96 0-168 62-168 140 0 42 21 79 55 104l-15 62 70-34c18 5 37 8 58 8 96 0 168-62 168-140S352 104 256 104z" fill="#fff" />
      <path d="M182 246l52 52 98-104" fill="none" stroke="#ea580c" strokeWidth="44" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
