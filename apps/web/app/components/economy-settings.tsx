'use client'
import { NETWORKS, usdcUnits, type EconomyConfig } from '@common-arcade/economy'
import { formatUnits } from 'viem'
import { SelectMenu } from './ui/select-menu'
export function EconomySettings({
  value,
  onChange,
  enabledNetworks,
}: {
  value: EconomyConfig
  onChange: (value: EconomyConfig) => void
  enabledNetworks: string[]
}) {
  return (
    <fieldset className="economy-settings">
      <legend>Match payments</legend>
      <label className="switch-row">
        <input
          type="checkbox"
          role="switch"
          className="switch"
          checked={value.mode === 'escrow'}
          onChange={(e) =>
            onChange(
              e.target.checked
                ? {
                    mode: 'escrow',
                    network: 'base-sepolia',
                    stakeUnits: '1000000',
                    bounties: false,
                    spectatorBets: false,
                    feeBps: 250,
                    fundingSeconds: 600,
                    settlementSeconds: 3600,
                  }
                : { mode: 'free' },
            )
          }
        />
        Use testnet USDC
      </label>
      {value.mode === 'escrow' && (
        <div className="economy-settings-fields">
          <label>
            Network
            <SelectMenu
              value={value.network}
              options={Object.values(NETWORKS)
                .filter((n) => n.testnet)
                .map((n) => ({
                  value: n.id,
                  label: n.chain.name,
                  description: enabledNetworks.includes(n.id)
                    ? undefined
                    : 'Awaiting deployment',
                  disabled: !enabledNetworks.includes(n.id),
                }))}
              onChange={(network) =>
                onChange({
                  ...value,
                  network: network as typeof value.network,
                })
              }
            />
          </label>
          <label>
            Stake per player (USDC){' '}
            <input
              inputMode="decimal"
              defaultValue={formatUnits(BigInt(value.stakeUnits), 6)}
              onChange={(e) => {
                try {
                  onChange({
                    ...value,
                    stakeUnits: usdcUnits(e.target.value).toString(),
                  })
                  e.target.setCustomValidity('')
                } catch {
                  e.target.setCustomValidity('Use up to six decimal places')
                }
              }}
            />
          </label>
          <label className="switch-row">
            <input
              type="checkbox"
              role="switch"
              className="switch"
              checked={value.bounties}
              onChange={(e) =>
                onChange({ ...value, bounties: e.target.checked })
              }
            />
            Allow sponsored bounties
          </label>
          <label className="switch-row">
            <input
              type="checkbox"
              role="switch"
              className="switch"
              checked={value.spectatorBets}
              onChange={(e) =>
                onChange({ ...value, spectatorBets: e.target.checked })
              }
            />
            Allow spectator bets before play
          </label>
          <p>
            Platform fee: {value.feeBps / 100}% of the prize pool and spectator
            profits. Draws and cancelled matches refund contributions.
          </p>
        </div>
      )}
    </fieldset>
  )
}
