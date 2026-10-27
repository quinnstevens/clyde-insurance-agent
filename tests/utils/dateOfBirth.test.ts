import { normalizeDateOfBirth } from '@clyde-api/utils/dateOfBirth'

const now = new Date('2026-10-27T12:00:00Z')
const read = (raw: string) => normalizeDateOfBirth(raw, now)

describe('normalizeDateOfBirth', () => {
  it.each([
    '1991-02-02',
    '1991/2/2',
    '02/02/1991',
    '2/2/1991',
    '2/2/91',
    '02-02-1991',
    '02.02.1991',
    '02 02 1991',
    '02021991',
    'February 2, 1991',
    'February 2nd, 1991',
    'february 2nd 1991',
    'Feb 2 1991',
    'Feb. 2, 1991',
    '2 February 1991',
    '2nd Feb 1991',
    '  02/02/1991  ',
    // The way people say it, and the way a voice model writes that down.
    'February 2nd, 1991.',
    '02/02/1991.',
    "Feb 2, '91",
    'February second, nineteen ninety-one',
    'february second nineteen ninety one',
    'the second of February 1991',
    '2nd of February, 1991',
    'the second of February, nineteen ninety-one',
    'oh two oh two nineteen ninety one',
    'oh two, oh two, ninety one',
    'two two ninety one',
    'two, two, one nine nine one',
    'oh two oh two one nine nine one',
    'February second, one nine nine one',
    'my birthday is February 2nd, 1991',
  ])('reads %p as 1991-02-02', (raw) => {
    expect(read(raw)).toBe('1991-02-02')
  })

  it('reads numeric dates month first, as in the US', () => {
    expect(read('05/01/1971')).toBe('1971-05-01')
    expect(read('January 5, 1971')).toBe('1971-01-05')
  })

  it('reads a two-digit year as the most recent past year', () => {
    expect(read('1/1/71')).toBe('1971-01-01')
    expect(read('1/1/05')).toBe('2005-01-01')
    expect(read('1/1/26')).toBe('2026-01-01')
    expect(read('12/1/26')).toBe('1926-12-01')
  })

  it.each(['02/30/1991', '13/01/1991', '1991-02-29', 'Smarch 2 1991', '01/01/1899', '01/01/2027', '', 'yesterday'])(
    'rejects %p',
    (raw) => {
      expect(read(raw)).toBeNull()
    },
  )

  it.each([
    ['January first, nineteen seventy-one', '1971-01-01'],
    ['May fifth nineteen seventy five', '1975-05-05'],
    ['December twenty-second, two thousand five', '2005-12-22'],
    ['March thirtieth two thousand and twelve', '2012-03-30'],
    ['July 4th twenty twelve', '2012-07-04'],
    ['August ninth, nineteen oh five', '1905-08-09'],
    ['the thirty-first of October 1988', '1988-10-31'],
    ['two, two, one nine seven one', '1971-02-02'],
    ['one one one nine seven one', '1971-01-01'],
    ['five five one nine seven five', '1975-05-05'],
    ['twelve twenty five two zero zero five', '2005-12-25'],
  ])('reads %p as %p', (raw, expected) => {
    expect(read(raw)).toBe(expected)
  })

  it('accepts a real leap day', () => {
    expect(read('2/29/1992')).toBe('1992-02-29')
  })
})
