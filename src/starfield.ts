import * as THREE from 'three'

/** Half-extent of the cube the stars live in (and wrap within). */
export const STAR_HALF = 700

/**
 * A deep field of stars filling a cube around the origin. Fog is disabled on the
 * material so distant stars stay crisp and read as a background; parallax comes
 * for free as the camera moves. Use `updateStarfield` to keep the cube centered
 * on the ship so the field is effectively infinite.
 */
export function createStarfield(count = 6000, half = STAR_HALF, inner = 60): THREE.Points {
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const color = new THREE.Color()

  let i = 0
  while (i < count) {
    const x = (Math.random() * 2 - 1) * half
    const y = (Math.random() * 2 - 1) * half
    const z = (Math.random() * 2 - 1) * half
    // Keep a clear bubble immediately around the ship.
    if (x * x + y * y + z * z < inner * inner) continue

    positions[i * 3 + 0] = x
    positions[i * 3 + 1] = y
    positions[i * 3 + 2] = z

    // Mostly white; a minority get a faint blue or warm tint for variety.
    const tinted = Math.random() > 0.85
    const hue = Math.random() > 0.5 ? 0.58 : 0.08
    const sat = tinted ? 0.25 + Math.random() * 0.3 : Math.random() * 0.08
    const light = 0.7 + Math.random() * 0.3
    color.setHSL(hue, sat, light)
    colors[i * 3 + 0] = color.r
    colors[i * 3 + 1] = color.g
    colors[i * 3 + 2] = color.b

    i++
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))

  const material = new THREE.PointsMaterial({
    size: 2.0,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    fog: false,
  })

  const stars = new THREE.Points(geometry, material)
  stars.name = 'starfield'
  stars.frustumCulled = false
  return stars
}

/**
 * Wrap each star into the cube [center ± half] so the field always surrounds the
 * ship. A star only jumps when it crosses a face (far behind/ahead of the ship,
 * masked by distance), so nearby stars stay world-fixed and parallax correctly.
 */
export function updateStarfield(
  stars: THREE.Points,
  center: THREE.Vector3,
  half = STAR_HALF,
): void {
  const attr = stars.geometry.getAttribute('position') as THREE.BufferAttribute
  const a = attr.array as Float32Array
  const span = half * 2
  const { x: cx, y: cy, z: cz } = center

  for (let i = 0; i < a.length; i += 3) {
    if (a[i] - cx > half) a[i] -= span
    else if (a[i] - cx < -half) a[i] += span
    if (a[i + 1] - cy > half) a[i + 1] -= span
    else if (a[i + 1] - cy < -half) a[i + 1] += span
    if (a[i + 2] - cz > half) a[i + 2] -= span
    else if (a[i + 2] - cz < -half) a[i + 2] += span
  }
  attr.needsUpdate = true
}
