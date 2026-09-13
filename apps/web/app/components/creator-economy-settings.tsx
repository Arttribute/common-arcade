'use client'
import { useState } from 'react'
import {
  gameMonetizationSchema,
  type GameMonetization,
} from '@common-arcade/protocol'
import { SwitchField } from './ui/switch'
import { RadioGroup, RadioOption } from './ui/radio-group'
import { Select, SelectOption } from './ui/select'
import { Field, Input } from './ui/field'
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
  const [network, setNetwork] = useState<
    'base-sepolia' | 'arc-testnet' | 'hedera-testnet' | 'celo-sepolia'
  >('base-sepolia')
  const validation = gameMonetizationSchema.safeParse(policy)
  const earningMode =
    policy.mode === 'revenue-share' && policy.allowedModes.length === 2
      ? 'both'
      : policy.mode === 'revenue-share'
        ? (policy.allowedModes[0] ?? 'sponsored')
        : 'sponsored'
  return (
    <div className="studio-section economy-settings">
      <div className="studio-section-label">Game earnings</div>
      <SwitchField
        disabled={disabled}
        checked={policy.mode === 'revenue-share'}
        label="Offer paid matches"
        hint="Free play stays available. Terms are pinned when you publish."
        onCheckedChange={(enabled) =>
          onChange(
            enabled
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
      {policy.mode === 'revenue-share' && (
        <>
          {!validation.success && (
            <p className="studio-notice" role="status">
              Add a complete, nonzero payout address for at least one network
              before saving or publishing paid matches.
            </p>
          )}
          <Field label="Earning mode">
            <RadioGroup
              ariaLabel="Earning mode"
              disabled={disabled}
              value={earningMode}
              onValueChange={(id) =>
                onChange({
                  ...policy,
                  allowedModes:
                    id === 'both'
                      ? ['sponsored', 'staked']
                      : [id as 'sponsored' | 'staked'],
                })
              }
            >
              <RadioOption
                value="sponsored"
                title="Sponsored rewards"
                hint="Free entry. A sponsor funds the prizes."
              />
              <RadioOption
                value="staked"
                title="Player stakes"
                hint="Players contribute to the prize pool."
              />
              <RadioOption
                value="both"
                title="Both options"
                hint="Let the host choose when starting a session."
              />
            </RadioGroup>
          </Field>
          <Field
            label="Creator share of the success fee"
            hint={`One 2.5% success fee. On a 10 USDC prize pool: 9.75 to the winner, ${(
              (0.25 * policy.creatorShareBps) /
              10000
            ).toFixed(3)} to the creator pool (including source royalties), ${(
              (0.25 * (10000 - policy.creatorShareBps)) /
              10000
            ).toFixed(
              3,
            )} to the platform. Draws and cancellations refund contributions without a fee.`}
          >
            <Select
              ariaLabel="Creator share of the success fee"
              disabled={disabled}
              value={String(policy.creatorShareBps)}
              onValueChange={(value) =>
                onChange({ ...policy, creatorShareBps: Number(value) })
              }
            >
              {[0, 5000, 7000, 9000].map((n) => (
                <SelectOption
                  key={n}
                  value={String(n)}
                  title={`${n / 100}% creator / ${(10000 - n) / 100}% platform`}
                />
              ))}
            </Select>
          </Field>
          <Field label="Payout network">
            <Select
              ariaLabel="Payout network"
              disabled={disabled}
              value={network}
              onValueChange={(value) => setNetwork(value as typeof network)}
            >
              {(
                [
                  'base-sepolia',
                  'arc-testnet',
                  'hedera-testnet',
                  'celo-sepolia',
                ] as const
              ).map((id) => (
                <SelectOption
                  key={id}
                  value={id}
                  title={id}
                  hint={policy.payouts[id] ? 'Configured' : undefined}
                />
              ))}
            </Select>
          </Field>
          <Field
            label={`${network} payout address`}
            hint="Configure at least one network. Switch networks to add or remove another address."
          >
            <Input
              placeholder="0x…"
              disabled={disabled}
              value={policy.payouts[network] ?? ''}
              onChange={(e) => {
                const payouts = { ...policy.payouts }
                if (e.target.value) payouts[network] = e.target.value
                else delete payouts[network]
                onChange({ ...policy, payouts })
              }}
            />
          </Field>
          <SwitchField
            disabled={disabled}
            checked={policy.spectatorBets}
            label="Spectator pools"
            hint="Spectator fees apply only to the losing side’s pool, and funding closes before play."
            onCheckedChange={(spectatorBets) =>
              onChange({ ...policy, spectatorBets })
            }
          />
          <p className="studio-help">
            Payout wallets must be able to receive testnet USDC; Hedera requires
            token association.
          </p>
        </>
      )}
    </div>
  )
}
