import { notFound } from 'next/navigation'
import { GameStudio } from '../../components/game-studio'
export default async function GameStudioPage({
  params,
  searchParams,
}: {
  params: Promise<{ gameId: string }>
  searchParams: Promise<{ session?: string; agent?: string; run?: string }>
}) {
  const [{ gameId }, query] = await Promise.all([params, searchParams])
  if (!/^prj_[a-zA-Z0-9]+$/.test(gameId)) notFound()
  // Recents deep-link into a specific copilot conversation or playtest.
  return (
    <GameStudio
      projectId={gameId}
      initialSession={
        query.session && query.agent
          ? { sessionId: query.session, agentId: query.agent }
          : undefined
      }
      initialRunId={query.run}
    />
  )
}
