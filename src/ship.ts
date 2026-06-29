import * as THREE from 'three'

/**
 * A simple low-poly placeholder ship, built from primitives.
 *
 * Convention: the nose points toward -Z (forward). The camera sits behind the
 * ship at +Z, so we view it from behind — the orientation we'll fly with later.
 */
export function createShip(): THREE.Group {
  const ship = new THREE.Group()
  ship.name = 'ship'

  const hullMat = new THREE.MeshStandardMaterial({
    color: 0x9aa6b2,
    metalness: 0.6,
    roughness: 0.4,
    flatShading: true,
  })
  const accentMat = new THREE.MeshStandardMaterial({
    color: 0x3b4a63,
    metalness: 0.5,
    roughness: 0.5,
    flatShading: true,
  })
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x101820,
    metalness: 0.9,
    roughness: 0.1,
  })
  const glowMat = new THREE.MeshStandardMaterial({
    color: 0x44ccff,
    emissive: 0x33bbff,
    emissiveIntensity: 2.0,
    roughness: 0.3,
  })

  // Fuselage: a cone whose tip (the nose) points toward -Z.
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.8, 12), hullMat)
  body.rotation.x = -Math.PI / 2
  ship.add(body)

  // Wings: a flat box across X, set back toward the tail.
  const wings = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 0.7), accentMat)
  wings.position.z = 0.35
  ship.add(wings)

  // Vertical tail fin.
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.5), accentMat)
  fin.position.set(0, 0.25, 0.55)
  ship.add(fin)

  // Cockpit canopy (a half-dome) near the front.
  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    glassMat,
  )
  canopy.position.set(0, 0.16, -0.1)
  ship.add(canopy)

  // Engine glow at the back (+Z).
  const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.2, 12), glowMat)
  engine.rotation.x = Math.PI / 2
  engine.position.z = 0.9
  ship.add(engine)

  return ship
}
