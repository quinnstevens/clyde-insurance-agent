const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
}

const monthFromName = (name: string): number | undefined => MONTHS[name.slice(0, 3)]

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * A real calendar date between 1900 and today, as YYYY-MM-DD. A two-digit year is read as the most
 * recent date that isn't in the future ("91" is 1991, "05" is 2005), since a birthday can't be.
 */
const toIsoDate = (year: number, month: number, day: number, now: Date): string | null => {
  if (year < 100) {
    const thisCentury = Math.floor(now.getUTCFullYear() / 100) * 100 + year
    year = Date.UTC(thisCentury, month - 1, day) > now.getTime() ? thisCentury - 100 : thisCentury
  }
  const date = new Date(Date.UTC(year, month - 1, day))
  const real = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  if (!real || year < 1900 || date.getTime() > now.getTime()) return null
  return `${year}-${pad(month)}-${pad(day)}`
}

/**
 * Reads a date of birth however a caller or the voice model wrote it down: 1991-02-02, 02/02/1991,
 * 2/2/91, 02-02-1991, 02021991, February 2nd, 1991, Feb 2 1991, 2 February 1991. Numeric dates are
 * month first, as in the US. Returns YYYY-MM-DD, or null for anything that isn't a real past date.
 */
export const normalizeDateOfBirth = (raw: string, now: Date = new Date()): string | null => {
  const text = raw
    .trim()
    .toLowerCase()
    .replace(/(\d)(st|nd|rd|th)\b/g, '$1')
    .replace(/[,]/g, ' ')
    .replace(/\s+/g, ' ')

  let m: RegExpMatchArray | null
  if ((m = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) return toIsoDate(+m[1], +m[2], +m[3], now)
  if ((m = text.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{4}|\d{2})$/))) return toIsoDate(+m[3], +m[1], +m[2], now)
  if ((m = text.match(/^(\d{2})(\d{2})(\d{4})$/))) return toIsoDate(+m[3], +m[1], +m[2], now)
  if ((m = text.match(/^([a-z]+)\.? (\d{1,2}) (\d{4}|\d{2})$/))) {
    const month = monthFromName(m[1])
    return month ? toIsoDate(+m[3], month, +m[2], now) : null
  }
  if ((m = text.match(/^(\d{1,2}) ([a-z]+)\.? (\d{4}|\d{2})$/))) {
    const month = monthFromName(m[2])
    return month ? toIsoDate(+m[3], month, +m[1], now) : null
  }
  return null
}
