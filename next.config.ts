import { withPayload } from '@payloadcms/next/withPayload'
import type { NextConfig } from 'next'

// Browser-side hardening on every response. Uploaded files are served with the same
// headers, so a text file can never be sniffed into a page and nothing can frame the admin.
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
]

const nextConfig: NextConfig = {
  poweredByHeader: false,
  headers: () => Promise.resolve([{ source: '/:path*', headers: securityHeaders }]),
}

export default withPayload(nextConfig, { devBundleServerPackages: false })
