import type { StudioProject } from '@common-arcade/protocol'
import { IdentityError } from './identity.js'
import type { DocumentStore, StoredDocument } from './store.js'

export type ProjectPermission = 'view' | 'test' | 'comment' | 'edit'
export type ProjectRecord = StoredDocument & { project: StudioProject }

type MembershipRecord = StoredDocument & {
  projectId: string
  ownerId: string
  actorId: string
  permissions: ProjectPermission[]
  active: boolean
}

function grants(
  project: StudioProject,
  actorId: string,
  required: ProjectPermission,
): boolean {
  if (project.ownerId === actorId) return true
  const member = project.collaborators?.find(
    (candidate) => candidate.actorId === actorId,
  )
  if (!member) return false
  if (required === 'view') return member.permissions.length > 0
  return member.permissions.includes(required)
}

export async function projectAccess(
  store: DocumentStore,
  actorId: string,
  projectId: string,
  required: ProjectPermission,
): Promise<ProjectRecord> {
  const owned = await store.get<ProjectRecord>(`owner:${actorId}`, projectId)
  if (owned && grants(owned.project, actorId, required)) return owned
  const membership = await store.get<MembershipRecord>(
    `project-memberships:${actorId}`,
    projectId,
  )
  if (!membership?.active)
    throw new IdentityError(403, 'Project is unavailable to this account.')
  const record = await store.get<ProjectRecord>(
    `owner:${membership.ownerId}`,
    projectId,
  )
  if (!record || !grants(record.project, actorId, required))
    throw new IdentityError(403, 'Project is unavailable to this account.')
  return record
}

export async function syncProjectMemberships(
  store: DocumentStore,
  before: StudioProject['collaborators'],
  project: StudioProject,
): Promise<void> {
  const actors = new Set([
    ...(before ?? []).map((member) => member.actorId),
    ...(project.collaborators ?? []).map((member) => member.actorId),
  ])
  for (const actorId of actors) {
    const current = await store.get<MembershipRecord>(
      `project-memberships:${actorId}`,
      project.id,
    )
    const permissions =
      project.collaborators?.find((member) => member.actorId === actorId)
        ?.permissions ?? []
    await store.put(
      `project-memberships:${actorId}`,
      project.id,
      {
        version: (current?.version ?? 0) + 1,
        projectId: project.id,
        ownerId: project.ownerId,
        actorId,
        permissions,
        active: permissions.length > 0,
      },
      current?.version,
    )
  }
}

export async function accessibleProjects(
  store: DocumentStore,
  actorId: string,
): Promise<StudioProject[]> {
  const owned = (
    await store.list<ProjectRecord>(`owner:${actorId}`, 'prj_')
  ).map((record) => record.project)
  const memberships = await store.list<MembershipRecord>(
    `project-memberships:${actorId}`,
  )
  const shared = await Promise.all(
    memberships
      .filter((membership) => membership.active)
      .map((membership) =>
        projectAccess(store, actorId, membership.projectId, 'view')
          .then((record) => record.project)
          .catch(() => undefined),
      ),
  )
  return [
    ...owned,
    ...shared.filter(
      (project): project is StudioProject =>
        project !== undefined && !owned.some((item) => item.id === project.id),
    ),
  ]
}
