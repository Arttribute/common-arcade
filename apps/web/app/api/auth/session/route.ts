import { NextResponse } from 'next/server'
import { readSession } from '../../../../lib/session'
export async function GET() {
  const session = await readSession()
  return NextResponse.json(
    session ? { user: { id: session.id, name: session.name } } : { user: null },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
