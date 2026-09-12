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
      <section
        className="shell page-heading"
        style={{ paddingTop: 40, paddingBottom: 80 }}
      >
        <h1>
          <span className="page-title">Game table</span>
        </h1>
        <p>Invite a player or join a table. Paid games use test tokens.</p>
        <GameEconomyTable
          releaseId={releaseId}
          initialEconomy={initialEconomy}
        />
      </section>
    </main>
  )
}
