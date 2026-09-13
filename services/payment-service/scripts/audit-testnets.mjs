import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
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
  const deployment = JSON.parse(
    await readFile(
      new URL(
        `../../../packages/contracts/deployments/${network.id}.json`,
        import.meta.url,
      ),
      'utf8',
    ),
  )
  const key = process.env.ARCADE_TESTNET_AUDIT_KEY
  const address = deployment.admin
  if (!deployment.verifiedAt || !/^0x[\da-f]{40}$/i.test(address))
    throw new Error('A verified testnet deployment is required')
  const [chainId, native, usdc] = await Promise.all([
    reader.getChainId(),
    reader.getBalance({ address }),
    reader.readContract({
      address: network.token,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [address],
    }),
  ])
  Object.assign(report, {
    chainId,
    address,
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
    if (!key || !/^0x[\da-f]{64}$/i.test(key))
      throw new Error(
        'Configure ARCADE_TESTNET_AUDIT_KEY in the protected test environment',
      )
    if (
      privateKeyToAccount(key).address.toLowerCase() !== address.toLowerCase()
    )
      throw new Error(
        'Audit wallet does not match the verified test deployment',
      )
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
  report.reason = (error.shortMessage ?? error.message).slice(0, 250)
  process.exitCode = 1
}
await writeFile(
  `${output}/${network.id}.json`,
  JSON.stringify(report, null, 2) + '\n',
)
console.log(JSON.stringify(report, null, 2))
