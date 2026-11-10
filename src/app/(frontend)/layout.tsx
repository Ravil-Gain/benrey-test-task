import type { ReactNode } from 'react'

export const metadata = {
  title: 'Support Tickets',
  description: 'Support Ticket Tracker admin built on Payload CMS.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
