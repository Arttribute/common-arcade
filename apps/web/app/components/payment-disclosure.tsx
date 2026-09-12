import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'

export function PaymentSummary({ children }: { children: ReactNode }) {
  return (
    <summary className="payment-summary">
      <ChevronRight size={16} aria-hidden className="payment-summary-chevron" />
      <span>{children}</span>
    </summary>
  )
}
