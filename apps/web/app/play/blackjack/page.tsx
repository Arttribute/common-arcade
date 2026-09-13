import { redirect } from 'next/navigation'

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ matchId?: string }>
}) {
  const { matchId } = await searchParams
  redirect(
    matchId && /^mat_[A-Za-z0-9_-]{1,190}$/.test(matchId)
      ? `/play/${matchId}?paid=1`
      : '/discover',
  )
}
