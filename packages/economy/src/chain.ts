import {
  encodeFunctionData,
  parseAbi,
  erc20Abi,
  keccak256,
  toBytes,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem'
import { arcadeEscrowAbi } from './abi.js'

export interface ContractCall {
  to: Address
  data: Hex
  value: '0'
  chainId: number
}
export interface EscrowDeployment {
  chainId: number
  contract: Address
  token: Address
  confirmations?: number
}
/** Wallet-agnostic boundary: humans, agent key custody, and Safe can submit the same calls. */
export interface ArcadeChainAdapter {
  deployment: EscrowDeployment
  submit(call: ContractCall): Promise<Hex>
}
export class TransactionReplacedError extends Error {
  constructor(readonly replacementHash: Hex) {
    super(
      `Transaction was cancelled or replaced in your wallet: ${replacementHash}`,
    )
    this.name = 'TransactionReplacedError'
  }
}
export function hashArcadeId(id: string): Hex {
  return keccak256(toBytes(id))
}
export function poolId(
  chainId: number,
  contract: Address,
  matchId: string,
  releaseDigest: string,
  round = 1,
): Hex {
  return hashArcadeId(
    JSON.stringify([
      'arcade-pool-v1',
      chainId,
      contract.toLowerCase(),
      matchId,
      releaseDigest,
      round,
    ]),
  )
}
export function escrowCall(
  deployment: EscrowDeployment,
  operation:
    'stake' | 'bounty' | 'bet' | 'refund' | 'claimBet' | 'void' | 'withdraw',
  id: Hex,
  options: { seat?: Hex; amount?: bigint; beneficiary?: Address } = {},
): ContractCall {
  let data: Hex
  switch (operation) {
    case 'stake':
      if (!options.seat) throw new Error('Seat required')
      data = encodeFunctionData({
        abi: arcadeEscrowAbi,
        functionName: 'stake',
        args: [id, options.seat],
      })
      break
    case 'bounty':
      if (!options.amount || options.amount < 0n)
        throw new Error('Positive amount required')
      data = encodeFunctionData({
        abi: arcadeEscrowAbi,
        functionName: 'fundBounty',
        args: [id, options.amount],
      })
      break
    case 'bet':
      if (!options.seat || !options.amount || options.amount < 0n)
        throw new Error('Seat and positive amount required')
      data = encodeFunctionData({
        abi: arcadeEscrowAbi,
        functionName: 'placeBet',
        args: [id, options.seat, options.amount],
      })
      break
    case 'void':
      data = encodeFunctionData({
        abi: arcadeEscrowAbi,
        functionName: 'voidMatch',
        args: [id],
      })
      break
    case 'refund':
      data = options.beneficiary
        ? encodeFunctionData({
            abi: arcadeEscrowAbi,
            functionName: 'claimRefundFor',
            args: [id, options.beneficiary],
          })
        : encodeFunctionData({
            abi: arcadeEscrowAbi,
            functionName: 'claimRefund',
            args: [id],
          })
      break
    case 'claimBet':
      data = options.beneficiary
        ? encodeFunctionData({
            abi: arcadeEscrowAbi,
            functionName: 'claimBetFor',
            args: [id, options.beneficiary],
          })
        : encodeFunctionData({
            abi: arcadeEscrowAbi,
            functionName: 'claimBet',
            args: [id],
          })
      break
    case 'withdraw':
      if (!options.beneficiary) throw new Error('Beneficiary required')
      data = encodeFunctionData({
        abi: arcadeEscrowAbi,
        functionName: 'withdraw',
        args: [deployment.token, options.beneficiary],
      })
      break
  }
  return {
    chainId: deployment.chainId,
    to: deployment.contract,
    value: '0',
    data,
  }
}
export function approvalCall(
  deployment: EscrowDeployment,
  amount: bigint,
): ContractCall {
  if (amount <= 0n) throw new Error('Positive approval required')
  return {
    chainId: deployment.chainId,
    to: deployment.token,
    value: '0',
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: 'approve',
      args: [deployment.contract, amount],
    }),
  }
}
export function createViemAdapter(
  deployment: EscrowDeployment,
  wallet: WalletClient,
  reader: PublicClient,
  observer?: { submitted(hash: Hex): void; confirmed(hash: Hex): void },
): ArcadeChainAdapter {
  return {
    deployment,
    async submit(call) {
      if (
        call.chainId !== deployment.chainId ||
        (await reader.getChainId()) !== deployment.chainId ||
        (await wallet.getChainId()) !== deployment.chainId
      )
        throw new Error('Wallet/RPC chain mismatch')
      if (!wallet.account) throw new Error('Wallet account required')
      if (
        ![
          deployment.contract.toLowerCase(),
          deployment.token.toLowerCase(),
        ].includes(call.to.toLowerCase()) ||
        call.value !== '0'
      )
        throw new Error('Call outside Arcade deployment')
      await reader.call({
        account: wallet.account,
        to: call.to,
        data: call.data,
        value: 0n,
      })
      const hash = await wallet.sendTransaction({
        account: wallet.account,
        chain: wallet.chain,
        to: call.to,
        data: call.data,
        value: 0n,
      })
      observer?.submitted(hash)
      let confirmedHash = hash
      let replacementError: TransactionReplacedError | undefined
      const receipt = await reader.waitForTransactionReceipt({
        hash,
        confirmations: deployment.confirmations ?? 2,
        onReplaced: ({ reason, transactionReceipt }) => {
          confirmedHash = transactionReceipt.transactionHash
          if (reason === 'repriced') observer?.submitted(confirmedHash)
          else replacementError = new TransactionReplacedError(confirmedHash)
        },
      })
      if (replacementError) throw replacementError
      if (receipt.status !== 'success')
        throw new Error(`Transaction reverted: ${confirmedHash}`)
      observer?.confirmed(confirmedHash)
      return confirmedHash
    },
  }
}
/** Safe Transaction Builder import; owner signatures remain in Safe. */
export function safeGovernanceBatch(
  deployment: EscrowDeployment,
  safe: Address,
  resolver: Address,
) {
  return {
    version: '1.0',
    chainId: String(deployment.chainId),
    createdAt: Date.now(),
    meta: {
      name: 'Authorize Arcade testnet payments',
      createdFromSafeAddress: safe,
      description:
        'Allow USDC and a bounded game-result resolver. Review deployed code and resolver custody before signing.',
    },
    transactions: [
      {
        to: deployment.contract,
        value: '0',
        data: encodeFunctionData({
          abi: arcadeEscrowAbi,
          functionName: 'setToken',
          args: [deployment.token, true],
        }),
      },
      {
        to: deployment.contract,
        value: '0',
        data: encodeFunctionData({
          abi: arcadeEscrowAbi,
          functionName: 'setResolver',
          args: [resolver, true],
        }),
      },
      ...(deployment.chainId === 296
        ? [
            {
              to: deployment.contract,
              value: '0',
              data: encodeFunctionData({
                abi: arcadeEscrowAbi,
                functionName: 'associateHederaToken',
                args: [deployment.token],
              }),
            },
            {
              to: '0x0000000000000000000000000000000000000167',
              value: '0',
              data: encodeFunctionData({
                abi: parseAbi([
                  'function associateToken(address account,address token) returns (int64)',
                ]),
                functionName: 'associateToken',
                args: [safe, deployment.token],
              }),
            },
          ]
        : []),
    ],
  }
}
