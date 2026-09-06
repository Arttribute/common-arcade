import { notFound } from 'next/navigation'
import { GameStudio } from '../../components/game-studio'
export default async function GameStudioPage({
  params,
}: {
  params: Promise<{ gameId: string }>
}) {
  const { gameId } = await params
  if (!/^prj_[a-zA-Z0-9]+$/.test(gameId)) notFound()
  return <GameStudio projectId={gameId} />
}
