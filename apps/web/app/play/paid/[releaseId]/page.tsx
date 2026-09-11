import { notFound } from 'next/navigation'
import { Header } from '../../../components/header'
import { GameEconomyTable } from '../../../components/game-economy-table'
import { economyConfigSchema, type EconomyConfig } from '@common-arcade/economy'
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ releaseId: string }>
  searchParams: Promise<{ economy?: string | string[] }>
}) {
  const { releaseId } = await params
  if (!/^rel_[A-Za-z0-9_-]{1,190}$/.test(releaseId)) notFound()
  const selection = (await searchParams).economy
  let initialEconomy: EconomyConfig | undefined
  if (selection !== undefined) {
    try {
      if (typeof selection !== 'string' || selection.length > 2048) notFound()
      initialEconomy = economyConfigSchema.parse(JSON.parse(selection))
    } catch {
      notFound()
    }
  }
  return (
    <main className="arcade" id="main">
      <Header />
      <section className="shell" style={{ paddingTop: 40, paddingBottom: 80 }}>
        <div className="eyebrow">OPTIONAL TESTNET ECONOMY</div>
        <h1>Play & earn</h1>
        <p>
          This match uses the published game and its immutable earning terms.
          Free play is the default. Paid previews support two-seat, turn-based
          games.
        </p>
        <GameEconomyTable
          releaseId={releaseId}
          initialEconomy={initialEconomy}
        />
      </section>
    </main>
  )
}
