import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Space_Grotesk } from 'next/font/google'
import { RootProvider } from 'fumadocs-ui/provider/next'
import 'fumadocs-ui/style.css'
import '@agent-commons/ui/styles.css'
import './styles.css'
import './refresh.css'

const spaceGrotesk = Space_Grotesk({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  display: 'swap',
  fallback: ['Helvetica', 'Arial', 'sans-serif'],
  variable: '--font-space-grotesk',
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
    <html lang="en" suppressHydrationWarning>
      <body className={`${spaceGrotesk.className} ${spaceGrotesk.variable}`}>
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  )
}
