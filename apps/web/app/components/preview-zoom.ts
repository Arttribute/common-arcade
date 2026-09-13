'use client'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react'

export const ZOOM_MIN = 0.5
export const ZOOM_MAX = 2
const ZOOM_STEP = 0.1
const STAGE_ASPECT = 16 / 9

type Box = { width: number; height: number }

/** The largest 16:9 box that fits inside the viewport — the 100% size. */
export function fitStage(viewport: Box, aspect = STAGE_ASPECT): Box {
  const width = Math.max(0, Math.min(viewport.width, viewport.height * aspect))
  return { width, height: width / aspect }
}

/** One zoom step in, or out, clamped and rounded so labels stay whole. */
export function stepZoom(zoom: number, direction: 1 | -1) {
  const next = Math.round((zoom + direction * ZOOM_STEP) * 10) / 10
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next))
}

/**
 * Zoom for the studio's game preview. The frame is sized in real pixels
 * (fit-to-viewport × zoom) inside a scrolling viewport, so zooming in
 * genuinely enlarges the game and the viewport scrolls around it. The point
 * at the centre of the view stays centred across zoom steps.
 */
export function usePreviewZoom() {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null)
  const [box, setBox] = useState<Box | null>(null)
  const [zoom, setZoomValue] = useState(1)
  const anchor = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!viewport) return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const { width, height } = entry.contentRect
      setBox((previous) =>
        previous?.width === width && previous.height === height
          ? previous
          : { width, height },
      )
    })
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [viewport])

  const changeZoom = useCallback(
    (next: (zoom: number) => number) => {
      if (viewport)
        anchor.current = {
          x:
            (viewport.scrollLeft + viewport.clientWidth / 2) /
            Math.max(1, viewport.scrollWidth),
          y:
            (viewport.scrollTop + viewport.clientHeight / 2) /
            Math.max(1, viewport.scrollHeight),
        }
      setZoomValue(next)
    },
    [viewport],
  )

  useLayoutEffect(() => {
    const point = anchor.current
    anchor.current = null
    if (!point || !viewport) return
    viewport.scrollLeft =
      point.x * viewport.scrollWidth - viewport.clientWidth / 2
    viewport.scrollTop =
      point.y * viewport.scrollHeight - viewport.clientHeight / 2
  }, [zoom, viewport])

  const fit = box ? fitStage(box) : null
  const frameStyle: CSSProperties = fit
    ? { width: fit.width * zoom, height: fit.height * zoom }
    : { width: '100%', aspectRatio: '16 / 9' }

  return {
    zoom,
    zoomIn: () => changeZoom((z) => stepZoom(z, 1)),
    zoomOut: () => changeZoom((z) => stepZoom(z, -1)),
    resetZoom: () => changeZoom(() => 1),
    viewportRef: setViewport,
    frameStyle,
  }
}
