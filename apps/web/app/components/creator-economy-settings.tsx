'use client'
import { useState } from 'react'
import {
  gameMonetizationSchema,
  type GameMonetization,
} from '@common-arcade/protocol'
import { SelectMenu } from './ui/select-menu'

const PAYOUT_NETWORKS = [
  ['base-sepolia', 'Base Sepolia'],
  ['arc-testnet', 'Arc testnet'],
  ['hedera-testnet', 'Hedera testnet'],
  ['celo-sepolia', 'Celo Sepolia'],
] as const
type PayoutNetwork = (typeof PAYOUT_NETWORKS)[number][0]

export function CreatorEconomySettings({
  value,
  onChange,
  disabled = false,
}: {
  value?: GameMonetization
  onChange: (value: GameMonetization) => void
  disabled?: boolean
}) {
  const policy = value ?? { mode: 'free' }
  // Networks ticked this session but without an address yet. Networks that
  // already have a payout address always show as ticked.
  const [ticked, setTicked] = useState<ReadonlySet<PayoutNetwork>>(new Set())
  const validation = gameMonetizationSchema.safeParse(policy)
  return (
    <fieldset disabled={disabled} className="studio-section economy-settings">
      <legend>Game earnings</legend>
      <label className="switch-row">
        <input
          type="checkbox"
          role="switch"
          className="switch"
          checked={policy.mode === 'revenue-share'}
          onChange={(e) =>
            onChange(
              e.target.checked
                ? {
                    mode: 'revenue-share',
                    allowedModes: ['sponsored', 'staked'],
                    feeBps: 250,
                    creatorShareBps: 7000,
                    payouts: {},
                    spectatorBets: false,
                  }
                : { mode: 'free' },
            )
          }
        />
        Offer optional paid matches
      </label>
      <p className="studio-help">
        Free play stays available. Earnings terms are pinned when you publish;
        existing matches keep their original terms.
      </p>
      {policy.mode === 'revenue-share' && (
        <>
          {!validation.success && (
            <p className="studio-help" role="status">
              Add a complete, nonzero payout address for at least one network
              before saving or publishing paid matches.
            </p>
          )}
          <fieldset className="earning-modes">
            <legend>Earning mode</legend>
            {(
              [
                [
                  'sponsored',
                  'Sponsored rewards',
                  'Free entry. A sponsor funds the prizes.',
                ],
                [
                  'staked',
                  'Player stakes',
                  'Players contribute to the prize pool.',
                ],
                [
                  'both',
                  'Both options',
                  'Let the host choose when starting a session.',
                ],
              ] as const
            ).map(([id, title, hint]) => (
              <label key={id}>
                <input
                  type="radio"
                  name="earning-mode"
                  checked={
                    policy.allowedModes.length === 2
                      ? id === 'both'
                      : policy.allowedModes[0] === id
                  }
                  onChange={() =>
                    onChange({
                      ...policy,
                      allowedModes:
                        id === 'both' ? ['sponsored', 'staked'] : [id],
                    })
                  }
                />
                <span>
                  <strong>{title}</strong>
                  <small>{hint}</small>
                </span>
              </label>
            ))}
          </fieldset>
          <label>
            Creator share of the success fee
            <SelectMenu
              value={String(policy.creatorShareBps)}
              options={[0, 5000, 7000, 9000].map((n) => ({
                value: String(n),
                label: `${n / 100}% creator / ${(10000 - n) / 100}% platform`,
              }))}
              onChange={(next) =>
                onChange({ ...policy, creatorShareBps: Number(next) })
              }
            />
          </label>
          <p className="studio-help">
            One 2.5% success fee. On a 10 USDC prize pool: 9.75 to the winner,{' '}
            {((0.25 * policy.creatorShareBps) / 10000).toFixed(3)} to the
            creator pool (including source royalties),{' '}
            {((0.25 * (10000 - policy.creatorShareBps)) / 10000).toFixed(3)} to
            the platform. Draws and cancellations refund contributions without a
            fee.
          </p>
          <fieldset className="payout-networks">
            <legend>Payout networks</legend>
            {PAYOUT_NETWORKS.map(([id, label]) => {
              const configured = Boolean(policy.payouts[id])
              const on = configured || ticked.has(id)
              return (
                <div className="payout-network" key={id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) => {
                        const next = new Set(ticked)
                        if (e.target.checked) next.add(id)
                        else {
                          next.delete(id)
                          if (configured) {
                            const payouts = { ...policy.payouts }
                            delete payouts[id]
                            onChange({ ...policy, payouts })
                          }
                        }
                        setTicked(next)
                      }}
                    />
                    {label}
                    {configured ? <small>Configured</small> : null}
                  </label>
                  {on ? (
                    <input
                      placeholder="0x…"
                      aria-label={`${label} payout address`}
                      value={policy.payouts[id] ?? ''}
                      onChange={(e) => {
                        const payouts = { ...policy.payouts }
                        if (e.target.value) payouts[id] = e.target.value
                        else delete payouts[id]
                        onChange({ ...policy, payouts })
                      }}
                    />
                  ) : null}
                </div>
              )
            })}
          </fieldset>
          <p className="studio-help">
            Tick every network you want to be paid on and add a payout address
            for each.
          </p>
          <label className="switch-row">
            <input
              type="checkbox"
              role="switch"
              className="switch"
              checked={policy.spectatorBets}
              onChange={(e) =>
                onChange({ ...policy, spectatorBets: e.target.checked })
              }
            />
            Allow optional spectator pools
          </label>
          <p className="studio-help">
            Spectator fees apply only to the losing side’s pool. Funding closes
            before play. Payout wallets must be able to receive testnet USDC;
            Hedera requires token association.
          </p>
        </>
      )}
    </fieldset>
  )
}
