'use client'
import { NETWORKS, usdcUnits, type EconomyConfig } from '@common-arcade/economy'
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
          <label>
            Network{' '}
            <select
              value={value.network}
              onChange={(e) =>
                onChange({
                  ...value,
                  network: e.target.value as typeof value.network,
                })
              }
            >
              {Object.values(NETWORKS)
                .filter((n) => n.testnet)
                .map((n) => (
                  <option
                    key={n.id}
                    value={n.id}
                    disabled={!enabledNetworks.includes(n.id)}
                  >
                    {n.chain.name}
                    {enabledNetworks.includes(n.id)
                      ? ''
                      : ' — awaiting deployment'}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Stake per player (USDC){' '}
            <input
              inputMode="decimal"
              defaultValue="1"
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
