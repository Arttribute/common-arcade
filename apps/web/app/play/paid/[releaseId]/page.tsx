import { notFound } from 'next/navigation'
import { Header } from '../../../components/header'
import { GameEconomyTable } from '../../../components/game-economy-table'
export default async function Page({
  params,
}: {
  params: Promise<{ releaseId: string }>
}) {
  const { releaseId } = await params
  if (!/^rel_[A-Za-z0-9_-]{1,190}$/.test(releaseId)) notFound()
  return (
    <main>
      <Header />
      <section className="shell" style={{ paddingTop: 40, paddingBottom: 80 }}>
        <div className="eyebrow">OPTIONAL TESTNET ECONOMY</div>
        <h1>Play & earn</h1>
        <p>
          This match uses the published game and its immutable earning terms.
          Free play is the default. Paid previews support two-seat, turn-based
          games.
        </p>
        <GameEconomyTable releaseId={releaseId} />
      </section>
    </main>
  )
}
