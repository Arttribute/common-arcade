import { ARCADE_PROTOCOL } from '@common-arcade/protocol'
import { ControlClient } from '@common-arcade/control-client'

export interface RunCliOptions {
  args: string[]
  env?: NodeJS.ProcessEnv
  write?: (value: string) => void
}

export async function runCli(options: RunCliOptions): Promise<number> {
  const [command] = options.args
  const env = options.env ?? process.env
  const write = options.write ?? console.log

  if (
    !command ||
    command === 'help' ||
    command === '--help' ||
    command === '-h'
  ) {
    write(
      'Common Arcade CLI (pre-v0alpha)\n\nCommands:\n  status   Inspect a control API\n  version  Print protocol status',
    )
    return 0
  }

  if (command === 'version' || command === '--version' || command === '-v') {
    write(`${ARCADE_PROTOCOL.namespace} (${ARCADE_PROTOCOL.stability})`)
    return 0
  }

  if (command === 'status') {
    const client = new ControlClient({
      baseUrl: env.ARCADE_API_URL ?? 'http://localhost:4100',
    })
    write(JSON.stringify(await client.getStatus(), null, 2))
    return 0
  }

  write(`Unknown command: ${command}`)
  return 1
}
