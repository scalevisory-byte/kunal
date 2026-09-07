/**
 * One icon set for the whole app: 20px stroke glyphs on a shared grid, so
 * nothing reads as borrowed from somewhere else. No dependency, no font.
 */
const PATHS = {
  dashboard: 'M3 10.5 12 3l9 7.5M5 9.5V20h14V9.5M9.5 20v-6h5v6',
  sun: 'M12 4V2m0 20v-2M6.3 6.3 4.9 4.9m14.2 14.2-1.4-1.4M4 12H2m20 0h-2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  chat: 'M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.3-.6L3 21l1.7-5.1A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5Z',
  robot: 'M12 3v3m-5 0h10a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3Zm2 6h.01M15 12h.01M9 16h6',
  calendar: 'M7 3v3m10-3v3M4 9h16M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z',
  check: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-3.5-9.2 2.4 2.4 4.6-4.8',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7.5 7.5 0 0 0-2-1.2L14.6 3H9.4L9 5.7a7.5 7.5 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5a7.4 7.4 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-1a7.5 7.5 0 0 0 2 1.2l.4 2.7h5.2l.4-2.7a7.5 7.5 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.06-.4.1-.8.1-1.2Z',
  bell: 'M18 8a6 6 0 1 0-12 0c0 6-2.5 7-2.5 7h17S18 14 18 8ZM13.7 19a2 2 0 0 1-3.4 0',
  refresh: 'M20.5 12a8.5 8.5 0 1 1-2.6-6.1M20 4v5h-5',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5.2-1.8L21 21',
  plus: 'M12 5v14M5 12h14',
  flag: 'M5 21V4m0 0 5.5 2L16 4l3 1.5V15l-3-1.5L10.5 15 5 13',
  play: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-1.5-12.5 5 3.5-5 3.5v-7Z',
  alert: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v5m0 3h.01',
  clipboard: 'M9 4h6v3H9V4Zm-1 1H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M8.5 12h7M8.5 16h5',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13.5V12l3 2',
  whatsapp: 'M20 11.7a8 8 0 0 1-11.9 7L4 20l1.3-4a8 8 0 1 1 14.7-4.3ZM9.2 8.6c.3.8.8 1.9 1.7 2.8.9.9 2 1.4 2.8 1.7l1-1 2 1v1.4c-.6.5-1.6.6-2.9.1a10 10 0 0 1-5.4-5.4c-.5-1.3-.4-2.3.1-2.9h1.4l1 2-.7 1Z',
  arrowRight: 'M5 12h13m-5-5 5 5-5 5',
  chevronDown: 'M6 9.5 12 15l6-5.5',
  more: 'M12 6.5h.01M12 12h.01M12 17.5h.01',
  trash: 'M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10.5 11v5M13.5 11v5',
  circle: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
  filter: 'M3.5 5.5h17l-6.5 7.5v5.5l-4 2v-7.5L3.5 5.5Z',
  // Work arriving: a tray with an arrow coming down into it.
  inbox: 'M4 13h4l1.5 3h5L16 13h4M4 13 6.5 5h11L20 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-5Z',
  // Work going out: an arrow leaving the tray.
  outbox: 'M4 14h4l1.5 3h5l1.5-3h4v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4Zm8-2V3m0 0L8.5 6.5M12 3l3.5 3.5',
  // A person, for the name a delegated task carries.
  person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8.5a7 7 0 0 1 14 0',
};

export default function Icon({ name, size = 18, className = '', strokeWidth = 1.6 }) {
  const d = PATHS[name];
  if (!d) return null;
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} />
    </svg>
  );
}
