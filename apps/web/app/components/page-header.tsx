import type { ReactNode } from 'react'

/**
 * The shared page header, matching Agent Commons' studio pages: a 16px title
 * sitting fully inside a soft marker highlight, an optional one-line
 * description, and a right-aligned actions slot. Borderless, so the page flows
 * straight into its content.
 */
export function PageHeader({
  title,
  description,
  children,
  className = '',
}: {
  title: string
  description?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <header className={`page-header shell ${className}`.trim()}>
      <div className="page-header-copy">
        <h1 className="page-header-title">
          <span>{title}</span>
        </h1>
        {description ? (
          <p className="page-header-description">{description}</p>
        ) : null}
      </div>
      {children ? <div className="page-header-actions">{children}</div> : null}
    </header>
  )
}
