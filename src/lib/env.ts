// Settings come from environment variables only. A missing one throws with its name, so a
// broken deploy fails at startup instead of falling back to a default.

export type EnvSource = Record<string, string | undefined>

export function requireEnv(name: string, source: EnvSource = process.env): string {
  const value = source[name]?.trim()
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

// The public address as a bare origin. It is also the CSRF allowlist, which compares origins,
// so a path or query would never match. Production must use https, except on a local host.
export function parseServerOrigin(value: string, nodeEnv: string | undefined): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('PAYLOAD_PUBLIC_SERVER_URL must be a full URL such as https://example.com')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('PAYLOAD_PUBLIC_SERVER_URL must start with http:// or https://')
  }
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error(
      'PAYLOAD_PUBLIC_SERVER_URL must be an origin only, with no path, query or login',
    )
  }
  if (nodeEnv === 'production' && url.protocol !== 'https:' && !LOCAL_HOSTS.has(url.hostname)) {
    throw new Error('PAYLOAD_PUBLIC_SERVER_URL must use https:// in production')
  }
  return url.origin
}

// Session cookies get the Secure flag whenever the app is served over https.
export function isHttpsOrigin(serverOrigin: string): boolean {
  return serverOrigin.startsWith('https://')
}

export const env = {
  databaseUrl: () => requireEnv('DATABASE_URL'),
  payloadSecret: () => requireEnv('PAYLOAD_SECRET'),
  serverUrl: () => parseServerOrigin(requireEnv('PAYLOAD_PUBLIC_SERVER_URL'), process.env.NODE_ENV),
  // Optional: without a key the AI help answers "not set up" and the admin keeps working.
  groqApiKey: (): string | null => process.env.GROQ_API_KEY?.trim() || null,
  groqModel: (): string | null => process.env.GROQ_MODEL?.trim() || null,
  r2: () => ({
    accountId: requireEnv('R2_ACCOUNT_ID'),
    bucket: requireEnv('R2_BUCKET'),
    accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
  }),
}
