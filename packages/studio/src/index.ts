import { z } from 'zod'
import {
  createGridPlacementGame,
  type GridPlacementRuleSet,
} from '@common-arcade/match-runtime'
import { computeManifestDigest } from '@common-arcade/manifest'
import { ARCADE_API_VERSION, type GameManifest } from '@common-arcade/protocol'

export const gameDocumentSchema = z
  .object({
    title: z.string().trim().min(1).max(100),
    description: z.string().max(1000),
    boardSize: z.number().int().min(3).max(8),
    winLength: z.number().int().min(3).max(8),
    marks: z.tuple([z.string().min(1).max(3), z.string().min(1).max(3)]),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    background: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  })
  .strict()
  .superRefine((d, c) => {
    if (d.winLength > d.boardSize)
      c.addIssue({
        code: 'custom',
        message: 'Win length cannot exceed board size',
      })
    if (d.marks[0] === d.marks[1])
      c.addIssue({ code: 'custom', message: 'Players need distinct marks' })
  })
export type GameDocument = z.infer<typeof gameDocumentSchema>
export const starterDocument: GameDocument = {
  title: 'Three in a row',
  description:
    'Take turns. Find your line. A small game with room for a clever opponent.',
  boardSize: 3,
  winLength: 3,
  marks: ['X', 'O'],
  accent: '#78716c',
  background: '#fafaf9',
}
export type StudioAnnotation = {
  id: string
  revision: number
  digest: string
  body: string
  status: 'open' | 'resolved'
  x: number
  y: number
  width?: number
  height?: number
  entityId?: string
  tick?: number
  createdAt: string
}
export type StudioProject = {
  id: string
  ownerId: string
  revision: number
  digest: string
  document: GameDocument
  annotations: StudioAnnotation[]
  createdAt: string
  updatedAt: string
  releaseId?: string
}
export type StudioRelease = {
  id: string
  projectId: string
  revision: number
  document: GameDocument
  digest: string
  manifest: GameManifest
  publishedAt: string
}
export function rulesFor(
  document: GameDocument,
  releaseId: string,
  digest: string,
): GridPlacementRuleSet {
  const d = gameDocumentSchema.parse(document)
  const lines: number[][] = []
  for (let y = 0; y < d.boardSize; y++)
    for (let x = 0; x < d.boardSize; x++) {
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
        [1, 1],
        [-1, 1],
      ] as const) {
        const ex = x + dx * (d.winLength - 1),
          ey = y + dy * (d.winLength - 1)
        if (ex < 0 || ex >= d.boardSize || ey >= d.boardSize) continue
        lines.push(
          Array.from(
            { length: d.winLength },
            (_, i) => (y + dy * i) * d.boardSize + x + dx * i,
          ),
        )
      }
    }
  return {
    kind: 'grid-placement',
    releaseId,
    releaseDigest: digest,
    marks: d.marks,
    cellCount: d.boardSize ** 2,
    winningLines: lines,
    objective: `Place ${d.winLength} marks in a row.`,
  }
}
export function compileGame(
  document: GameDocument,
  releaseId: string,
  digest: string,
) {
  return createGridPlacementGame(rulesFor(document, releaseId, digest))
}
export async function documentDigest(document: GameDocument): Promise<string> {
  const data = new TextEncoder().encode(
    JSON.stringify(gameDocumentSchema.parse(document)),
  )
  const hash = await crypto.subtle.digest('SHA-256', data)
  return `sha256:${Array.from(new Uint8Array(hash), (n) => n.toString(16).padStart(2, '0')).join('')}`
}
export async function releaseManifest(
  project: StudioProject,
  releaseId: string,
): Promise<GameManifest> {
  const m: GameManifest = {
    apiVersion: ARCADE_API_VERSION,
    kind: 'Game',
    metadata: {
      id: project.id.replace(/^prj_/, 'gam_'),
      namespace: 'io.agentcommons.arcade.creators',
      slug: project.id,
      version: `0.1.${project.revision}`,
      digest: `sha256:${'0'.repeat(64)}`,
      title: project.document.title,
      summary: project.document.description,
      publisher: {
        id: `pub_${project.ownerId.replace(/[^a-zA-Z0-9_]/g, '_')}`,
        name: 'Arcade creator',
      },
      tags: ['grid', 'turn-based', 'agents'],
    },
    spec: {
      mode: 'turn-based',
      profiles: [
        'base-v1',
        'turn-based-v1',
        'replay-v1',
        'generic-controls-v1',
        'policy-v1',
      ],
      extensions: [],
      seats: {
        min: 2,
        max: 2,
        roles: [{ id: 'player', title: 'Player', count: 2 }],
        spectators: true,
        lateJoin: false,
      },
      clock: { maxDurationSeconds: 600 },
      schemas: Object.fromEntries(
        [
          'config',
          'publicState',
          'observation',
          'action',
          'event',
          'result',
        ].map((key) => [
          key,
          { uri: `/v1/releases/${releaseId}/schemas/${key}` },
        ]),
      ) as GameManifest['spec']['schemas'],
      runtime: {
        type: 'declarative',
        module: 'grid-placement',
        digest: project.digest,
      },
      presentation: { generic: true, bridge: 'semantic-v1' },
      policy: {
        tiers: ['declarative'],
        maxDecisionsPerSecond: 2,
        memoryKiB: 16,
      },
    },
  }
  m.metadata.digest = await computeManifestDigest(m)
  return m
}
const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  )
/** No remote dependencies or host credentials. Opaque-origin sandbox in every host. */
export function compilePresentation(
  document: GameDocument,
  state?: { board?: readonly (string | null)[] },
  interactive = true,
): string {
  const d = gameDocumentSchema.parse(document)
  const rules = rulesFor(d, 'rel_preview', `sha256:${'0'.repeat(64)}`)
  const board =
    state?.board ?? Array<string | null>(d.boardSize ** 2).fill(null)
  const data = JSON.stringify({
    ...d,
    board,
    lines: rules.winningLines,
    interactive,
  }).replace(/</g, '\\u003c')
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src data:; form-action 'none'; base-uri 'none'"><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:${d.background};color:#292524;font:14px system-ui}main{width:min(80vw,430px);text-align:center;padding:28px 0}h1{font-size:25px;letter-spacing:-.04em;font-weight:500;margin:0 0 8px}p{color:#78716c;line-height:1.6}.board{display:grid;grid-template-columns:repeat(${d.boardSize},1fr);gap:8px;margin:32px 0}button{aspect-ratio:1;border:1px solid #d6d3d1;border-radius:12px;background:#ffffffaa;color:${d.accent};font-size:clamp(18px,6vw,42px);cursor:pointer}button:hover{background:#fff}button:focus-visible{outline:2px solid ${d.accent};outline-offset:3px}button:disabled{cursor:default}#reset{aspect-ratio:auto;font-size:12px;padding:9px 16px}#status{min-height:24px}@media(prefers-reduced-motion:no-preference){button{transition:background .15s}}</style></head><body><main><h1>${escapeHtml(d.title)}</h1><p>${escapeHtml(d.description)}</p><div class="board" role="group" aria-label="Game board">${board.map((mark, i) => `<button data-arcade-node="cell:${i}" aria-label="Cell ${i + 1}${mark ? `, ${escapeHtml(mark)}` : ', empty'}">${escapeHtml(mark ?? '')}</button>`).join('')}</div><p id="status" role="status">${d.winLength} in a row wins</p>${interactive ? '<button id="reset">New game</button>' : ''}</main><script>const d=${data};let board=[...d.board],turn=0,over=false;const buttons=[...document.querySelectorAll('[data-arcade-node]')],status=document.getElementById('status');function draw(){buttons.forEach((b,i)=>{b.textContent=board[i]||'';b.disabled=!d.interactive||over||!!board[i];b.setAttribute('aria-label','Cell '+(i+1)+', '+(board[i]||'empty'))})}buttons.forEach((b,i)=>b.onclick=()=>{if(!d.interactive||over||board[i])return;board[i]=d.marks[turn%2];const won=d.lines.some(l=>l.every(c=>board[c]===board[i]));over=won||board.every(Boolean);status.textContent=won?board[i]+' wins':over?'A draw':d.marks[(++turn)%2]+' to play';draw()});document.getElementById('reset')?.addEventListener('click',()=>{board=board.map(()=>null);turn=0;over=false;status.textContent=d.marks[0]+' to play';draw()});draw();</script></body></html>`
}
