// Reads settings from environment variables. A missing one throws with its name,
// so a broken deploy fails at startup. We never fall back to local disk or a default password.

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

export const env = {
  databaseUrl: () => required('DATABASE_URL'),
  payloadSecret: () => required('PAYLOAD_SECRET'),
  // The public address of the app, e.g. http://localhost:3000 or the Render URL.
  serverUrl: () => {
    const url = required('PAYLOAD_PUBLIC_SERVER_URL').replace(/\/+$/, '')
    if (!/^https?:\/\//.test(url)) {
      throw new Error('PAYLOAD_PUBLIC_SERVER_URL must start with http:// or https://')
    }
    return url
  },
  r2: () => ({
    accountId: required('R2_ACCOUNT_ID'),
    bucket: required('R2_BUCKET'),
    accessKeyId: required('R2_ACCESS_KEY_ID'),
    secretAccessKey: required('R2_SECRET_ACCESS_KEY'),
  }),
}
