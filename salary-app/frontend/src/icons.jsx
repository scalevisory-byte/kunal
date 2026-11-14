/*
 * The app's icons: one stroked path each, drawn here rather than pulled from a
 * library. Five shapes in the dashboard's headline band and one per module in
 * the sidebar is twenty lines of path data; an icon font or an icon package is
 * a hundred kilobytes, in a build that has to stay small enough to email.
 *
 * All on a 24x24 box, stroke only, so one <svg> renders every one of them and
 * they take the colour of whatever they sit in.
 */
export const GLYPHS = {
  /* the dashboard's headline band */
  people: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2 21a7 7 0 0 1 14 0M17.5 11.5a3 3 0 1 0 0-6M19 21a6 6 0 0 0-3-5.2',
  rupee: 'M7 4h10M7 9h10M15.5 4c0 3-2.2 5-5.5 5H7l8 11',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3.5 2.2',
  calendar: 'M4 8h16M7 3v3M17 3v3M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1ZM8 13h2M14 13h2M8 17h2M14 17h2',
  alert: 'M12 3 2.5 20h19L12 3ZM12 10v4.5M12 17.6v.1',

  /* one per module, in the order the sidebar lists them */
  dashboard: 'M4 4h6v7H4zM14 4h6v4h-6zM14 12h6v8h-6zM4 15h6v5H4z',
  sheet: 'M4 4h16v16H4zM4 9h16M4 14h16M9 4v16M14.5 4v16',
  attendance: 'M4 8h16M7 3v3M17 3v3M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1ZM8.5 14.5l2.5 2.5 4.5-5',
  sunday: 'M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8',
  leave: 'M4 8h16M7 3v3M17 3v3M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1ZM9 15h6',
  loans: 'M3 7.5h18v11H3zM3 11h18M6.5 15.5h3M12 4.5h9',
  employees: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2 21a7 7 0 0 1 14 0M17.5 11.5a3 3 0 1 0 0-6M19 21a6 6 0 0 0-3-5.2',
  hiring: 'M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2.5 21a7 7 0 0 1 14 0M18.5 9v6M21.5 12h-6',
  person: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM12 11.5a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4ZM8 17a4 4 0 0 1 8 0',
  asset: 'M3.5 7.8 12 3.5l8.5 4.3v8.4L12 20.5l-8.5-4.3V7.8ZM3.5 7.8 12 12.1l8.5-4.3M12 12.1v8.4',
  reports: 'M4 20h16M7.5 20v-7M12 20V6M16.5 20v-10',
  admin: 'M12 3.5 4.5 6.5v5c0 4.6 3.1 7.9 7.5 9 4.4-1.1 7.5-4.4 7.5-9v-5L12 3.5ZM9.3 12.2l2 2 3.6-4',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM9.3 9.3a2.8 2.8 0 1 1 3.4 3.3c-.5.1-.7.5-.7 1v.6M12 17.4v.1',
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M5.5 5.5l13 13M18.5 5.5l-13 13',
};

/** One icon. Unknown name draws nothing rather than a broken box. */
export default function Glyph({ name, size = 15, width = 1.9 }) {
  const d = GLYPHS[name];
  if (!d) return null;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth={width}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
