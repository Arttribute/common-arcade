export const service = {
  name: 'common-arcade-mcp-server',
  status: 'pre-v0alpha',
  transports: [] as string[],
  tools: [] as string[],
} as const

if (process.argv[1] === import.meta.filename) {
  console.log(JSON.stringify(service))
}
