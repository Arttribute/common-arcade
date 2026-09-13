export function parseAgentBalance(
  value: unknown,
  address: string,
  chainId: number,
): { usdc: string; native: string } {
  const balance = value as {
    address?: string
    chainId?: string
    usdc?: string
    native?: string
  } | null
  if (
    !balance ||
    balance.address?.toLowerCase() !== address.toLowerCase() ||
    balance.chainId !== String(chainId) ||
    ![balance.usdc, balance.native].every(
      (n) => typeof n === 'string' && /^\d+(\.\d+)?$/.test(n),
    )
  )
    throw new Error('Balance response does not match the wallet and network')
  return { usdc: balance.usdc!, native: balance.native! }
}
