import * as THREE from 'three'

/**
 * A deep field of stars distributed through a spherical volume around the
 * origin. Fog is disabled on the material so distant stars stay crisp and read
 * as a background; parallax will come for free once the camera moves (Phase 3).
 */
export function createStarfield(count = 5000, radius = 1200, innerRadius = 80): THREE.Points {
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const color = new THREE.Color()

  for (let i = 0; i < count; i++) {
    // Uniform density through the shell volume (cbrt) so stars don't clump at center.
    const r = innerRadius + (radius - innerRadius) * Math.cbrt(Math.random())
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(2 * Math.random() - 1)
    positions[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta)
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta)
    positions[i * 3 + 2] = r * Math.cos(phi)

    // Mostly white; a minority get a faint blue or warm tint for variety.
    const tinted = Math.random() > 0.85
    const hue = Math.random() > 0.5 ? 0.58 : 0.08 // blue-ish or warm-ish
    const sat = tinted ? 0.25 + Math.random() * 0.3 : Math.random() * 0.08
    const light = 0.7 + Math.random() * 0.3
    color.setHSL(hue, sat, light)
    colors[i * 3 + 0] = color.r
    colors[i * 3 + 1] = color.g
    colors[i * 3 + 2] = color.b
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
  return stars
}
