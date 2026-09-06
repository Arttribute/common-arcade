import { Hono } from 'hono'
import { z } from 'zod'
import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3'
import { createPresignedPost } from '@aws-sdk/s3-presigned-post'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { StudioProject } from '@common-arcade/protocol'
import { IdentityError, type Principal } from './identity.js'
import type { DocumentStore, StoredDocument } from './store.js'

type Recording = StoredDocument & {
  id: string
  ownerId: string
  projectId: string
  revision: number
  digest: string
  title: string
  createdAt: string
  durationMs: number
  sizeBytes: number
  public: boolean
  ready: boolean
  objectKey: string
}
/** The object-store boundary works with AWS S3 or a self-hosted S3-compatible endpoint. */
export function createRecordingApi(
  store: DocumentStore,
  authenticate: (authorization?: string, scope?: string) => Promise<Principal>,
) {
  const app = new Hono()
  const client = new S3Client({
    endpoint: process.env.ARCADE_OBJECT_STORE_ENDPOINT,
    forcePathStyle: Boolean(process.env.ARCADE_OBJECT_STORE_ENDPOINT),
    region: process.env.AWS_REGION ?? 'eu-west-1',
  })
  const bucket = process.env.ARCADE_RECORDINGS_BUCKET
  const owned = async (ownerId: string, id: string) => {
    const record = await store.get<StoredDocument & { project: StudioProject }>(
      `owner:${ownerId}`,
      id,
    )
    if (!record)
      throw new IdentityError(403, 'Project is unavailable to this account.')
    return record.project
  }
  const summary = ({ objectKey, ownerId, version, ...record }: Recording) =>
    record
  app.post('/v1/projects/:id/recordings', async (c) => {
    const p = await authenticate(
      c.req.header('Authorization'),
      'projects:write',
    )
    const project = await owned(p.id, c.req.param('id'))
    if (!bucket)
      return c.json(
        {
          detail:
            'Hosted recording storage is not configured. Download this recording or configure an S3-compatible bucket.',
        },
        503,
      )
    const body = z
      .object({
        revision: z.number().int().positive(),
        title: z.string().min(1).max(120),
        durationMs: z.number().int().min(0).max(310000),
        sizeBytes: z
          .number()
          .int()
          .min(1)
          .max(8 * 1024 * 1024),
        public: z.boolean().default(false),
      })
      .strict()
      .parse(await c.req.json())
    if (body.revision !== project.revision)
      throw new IdentityError(
        403,
        'Recordings must be attached to the revision that was played. Save source changes before recording.',
      )
    const id = `rec_${crypto.randomUUID().replaceAll('-', '')}`
    const record: Recording = {
      version: 1,
      id,
      ownerId: p.id,
      projectId: project.id,
      digest: project.digest,
      ...body,
      createdAt: new Date().toISOString(),
      ready: false,
      objectKey: `recordings/${project.id}/${id}.json.gz`,
    }
    const upload = await createPresignedPost(client, {
      Bucket: bucket,
      Key: record.objectKey,
      Expires: 300,
      Fields: { 'Content-Type': 'application/gzip' },
      Conditions: [
        ['content-length-range', body.sizeBytes, body.sizeBytes],
        ['eq', '$Content-Type', 'application/gzip'],
      ],
    })
    await store.put('recordings', id, record)
    return c.json({ recording: summary(record), upload }, 201)
  })
  app.post('/v1/studio/recordings/:id/complete', async (c) => {
    const p = await authenticate(
      c.req.header('Authorization'),
      'projects:write',
    )
    const record = await store.get<Recording>('recordings', c.req.param('id'))
    if (!record || record.ownerId !== p.id)
      throw new IdentityError(403, 'Recording is unavailable to this account.')
    if (!bucket)
      return c.json({ detail: 'Recording storage is unavailable.' }, 503)
    const object = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: record.objectKey }),
    )
    if (
      object.ContentLength !== record.sizeBytes ||
      object.ContentType !== 'application/gzip'
    )
      return c.json({ detail: 'The recording upload is incomplete.' }, 409)
    if (!record.ready) {
      const ready = { ...record, ready: true, version: record.version + 1 }
      await store.put('recordings', record.id, ready, record.version)
      await store.put(`recordings:${record.projectId}`, record.id, ready)
      return c.json(summary(ready))
    }
    // Repair the project index if a previous completion stopped after committing the record.
    if (!(await store.get(`recordings:${record.projectId}`, record.id)))
      await store.put(`recordings:${record.projectId}`, record.id, record)
    return c.json(summary(record))
  })
  app.get('/v1/projects/:id/recordings', async (c) => {
    const p = await authenticate(c.req.header('Authorization'), 'projects:read')
    const project = await owned(p.id, c.req.param('id'))
    return c.json({
      recordings: (await store.list<Recording>(`recordings:${project.id}`))
        .filter((r) => r.ready)
        .map(summary),
    })
  })
  app.get('/v1/games/:id/recordings', async (c) => {
    const projectId = c.req.param('id').replace(/^gam_/, 'prj_')
    return c.json({
      recordings: (await store.list<Recording>(`recordings:${projectId}`))
        .filter((r) => r.ready && r.public)
        .map(summary),
    })
  })
  app.get('/v1/studio/recordings/:id', async (c) => {
    const record = await store.get<Recording>('recordings', c.req.param('id'))
    if (!record || !record.ready)
      return c.json({ detail: 'Recording not found.' }, 404)
    if (!record.public) {
      const p = await authenticate(
        c.req.header('Authorization'),
        'projects:read',
      )
      if (record.ownerId !== p.id)
        throw new IdentityError(403, 'Recording is private.')
    }
    if (!bucket)
      return c.json({ detail: 'Recording storage is unavailable.' }, 503)
    return c.json({
      ...summary(record),
      downloadUrl: await getSignedUrl(
        client,
        new GetObjectCommand({ Bucket: bucket, Key: record.objectKey }),
        { expiresIn: 120 },
      ),
    })
  })
  return app
}
