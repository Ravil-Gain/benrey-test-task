// Upload rules for the media collection. No Payload import, so the unit tests can run them directly.
// The checks look at the bytes that were actually stored, not only at what the client declared.

export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'text/plain',
] as const

export type AllowedMime = (typeof ALLOWED_MIME_TYPES)[number]

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

// How many leading bytes the signature check needs.
export const SIGNATURE_BYTES = 16

const EXTENSIONS_BY_MIME: Record<AllowedMime, string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'application/pdf': ['pdf'],
  'text/plain': ['txt'],
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export function isAllowedMime(value: string): value is AllowedMime {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(value)
}

// "report.PDF" -> true for application/pdf. A name without an extension never matches.
export function extensionMatches(mimetype: AllowedMime, filename: string): boolean {
  const dot = filename.lastIndexOf('.')
  if (dot < 0) {
    return false
  }
  return EXTENSIONS_BY_MIME[mimetype].includes(filename.slice(dot + 1).toLowerCase())
}

// Magic bytes: the first bytes that identify the real format.
export function matchesSignature(mimetype: AllowedMime, header: Uint8Array): boolean {
  switch (mimetype) {
    case 'image/jpeg':
      return header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff
    case 'image/png':
      return PNG_SIGNATURE.every((byte, index) => header[index] === byte)
    case 'image/webp':
      return hasAscii(header, 0, 'RIFF') && hasAscii(header, 8, 'WEBP')
    case 'application/pdf':
      return hasAscii(header, 0, '%PDF-')
    case 'text/plain':
      // Plain text has no fixed signature. A NUL byte means the file is binary.
      return !header.includes(0)
  }
}

// Returns the error message for the first rule that fails, or null when the upload is fine.
export function validateUpload(input: {
  filename: string
  mimetype: string
  size: number
  header: Uint8Array
}): string | null {
  if (!isAllowedMime(input.mimetype)) {
    return `File type ${input.mimetype} is not allowed.`
  }
  if (input.size > MAX_UPLOAD_BYTES) {
    return 'File is larger than 5 MB.'
  }
  if (!extensionMatches(input.mimetype, input.filename)) {
    return `File name must end with ${EXTENSIONS_BY_MIME[input.mimetype].map((ext) => `.${ext}`).join(' or ')}.`
  }
  if (!matchesSignature(input.mimetype, input.header)) {
    return 'File content does not match its type.'
  }
  return null
}

function hasAscii(bytes: Uint8Array, offset: number, text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (bytes[offset + i] !== text.charCodeAt(i)) {
      return false
    }
  }
  return true
}
