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

const UNITS: Record<string, number> = {
  oh: 0,
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
}
const TEENS: Record<string, number> = {
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  tenth: 10,
  eleventh: 11,
  twelfth: 12,
  thirteenth: 13,
  fourteenth: 14,
  fifteenth: 15,
  sixteenth: 16,
  seventeenth: 17,
  eighteenth: 18,
  nineteenth: 19,
}
const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  twentieth: 20,
  thirtieth: 30,
}

const isNumberWord = (w: string) => w in UNITS || w in TEENS || w in TENS || w === 'hundred' || w === 'thousand'

/**
 * Turns one run of spoken number words into digit groups: "nineteen ninety one" -> ["1991"],
 * "oh two oh two" -> ["02", "02"], "twenty second" -> ["22"], "two thousand and five" -> ["2005"].
 */
const spokenRunToDigits = (words: string[]): string[] => {
  // First pass: numbers under 100, keeping "oh five" as the two-digit "05".
  const chunks: { value: number; text: string }[] = []
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    const next = words[i + 1]
    // "thirty one" is 31, but "thirtieth" is complete: "thirtieth two thousand" is the 30th, then 2000.
    if (w in TENS && !w.endsWith('ieth') && next !== undefined && next in UNITS && UNITS[next] > 0) {
      const value = TENS[w] + UNITS[next]
      chunks.push({ value, text: String(value) })
      i++
    } else if ((w === 'oh' || w === 'zero') && next !== undefined && next in UNITS && UNITS[next] > 0) {
      chunks.push({ value: UNITS[next], text: `0${UNITS[next]}` })
      i++
    } else if (w in TENS) chunks.push({ value: TENS[w], text: String(TENS[w]) })
    else if (w in TEENS) chunks.push({ value: TEENS[w], text: String(TEENS[w]) })
    else if (w in UNITS) chunks.push({ value: UNITS[w], text: String(UNITS[w]) })
    else chunks.push({ value: -1, text: w }) // hundred / thousand, resolved below
  }

  // Second pass: years. "two thousand (and) five", "nineteen hundred (and) five", "nineteen ninety one".
  const out: string[] = []
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i]
    const marker = chunks[i + 1]?.text
    if ((marker === 'thousand' || marker === 'hundred') && c.value > 0) {
      const base = c.value * (marker === 'thousand' ? 1000 : 100)
      const rest = chunks[i + 2] && chunks[i + 2].value >= 0 ? chunks[i + 2] : undefined
      out.push(String(base + (rest?.value ?? 0)))
      i += rest ? 2 : 1
      continue
    }
    const after = chunks[i + 1]
    if ((c.value === 19 || c.value === 20) && after && after.value >= 0 && after.text.length === 2) {
      out.push(`${c.value}${after.text}`)
      i++
      continue
    }
    if (c.value >= 0) out.push(c.text)
  }
  return out
}

/** "February second, nineteen ninety-one" -> "february 2 1991". Other words are left alone. */
const spokenToDigits = (text: string): string => {
  const words = text.split(' ')
  const out: string[] = []
  for (let i = 0; i < words.length;) {
    if (!isNumberWord(words[i])) {
      out.push(words[i++])
      continue
    }
    const run: string[] = []
    while (i < words.length && (isNumberWord(words[i]) || (words[i] === 'and' && run.length > 0))) {
      if (words[i] !== 'and') run.push(words[i])
      i++
    }
    out.push(...spokenRunToDigits(run))
  }
  return out.join(' ')
}

/**
 * Reads a date of birth however a caller said it or the voice model wrote it down: 1991-02-02,
 * 02/02/1991, 2/2/91, 02021991, February 2nd, 1991, Feb 2 '91, the second of February 1991,
 * February second nineteen ninety-one, oh two oh two ninety one. Numeric dates are month first, as
 * in the US. Returns YYYY-MM-DD, or null for anything that isn't a real past date.
 */
export const normalizeDateOfBirth = (raw: string, now: Date = new Date()): string | null => {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[.,;:!?"]+$/, '')
    .replace(/'(\d{2})\b/g, '$1')
    .replace(/(\d)(st|nd|rd|th)\b/g, '$1')
    .replace(/[,;"]/g, ' ')
    .replace(/(\p{L})-(\p{L})/gu, '$1 $2')
    .replace(/\s+/g, ' ')
  const text = spokenToDigits(cleaned)
    .split(' ')
    .filter((w) => !['the', 'of', 'on', 'born', 'and', 'my', 'birthday', 'is', "it's", 'its'].includes(w))
    .join(' ')

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
