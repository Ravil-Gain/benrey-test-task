// Rules for the `originalName` field of the media collection. No Payload import, so the
// unit tests can run them directly.
//
// For a direct upload the browser asks for a signed URL first, and Payload's client handler
// then swaps the file name for the sanitized one before the media document is created. The
// signed-URL request is the only place the server sees the name the uploader picked, so it
// keeps that name in Payload's key-value store under the upload's random folder (the
// `_objectKey` that the signed receipt carries). The media hook reads it back once.

export const ORIGINAL_NAME_MAX_LENGTH = 200

// Same lifetime as Payload's signed upload receipt. A receipt older than this is refused,
// so a stored name older than this can never be used.
export const ORIGINAL_NAME_TTL_MS = 6 * 60 * 60 * 1000

export type StoredOriginalName = { name: string; expiresAt: number }

export function originalNameKey(objectKey: string): string {
  return `media-original-name:${objectKey}`
}

// Keeps the name as the uploader gave it, minus anything that is not part of a file name:
// a client path ("C:\\photos\\a.png" -> "a.png"), control characters and outer spaces.
// Returns null when nothing usable is left.
export function cleanOriginalName(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const base = value.split(/[\\/]/).pop() ?? ''
  const name = base
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, ORIGINAL_NAME_MAX_LENGTH)
  return name.length > 0 ? name : null
}

export function storedOriginalName(name: string, now: number): StoredOriginalName {
  return { name, expiresAt: now + ORIGINAL_NAME_TTL_MS }
}

// Reads a value back from the store. Anything malformed or expired counts as missing.
export function readStoredOriginalName(value: unknown, now: number): string | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const { name, expiresAt } = value as Partial<StoredOriginalName>
  if (typeof expiresAt !== 'number' || expiresAt <= now) {
    return null
  }
  return cleanOriginalName(name)
}
