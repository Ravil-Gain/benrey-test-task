/**
 * Reads required configuration from environment variables.
 *
 * A missing value throws with the variable name. The app never falls back to
 * local disk or an embedded database, so a misconfigured deploy fails loudly.
 */
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
  r2: () => ({
    accountId: required('R2_ACCOUNT_ID'),
    bucket: required('R2_BUCKET'),
    accessKeyId: required('R2_ACCESS_KEY_ID'),
    secretAccessKey: required('R2_SECRET_ACCESS_KEY'),
  }),
}
