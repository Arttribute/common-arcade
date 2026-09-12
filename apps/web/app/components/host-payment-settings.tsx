'use client'

import { useEffect, useState } from 'react'
import type { GameMonetization } from '@common-arcade/protocol'
import { NETWORKS, usdcUnits, type EconomyConfig } from '@common-arcade/economy'
import { formatUnits } from 'viem'
import { SelectMenu } from './ui/select-menu'

export function HostPaymentSettings({
  value,
  onChange,
  terms,
  supported,
}: {
  value: EconomyConfig
  onChange: (value: EconomyConfig) => void
  terms?: GameMonetization
  supported: boolean
}) {
  const [networks, setNetworks] = useState<string[]>()
  useEffect(() => {
    const controller = new AbortController()
    const origin = process.env.NEXT_PUBLIC_ARCADE_PAYMENTS_URL
    if (!origin) {
      setNetworks([])
      return
    }
    fetch(`${origin}/v1/economy/config`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Unavailable')
        return response.json()
      })
      .then((result) => {
        if (!controller.signal.aborted)
          setNetworks(Array.isArray(result.networks) ? result.networks : [])
      })
      .catch(() => {
        if (!controller.signal.aborted) setNetworks([])
      })
    return () => controller.abort()
  }, [])
  const available = (
    ['base-sepolia', 'arc-testnet', 'hedera-testnet', 'celo-sepolia'] as const
  ).filter(
    (network) =>
      networks?.includes(network) &&
      terms?.mode === 'revenue-share' &&
      terms.payouts[network],
  )
  const enabled =
    supported && terms?.mode === 'revenue-share' && available.length > 0
  const mode =
    value.mode === 'free'
      ? 'free'
      : BigInt(value.stakeUnits) > 0n
        ? 'staked'
        : 'sponsored'
  return (
    <fieldset className="economy-settings host-payment-settings">
      <legend>Host payment settings</legend>
      <p>
        Set entry requirements and rewards for the match. Players connect their
        wallets and agents when they join.
      </p>
      <label>
        Payment format{' '}
        <SelectMenu
          value={mode}
          options={[
            {
              value: 'free',
              label: 'Free entry',
              description: 'No prize pool',
            },
            {
              value: 'staked',
              label: 'Player stakes',
              disabled:
                !enabled ||
                terms?.mode !== 'revenue-share' ||
                !terms.allowedModes.includes('staked'),
            },
            {
              value: 'sponsored',
              label: 'Sponsored prize pool',
              description: 'Free entry',
              disabled:
                !enabled ||
                terms?.mode !== 'revenue-share' ||
                !terms.allowedModes.includes('sponsored'),
            },
          ]}
          onChange={(selected) => {
            if (selected === 'free') {
              onChange({ mode: 'free' })
              return
            }
            const network =
              available.find((item) => item === 'base-sepolia') ?? available[0]
            if (!network || !enabled) return
            onChange({
              mode: 'escrow',
              network,
              stakeUnits: selected === 'staked' ? '1000000' : '0',
              bounties: selected === 'sponsored',
              spectatorBets: false,
              feeBps: 250,
              fundingSeconds: 600,
              settlementSeconds: 3600,
            })
          }}
        />
      </label>
      {!enabled && (
        <p className="studio-help">
          {!supported
            ? 'Entry stakes and prize pools are not available for this realtime release yet.'
            : terms?.mode !== 'revenue-share'
              ? 'The creator has enabled free play only.'
              : networks === undefined
                ? 'Checking payment networks…'
                : 'No payment network is currently available for this release.'}
        </p>
      )}
      {value.mode === 'escrow' && (
        <div className="match-setup-grid">
          <label>
            Payment network{' '}
            <SelectMenu
              value={value.network}
              options={available.map((network) => ({
                value: network,
                label: NETWORKS[network].chain.name,
                description: 'Test USDC',
              }))}
              onChange={(network) =>
                onChange({
                  ...value,
                  network: network as typeof value.network,
                })
              }
            />
          </label>
          {mode === 'staked' && (
            <label>
              Entry stake per player (USDC){' '}
              <input
                required
                type="number"
                min="0.000001"
                step="0.000001"
                defaultValue={formatUnits(BigInt(value.stakeUnits), 6)}
                onChange={(event) => {
                  try {
                    const units = usdcUnits(event.target.value)
                    if (units <= 0n) throw new Error()
                    event.target.setCustomValidity('')
                    onChange({ ...value, stakeUnits: units.toString() })
                  } catch {
                    event.target.setCustomValidity(
                      'Enter a positive amount with up to six decimal places',
                    )
                  }
                }}
              />
            </label>
          )}
          <label>
            Funding window (minutes){' '}
            <input
              required
              type="number"
              min="1"
              max="60"
              step="1"
              value={value.fundingSeconds / 60}
              onChange={(event) =>
                onChange({
                  ...value,
                  fundingSeconds: Number(event.target.value) * 60,
                })
              }
            />
          </label>
          <label>
            Match deadline after funding (minutes){' '}
            <input
              required
              type="number"
              min="2"
              max="1440"
              step="1"
              value={value.settlementSeconds / 60}
              onChange={(event) =>
                onChange({
                  ...value,
                  settlementSeconds: Number(event.target.value) * 60,
                })
              }
            />
          </label>
          <label className="switch-row">
            <input
              type="checkbox"
              role="switch"
              className="switch"
              checked={value.bounties}
              disabled={mode === 'sponsored'}
              onChange={(event) =>
                onChange({ ...value, bounties: event.target.checked })
              }
            />{' '}
            Allow sponsored bounties
          </label>
          <label className="switch-row">
            <input
              type="checkbox"
              role="switch"
              className="switch"
              checked={value.spectatorBets}
              disabled={terms?.mode !== 'revenue-share' || !terms.spectatorBets}
              onChange={(event) =>
                onChange({ ...value, spectatorBets: event.target.checked })
              }
            />{' '}
            Allow spectator bets before play
          </label>
          {terms?.mode === 'revenue-share' && (
            <p className="match-setup-wide studio-help">
              Success fee: {terms.feeBps / 100}%. Creator share of that fee:{' '}
              {terms.creatorShareBps / 100}%.
              <br />
              Creator payout:{' '}
              <span style={{ overflowWrap: 'anywhere' }}>
                {terms.payouts[value.network]}
              </span>
              <br />
              These payout terms are fixed by the published release.
            </p>
          )}
        </div>
      )}
    </fieldset>
  )
}
