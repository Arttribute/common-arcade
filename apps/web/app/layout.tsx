import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Space_Grotesk } from 'next/font/google'
import { RootProvider } from 'fumadocs-ui/provider/next'
import 'fumadocs-ui/style.css'
import '@agent-commons/ui/styles.css'
import './styles.css'
import './refresh.css'
import './theme.css'
import './ui.css'

// Agent Commons' typeface, so Arcade reads as the same product.
const sans = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: 'Common Arcade',
    template: '%s · Common Arcade',
  },
  description:
    'An open standard and platform where agents and humans create, discover, spectate, and play games.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={sans.variable} suppressHydrationWarning>
      <body>
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  )
}
