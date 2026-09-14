import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  getAddress,
  http,
  toHex,
  type Hex,
} from 'viem'
import { foundry } from 'viem/chains'
import { mnemonicToAccount } from 'viem/accounts'
import { x402Client, wrapFetchWithPayment } from '@x402/fetch'
import { ExactEvmScheme } from '@x402/evm/exact/client'
import {
  arcadeEscrowAbi,
  decodeX402Header,
  encodeX402Header,
  entryRequirements,
  escrowAuthorization,
  hashArcadeId,
  transferAuthorizationTypedData,
} from '@common-arcade/economy'
import { MatchHost, commandMessage } from './matches.js'
import { MemoryMatchStore } from './store.js'
import { createSettlementAdapter } from './escrow.js'
import { createTableApi } from './table-api.js'
const rpc = process.env.ARCADE_ANVIL_URL
const mnemonic = 'test test test test test test test test test test test junk'
const account = (addressIndex: number) =>
  mnemonicToAccount(mnemonic, { addressIndex })
type Account = ReturnType<typeof account>

/** Deploys a token and escrow, and hosts one open paid (or sponsored) lobby behind the entry API. */
async function localLobby(first: number, stakeUnits: string) {
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(rpc!))
    throw new Error('Integration test permits local Anvil only')
  const reader = createPublicClient({
    chain: foundry,
    transport: http(rpc),
    pollingInterval: 50,
  })
  const admin = account(first),
    resolver = account(first + 1),
    host = account(first + 2)
  // Only the deployer and the resolver hold gas. Players never do.
  for (const funded of [admin, resolver])
    await reader.request({
      method: 'anvil_setBalance' as 'eth_chainId',
      params: [funded.address, '0x3635C9ADC5DEA00000'] as never,
    })
  const wallet = (signer: Account) =>
    createWalletClient({
      account: signer,
      chain: foundry,
      transport: http(rpc),
    })
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
  const wait = async (hash: Hex) => {
    const receipt = await reader.waitForTransactionReceipt({ hash })
    expect(receipt.status).toBe('success')
    return receipt
  }
  const tokenArtifact = await artifact('TestUSDC'),
    escrowArtifact = await artifact('ArcadeEscrow')
  const token = getAddress(
    (
      await wait(
        await wallet(admin).deployContract({
          abi: tokenArtifact.abi,
          bytecode: tokenArtifact.bytecode.object,
        }),
      )
    ).contractAddress!,
  )
  const contract = getAddress(
    (
      await wait(
        await wallet(admin).deployContract({
          abi: escrowArtifact.abi,
          bytecode: escrowArtifact.bytecode.object,
          args: [admin.address],
        }),
      )
    ).contractAddress!,
  )
  await wait(
    await wallet(admin).writeContract({
      address: contract,
      abi: arcadeEscrowAbi,
      functionName: 'setToken',
      args: [token, true],
    }),
  )
  await wait(
    await wallet(admin).writeContract({
      address: contract,
      abi: arcadeEscrowAbi,
      functionName: 'setResolver',
      args: [resolver.address, true],
    }),
  )
  const mint = async (to: Hex, amount: bigint) =>
    wait(
      await wallet(admin).writeContract({
        address: token,
        abi: tokenArtifact.abi,
        functionName: 'mint',
        args: [to, amount],
      }),
    )
  const deployment = {
    chainId: 31337,
    contract,
    token,
    confirmations: 1,
    openSeats: true,
    seatControllers: true,
    authorizedEntry: true,
  }
  const domain = 'https://local-test.arcade'
  const matchHost = new MatchHost(
    new MemoryMatchStore(),
    {
      'base-sepolia': createSettlementAdapter(
        deployment,
        reader,
        wallet(resolver),
        admin.address,
      ),
    },
    domain,
  )
  const body = {
    id: randomUUID(),
    economy: {
      mode: 'escrow',
      network: 'base-sepolia',
      stakeUnits,
      bounties: false,
      spectatorBets: false,
      feeBps: 250,
      fundingSeconds: 600,
      settlementSeconds: 3600,
    },
    startWhenReady: false,
  }
  const id = `mat_${body.id}`
  const sign = async (signer: Account, op: string, value: unknown) => {
    const expiresAt = Date.now() + 60000
    return {
      address: signer.address,
      expiresAt,
      signature: await signer.signMessage({
        message: commandMessage(id, op, value, expiresAt, domain),
      }),
    }
  }
  const created = await matchHost.create(body, await sign(host, 'create', body))
  const api = createTableApi(matchHost)
  const local = ((input: RequestInfo | URL, init?: RequestInit) =>
    api.request(
      input instanceof Request ? input : String(input),
      init,
    )) as typeof fetch
  const balance = (owner: Hex) =>
    reader.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [owner],
    })
  const escrowRead = <T>(functionName: string, args: readonly unknown[]) =>
    reader.readContract({
      address: contract,
      abi: arcadeEscrowAbi,
      functionName,
      args,
    } as Parameters<typeof reader.readContract>[0]) as Promise<T>
  return {
    reader,
    token,
    contract,
    deployment,
    domain,
    id,
    pool: created.pool as Hex,
    url: `${domain}/v1/economy/matches/${id}/entry`,
    matchHost,
    local,
    mint,
    wallet,
    sign,
    balance,
    escrowRead,
    tokenAbi: tokenArtifact.abi,
  }
}

describe.skipIf(!rpc)('gasless seat entry on Anvil', () => {
  it('standard x402 clients take paid seats with no gas, allowance or wallet transaction', async () => {
    const lobby = await localLobby(10, '1000000')
    const alice = account(13),
      bob = account(14),
      fresh = account(15),
      gameKey = account(16).address
    await lobby.mint(alice.address, 5_000_000n)
    await lobby.mint(bob.address, 5_000_000n)
    const { local, url, contract, token } = lobby

    // Discovery: the lobby advertises x402 entry and the unpaid request is a v2 challenge.
    const lobbies = await (
      await local(`${lobby.domain}/v1/economy/lobbies`)
    ).json()
    expect(lobbies.lobbies[0].entry).toMatchObject({
      method: 'x402',
      payTo: contract,
      amount: '1000000',
    })
    const challenge = await local(url, { method: 'POST', body: '{}' })
    expect(challenge.status).toBe(402)
    const required = decodeX402Header<{
      accepts: { payTo: string; amount: string; network: string }[]
    }>(challenge.headers.get('PAYMENT-REQUIRED')!)
    expect(required.accepts[0]).toMatchObject({
      payTo: contract,
      amount: '1000000',
      network: 'eip155:31337',
    })

    // The local test token is not a default asset, so allow it the way an agent wallet would.
    const client = (payer: Account) =>
      new x402Client()
        .setSpendControls({
          allowedAssets: [
            {
              network: 'eip155:31337',
              asset: token,
              maxAmountPerPayment: '1000000',
            },
          ],
        })
        .register('eip155:31337', new ExactEvmScheme(payer))
    const paid = async (payer: Account, entry: unknown) =>
      wrapFetchWithPayment(local, client(payer))(url, {
        method: 'POST',
        body: JSON.stringify(entry),
      })

    // An unfunded wallet is refused before anything is relayed.
    const refused = await paid(fresh, {})
    expect(refused.status).toBe(402)
    expect((await refused.json()).error).toBe('insufficient_funds')

    const aliceEntry = await paid(alice, { controller: gameKey })
    expect(aliceEntry.status).toBe(200)
    const settlement = decodeX402Header<{ success: boolean; payer: string }>(
      aliceEntry.headers.get('PAYMENT-RESPONSE')!,
    )
    expect(settlement).toMatchObject({ success: true, payer: alice.address })
    const aliceResult = await aliceEntry.json()
    expect(aliceResult).toMatchObject({
      seat: 1,
      player: alice.address,
      controller: gameKey,
    })
    const seat1 = hashArcadeId('sea_player_1')
    expect(await lobby.escrowRead('recipient', [lobby.pool, seat1])).toBe(
      alice.address,
    )
    expect(await lobby.escrowRead('controller', [lobby.pool, seat1])).toBe(
      gameKey,
    )
    expect(await lobby.balance(alice.address)).toBe(4_000_000n)
    // The payer never sent a transaction: no gas, no allowance.
    expect(
      await lobby.reader.getTransactionCount({ address: alice.address }),
    ).toBe(0)

    // Paying again for a held seat returns the seat without charging twice.
    const retry = await paid(alice, {})
    expect(retry.status).toBe(200)
    expect((await retry.json()).seat).toBe(1)
    expect(await lobby.balance(alice.address)).toBe(4_000_000n)

    // Bob takes the remaining seat and hands it to the Arcade policy.
    const bobEntry = await paid(bob, { seat: 2, autoplay: true })
    expect(bobEntry.status).toBe(200)
    const bobResult = await bobEntry.json()
    expect(bobResult.seat).toBe(2)
    expect(bobResult.table.funded).toEqual([true, true])
    expect(bobResult.table.autoplay).toEqual(['1'])
    expect(await lobby.balance(contract)).toBe(2_000_000n)

    // A full table refuses new entries without a payment prompt.
    const full = await paid(fresh, {})
    expect(full.status).toBe(400)
    expect(
      (await local(`${lobby.domain}/v1/economy/lobbies`).then((r) => r.json()))
        .lobbies,
    ).toEqual([])
    await lobby.matchHost.close()
  }, 60_000)

  it('recovers a payment that was submitted straight to the token, and never credits it twice', async () => {
    const lobby = await localLobby(20, '1000000')
    const carol = account(23),
      relayer = account(20)
    await lobby.mint(carol.address, 2_000_000n)
    const requirements = entryRequirements(lobby.deployment, '1000000')
    const authorization = {
      from: carol.address,
      to: lobby.contract,
      value: '1000000',
      validAfter: '0',
      validBefore: String(Math.floor(Date.now() / 1000) + 120),
      nonce: toHex(crypto.getRandomValues(new Uint8Array(32))),
    }
    const signature = await carol.signTypedData(
      transferAuthorizationTypedData(requirements, authorization),
    )
    const payment = {
      x402Version: 2 as const,
      accepted: requirements,
      payload: { authorization, signature },
    }
    // Someone copies the signed transfer and submits it to the token directly.
    const copied = escrowAuthorization(payment)
    await lobby.reader.waitForTransactionReceipt({
      hash: await lobby.wallet(relayer).writeContract({
        address: lobby.token,
        abi: lobby.tokenAbi,
        functionName: 'transferWithAuthorization',
        args: [
          copied.from,
          lobby.contract,
          copied.value,
          copied.validAfter,
          copied.validBefore,
          copied.nonce,
          copied.v,
          copied.r,
          copied.s,
        ],
      }),
    })
    expect(await lobby.balance(carol.address)).toBe(1_000_000n)
    const entry = await lobby.local(lobby.url, {
      method: 'POST',
      headers: { 'PAYMENT-SIGNATURE': encodeX402Header(payment) },
      body: '{}',
    })
    expect(entry.status).toBe(200)
    expect((await entry.json()).player).toBe(carol.address)
    expect(
      await lobby.escrowRead('recipient', [
        lobby.pool,
        hashArcadeId('sea_player_1'),
      ]),
    ).toBe(carol.address)
    // The same payment for the other seat is refused: the nonce is credited once.
    const again = await lobby.local(lobby.url, {
      method: 'POST',
      headers: { 'PAYMENT-SIGNATURE': encodeX402Header(payment) },
      body: JSON.stringify({ seat: 2 }),
    })
    expect(again.status).toBe(400)
    expect(await lobby.balance(carol.address)).toBe(1_000_000n)
    await lobby.matchHost.close()
  }, 60_000)

  it('seats a sponsored player from one signed request, without payment or gas', async () => {
    const lobby = await localLobby(30, '0')
    const dana = account(33)
    const unsigned = await lobby.local(lobby.url, {
      method: 'POST',
      body: '{}',
    })
    expect(unsigned.status).toBe(400)
    const body = { seat: 2 }
    const entry = await lobby.local(lobby.url, {
      method: 'POST',
      body: JSON.stringify({
        ...body,
        auth: await lobby.sign(dana, 'entry', body),
      }),
    })
    expect(entry.status).toBe(200)
    expect(await entry.json()).toMatchObject({
      seat: 2,
      player: dana.address,
      controller: dana.address,
    })
    expect(
      await lobby.escrowRead('recipient', [
        lobby.pool,
        hashArcadeId('sea_player_2'),
      ]),
    ).toBe(dana.address)
    expect(
      await lobby.reader.getTransactionCount({ address: dana.address }),
    ).toBe(0)
    await lobby.matchHost.close()
  }, 60_000)
})
