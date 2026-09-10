'use client'
import {
  gameMonetizationSchema,
  type GameMonetization,
} from '@common-arcade/protocol'
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
  const validation = gameMonetizationSchema.safeParse(policy)
  return (
    <fieldset disabled={disabled} className="studio-section economy-settings">
      <legend>Game earnings</legend>
      <label>
        <input
          type="checkbox"
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
        />{' '}
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
          <label>
            Earning mode
            <select
              value={
                policy.allowedModes.length === 2
                  ? 'both'
                  : policy.allowedModes[0]
              }
              onChange={(e) =>
                onChange({
                  ...policy,
                  allowedModes:
                    e.target.value === 'both'
                      ? ['sponsored', 'staked']
                      : [e.target.value as 'sponsored' | 'staked'],
                })
              }
            >
              <option value="both">Sponsored rewards & player stakes</option>
              <option value="sponsored">Sponsored rewards · free entry</option>
              <option value="staked">Player stakes · winner takes prize</option>
            </select>
          </label>
          <label>
            Creator share of the success fee
            <select
              value={policy.creatorShareBps}
              onChange={(e) =>
                onChange({ ...policy, creatorShareBps: Number(e.target.value) })
              }
            >
              {[0, 5000, 7000, 9000].map((n) => (
                <option key={n} value={n}>
                  {n / 100}% creator / {(10000 - n) / 100}% platform
                </option>
              ))}
            </select>
          </label>
          <p className="studio-help">
            One 2.5% success fee. On a 10 USDC prize pool: 9.75 to the winner,{' '}
            {((0.25 * policy.creatorShareBps) / 10000).toFixed(3)} to the
            creator pool (including source royalties),{' '}
            {((0.25 * (10000 - policy.creatorShareBps)) / 10000).toFixed(3)} to
            the platform. Draws and cancellations refund contributions without a
            fee.
          </p>
          {(['base-sepolia', 'arc-testnet', 'hedera-testnet'] as const).map(
            (network) => (
              <label key={network}>
                {network} payout address
                <input
                  placeholder="0x… · leave empty to disable this network"
                  value={policy.payouts[network] ?? ''}
                  onChange={(e) => {
                    const payouts = { ...policy.payouts }
                    if (e.target.value) payouts[network] = e.target.value
                    else delete payouts[network]
                    onChange({ ...policy, payouts })
                  }}
                />
              </label>
            ),
          )}
          <label>
            <input
              type="checkbox"
              checked={policy.spectatorBets}
              onChange={(e) =>
                onChange({ ...policy, spectatorBets: e.target.checked })
              }
            />{' '}
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
