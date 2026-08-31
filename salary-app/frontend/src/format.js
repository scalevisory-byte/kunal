const money = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const money2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const rupees = (n) => (Number.isFinite(Number(n)) ? money.format(Math.round(Number(n))) : '-');
export const rupees2 = (n) => (Number.isFinite(Number(n)) ? money2.format(Number(n)) : '-');

/** Days print as 7.5, not 7.50, and a whole number keeps no decimal at all. */
export const days = (n) => {
  const value = Number(n);
  if (!Number.isFinite(value)) return '-';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
};

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const daysInMonth = (year, month) => new Date(year, month, 0).getDate();

export const weekday = (year, month, day) =>
  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(year, month - 1, day).getDay()];

export const isSunday = (year, month, day) => new Date(year, month - 1, day).getDay() === 0;
