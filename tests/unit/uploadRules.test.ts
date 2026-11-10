import { describe, expect, it } from 'vitest'

import {
  MAX_UPLOAD_BYTES,
  extensionMatches,
  matchesSignature,
  validateUpload,
} from '../../src/lib/uploadRules'

const PNG_HEADER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
const JPEG_HEADER = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16])
const PDF_HEADER = new TextEncoder().encode('%PDF-1.7\n%....')
const WEBP_HEADER = new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ')
const TEXT_HEADER = new TextEncoder().encode('Log excerpt\nStatus: 500\n')
const HTML_HEADER = new TextEncoder().encode('<html><script>alert(1)</script>')

describe('matchesSignature', () => {
  it('accepts the real magic bytes of each allowed type', () => {
    expect(matchesSignature('image/png', PNG_HEADER)).toBe(true)
    expect(matchesSignature('image/jpeg', JPEG_HEADER)).toBe(true)
    expect(matchesSignature('application/pdf', PDF_HEADER)).toBe(true)
    expect(matchesSignature('image/webp', WEBP_HEADER)).toBe(true)
    expect(matchesSignature('text/plain', TEXT_HEADER)).toBe(true)
  })

  it('rejects HTML content that claims to be an image', () => {
    expect(matchesSignature('image/png', HTML_HEADER)).toBe(false)
    expect(matchesSignature('image/jpeg', HTML_HEADER)).toBe(false)
  })

  it('rejects a header that is too short to contain the signature', () => {
    expect(matchesSignature('image/png', new Uint8Array([0x89, 0x50]))).toBe(false)
    expect(matchesSignature('image/webp', new TextEncoder().encode('RIFF'))).toBe(false)
  })

  it('rejects binary content sent as text/plain', () => {
    expect(matchesSignature('text/plain', new Uint8Array([0x41, 0x00, 0x42]))).toBe(false)
  })
})

describe('extensionMatches', () => {
  it('is case-insensitive and accepts both jpeg spellings', () => {
    expect(extensionMatches('image/png', 'screenshot.PNG')).toBe(true)
    expect(extensionMatches('image/jpeg', 'photo.jpeg')).toBe(true)
  })

  it('rejects a name whose extension does not belong to the type', () => {
    expect(extensionMatches('image/png', 'page.html')).toBe(false)
    expect(extensionMatches('image/png', 'png')).toBe(false)
  })
})

describe('validateUpload', () => {
  const valid = { filename: 'screenshot.png', mimetype: 'image/png', size: 1000, header: PNG_HEADER }

  it('passes a well-formed upload', () => {
    expect(validateUpload(valid)).toBeNull()
  })

  it('rejects a MIME type outside the allowlist', () => {
    expect(validateUpload({ ...valid, mimetype: 'text/html' })).toContain('not allowed')
  })

  it('accepts exactly 5 MB and rejects one byte more', () => {
    expect(validateUpload({ ...valid, size: MAX_UPLOAD_BYTES })).toBeNull()
    expect(validateUpload({ ...valid, size: MAX_UPLOAD_BYTES + 1 })).toContain('larger than 5 MB')
  })

  it('rejects a file whose name does not match its declared type', () => {
    expect(validateUpload({ ...valid, filename: 'report.exe' })).toContain('must end with .png')
  })

  it('rejects a PNG name carrying HTML bytes', () => {
    expect(validateUpload({ ...valid, header: HTML_HEADER })).toBe('File content does not match its type.')
  })
})
