// The CORS rule for the R2 bucket. No AWS SDK import, so the unit tests can run it directly.
//
// Browsers PUT files straight to R2 with a signed URL (ADR-022), so the bucket must allow
// each origin the admin runs on. Nothing else: reads go through Payload's file route,
// which is same-origin, so GET is not allowed from browsers.

export type CorsRule = {
  AllowedOrigins: string[]
  AllowedMethods: string[]
  AllowedHeaders: string[]
  ExposeHeaders: string[]
  MaxAgeSeconds: number
}

// Accepts "https://host[:port]" with no path. Returns the normalized origin.
export function parseCorsOrigin(value: string): string {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error(`Not a URL: ${value}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Origin must start with http:// or https://: ${value}`)
  }
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error(`Origin must have no path, query or login: ${value}`)
  }
  return url.origin
}

export function buildCorsRules(origins: string[]): CorsRule[] {
  const unique = [...new Set(origins.map(parseCorsOrigin))]
  if (unique.length === 0) {
    throw new Error('At least one origin is required')
  }
  return [
    {
      AllowedOrigins: unique,
      AllowedMethods: ['PUT'],
      // The signed PUT fixes Content-Type, Content-Length and If-None-Match.
      AllowedHeaders: ['content-type', 'content-length', 'if-none-match'],
      ExposeHeaders: ['ETag'],
      MaxAgeSeconds: 3600,
    },
  ]
}
