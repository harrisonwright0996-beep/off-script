// Day keys are 'YYYY-MM-DD' in the phone's local time. A day starts at 03:00,
// so practice just after midnight counts towards the evening before.
export const DAY_START_HOUR = 3;

const pad = (n) => String(n).padStart(2, '0');

export function dayKey(date = new Date()) {
  const d = new Date(date.getTime());
  if (d.getHours() < DAY_START_HOUR) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const isDayKey = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

const utc = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

export function addDays(key, n) {
  return new Date(utc(key) + n * 86400000).toISOString().slice(0, 10);
}

// Whole days from a to b (positive when b is later).
export function daysBetween(a, b) {
  return Math.round((utc(b) - utc(a)) / 86400000);
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function weekday(key) {
  return DAYS[new Date(utc(key)).getUTCDay()];
}

// 'Wed 4 Nov', or 'Wednesday 4 November' with long: true.
export function formatDay(key, { long = false } = {}) {
  const d = new Date(utc(key));
  const day = DAYS[d.getUTCDay()];
  const month = MONTHS[d.getUTCMonth()];
  return long
    ? `${day} ${d.getUTCDate()} ${month}`
    : `${day.slice(0, 3)} ${d.getUTCDate()} ${month.slice(0, 3)}`;
}

// The moment a day ends: 03:00 local time the next morning.
export function dayEnd(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d + 1, DAY_START_HOUR).getTime();
}
