'use client'
import {
  platformGameMonetizationSchema,
  SUCCESS_FEE_BPS,
  CREATOR_SHARE_BPS,
  type GameMonetization,
} from '@common-arcade/protocol'
import { useArcadeWallet, WalletConnectionButton } from './arcade-wallet'
export function CreatorEconomySettings({
  value,
  onChange,
  disabled = false,
}: {
  value?: GameMonetization
  onChange: (value: GameMonetization) => void
  disabled?: boolean
}) {
  const wallet = useArcadeWallet()
  const policy: GameMonetization =
    value?.mode === 'revenue-share'
      ? {
          ...value,
          feeBps: SUCCESS_FEE_BPS,
          creatorShareBps: CREATOR_SHARE_BPS,
        }
      : (value ?? { mode: 'free' })
  const validation = platformGameMonetizationSchema.safeParse(policy)
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
      {value?.mode === 'revenue-share' &&
        value.creatorShareBps !== CREATOR_SHARE_BPS && (
          <p className="studio-help" role="status">
            This draft has an older earnings split. New paid releases use 70%
            creator / 30% Arcade.
            <button type="button" onClick={() => onChange(policy)}>
              Apply current earnings policy
            </button>
          </p>
        )}
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
          <p className="studio-help">
            <strong>70% to creators · 30% to Arcade</strong>
            <br />
            Arcade sets this split of the 2.5% success fee for new releases.
          </p>
          <p className="studio-help">
            One 2.5% success fee. On a 10 USDC prize pool: 9.75 to the winner,{' '}
            {((0.25 * policy.creatorShareBps) / 10000).toFixed(3)} to the
            creator pool (including source royalties),{' '}
            {((0.25 * (10000 - policy.creatorShareBps)) / 10000).toFixed(3)} to
            the platform. Draws and cancellations refund contributions without a
            fee.
          </p>
          <WalletConnectionButton disabled={disabled} />
          <p className="studio-help">
            Connect your wallet to use its address for payouts. Saving a payout
            address and publishing do not send a transaction; claiming earnings
            does.
          </p>
          {(
            [
              'base-sepolia',
              'arc-testnet',
              'hedera-testnet',
              'celo-sepolia',
            ] as const
          ).map((network) => (
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
              {wallet.address && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    onChange({
                      ...policy,
                      payouts: {
                        ...policy.payouts,
                        [network]: wallet.address!,
                      },
                    })
                  }
                >
                  Use connected wallet
                </button>
              )}
            </label>
          ))}
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
