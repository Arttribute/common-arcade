# External agent wallets

Design checked against Privy's documentation on 2026-09-10.

## Experience

An owner signs in to Arcade, selects **Create agent wallet**, names a Codex,
Claude Code or other external agent, and approves a testnet, USDC allowance
and expiry. Arcade provisions a dedicated Privy wallet. A short-lived,
single-use connection code connects the external process without handing it
the owner's Commons credential, Privy app secret or wallet private key.

The owner sees a compact wallet card: connection state, wallet address,
network balances, remaining allowance, expiry, activity and **Revoke access**.
Funding is separate from authorization: creating a wallet does not deposit
USDC or gas. Revoking access does not destroy the wallet or its funds.

## Privy integration decision

Privy now provides an official device-authorization flow for self-hosted
agents, including Codex and Claude Code. It can be used with an application's
own approval page. Its public CLI and sandbox are also useful for an immediate
bring-your-own-wallet trial. These are distinct from an Arcade-managed wallet.

For the managed product, use an application-owned Privy wallet per agent
connection and an Arcade capability that authorizes only structured Arcade
operations. Keep Privy authorization credentials on the backend and apply
Privy wallet policies as an additional boundary. Keep total session accounting
and per-request idempotency in the authoritative database. A UI spending limit
alone is not enforcement. Never expose generic wallet RPC, raw signing, key
export, arbitrary approvals or owner credentials to the external agent.

Privy's direct device flow should be a later optional integration for users
bringing their own Privy wallets. Its documented authorization response does
not itself establish our per-agent wallet isolation or Arcade budget. Privy
revocation invalidates refresh tokens; an existing access token can remain
valid for up to 15 minutes. Do not label that mechanism an immediate Arcade
spending stop. The broker can deny new operations immediately upon revocation;
already submitted blockchain transactions can still settle.

## Existing implementation constraints

Commons wallet creation currently generates an EOA and encrypts its private
key in the database. Its existing spending-grant SQL explicitly requires a
non-null encrypted key. Integrating Privy through that path requires a signer
interface and provider-aware eligibility; recording a Privy address as an
external wallet does not make it spendable. Arcade already has owner identity,
scoped access keys, conditional document writes, and an authenticated frontend
proxy, which can host the dedicated external-agent onboarding independently.

Base Sepolia, Arc Testnet and Celo Sepolia are the first EVM targets. Hedera's
native x402 signer and HTS account/token association need separate verification;
do not infer native Hedera support from an Ethereum wallet address. Gas
sponsorship must be checked per network and is separate from USDC funding.

## Verification required before enabling creation

- Owner identity and provider configuration are verified before provisioning.
- Wallet creation and pairing are idempotent; connection codes expire and
  cannot be consumed twice or recovered from database records.
- Agent credentials cannot enumerate other wallets, change limits, export a
  key, or sign unrelated messages or transactions.
- Concurrent requests cannot exceed the allowance; ambiguous payments retain
  their reservation and are reconciled instead of automatically paid again.
- Revocation and expiry deny new operations; recovery remains available to
  the owner for funds already deposited.
- Real Privy creation, signatures and one funded testnet payment are tested
  before the UI labels the integration ready.

## Sources

- [Privy agent authorization](https://docs.privy.io/recipes/agent-integrations/agent-authorization)
- [Privy Agent CLI](https://docs.privy.io/recipes/agent-integrations/agent-cli)
- [Application-owned agent wallets](https://docs.privy.io/recipes/agent-integrations/agentic-wallets)
- [Create wallet API](https://docs.privy.io/api-reference/wallets/create)
- [Wallet policies and controls](https://docs.privy.io/security/wallet-infrastructure/policy-and-controls)
- [Ethereum policy examples](https://docs.privy.io/controls/policies/example-policies/ethereum)

## Implementation and activation

The UI is `/agents/wallets`. The portable Node 22+ CLI is served at
`/agent-wallet.mjs`. It stores its scoped Arcade credential in the OS keychain
or in a file encrypted with `ARCADE_WALLET_PASSPHRASE` supplied from a secret
store. `ARCADE_WALLET_CONFIG_DIR` can select a mounted per-agent configuration
directory. Neither the agent nor the browser receives Privy credentials.

The control API stores wallet metadata, hashed credentials and payment
reservations in DynamoDB using conditional writes. Privy signing uses
`@privy-io/node` and its viem account adapter. Supported commands are paid
analysis, a player's own stake, start, observation, hit/stand, and claiming
settled winnings back to the same wallet. Generic game payloads, sponsored
bounties, spectator bets and native Hedera x402 are not part of this first
external-wallet client. Existing human/Commons payment flows are unchanged.

Connections allow at most 100 agent operations. Reconnecting rotates access
and renews expiry but does not refill the original USDC allowance. Winnings
and refunds do not automatically increase the approved allowance. Owners can
claim winnings or withdraw canonical USDC using **Manage funds**, including
after revoking agent access. The broker never exposes owner withdrawals to an
agent credential. Native gas recovery and cancelled-pool refunds require
operator assistance in this initial release.

Create a dedicated Privy application and configure a server authorization key
or quorum and one policy per enabled testnet. Store these fields in AWS Secrets
Manager as `common-arcade/development/privy-wallets`:

```json
{
  "appId": "<Privy app ID>",
  "appSecret": "<Privy app secret>",
  "ownerId": "<server owner key-quorum ID>",
  "authorizationKey": "<authorization private key>",
  "paymentUrl": "https://d2scptqzm55h6p.cloudfront.net",
  "networksJson": "{\"base-sepolia\":{\"policyId\":\"<policy ID>\",\"escrow\":\"0x45699ed8ccda0d7b29008e7af90e287a79de08de\",\"treasury\":\"0xD9303DFc71728f209EF64DD1AD97F5a557AE0Fab\"}}"
}
```

Network entries use canonical token/chain definitions from the economy
package; escrow and treasury addresses must match the reviewed deployment
records. Policy rules must constrain `eth_signTransaction` (the viem adapter
signs before broadcasting), USDC approvals to the designated escrow, own-seat
stakes, claims, and owner USDC transfers. Constrain `personal_sign` to the
Arcade payment-domain message prefix and `eth_signTypedData_v4` to canonical
USDC, the correct chain, and the intended x402 payee. Deny key export and
unrelated signing methods. A blanket allow-all policy is not appropriate.

CDK accepts `privyWalletSecretName` and `managedWallets` contexts. The protected AWS workflow maps environment variables `PRIVY_WALLET_SECRET_NAME` and `MANAGED_WALLETS_ENABLED` to the same settings. With no secret
context, creation stays disabled. With the secret context, CloudFormation uses
Secrets Manager dynamic references for the backend environment. Enable with
`managedWallets=true` only after the real Privy and funded testnet checks; use
the protected AWS workflow and review synth/diff first. No Privy app credentials
have been configured or live Privy wallets created by this change.

The browser approval itself is the permission to create and use this dedicated
wallet within its configured allowance; the connection code is not a Commons
login or a Privy OAuth token. The public pairing endpoint is only useful after
an authenticated owner creates a wallet and supplies its one-use code.

For a lost response, keep the original request UUID and inspect `status` or
repeat that same UUID. A stored completed result is returned without another
execution. An uncertain operation keeps its allowance reservation and blocks
further wallet operations until an operator verifies the transaction receipts
and reconciles the record. Do not clear this lock or refund its reservation
merely because an HTTP request timed out.

## Human wallet approvals and platform earnings

New paid releases use a platform-controlled 2.5% success fee, split 70% to the
creator pool and 30% to Arcade. Creators cannot change either number through
the UI, project writes, the earnings tool or publication. Match creation also
rejects success-fee overrides. Existing immutable releases remain readable and
keep their original terms. Publishing a remix must not reduce inherited
royalties; legacy obligations that exceed the current creator pool require
resolution before a new paid release can be published.

| Action                                                                     | User approval                                               | Onchain transaction                                                                                       |
| -------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Browse, spectate, inspect balances                                         | None                                                        | No                                                                                                        |
| Save a payout address or publish a game                                    | Commons owner action                                        | No                                                                                                        |
| Create a managed agent wallet, pair, set its allowance, revoke access      | Commons owner approval                                      | No                                                                                                        |
| Connect a personal wallet with Privy                                       | Wallet connection or Privy login                            | No                                                                                                        |
| Create a table, start play, read a private observation, submit a game move | Wallet message signature                                    | The signature is offchain; the resolver handles match creation, locking and settlement where applicable   |
| Stake, fund a bounty, place a spectator bet                                | Review amount/network, then approve in the wallet           | Exact USDC allowance if needed, followed by the deposit                                                   |
| Claim prizes, creator earnings, spectator payouts or refunds               | Review recipient/network, then approve in the wallet        | Yes; network fees apply                                                                                   |
| Void an expired match                                                      | Confirm in the wallet                                       | Yes; contract eligibility is checked                                                                      |
| Add USDC to an agent from a personal wallet                                | Review transfer amount, network and recipient in the wallet | One token transfer; it does not enlarge the agent's approved allowance                                    |
| Recover funds from an Arcade-managed agent wallet                          | Explicit owner action in Manage funds                       | Backend Privy signer submits the transaction; this is a different wallet from the user's connected wallet |

Human connections use Privy's React SDK (`connectOrCreateWallet`, `useWallets`
and the selected wallet's EIP-1193 provider). Embedded wallet confirmation
modals are explicitly enabled. External wallets show their own approval UI.
Connecting a wallet does not grant an agent spending access or replace Commons
owner authentication. Message signatures are not represented as gas-paying
transactions. A submitted hash is retained locally until a confirmed receipt;
confirmation timeouts require checking that hash instead of rebroadcasting.
USDC allowance confirmation is separate from deposit confirmation. Wallet
cancellations and replacements are not reported as successful payments;
speed-ups follow the replacement hash.

Set public `NEXT_PUBLIC_PRIVY_APP_ID` and, where applicable,
`NEXT_PUBLIC_PRIVY_CLIENT_ID` on the web deployment. Configure the Arcade
production and approved preview/local origins in that Privy app. These public
IDs are distinct from the backend Privy secret and authorization key above.
The human UI supports the configured testnet EVM escrow networks; a Hedera
wallet still needs a funded account and USDC token association. No native
Hedera x402 capability is implied by this browser connection.

References: [React setup](https://docs.privy.io/basics/react/setup),
[wallet connectors](https://docs.privy.io/recipes/react/configuring-external-connectors),
[viem integration](https://docs.privy.io/wallets/connectors/ethereum/integrations/viem),
[confirmation modals](https://docs.privy.io/recipes/react/manage-wallet-UIs).
