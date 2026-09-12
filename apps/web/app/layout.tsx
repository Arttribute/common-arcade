import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Space_Grotesk, Geist_Mono } from 'next/font/google'
import { RootProvider } from 'fumadocs-ui/provider/next'
import 'fumadocs-ui/style.css'
import '@agent-commons/ui/styles.css'
import './tokens.css'
import './styles.css'
import './refresh.css'
import './harmony.css'

/* Space Grotesk is the shared brand face across Agent Commons; Geist Mono
 * carries metadata, identifiers and code. Both are exposed as custom
 * properties that `--font-sans` / `--font-mono` in tokens.css resolve. */
const spaceGrotesk = Space_Grotesk({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  display: 'swap',
  fallback: ['Helvetica Neue', 'Helvetica', 'Arial', 'sans-serif'],
  variable: '--font-space',
})

const geistMono = Geist_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-geist-mono',
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
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <RootProvider
          theme={{
            defaultTheme: 'light',
            enableSystem: false,
            storageKey: 'arcade-theme',
            hotKey: false,
          }}
        >
          {children}
        </RootProvider>
      </body>
    </html>
  )
}
