import { expect, it } from 'vitest'
import { summarizePreviewTelemetry } from './browser-tests.js'
it('counts sampled decision sequences per epoch, deduplicates samples and includes final progress', () => {
  expect(
    summarizePreviewTelemetry([
      { version: 1, epoch: 'a', events: [{ step: 0 }, { step: 20 }] },
      { version: 1, epoch: 'a', events: [{ step: 20 }, { step: 40 }] },
      { version: 1, epoch: 'a', events: [], progress: { decisions: 48 } },
      { version: 1, epoch: 'b', events: [{ step: 0 }, { step: 4 }] },
    ]),
  ).toEqual({ decisions: 53, samples: 5, source: 'client-observed-preview' })
})
