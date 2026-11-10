import { describe, expect, it } from 'vitest'

import {
  ORIGINAL_NAME_MAX_LENGTH,
  ORIGINAL_NAME_TTL_MS,
  cleanOriginalName,
  originalNameKey,
  readStoredOriginalName,
  storedOriginalName,
} from '../../src/lib/originalName'

describe('cleanOriginalName', () => {
  it('keeps characters that the storage key would sanitize away', () => {
    expect(cleanOriginalName('browser test?.png')).toBe('browser test?.png')
    expect(cleanOriginalName('Отчёт #3 (финал).pdf')).toBe('Отчёт #3 (финал).pdf')
  })

  it('drops a client path, control characters and outer spaces', () => {
    expect(cleanOriginalName('C:\\photos\\a.png')).toBe('a.png')
    expect(cleanOriginalName('../../etc/passwd.txt')).toBe('passwd.txt')
    expect(cleanOriginalName('  bad\u0000na\nme.txt ')).toBe('badname.txt')
  })

  it('caps the length', () => {
    expect(cleanOriginalName(`${'a'.repeat(300)}.png`)).toHaveLength(ORIGINAL_NAME_MAX_LENGTH)
  })

  it('returns null when nothing usable is left', () => {
    expect(cleanOriginalName('')).toBeNull()
    expect(cleanOriginalName('   ')).toBeNull()
    expect(cleanOriginalName('folder/')).toBeNull()
    expect(cleanOriginalName(42)).toBeNull()
    expect(cleanOriginalName(undefined)).toBeNull()
  })
})

describe('stored original name', () => {
  const now = 1_000_000

  it('is keyed by the upload folder', () => {
    expect(originalNameKey('77de04fc')).toBe('media-original-name:77de04fc')
  })

  it('reads back a fresh value', () => {
    expect(readStoredOriginalName(storedOriginalName('a?.png', now), now + 1)).toBe('a?.png')
  })

  it('treats an expired value as missing', () => {
    const stored = storedOriginalName('a.png', now)
    expect(stored.expiresAt).toBe(now + ORIGINAL_NAME_TTL_MS)
    expect(readStoredOriginalName(stored, now + ORIGINAL_NAME_TTL_MS)).toBeNull()
  })

  it('treats malformed values as missing', () => {
    expect(readStoredOriginalName(null, now)).toBeNull()
    expect(readStoredOriginalName('a.png', now)).toBeNull()
    expect(readStoredOriginalName({ name: 'a.png' }, now)).toBeNull()
    expect(readStoredOriginalName({ name: 5, expiresAt: now + 10 }, now)).toBeNull()
  })

  it('cleans a stored name again on read', () => {
    expect(readStoredOriginalName({ name: 'x/\u0007y.png', expiresAt: now + 10 }, now)).toBe('y.png')
  })
})
