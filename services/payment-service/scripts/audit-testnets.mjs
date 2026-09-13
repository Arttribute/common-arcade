import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { createPublicClient, http, erc20Abi, formatUnits } from 'viem'
import { NETWORKS } from '@common-arcade/economy'
import { privateKeyToAccount } from 'viem/accounts'

const network = NETWORKS[process.argv[2]]
if (!network?.testnet) throw new Error('Select a supported testnet')
const output = process.env.ARCADE_AUDIT_OUTPUT ?? '/tmp/arcade-payment-audit'
await mkdir(output, { recursive: true })
const report = {
  network: network.id,
  checkedAt: new Date().toISOString(),
  status: 'checking',
}
try {
  const reader = createPublicClient({
    chain: network.chain,
    transport: http(undefined, { timeout: 15000, retryCount: 1 }),
  })
  const secret = JSON.parse(
    execFileSync(
      'aws',
      [
        'secretsmanager',
        'get-secret-value',
        '--secret-id',
        `common-arcade/${process.env.ARCADE_AUDIT_STAGE ?? 'development'}/payments`,
        '--query',
        'SecretString',
        '--output',
        'text',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ),
  )
  const key = secret.resolverKey
  const account = privateKeyToAccount(key)
  const [chainId, native, usdc] = await Promise.all([
    reader.getChainId(),
    reader.getBalance({ address: account.address }),
    reader.readContract({
      address: network.token,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account.address],
    }),
  ])
  Object.assign(report, {
    chainId,
    address: account.address,
    native: formatUnits(native, 18),
    nativeSymbol: network.chain.nativeCurrency.symbol,
    usdc: formatUnits(usdc, 6),
  })
  if (chainId !== network.chain.id)
    throw new Error('RPC returned the wrong chain')
  if (usdc < 60000n || native === 0n) {
    report.status = 'needs-test-funds'
    report.reason =
      'At least 0.06 test USDC and native gas are required for the funded contract check'
  } else if (!process.argv.includes('--broadcast'))
    report.status = 'funded-read-only'
  else {
    const child = spawnSync(
      process.execPath,
      ['scripts/smoke-testnet.mjs', network.id, '--broadcast'],
      {
        cwd: new URL('..', import.meta.url),
        env: { ...process.env, ARCADE_DEPLOYER_KEY: key },
        encoding: 'utf8',
        timeout: 900000,
      },
    )
    // Only transaction hashes/check outcomes, never a signing key or request dump.
    report.contractExitCode = child.status
    report.contractEvidence = (child.stdout ?? '')
      .split('\n')
      .filter((line) => /^\w+: 0x[\da-f]{64}$/.test(line))
    if (child.status !== 0)
      throw new Error(
        'Funded contract smoke test failed; inspect public receipts',
      )
    report.status = 'contract-payments-verified'
  }
} catch (error) {
  report.status = 'failed'
  report.reason = error.message?.startsWith('Command failed')
    ? 'AWS credential or secret access failed'
    : (error.shortMessage ?? error.message).slice(0, 250)
  process.exitCode = 1
}
await writeFile(
  `${output}/${network.id}.json`,
  JSON.stringify(report, null, 2) + '\n',
)
console.log(JSON.stringify(report, null, 2))
