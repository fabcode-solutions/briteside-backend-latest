/**
 * Recurrence engine — converts a recurrence rule into discrete session objects
 * that can be passed directly to EventScheduleService.createEventSessions().
 *
 * Supported types: 'daily' | 'weekly' | 'monthly'
 *
 * Rule shape:
 * {
 *   type        : 'daily' | 'weekly' | 'monthly'
 *   interval    : number          – every N days / weeks / months  (default 1)
 *   daysOfWeek  : number[]        – weekly only: 0=Sun … 6=Sat (at least 1)
 *   dayOfMonth  : number          – monthly only: 1–31
 *   startDate   : string          – 'YYYY-MM-DD'
 *   startTime   : string          – 'HH:MM'  (24-hour)
 *   endTime     : string          – 'HH:MM'  (24-hour, must be > startTime)
 *   occurrences : number          – total sessions to generate (1–365)
 * }
 *
 * Returns: Array<{ date: string, startTime: string, endTime: string }>
 *          where all values are ISO 8601 strings (UTC).
 */

const MAX_OCCURRENCES = 365;
// Safety cap on month iterations to prevent infinite loops when dayOfMonth
// never exists in any reachable month (e.g. day=31 with a very large interval).
const MAX_MONTH_ITERATIONS = 365 * 12;

/**
 * Parse 'YYYY-MM-DD' to a UTC midnight Date object.
 */
function parseDateOnly(str) {
  const [y, mo, d] = str.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d));
}

/**
 * Add N days to a Date (returns a new Date, does not mutate).
 */
function addDays(date, n) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

/**
 * Return the number of days in a given month.
 * @param {number} year
 * @param {number} month  0-indexed
 */
function getDaysInMonth(year, month) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * Build a session object for a given UTC day + HH:MM time strings.
 */
function buildSession(dayDate, startTimeStr, endTimeStr) {
  const [sh, sm] = startTimeStr.split(':').map(Number);
  const [eh, em] = endTimeStr.split(':').map(Number);

  const startDt = new Date(dayDate);
  startDt.setUTCHours(sh, sm, 0, 0);

  const endDt = new Date(dayDate);
  endDt.setUTCHours(eh, em, 0, 0);

  return {
    date: new Date(
      Date.UTC(dayDate.getUTCFullYear(), dayDate.getUTCMonth(), dayDate.getUTCDate())
    ).toISOString(),
    startTime: startDt.toISOString(),
    endTime: endDt.toISOString(),
  };
}

/**
 * Generate recurring session objects from a recurrence rule.
 *
 * @param {object} rule
 * @returns {Array<{ date: string, startTime: string, endTime: string }>}
 */
export function generateOccurrences(rule) {
  const { type, interval = 1, startDate, startTime, endTime, occurrences } = rule;
  const cap = Math.min(occurrences, MAX_OCCURRENCES);
  const start = parseDateOnly(startDate);
  const results = [];

  if (type === 'daily') {
    let current = new Date(start);
    while (results.length < cap) {
      results.push(buildSession(current, startTime, endTime));
      current = addDays(current, interval);
    }
  } else if (type === 'weekly') {
    const sortedDays = [...new Set(rule.daysOfWeek)].sort((a, b) => a - b);

    // Rewind to the Sunday of the week that contains startDate
    const startDow = start.getUTCDay(); // 0=Sun
    let weekStart = addDays(start, -startDow);

    let count = 0;
    outer: while (count < cap) {
      for (const dow of sortedDays) {
        const candidate = addDays(weekStart, dow);
        // Skip days before the requested startDate
        if (candidate < start) continue;
        results.push(buildSession(candidate, startTime, endTime));
        count++;
        if (count >= cap) break outer;
      }
      // Advance by interval weeks
      weekStart = addDays(weekStart, 7 * interval);
    }
  } else if (type === 'monthly') {
    const { dayOfMonth } = rule;
    let year = start.getUTCFullYear();
    let month = start.getUTCMonth(); // 0-indexed

    let count = 0;
    let iterations = 0;

    while (count < cap && iterations < MAX_MONTH_ITERATIONS) {
      iterations++;
      const daysInMonth = getDaysInMonth(year, month);

      // Skip months where dayOfMonth doesn't exist (e.g. Feb 31)
      if (dayOfMonth <= daysInMonth) {
        const candidate = new Date(Date.UTC(year, month, dayOfMonth));
        // Skip dates before startDate
        if (candidate >= start) {
          results.push(buildSession(candidate, startTime, endTime));
          count++;
        }
      }

      // Advance by interval months
      month += interval;
      if (month > 11) {
        year += Math.floor(month / 12);
        month = month % 12;
      }
    }
  }

  return results;
}
