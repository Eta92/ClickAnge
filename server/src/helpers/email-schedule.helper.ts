// Time maths for the email distribution: the provider's daily quota resets at
// midnight UTC, while customers are only mailed during waking hours in France.
// The 8:00–23:00 Paris window always sits inside a single UTC day.

export const SEND_TIMEZONE = 'Europe/Paris';
export const SEND_WINDOW_START_HOUR = 8;
export const SEND_WINDOW_END_HOUR = 23;

const DAY_MS = 24 * 60 * 60_000;

const wallClockFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: SEND_TIMEZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
});

interface WallClock {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClock(at: number): WallClock {
  const parts: Record<string, number> = {};
  for (const part of wallClockFormat.formatToParts(at)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return parts as unknown as WallClock;
}

// how far the send timezone is ahead of UTC at `at`, in ms (+1h or +2h for Paris)
function timezoneOffset(at: number): number {
  const c = wallClock(at);
  const asUtc = Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second);
  return asUtc - Math.floor(at / 1000) * 1000;
}

export function startOfUtcDay(at: number): number {
  return Math.floor(at / DAY_MS) * DAY_MS;
}

export function isWithinSendWindow(at: number): boolean {
  const hour = wallClock(at).hour;
  return hour >= SEND_WINDOW_START_HOUR && hour < SEND_WINDOW_END_HOUR;
}

// the next opening of the send window strictly after `at` (today's if it is
// still early, otherwise tomorrow's)
export function nextWindowStart(at: number): number {
  const c = wallClock(at);
  const dayOffset = c.hour < SEND_WINDOW_START_HOUR ? 0 : 1;
  const wallTimeAsUtc = Date.UTC(c.year, c.month - 1, c.day + dayOffset, SEND_WINDOW_START_HOUR);
  // the offset at the target moment, not now, so a DST change overnight is honoured
  const guess = wallTimeAsUtc - timezoneOffset(at);
  return wallTimeAsUtc - timezoneOffset(guess);
}

// when queued emails can next go out, given whether today's quota still has room
export function nextSendTime(at: number, quotaLeft: boolean): number {
  if (!quotaLeft) return nextWindowStart(startOfUtcDay(at) + DAY_MS);
  return isWithinSendWindow(at) ? at : nextWindowStart(at);
}
