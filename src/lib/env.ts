// Reads settings from environment variables. A missing one throws with its name,
// so a broken deploy fails at startup. We never fall back to local disk or a default password.

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

// Turns the configured public address into a bare origin ("https://host[:port]").
// It is the CSRF allowlist, which compares origins, so a path, query or hash would
// never match and is refused. In production the origin must be https, except on a
// local host (a production build started on this machine with `pnpm start`).
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
    throw new Error('PAYLOAD_PUBLIC_SERVER_URL must be an origin only, with no path, query or login')
  }
  if (nodeEnv === 'production' && url.protocol !== 'https:' && !LOCAL_HOSTS.has(url.hostname)) {
    throw new Error('PAYLOAD_PUBLIC_SERVER_URL must use https:// in production')
  }
  return url.origin
}

// Session cookies get the Secure flag whenever the app is served over https.
// Payload's default is Secure off.
export function useSecureCookies(serverOrigin: string): boolean {
  return serverOrigin.startsWith('https://')
}

export const env = {
  databaseUrl: () => required('DATABASE_URL'),
  payloadSecret: () => required('PAYLOAD_SECRET'),
  // The public address of the app, e.g. http://localhost:3000 or the Render URL.
  serverUrl: () => parseServerOrigin(required('PAYLOAD_PUBLIC_SERVER_URL'), process.env.NODE_ENV),
  r2: () => ({
    accountId: required('R2_ACCOUNT_ID'),
    bucket: required('R2_BUCKET'),
    accessKeyId: required('R2_ACCESS_KEY_ID'),
    secretAccessKey: required('R2_SECRET_ACCESS_KEY'),
  }),
}
