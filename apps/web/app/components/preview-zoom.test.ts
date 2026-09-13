import { describe, expect, it } from 'vitest'
import { ZOOM_MAX, ZOOM_MIN, fitStage, stepZoom } from './preview-zoom'

describe('fitStage', () => {
  it('fits a 16:9 stage to the viewport width when the viewport is tall', () => {
    expect(fitStage({ width: 800, height: 900 })).toEqual({
      width: 800,
      height: 450,
    })
  })
  it('fits to the viewport height when the viewport is wide', () => {
    expect(fitStage({ width: 1600, height: 450 })).toEqual({
      width: 800,
      height: 450,
    })
  })
})

describe('stepZoom', () => {
  it('steps in tenths without floating-point drift', () => {
    let zoom = 1
    for (let i = 0; i < 3; i++) zoom = stepZoom(zoom, 1)
    expect(zoom).toBe(1.3)
  })
  it('clamps at the limits', () => {
    expect(stepZoom(ZOOM_MAX, 1)).toBe(ZOOM_MAX)
    expect(stepZoom(ZOOM_MIN, -1)).toBe(ZOOM_MIN)
  })
})
