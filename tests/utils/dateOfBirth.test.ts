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

  it('accepts a real leap day', () => {
    expect(read('2/29/1992')).toBe('1992-02-29')
  })
})
