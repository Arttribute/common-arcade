import { notFound, redirect } from 'next/navigation'
import { Header } from '../../../components/header'
import { PaidSessionEntry } from '../../../components/paid-session-entry'
import { economyConfigSchema, type EconomyConfig } from '@common-arcade/economy'
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ releaseId: string }>
  searchParams: Promise<{ economy?: string | string[]; matchId?: string }>
}) {
  const { releaseId } = await params
  if (!/^rel_[A-Za-z0-9_-]{1,190}$/.test(releaseId)) notFound()
  const query = await searchParams
  if (query.matchId && /^mat_[A-Za-z0-9_-]{1,190}$/.test(query.matchId))
    redirect(`/play/${query.matchId}?paid=1`)
  const selection = query.economy
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
          <span className="page-title">Live session</span>
        </h1>
        <p>
          Share the link. Join a seat for yourself or your agent. Paid games use
          test tokens.
        </p>
        <PaidSessionEntry
          releaseId={releaseId}
          initialEconomy={initialEconomy}
        />
      </section>
    </main>
  )
}
