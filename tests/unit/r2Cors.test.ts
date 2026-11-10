import { describe, expect, it } from 'vitest'

import { buildCorsRules, parseCorsOrigin } from '../../src/lib/r2Cors'

describe('parseCorsOrigin', () => {
  it('normalizes an origin', () => {
    expect(parseCorsOrigin(' https://App.onrender.com/ ')).toBe('https://app.onrender.com')
    expect(parseCorsOrigin('http://localhost:3000')).toBe('http://localhost:3000')
  })

  it('refuses anything that is not a bare http(s) origin', () => {
    expect(() => parseCorsOrigin('app.onrender.com')).toThrow(/Not a URL/)
    expect(() => parseCorsOrigin('ftp://host')).toThrow(/http/)
    expect(() => parseCorsOrigin('https://app.onrender.com/admin')).toThrow(/no path/)
    expect(() => parseCorsOrigin('https://app.onrender.com?x=1')).toThrow(/no path/)
  })
})

describe('buildCorsRules', () => {
  it('allows only PUT from the given origins, without duplicates', () => {
    const [rule, ...rest] = buildCorsRules([
      'https://app.onrender.com',
      'https://app.onrender.com/',
      'http://localhost:3000',
    ])
    expect(rest).toEqual([])
    expect(rule!.AllowedOrigins).toEqual(['https://app.onrender.com', 'http://localhost:3000'])
    expect(rule!.AllowedMethods).toEqual(['PUT'])
  })

  it('allows exactly the headers the signed PUT sends', () => {
    const [rule] = buildCorsRules(['https://app.onrender.com'])
    expect(rule!.AllowedHeaders).toEqual(['content-type', 'content-length', 'if-none-match'])
    expect(rule!.ExposeHeaders).toEqual(['ETag'])
  })

  it('never allows every origin and needs at least one', () => {
    expect(() => buildCorsRules(['*'])).toThrow()
    expect(() => buildCorsRules([])).toThrow(/At least one origin/)
  })
})
