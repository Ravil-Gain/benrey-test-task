import { afterEach, describe, expect, it, vi } from 'vitest'

import { env, isHttpsOrigin, parseServerOrigin, requireEnv } from '../../src/lib/env'

describe('parseServerOrigin', () => {
  it('returns a bare origin and drops a trailing slash', () => {
    expect(parseServerOrigin('https://app.onrender.com/', 'production')).toBe(
      'https://app.onrender.com',
    )
    expect(parseServerOrigin('http://localhost:3000', undefined)).toBe('http://localhost:3000')
    expect(parseServerOrigin('HTTPS://App.OnRender.com', 'production')).toBe(
      'https://app.onrender.com',
    )
  })

  it('refuses a value that is not a full http(s) URL', () => {
    expect(() => parseServerOrigin('app.onrender.com', undefined)).toThrow(/full URL/)
    expect(() => parseServerOrigin('ftp://app.onrender.com', undefined)).toThrow(
      /http:\/\/ or https:\/\//,
    )
  })

  it('refuses a path, query, hash or login, which would never match the CSRF origin check', () => {
    for (const value of [
      'https://app.onrender.com/admin',
      'https://app.onrender.com?x=1',
      'https://app.onrender.com#top',
      'https://user:pw@app.onrender.com',
    ]) {
      expect(() => parseServerOrigin(value, 'production')).toThrow(/origin only/)
    }
  })

  it('requires https in production, except on a local host', () => {
    expect(() => parseServerOrigin('http://app.onrender.com', 'production')).toThrow(/https/)
    expect(parseServerOrigin('http://app.onrender.com', 'development')).toBe(
      'http://app.onrender.com',
    )
    expect(parseServerOrigin('http://localhost:3100', 'production')).toBe('http://localhost:3100')
    expect(parseServerOrigin('http://127.0.0.1:3100', 'production')).toBe('http://127.0.0.1:3100')
    expect(parseServerOrigin('http://[::1]:3100', 'production')).toBe('http://[::1]:3100')
  })
})

describe('isHttpsOrigin', () => {
  it('is on for https and off for http', () => {
    expect(isHttpsOrigin('https://app.onrender.com')).toBe(true)
    expect(isHttpsOrigin('http://localhost:3000')).toBe(false)
  })
})

describe('requireEnv and env', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('throws with the variable name when one is missing or blank', () => {
    expect(() => requireEnv('X_MISSING', {})).toThrow(
      'Missing required environment variable: X_MISSING',
    )
    expect(() => requireEnv('X_BLANK', { X_BLANK: '   ' })).toThrow('X_BLANK')
    expect(requireEnv('X_SET', { X_SET: ' value ' })).toBe('value')
    vi.stubEnv('DATABASE_URL', '')
    expect(() => env.databaseUrl()).toThrow('DATABASE_URL')
    vi.stubEnv('R2_BUCKET', '')
    expect(() => env.r2()).toThrow(/R2_/)
  })

  it('validates the server URL against NODE_ENV', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('PAYLOAD_PUBLIC_SERVER_URL', 'http://app.onrender.com')
    expect(() => env.serverUrl()).toThrow(/https/)
    vi.stubEnv('PAYLOAD_PUBLIC_SERVER_URL', 'https://app.onrender.com/')
    expect(env.serverUrl()).toBe('https://app.onrender.com')
  })
})
