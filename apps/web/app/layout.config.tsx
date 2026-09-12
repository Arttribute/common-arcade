import { Brand } from './components/brand'
import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared'

export const baseOptions: BaseLayoutProps = {
  themeSwitch: { enabled: false },
  nav: {
    title: <Brand />,
  },
  links: [
    { text: 'Discover', url: '/discover' },
    { text: 'Studio', url: '/studio' },
    { text: 'Docs', url: '/docs' },
  ],
}
