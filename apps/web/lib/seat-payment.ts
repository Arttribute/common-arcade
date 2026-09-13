import { erc20Abi, type PublicClient, type WalletClient, type Hex } from 'viem'
import {
  approvalCall,
  createViemAdapter,
  type ContractCall,
  type EscrowDeployment,
} from '@common-arcade/economy'

const submitted = new Map<string, { hash?: Hex; batch?: string }>()

/** Never silently retry a submitted batch as individual transfers. */
export async function submitSeatPayment(input: {
  deployment: EscrowDeployment
  wallet: WalletClient
  reader: PublicClient
  call: ContractCall
  amount: bigint
  onProgress: (message: string) => void
}) {
  const { deployment, wallet, reader, call, amount, onProgress } = input
  if (!wallet.account) throw new Error('Connect a wallet to continue')
  if (
    call.chainId !== deployment.chainId ||
    call.to.toLowerCase() !== deployment.contract.toLowerCase() ||
    call.value !== '0'
  )
    throw new Error('Payment call does not match this game')
  if (
    (await wallet.getChainId()) !== deployment.chainId ||
    (await reader.getChainId()) !== deployment.chainId
  )
    throw new Error('Wallet network does not match this game')
  const key = `arcade:pending-payment:${deployment.chainId}:${wallet.account.address.toLowerCase()}:${call.to.toLowerCase()}:${call.data}`
  const storage =
    typeof window === 'undefined' ? undefined : window.localStorage
  let pending = submitted.get(key)
  if (!pending) {
    const saved = storage?.getItem(key)
    if (saved) pending = JSON.parse(saved)
  }
  const save = (value: { hash?: Hex; batch?: string }) => {
    submitted.set(key, value)
    storage?.setItem(key, JSON.stringify(value))
  }
  const clear = () => {
    submitted.delete(key)
    storage?.removeItem(key)
  }
  async function confirm(value: { hash?: Hex; batch?: string }) {
    onProgress('Confirming your payment…')
    let hash = value.hash
    if (!hash && value.batch) {
      const result = await wallet.waitForCallsStatus({ id: value.batch })
      if (result.status === 'failure') {
        clear()
        throw new Error('Payment reverted')
      }
      hash = result.receipts?.at(-1)?.transactionHash
      if (hash) save({ hash })
    }
    if (!hash)
      throw new Error(
        'Payment submitted. Check your wallet receipt before retrying.',
      )
    const receipt = await reader.waitForTransactionReceipt({
      hash,
      confirmations: deployment.confirmations ?? 2,
    })
    clear()
    if (receipt.status !== 'success') throw new Error('Payment reverted')
    return hash
  }
  if (pending) return confirm(pending)
  const allowance =
    amount > 0n
      ? await reader.readContract({
          address: deployment.token,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [wallet.account.address, deployment.contract],
        })
      : 0n
  const adapter = createViemAdapter(deployment, wallet, reader)
  if (allowance < amount) {
    const capabilities = await wallet
      .getCapabilities({
        account: wallet.account.address,
        chainId: deployment.chainId,
      })
      .catch(() => undefined)
    if (capabilities?.atomic?.status === 'supported') {
      onProgress('Confirm the seat payment in your wallet…')
      const approval = approvalCall(deployment, amount)
      const { id } = await wallet.sendCalls({
        account: wallet.account,
        chain: wallet.chain,
        forceAtomic: true,
        calls: [approval, call].map((c) => ({
          to: c.to,
          data: c.data,
          value: 0n,
        })),
      })
      save({ batch: id })
      return confirm({ batch: id })
    }
    onProgress(
      'This wallet needs a USDC allowance first, then the payment confirmation.',
    )
    await adapter.submit(approvalCall(deployment, amount))
  }
  onProgress('Confirm the payment in your wallet…')
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
  save({ hash })
  return confirm({ hash })
}
