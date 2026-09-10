import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import {
  createPublicClient,
  createWalletClient,
  http,
  erc20Abi,
  keccak256,
  toBytes,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { NETWORKS, arcadeEscrowAbi } from '@common-arcade/economy'

// Explicit public-chain integration check, using 0.06 test USDC, returned to
// the same wallet. Gas is consumed. Run only against a verified deployment.
try {
  const networkId = process.argv[2]
  const network = NETWORKS[networkId]
  if (!network?.testnet || !process.argv.includes('--broadcast'))
    throw new Error('Select a testnet and explicitly pass --broadcast')
  const account = privateKeyToAccount(process.env.ARCADE_DEPLOYER_KEY)
  const record = JSON.parse(
    await readFile(
      new URL(
        `../../../packages/contracts/deployments/${networkId}.json`,
        import.meta.url,
      ),
      'utf8',
    ),
  )
  if (
    !record.verifiedAt ||
    record.admin.toLowerCase() !== account.address.toLowerCase()
  )
    throw new Error('Verified deployment and matching administrator required')
  const rpcUrl =
    process.env.ARCADE_DEPLOY_RPC_URL ?? network.chain.rpcUrls.default.http[0]
  const reader = createPublicClient({
    chain: network.chain,
    transport: http(rpcUrl),
    pollingInterval: 1000,
  })
  const wallet = createWalletClient({
    account,
    chain: network.chain,
    transport: http(rpcUrl),
  })
  assert.equal(await reader.getChainId(), network.chain.id)
  const contract = record.contract
  const read = (functionName, args = []) =>
    reader.readContract({
      address: contract,
      abi: arcadeEscrowAbi,
      functionName,
      args,
    })
  const balanceOf = (address) =>
    reader.readContract({
      address: network.token,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [address],
    })
  assert.equal(
    (await read('owner')).toLowerCase(),
    account.address.toLowerCase(),
  )
  assert.equal(await read('allowedTokens', [network.token]), true)
  assert.equal(await read('resolvers', [account.address]), true)
  assert.ok(
    (await balanceOf(account.address)) >= 60000n,
    'Fund wallet with at least 0.06 test USDC plus network gas',
  )
  const baseline = await balanceOf(contract)
  const claimableBefore = await read('claimable', [
    network.token,
    account.address,
  ])
  const runId = `${networkId}-${Date.now()}`
  const evidence = {
    network: networkId,
    chainId: network.chain.id,
    contract,
    administrator: account.address,
    runId,
    transactions: [],
    verified: false,
  }
  const file = new URL(
    `../../../packages/contracts/deployments/${runId}-smoke.json`,
    import.meta.url,
  )
  const save = () => writeFile(file, JSON.stringify(evidence, null, 2) + '\n')
  async function send(functionName, args, token = false) {
    const { request } = await reader.simulateContract({
      account,
      address: token ? network.token : contract,
      abi: token ? erc20Abi : arcadeEscrowAbi,
      functionName,
      args,
    })
    const hash = await wallet.writeContract(request)
    const tx = { operation: functionName, hash }
    evidence.transactions.push(tx)
    await save()
    const receipt = await reader.waitForTransactionReceipt({
      hash,
      confirmations: 2,
      timeout: 180000,
    })
    assert.equal(receipt.status, 'success', functionName)
    tx.blockNumber = String(receipt.blockNumber)
    tx.status = receipt.status
    await save()
    console.log(`${functionName}: ${hash}`)
    return receipt
  }
  const hash = (value) => keccak256(toBytes(`${runId}:${value}`))
  const seats = [hash('seat-a'), hash('seat-b')]
  const pool = hash('staked-pool')
  const block = await reader.getBlock()
  const terms = {
    token: network.token,
    resolver: account.address,
    treasury: account.address,
    fundingDeadline: block.timestamp + 3600n,
    settlementDeadline: block.timestamp + 7200n,
    feeBps: 250,
    stake: 10000n,
    bounties: true,
    betting: true,
    rulesHash: hash('rules'),
    creator: account.address,
    creatorShareBps: 7000,
    royalties: [],
  }
  await send('approve', [contract, 60000n], true)
  await send('createMatch', [
    pool,
    terms,
    seats,
    [account.address, account.address],
  ])
  await send('stake', [pool, seats[0]])
  await send('stake', [pool, seats[1]])
  await send('fundBounty', [pool, 10000n])
  await send('placeBet', [pool, seats[0], 10000n])
  await send('placeBet', [pool, seats[1], 10000n])
  await send('lock', [pool])
  await send('settle', [pool, seats[0], hash('result')])
  assert.equal((await read('getMatch', [pool])).status, 3)
  // 30,000 prize units plus the 250-unit losing-spectator fee, all recipients
  // deliberately share this wallet. Separate recipients are covered on Anvil.
  assert.equal(
    await read('claimable', [network.token, account.address]),
    claimableBefore + 30250n,
  )
  await send('claimBet', [pool])
  await send('withdraw', [network.token, account.address])
  assert.equal(await read('claimable', [network.token, account.address]), 0n)
  const refundPool = hash('sponsored-refund')
  await send('createMatch', [
    refundPool,
    { ...terms, stake: 0n },
    seats,
    [account.address, account.address],
  ])
  await send('fundBounty', [refundPool, 10000n])
  await send('voidMatch', [refundPool])
  await send('claimRefund', [refundPool])
  assert.equal(await read('refundable', [refundPool, account.address]), 0n)
  assert.equal(await balanceOf(contract), baseline - claimableBefore)
  // Clear any unused allowance after this one-shot run.
  await send('approve', [contract, 0n], true)
  evidence.verified = true
  evidence.verifiedAt = new Date().toISOString()
  evidence.checks = [
    'canonical USDC approval',
    'two player stakes',
    'sponsor bounty',
    'winning and losing spectator deposits',
    'lock',
    'settlement and fee accounting',
    'spectator claim',
    'withdrawal',
    'sponsored pool cancellation and refund',
    'escrow balance conservation',
    'allowance cleared',
  ]
  await save()
  console.log(`Verified ${networkId}; public evidence: ${file.pathname}`)
} catch (error) {
  console.error(error.shortMessage ?? error.message)
  process.exitCode = 1
}
