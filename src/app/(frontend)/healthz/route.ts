// Render's health check. It answers once the server is up and accepting requests.
// It does not touch the database: a Neon outage should not make Render restart the app
// in a loop, and a check every few seconds would keep the free Neon compute awake.
export const dynamic = 'force-dynamic'

export function GET(): Response {
  return Response.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } })
}
