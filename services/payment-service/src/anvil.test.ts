import { it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import {
  createPublicClient,
  createWalletClient,
  http,
  erc20Abi,
  type Address,
  type Hex,
} from 'viem'
import { foundry } from 'viem/chains'
import { mnemonicToAccount } from 'viem/accounts'
import {
  createViemAdapter,
  approvalCall,
  escrowCall,
  arcadeEscrowAbi,
  hashArcadeId,
} from '@common-arcade/economy'
import { shuffledShoe, handValue } from '@common-arcade/example-blackjack'
import { MatchHost, commandMessage } from './matches.js'
import { MemoryMatchStore } from './store.js'
import { createSettlementAdapter } from './escrow.js'
const rpc = process.env.ARCADE_ANVIL_URL
it.skipIf(!rpc)(
  'runs actual ERC20 deposits, blackjack replay, spectators, fee settlement and withdrawals on Anvil',
  async () => {
    if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(rpc!))
      throw new Error('Integration test permits local Anvil only')
    const reader = createPublicClient({
      chain: foundry,
      transport: http(rpc),
      pollingInterval: 50,
    })
    expect(await reader.getChainId()).toBe(31337)
    const accounts = Array.from({ length: 6 }, (_, addressIndex) =>
      mnemonicToAccount(
        'test test test test test test test test test test test junk',
        { addressIndex },
      ),
    )
    const wallets = accounts.map((account) =>
      createWalletClient({ account, chain: foundry, transport: http(rpc) }),
    )
    const artifact = async (name: string) =>
      JSON.parse(
        await readFile(
          new URL(
            `../../../packages/contracts/out/${name}.sol/${name}.json`,
            import.meta.url,
          ),
          'utf8',
        ),
      )
    const tokenArtifact = await artifact('TestUSDC'),
      escrowArtifact = await artifact('ArcadeEscrow')
    async function wait(hash: Hex) {
      const r = await reader.waitForTransactionReceipt({ hash })
      expect(r.status).toBe('success')
      return r
    }
    const token = (
      await wait(
        await wallets[0]!.deployContract({
          abi: tokenArtifact.abi,
          bytecode: tokenArtifact.bytecode.object,
        }),
      )
    ).contractAddress!
    const contract = (
      await wait(
        await wallets[0]!.deployContract({
          abi: escrowArtifact.abi,
          bytecode: escrowArtifact.bytecode.object,
          args: [accounts[0]!.address],
        }),
      )
    ).contractAddress!
    await wait(
      await wallets[0]!.writeContract({
        address: contract,
        abi: arcadeEscrowAbi,
        functionName: 'setToken',
        args: [token, true],
      }),
    )
    await wait(
      await wallets[0]!.writeContract({
        address: contract,
        abi: arcadeEscrowAbi,
        functionName: 'setResolver',
        args: [accounts[1]!.address, true],
      }),
    )
    for (let i = 2; i < 6; i++)
      await wait(
        await wallets[0]!.writeContract({
          address: token,
          abi: tokenArtifact.abi,
          functionName: 'mint',
          args: [accounts[i]!.address, 100_000_000n],
        }),
      )
    const deployment = { chainId: 31337, contract, token, confirmations: 1 },
      adapter = createSettlementAdapter(
        deployment,
        reader,
        wallets[1]!,
        accounts[0]!.address,
      )
    let seed = ''
    for (let i = 0; i < 100; i++) {
      const candidate = `smoke-${i}`,
        shoe = shuffledShoe(candidate),
        hand = [shoe[1]!, shoe[3]!]
      let cursor = 4
      do {
        hand.push(shoe[cursor++]!)
      } while (handValue(hand) < 21)
      if (handValue(hand) > 21) {
        seed = candidate
        break
      }
    }
    expect(seed).not.toBe('')
    const domain = 'https://local-test.arcade',
      store = new MemoryMatchStore(),
      host = new MatchHost(
        store,
        { 'base-sepolia': adapter },
        domain,
        () => seed,
      )
    const body = {
      id: randomUUID(),
      recipients: [accounts[2]!.address, accounts[3]!.address],
      economy: {
        mode: 'escrow',
        network: 'base-sepolia',
        stakeUnits: '1000000',
        bounties: true,
        spectatorBets: true,
        feeBps: 250,
        fundingSeconds: 600,
        settlementSeconds: 3600,
      },
    }
    const id = `mat_${body.id}`
    const auth = async (i: number, op: string, value: unknown) => {
      const expiresAt = Date.now() + 60000
      return {
        address: accounts[i]!.address,
        expiresAt,
        signature: await accounts[i]!.signMessage({
          message: commandMessage(id, op, value, expiresAt, domain),
        }),
      }
    }
    let view = await host.create(body, await auth(2, 'create', body))
    const pool = view.pool!
    for (const [payer, op, seat, amount] of [
      [2, 'stake', 'sea_player_1', 1_000_000n],
      [3, 'stake', 'sea_player_2', 1_000_000n],
      [4, 'bounty', 'sea_player_1', 1_000_000n],
      [4, 'bet', 'sea_player_1', 1_000_000n],
      [5, 'bet', 'sea_player_2', 2_000_000n],
    ] as const) {
      const payerAdapter = createViemAdapter(
        deployment,
        wallets[payer]!,
        reader,
      )
      await payerAdapter.submit(approvalCall(deployment, amount))
      await payerAdapter.submit(
        escrowCall(deployment, op, pool, { seat: hashArcadeId(seat), amount }),
      )
    }
    let updates = 0
    const stop = host.subscribe(id, () => updates++)
    await host.start(id, await auth(2, 'start', {}))
    const first = {
      actionId: randomUUID(),
      sequence: 0,
      type: 'stand' as const,
    }
    await host.action(id, first, await auth(2, 'action', first))
    // Deliberately bust the second player: deterministic winner exercises real USDC reward accounting.
    view = await host.view(id)
    while (view.stage === 'playing') {
      const body = {
        actionId: randomUUID(),
        sequence: view.sequence,
        type: 'hit' as const,
      }
      view = await host.action(id, body, await auth(3, 'action', body))
    }
    stop()
    expect(updates).toBeGreaterThan(2)
    expect(view.stage).toBe('settled')
    expect(view.replay).toBeTruthy()
    expect(view.result).toMatchObject({ winnerSeatId: 'sea_player_1' })
    expect(view.accounting).toEqual({
      status: 'allocated',
      prizePoolUnits: '3000000',
      spectatorPoolUnits: '3000000',
      allocations: [
        {
          role: 'winner',
          recipient: accounts[2]!.address,
          amountUnits: '2925000',
        },
        {
          role: 'platform',
          recipient: accounts[0]!.address,
          amountUnits: '125000',
        },
      ],
      spectatorPayoutUnits: '2950000',
      feeUnits: '125000',
    })
    expect(
      await reader.readContract({
        address: contract,
        abi: arcadeEscrowAbi,
        functionName: 'claimable',
        args: [token, accounts[2]!.address],
      }),
    ).toBe(2_925_000n)
    // Any caller can trigger a prize payout; it can only go to the fixed recipient.
    const caller = createViemAdapter(deployment, wallets[5]!, reader)
    await caller.submit(
      escrowCall(deployment, 'withdraw', pool, {
        beneficiary: accounts[2]!.address,
      }),
    )
    await caller.submit(
      escrowCall(deployment, 'withdraw', pool, {
        beneficiary: accounts[0]!.address,
      }),
    )
    await createViemAdapter(deployment, wallets[4]!, reader).submit(
      escrowCall(deployment, 'claimBet', pool),
    )
    expect(
      await reader.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [contract],
      }),
    ).toBe(0n)
    expect(
      await reader.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [accounts[0]!.address],
      }),
    ).toBe(125_000n)
    // Reporting preserves this table's allocation after the cumulative balance is withdrawn.
    expect((await host.view(id)).accounting).toEqual(view.accounting)
  },
  90000,
)
