import { readFile, writeFile, mkdir } from 'node:fs/promises'
import {
  createPublicClient,
  createWalletClient,
  http,
  erc20Abi,
  formatEther,
  parseAbi,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { NETWORKS } from '@common-arcade/economy'

// Explicit EOA testnet deployment. Keys are injected into the process only;
// deployment records contain public addresses, receipts and compiler settings.
const networkId = process.argv[2]
const network = NETWORKS[networkId]
const broadcast = process.argv.includes('--broadcast')
try {
  if (!network?.testnet)
    throw new Error(
      'Select base-sepolia, arc-testnet, hedera-testnet or celo-sepolia',
    )
  const admin = process.env.ARCADE_TESTNET_ADMIN
  if (!/^0x[0-9a-fA-F]{40}$/.test(admin ?? '') || /^0x0{40}$/.test(admin))
    throw new Error('Set a nonzero ARCADE_TESTNET_ADMIN')
  const rpcUrl =
    process.env.ARCADE_DEPLOY_RPC_URL ?? network.chain.rpcUrls.default.http[0]
  const reader = createPublicClient({
    chain: network.chain,
    transport: http(rpcUrl),
    pollingInterval: 1000,
  })
  if ((await reader.getChainId()) !== network.chain.id)
    throw new Error('RPC chain mismatch')
  if (((await reader.getCode({ address: admin })) ?? '0x') !== '0x')
    throw new Error('Testnet administrator must be an EOA')
  const balance = await reader.getBalance({ address: admin })
  console.log(
    `${networkId}: ${formatEther(balance)} ${network.chain.nativeCurrency.symbol} for gas`,
  )
  const tokenDecimals = await reader.readContract({
    address: network.token,
    abi: erc20Abi,
    functionName: 'decimals',
  })
  if (tokenDecimals !== 6) throw new Error('Unexpected canonical USDC decimals')
  if (!broadcast) process.exit(0)
  if (balance === 0n)
    throw new Error('Fund the testnet administrator before broadcasting')
  const key = process.env.ARCADE_DEPLOYER_KEY
  if (!/^0x[0-9a-fA-F]{64}$/.test(key ?? ''))
    throw new Error('Inject ARCADE_DEPLOYER_KEY as 0x-prefixed hex')
  const account = privateKeyToAccount(key)
  if (account.address.toLowerCase() !== admin.toLowerCase())
    throw new Error('Deployer must match testnet administrator')
  const wallet = createWalletClient({
    account,
    chain: network.chain,
    transport: http(rpcUrl),
  })
  const artifact = JSON.parse(
    await readFile(
      new URL(
        '../../../packages/contracts/out/ArcadeEscrow.sol/ArcadeEscrow.json',
        import.meta.url,
      ),
      'utf8',
    ),
  )
  const metadata =
    typeof artifact.metadata === 'string'
      ? JSON.parse(artifact.metadata)
      : artifact.metadata
  const directory = new URL(
    '../../../packages/contracts/deployments/',
    import.meta.url,
  )
  const recordUrl = new URL(`${networkId}.json`, directory)
  await mkdir(directory, { recursive: true })
  let record
  try {
    record = JSON.parse(await readFile(recordUrl, 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  if (
    record &&
    (record.chainId !== network.chain.id ||
      record.admin.toLowerCase() !== admin.toLowerCase())
  )
    throw new Error(
      'Existing deployment record has different network/administrator',
    )
  record ??= {
    network: networkId,
    chainId: network.chain.id,
    admin: account.address,
    treasury: account.address,
    resolver: account.address,
    token: network.token,
    compiler: metadata.compiler,
    transactions: {},
  }
  const save = () =>
    writeFile(recordUrl, JSON.stringify(record, null, 2) + '\n')
  async function receipt(label, send) {
    let hash = record.transactions[label]?.hash
    if (!hash) {
      hash = await send()
      record.transactions[label] = { hash }
      await save() // Save pending hashes before waiting; never resend on timeout.
    }
    const result = await reader.waitForTransactionReceipt({
      hash,
      confirmations: 2,
      timeout: 180000,
    })
    if (result.status !== 'success')
      throw new Error(`${label} reverted: ${hash}; inspect before retrying`)
    record.transactions[label] = {
      hash,
      blockNumber: String(result.blockNumber),
      status: result.status,
    }
    await save()
    console.log(`${label}: ${hash}`)
    return result
  }
  const deployed = await receipt('deploy', () =>
    wallet.deployContract({
      abi: artifact.abi,
      bytecode: artifact.bytecode.object,
      args: [account.address],
    }),
  )
  record.contract = deployed.contractAddress
  if (!record.contract)
    throw new Error('Deployment receipt lacks contract address')
  await save()
  const read = (functionName, args = []) =>
    reader.readContract({
      address: record.contract,
      abi: artifact.abi,
      functionName,
      args,
    })
  if ((await read('owner')).toLowerCase() !== admin.toLowerCase())
    throw new Error('Unexpected escrow owner')
  async function write(label, functionName, args) {
    return receipt(label, async () => {
      const { request } = await reader.simulateContract({
        address: record.contract,
        abi: artifact.abi,
        functionName,
        args,
        account,
      })
      return wallet.writeContract(request)
    })
  }
  if (!(await read('allowedTokens', [network.token])))
    await write('allowUSDC', 'setToken', [network.token, true])
  if (!(await read('resolvers', [account.address])))
    await write('allowResolver', 'setResolver', [account.address, true])
  if (network.chain.id === 296) {
    await write('associateEscrowUSDC', 'associateHederaToken', [network.token])
    // The EOA treasury must also be able to receive canonical HTS USDC.
    // HRC-719 runs association in the context of the transaction's signer.
    const associationAbi = parseAbi([
      'function isAssociated() view returns (bool)',
      'function associate() returns (int64)',
    ])
    const associated = () =>
      reader.readContract({
        address: network.token,
        abi: associationAbi,
        functionName: 'isAssociated',
        account,
      })
    if (!(await associated())) {
      await receipt('associateTreasuryUSDC', async () => {
        const { request, result } = await reader.simulateContract({
          address: network.token,
          abi: associationAbi,
          functionName: 'associate',
          account,
        })
        if (result !== 22n && result !== 194n)
          throw new Error(`Hedera treasury association returned ${result}`)
        return wallet.writeContract(request)
      })
    }
    if (!(await associated()))
      throw new Error('Hedera treasury is not associated with USDC')
  }
  record.verifiedAt = new Date().toISOString()
  record.settings = metadata.settings
  await save()
  console.log(
    JSON.stringify(
      {
        [networkId]: {
          contract: record.contract,
          treasury: account.address,
          rpcUrl,
        },
      },
      null,
      2,
    ),
  )
} catch (error) {
  // viem errors can include request data; never dump the signing environment.
  console.error(error.shortMessage ?? error.message)
  process.exitCode = 1
}
