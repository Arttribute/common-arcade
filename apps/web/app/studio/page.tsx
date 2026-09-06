import { redirect } from 'next/navigation'
import { StudioHome } from '../components/studio-home'
export default async function StudioPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>
}) {
  const { project } = await searchParams
  if (project && /^prj_[a-zA-Z0-9]+$/.test(project))
    redirect(`/studio/${project}`)
  return <StudioHome />
}
