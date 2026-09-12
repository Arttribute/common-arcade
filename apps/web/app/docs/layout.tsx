import type { ReactNode } from 'react'
import { DocsLayout } from 'fumadocs-ui/layouts/docs'
import { baseOptions } from '../layout.config'
import { source } from '@/lib/source'

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="docs-shell" style={{ display: 'contents' }}>
      <DocsLayout tree={source.getPageTree()} {...baseOptions}>
        {children}
      </DocsLayout>
    </div>
  )
}
