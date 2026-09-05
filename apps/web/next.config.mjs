import { createMDX } from 'fumadocs-mdx/next'

/** @type {import('next').NextConfig} */
const config = {
  transpilePackages: ['@agent-commons/ui'],
  reactStrictMode: true,
  poweredByHeader: false,
}

export default createMDX()(config)
