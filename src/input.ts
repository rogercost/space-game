/**
 * Normalized pointer position relative to screen center.
 *   x: -1 (left edge) .. +1 (right edge)
 *   y: -1 (bottom)    .. +1 (top)        [inverted from clientY so up is positive]
 * (0, 0) is dead center => fly straight.
 */
export interface Pointer {
  x: number
  y: number
}

export function createPointer(): { value: Pointer } {
  const value: Pointer = { x: 0, y: 0 }

  const update = (e: PointerEvent): void => {
    value.x = (e.clientX / window.innerWidth) * 2 - 1
    value.y = -((e.clientY / window.innerHeight) * 2 - 1)
  }

  let activeTouchId: number | null = null

  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || activeTouchId !== null) return
    activeTouchId = e.pointerId
    update(e)
  })

  window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch' && e.pointerId !== activeTouchId) return
    update(e)
  })

  const releaseTouch = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch' || e.pointerId !== activeTouchId) return
    activeTouchId = null
    value.x = 0
    value.y = 0
  }

  window.addEventListener('pointerup', releaseTouch)
  window.addEventListener('pointercancel', releaseTouch)

  return { value }
}
