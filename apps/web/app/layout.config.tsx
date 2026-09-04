import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared'

export const baseOptions: BaseLayoutProps = {
  nav: {
    title: 'Common Arcade',
  },
  links: [
    { text: 'Discover', url: '/discover' },
    { text: 'Studio', url: '/studio' },
    { text: 'Docs', url: '/docs' },
  ],
}
