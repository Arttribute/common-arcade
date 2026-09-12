'use client'
import { NETWORKS, usdcUnits, type EconomyConfig } from '@common-arcade/economy'
import { formatUnits } from 'viem'
import { Select, SelectOption } from './ui/select'
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
      <label>
        <input
          type="checkbox"
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
        />{' '}
        Use testnet USDC
      </label>
      {value.mode === 'escrow' && (
        <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
          <div className="field">
            <span className="field-label">Network</span>
            <Select
              value={value.network}
              ariaLabel="Table payment network"
              onValueChange={(network) => {
                if (
                  Object.hasOwn(NETWORKS, network) &&
                  enabledNetworks.includes(network)
                ) {
                  onChange({
                    ...value,
                    network: network as typeof value.network,
                  })
                }
              }}
            >
              {Object.values(NETWORKS)
                .filter((network) => network.testnet)
                .map((network) => (
                  <SelectOption
                    key={network.id}
                    value={network.id}
                    disabled={!enabledNetworks.includes(network.id)}
                    title={network.chain.name}
                    hint={
                      enabledNetworks.includes(network.id)
                        ? undefined
                        : 'Unavailable'
                    }
                  />
                ))}
            </Select>
          </div>
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
          <label>
            <input
              type="checkbox"
              checked={value.bounties}
              onChange={(e) =>
                onChange({ ...value, bounties: e.target.checked })
              }
            />{' '}
            Allow sponsored bounties
          </label>
          <label>
            <input
              type="checkbox"
              checked={value.spectatorBets}
              onChange={(e) =>
                onChange({ ...value, spectatorBets: e.target.checked })
              }
            />{' '}
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
