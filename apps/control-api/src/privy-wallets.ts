import { PrivyClient } from '@privy-io/node'
import { createViemAccount } from '@privy-io/node/viem'
import {
  createPublicClient,
  createWalletClient,
  http,
  erc20Abi,
  formatUnits,
  isAddress,
  type Address,
  type Hex,
} from 'viem'
import {
  NETWORKS,
  arcadeEscrowAbi,
  approvalCall,
  escrowCall,
  hashArcadeId,
  createViemAdapter,
} from '@common-arcade/economy'
import { x402Client, x402HTTPClient } from '@x402/core/client'
import { ExactEvmScheme } from '@x402/evm/exact/client'
import { z } from 'zod'
import { IdentityError } from './identity.js'
import {
  managedNetworks,
  type AgentWalletRecord,
  type ManagedNetwork,
  type ManagedWalletProvider,
  type WalletOperation,
} from './agent-wallets.js'

const address = z.string().refine((v) => isAddress(v) && !/^0x0{40}$/i.test(v))
const configuration = z.object({
  appId: z.string().min(1),
  appSecret: z.string().min(1),
  ownerId: z.string().min(1),
  authorizationKey: z.string().min(1),
  paymentUrl: z
    .string()
    .url()
    .refine((v) => new URL(v).protocol === 'https:'),
  networks: z
    .record(
      z.enum(managedNetworks),
      z
        .object({
          policyId: z.string().min(1),
          escrow: address,
          treasury: address,
        })
        .strict()
        .optional(),
    )
    .refine((networks) => Object.values(networks).some(Boolean)),
})
type Configuration = z.infer<typeof configuration>
/** Configuration stays on the server. Readiness is explicitly opt-in after a real Privy smoke test. */
export function privyWalletProviderFromEnvironment():
  ManagedWalletProvider | undefined {
  if (process.env.ARCADE_MANAGED_WALLETS_ENABLED !== 'true') return undefined
  const parsed = configuration.safeParse({
    appId: process.env.PRIVY_APP_ID,
    appSecret: process.env.PRIVY_APP_SECRET,
    ownerId: process.env.PRIVY_WALLET_OWNER_ID,
    authorizationKey: process.env.PRIVY_AUTHORIZATION_KEY,
    paymentUrl: process.env.ARCADE_PAYMENT_URL,
    networks: (() => {
      try {
        return JSON.parse(process.env.ARCADE_PRIVY_NETWORKS ?? '{}')
      } catch {
        return null
      }
    })(),
  })
  // A partial configuration must not break existing Arcade routes or offer a fake wallet.
  return parsed.success ? new PrivyWalletProvider(parsed.data) : undefined
}
export class PrivyWalletProvider implements ManagedWalletProvider {
  readonly networks: ManagedNetwork[]
  private readonly client: PrivyClient
  private readonly base: string
  constructor(private readonly config: Configuration) {
    this.client = new PrivyClient({
      appId: config.appId,
      appSecret: config.appSecret,
      maxRetries: 0,
      timeout: 20000,
    })
    this.networks = managedNetworks.filter((id) => config.networks[id])
    this.base = config.paymentUrl.replace(/\/$/, '')
  }
  async create(id: string, name: string, network: ManagedNetwork) {
    const rule = this.config.networks[network]
    if (!rule) throw new Error('Network is not configured')
    const wallet = await this.client.wallets().create({
      chain_type: 'ethereum',
      display_name: name,
      external_id: `arcade_${id}`,
      idempotency_key: id,
      owner_id: this.config.ownerId,
      policy_ids: [rule.policyId],
    })
    if (!isAddress(wallet.address))
      throw new Error('Provider returned an invalid wallet')
    return { id: wallet.id, address: wallet.address }
  }
  private account(wallet: AgentWalletRecord) {
    if (
      !wallet.providerWalletId ||
      !wallet.address ||
      !isAddress(wallet.address)
    )
      throw new Error('Wallet is not ready')
    return createViemAccount(this.client, {
      walletId: wallet.providerWalletId,
      address: wallet.address as Address,
      authorizationContext: {
        authorization_private_keys: [this.config.authorizationKey],
      },
    })
  }
  async balance(wallet: AgentWalletRecord) {
    if (!wallet.address) throw new Error('Wallet is not ready')
    const network = NETWORKS[wallet.network],
      reader = createPublicClient({ chain: network.chain, transport: http() })
    const [usdc, native] = await Promise.all([
      reader.readContract({
        address: network.token,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [wallet.address as Address],
      }),
      reader.getBalance({ address: wallet.address as Address }),
    ])
    return {
      usdc: formatUnits(usdc, 6),
      native: formatUnits(native, 18),
      nativeSymbol: network.chain.nativeCurrency.symbol,
    }
  }
  private async json(path: string, body?: unknown) {
    const response = await fetch(this.base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(25000),
    })
    if (!response.ok)
      throw new Error(`Arcade operation failed (${response.status})`)
    return response.json()
  }
  async prepare(wallet: AgentWalletRecord, input: WalletOperation) {
    const network = NETWORKS[wallet.network],
      rule = this.config.networks[wallet.network]
    if (!rule) throw new Error('Network is not configured')
    const account = this.account(wallet)
    if (input.operation === 'claim') {
      const reader = createPublicClient({
        chain: network.chain,
        transport: http(),
      })
      const amount = await reader.readContract({
        address: rule.escrow as Address,
        abi: arcadeEscrowAbi,
        functionName: 'claimable',
        args: [network.token, account.address],
      })
      return {
        amountUnits: '0',
        execute: async () => {
          if (amount === 0n) return { claimedUnits: '0' }
          const deployment = {
            chainId: network.chain.id,
            contract: rule.escrow as Address,
            token: network.token,
          }
          const adapter = createViemAdapter(
            deployment,
            createWalletClient({
              account,
              chain: network.chain,
              transport: http(),
            }),
            reader,
          )
          const transaction = await adapter.submit(
            escrowCall(deployment, 'withdraw', `0x${'0'.repeat(64)}`, {
              beneficiary: account.address,
            }),
          )
          return { transaction, claimedUnits: amount.toString() }
        },
      }
    }
    if (input.operation === 'analysis') {
      const reader = createPublicClient({
        chain: network.chain,
        transport: http(),
      })
      const balance = await reader.readContract({
        address: network.token,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [account.address],
      })
      if (balance < 480n)
        throw new IdentityError(
          403,
          'Add test USDC to this wallet before requesting paid analysis.',
        )
      const body = JSON.stringify({
        hand: input.hand,
        visibleCards: input.visibleCards,
      })
      const url = `${this.base}/v1/analysis/${wallet.network}`
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      })
      if (response.status !== 402) throw new Error('Expected a payment quote')
      const client = new x402HTTPClient(
        new x402Client()
          .setSpendControls({
            allowedAssets: [
              {
                network: network.x402Network,
                asset: network.token,
                maxAmountPerPayment: '480',
              },
            ],
          })
          .register(network.x402Network, new ExactEvmScheme(account)),
      )
      const required = client.getPaymentRequiredResponse((name) =>
        response.headers.get(name),
      )
      // Do not let the server substitute another payee, chain, token or price.
      const accepted = required.accepts.filter(
        (r) =>
          r.scheme === 'exact' &&
          r.network === network.x402Network &&
          r.asset.toLowerCase() === network.token.toLowerCase() &&
          r.payTo.toLowerCase() === rule.treasury.toLowerCase() &&
          r.amount === '480',
      )
      if (accepted.length !== 1)
        throw new Error('Payment quote is outside Arcade policy')
      return {
        amountUnits: '480',
        execute: async () => {
          const payload = await client.createPaymentPayload({
            ...required,
            accepts: accepted,
          })
          const paid = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...client.encodePaymentSignatureHeader(payload),
            },
            body,
            redirect: 'error',
            signal: AbortSignal.timeout(25000),
          })
          if (!paid.ok) throw new Error('Payment result is uncertain')
          const receipt = client.getPaymentSettleResponse((name) =>
            paid.headers.get(name),
          )
          if (!receipt.success || receipt.network !== network.x402Network)
            throw new Error('Settlement receipt is invalid')
          return { receipt, analysis: await paid.json() }
        },
      }
    }
    const table = (await this.json(`/v1/economy/matches/${input.matchId}`)) as {
      recipients: string[]
      economy: { mode: string; network?: string }
      pool?: Hex
      deployment?: { contract: string; chainId: number }
    }
    if (
      !table.recipients.some(
        (a) => a.toLowerCase() === account.address.toLowerCase(),
      )
    )
      throw new Error('This wallet does not belong to the match')
    if (
      table.economy.mode !== 'free' &&
      table.economy.network !== wallet.network
    )
      throw new Error('Match network is outside this connection')
    if (input.operation === 'stake') {
      if (
        !table.pool ||
        table.deployment?.contract.toLowerCase() !==
          rule.escrow.toLowerCase() ||
        table.deployment.chainId !== network.chain.id
      )
        throw new Error('Match escrow is not approved')
      const reader = createPublicClient({
        chain: network.chain,
        transport: http(),
      })
      const contract = rule.escrow as Address,
        pool = table.pool,
        seat = hashArcadeId(input.seatId)
      const [state, recipient] = await Promise.all([
        reader.readContract({
          address: contract,
          abi: arcadeEscrowAbi,
          functionName: 'getMatch',
          args: [pool],
        }),
        reader.readContract({
          address: contract,
          abi: arcadeEscrowAbi,
          functionName: 'recipient',
          args: [pool, seat],
        }),
      ])
      if (
        state.status !== 1 ||
        state.terms.stake <= 0n ||
        state.terms.token.toLowerCase() !== network.token.toLowerCase() ||
        recipient.toLowerCase() !== account.address.toLowerCase() ||
        Number(state.terms.fundingDeadline) <= Date.now() / 1000
      )
        throw new Error('Seat is unavailable for this wallet')
      const deployment = {
        chainId: network.chain.id,
        contract,
        token: network.token,
      }
      const [balance, native] = await Promise.all([
        reader.readContract({
          address: network.token,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [account.address],
        }),
        reader.getBalance({ address: account.address }),
      ])
      if (balance < state.terms.stake || native === 0n)
        throw new IdentityError(
          403,
          'Add enough test USDC for the stake and network gas before playing.',
        )
      return {
        amountUnits: state.terms.stake.toString(),
        execute: async () => {
          const adapter = createViemAdapter(
            deployment,
            createWalletClient({
              account,
              chain: network.chain,
              transport: http(),
            }),
            reader,
          )
          const approval = await adapter.submit(
            approvalCall(deployment, state.terms.stake),
          )
          const transaction = await adapter.submit(
            escrowCall(deployment, 'stake', pool, { seat }),
          )
          return { approval, transaction }
        },
      }
    }
    return {
      amountUnits: '0',
      execute: async () => {
        const body =
          input.operation === 'action'
            ? {
                actionId: input.actionId,
                sequence: input.sequence,
                type: input.type,
              }
            : {}
        const expiresAt = Date.now() + 60000
        const signature = await account.signMessage({
          message: JSON.stringify({
            domain: this.base,
            matchId: input.matchId,
            operation: input.operation,
            body,
            expiresAt,
          }),
        })
        const auth = { address: account.address, expiresAt, signature }
        return this.json(
          `/v1/economy/matches/${input.matchId}/${input.operation === 'action' ? 'actions' : input.operation}`,
          input.operation === 'action' ? { body, auth } : auth,
        )
      },
    }
  }
  async prepareWithdrawal(
    wallet: AgentWalletRecord,
    to: string,
    amountUnits: string,
  ) {
    if (
      !isAddress(to) ||
      /^0x0{40}$/i.test(to) ||
      BigInt(amountUnits) <= 0n ||
      BigInt(amountUnits) > 1000_000000n
    )
      throw new Error('Invalid withdrawal')
    const network = NETWORKS[wallet.network],
      account = this.account(wallet)
    const reader = createPublicClient({
      chain: network.chain,
      transport: http(),
    })
    const balance = await reader.readContract({
      address: network.token,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account.address],
    })
    if (balance < BigInt(amountUnits))
      throw new IdentityError(
        403,
        'Insufficient USDC. Claim settled winnings first if needed.',
      )
    return {
      execute: async () => {
        const client = createWalletClient({
          chain: network.chain,
          transport: http(),
          account,
        })
        const transaction = await client.writeContract({
          address: network.token,
          abi: erc20Abi,
          functionName: 'transfer',
          args: [to, BigInt(amountUnits)],
        })
        const receipt = await reader.waitForTransactionReceipt({
          hash: transaction,
        })
        if (receipt.status !== 'success')
          throw new Error('USDC withdrawal reverted')
        return { transaction, to, amountUnits }
      },
    }
  }
}
