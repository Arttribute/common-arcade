import { compileBrowserPresentation } from './browser.js'
import type { GridPlacementRuleSet } from '@common-arcade/match-runtime'
import { computeManifestDigest } from '@common-arcade/manifest'
import {
  ARCADE_API_VERSION,
  gameManifestSchema,
  type GameManifest,
} from '@common-arcade/protocol'

export {
  gameDocumentSchema,
  starterDocument,
  exampleDocument,
  emptyBrowserDocument,
  defaultGameDistribution,
  isBrowserGame,
  isManagedBrowserGame,
} from '@common-arcade/protocol'
export type {
  GameDocument,
  BrowserGameDocument,
  StudioProject,
  StudioRelease,
  StudioAnnotation,
} from '@common-arcade/protocol'
import {
  gameDocumentSchema,
  isBrowserGame,
  isManagedBrowserGame,
  type GameDocument,
  type StudioProject,
} from '@common-arcade/protocol'

export interface LiveReadinessReport {
  readonly liveReady: boolean
  readonly classification: 'arcade-managed' | 'preview-only'
  readonly runtimeModule:
    'sandboxed-script-v1' | 'grid-placement' | 'browser-presentation'
  readonly checks: readonly string[]
  readonly blockers: readonly string[]
}

/**
 * A release is live-ready only when Arcade can recreate its authoritative
 * runtime from the immutable document. Browser bridges are useful for private
 * testing, but never become match authority merely by declaring a capability.
 */
export function assessLiveReadiness(
  document: GameDocument,
): LiveReadinessReport {
  const parsed = gameDocumentSchema.parse(document)
  if (isManagedBrowserGame(parsed))
    return {
      liveReady: true,
      classification: 'arcade-managed',
      runtimeModule: 'sandboxed-script-v1',
      checks: [
        'isolated WebAssembly sandbox',
        'bounded memory and execution time',
        'no ambient network, filesystem, process, clock, or randomness',
        'server-side action validation',
        'authoritative fixed-tick support',
        'deterministic replay',
        'seat observations',
        'custom 2D/3D presentation bridge',
      ],
      blockers: [],
    }
  if (!isBrowserGame(parsed))
    return {
      liveReady: true,
      classification: 'arcade-managed',
      runtimeModule: 'grid-placement',
      checks: [
        'immutable authoritative rules',
        'server-side action validation',
        'deterministic replay',
        'seat observations',
      ],
      blockers: [],
    }
  const requestedAuthority = parsed.capabilities?.world.authority
  return {
    liveReady: false,
    classification: 'preview-only',
    runtimeModule: 'browser-presentation',
    checks: ['sandbox presentation', 'agent play bridge'],
    blockers: [
      requestedAuthority === 'external-conformant-host'
        ? 'The declared external host has not supplied a conformant live adapter for this release.'
        : requestedAuthority === 'arcade-managed'
          ? 'Arcade-managed authority was requested, but this project contains only browser presentation source.'
          : 'Browser presentation source is not an authoritative match runtime.',
      'Move rules, time, state transitions, results, and observations into a supported managed runtime or conformant external host.',
    ],
  }
}

export function rulesFor(
  document: GameDocument,
  releaseId: string,
  digest: string,
): GridPlacementRuleSet {
  const d = gameDocumentSchema.parse(document)
  if (isBrowserGame(d))
    throw new Error(
      'Browser projects run in an isolated browser. This release does not provide an authoritative grid runtime.',
    )
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
  project = { ...project, document: gameDocumentSchema.parse(project.document) }
  const capabilities = isBrowserGame(project.document)
    ? project.document.capabilities
    : undefined
  const capabilityTags = capabilities
    ? [
        ...capabilities.genres,
        capabilities.presentation.dimension,
        capabilities.teams.enabled ? 'teams' : undefined,
        capabilities.world.persistence !== 'session'
          ? capabilities.world.persistence
          : undefined,
        capabilities.economy.payments === 'integration-ready'
          ? 'payments-ready'
          : undefined,
      ].filter((tag): tag is string => Boolean(tag))
    : []
  const extensions = capabilities
    ? [
        {
          id: 'https://arcade.agentcommons.io/extensions/world/v1',
          required: false,
          config: capabilities.world,
        },
        {
          id: 'https://arcade.agentcommons.io/extensions/presentation/v1',
          required: false,
          config: capabilities.presentation,
        },
        ...(capabilities.teams.enabled
          ? [
              {
                id: 'https://arcade.agentcommons.io/extensions/teams/v1',
                required: false,
                config: capabilities.teams,
              },
            ]
          : []),
        ...(capabilities.economy.payments === 'integration-ready'
          ? [
              {
                id: 'https://arcade.agentcommons.io/extensions/economy/v1',
                required: false,
                config: capabilities.economy,
              },
            ]
          : []),
      ]
    : []
  const m: GameManifest = {
    apiVersion: ARCADE_API_VERSION,
    kind: 'Game',
    metadata: {
      id: project.id.replace(/^prj_/, 'gam_'),
      namespace: 'io.agentcommons.arcade.creators',
      slug: project.id.replaceAll('_', '-').toLowerCase(),
      version: `0.1.${project.revision}`,
      digest: `sha256:${'0'.repeat(64)}`,
      title: project.document.title,
      summary: project.document.description.trim() || project.document.title,
      publisher: {
        id: `pub_${project.ownerId.replace(/[^a-zA-Z0-9_]/g, '_')}`,
        name: 'Arcade creator',
      },
      tags: isBrowserGame(project.document)
        ? [...new Set(['browser', 'interactive', 'agents', ...capabilityTags])]
        : ['grid', 'turn-based', 'agents'],
    },
    spec: {
      mode: isBrowserGame(project.document)
        ? (project.document.play?.mode ?? 'turn-based')
        : 'turn-based',
      profiles: isManagedBrowserGame(project.document)
        ? [
            'base-v1',
            ...(project.document.play?.mode === 'turn-based'
              ? (['turn-based-v1'] as const)
              : project.document.play?.mode === 'simultaneous'
                ? (['simultaneous-v1'] as const)
                : ['realtime', 'hybrid'].includes(
                      project.document.play?.mode ?? '',
                    )
                  ? (['realtime-authoritative-v1'] as const)
                  : []),
            'replay-v1',
            'generic-controls-v1',
            'policy-v1',
            'semantic-presentation-v1',
          ]
        : isBrowserGame(project.document)
          ? ['base-v1']
          : [
              'base-v1',
              'turn-based-v1',
              'replay-v1',
              'generic-controls-v1',
              'policy-v1',
            ],
      extensions,
      seats: {
        min: isBrowserGame(project.document)
          ? (project.document.play?.seats.min ?? 1)
          : 2,
        max: isBrowserGame(project.document)
          ? (project.document.play?.seats.max ?? 2)
          : 2,
        roles: (isBrowserGame(project.document)
          ? project.document.play?.roles
          : undefined) ?? [
          {
            id: 'player',
            title: 'Player',
            count: isBrowserGame(project.document)
              ? (project.document.play?.seats.default ?? 2)
              : 2,
          },
        ],
        spectators: isBrowserGame(project.document)
          ? (project.document.play?.spectators ?? true)
          : true,
        lateJoin: isBrowserGame(project.document)
          ? (project.document.play?.lateJoin ?? false)
          : false,
      },
      clock: {
        ...(isManagedBrowserGame(project.document) &&
        ['realtime', 'hybrid'].includes(project.document.play?.mode ?? '')
          ? {
              simulationHz: project.document.runtime.tickRate,
              networkHz: Math.min(20, project.document.runtime.tickRate),
            }
          : {}),
        maxDurationSeconds: isBrowserGame(project.document)
          ? (project.document.play?.maxDurationSeconds ?? 600)
          : 600,
      },
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
        module: isManagedBrowserGame(project.document)
          ? 'sandboxed-script-v1'
          : isBrowserGame(project.document)
            ? 'browser-presentation'
            : 'grid-placement',
        digest: project.digest,
      },
      presentation: { generic: true, bridge: 'semantic-v1' },
      policy: {
        tiers: ['declarative'],
        maxDecisionsPerSecond: isBrowserGame(project.document)
          ? (project.document.play?.maxDecisionsPerSecond ?? 2)
          : 2,
        memoryKiB: 16,
      },
    },
  }
  const validated = gameManifestSchema.parse(m)
  validated.metadata.digest = await computeManifestDigest(validated)
  return validated
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
  if (isBrowserGame(d)) return compileBrowserPresentation(d)
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
