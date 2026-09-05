import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { RootProvider } from 'fumadocs-ui/provider/next'
import 'fumadocs-ui/style.css'
import '@agent-commons/ui/styles.css'
import './styles.css'

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
      <body>
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  )
}
