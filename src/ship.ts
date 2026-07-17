import * as THREE from 'three'

/**
 * A low-poly fighter jet, built from primitives: a pointed nose cone, a tapered
 * fuselage, swept delta wings, a vertical tail fin, a canopy, and a recessed engine.
 *
 * Convention: the nose points toward -Z (forward). The camera sits behind the
 * ship at +Z, so we view it from behind — the orientation we fly with.
 *
 * The returned nozzle anchor is the exhaust system's source of truth for both its
 * world position and aft direction. Keeping that attachment point in the model
 * avoids duplicating engine dimensions in the flight/rendering code.
 */
export interface ShipModel {
  object: THREE.Group
  engineNozzle: THREE.Object3D
  engineOpeningRadius: number
  flashMaterials: THREE.MeshStandardMaterial[]
}

const ENGINE_OPENING_RADIUS = 0.14
const ENGINE_OUTER_FRONT_RADIUS = 0.21
const ENGINE_OUTER_REAR_RADIUS = 0.18
const ENGINE_FRONT_Z = 1.34
const ENGINE_REAR_Z = 1.68

export function createShip(): ShipModel {
  const ship = new THREE.Group()
  ship.name = 'ship'

  // hull + accent are DoubleSide so the flat-triangle wings/fin light from both
  // sides (and so a single shared material per part still flashes as one unit).
  const hullMat = new THREE.MeshStandardMaterial({
    color: 0x9aa6b2,
    metalness: 0.6,
    roughness: 0.4,
    flatShading: true,
    side: THREE.DoubleSide,
  })
  const accentMat = new THREE.MeshStandardMaterial({
    color: 0x3b4a63,
    metalness: 0.5,
    roughness: 0.5,
    flatShading: true,
    side: THREE.DoubleSide,
  })
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x101820,
    metalness: 0.9,
    roughness: 0.1,
  })
  const engineMat = new THREE.MeshStandardMaterial({
    color: 0xff7a1a,
    metalness: 0.05,
    roughness: 0.8,
    side: THREE.DoubleSide,
  })

  // Pointed nose: a long cone whose tip (the nose) points toward -Z.
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.26, 1.7, 10), hullMat)
  nose.rotation.x = -Math.PI / 2
  nose.position.z = -0.55 // tip ~ z=-1.4, base ~ z=+0.3
  ship.add(nose)

  // Tapered fuselage behind the nose, narrowing toward the tail.
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.14, 1.5, 10), hullMat)
  body.rotation.x = -Math.PI / 2
  body.position.z = 0.75 // spans ~ z=0.0 .. 1.5
  ship.add(body)

  // Swept delta wings — flat triangles with a slight tip droop (anhedral).
  const rootFore: Vec = [0.13, 0, -0.1]
  const rootAft: Vec = [0.13, 0, 1.05]
  const tip: Vec = [1.5, -0.06, 0.92]
  ship.add(triangle(rootFore, rootAft, tip, hullMat)) // right
  ship.add(triangle(mirrorX(rootFore), mirrorX(rootAft), mirrorX(tip), hullMat)) // left

  // Vertical tail fin (a delta in the X=0 plane, near the tail).
  ship.add(triangle([0, 0.12, 0.85], [0, 0.12, 1.45], [0, 0.7, 1.4], accentMat))

  // Cockpit canopy: a half-dome near the front.
  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    glassMat,
  )
  canopy.scale.z = 1.6
  canopy.position.set(0, 0.16, -0.15)
  ship.add(canopy)

  // Gray, open-ended cowling around a recessed orange inner sleeve and back plate.
  // Nothing here is emissive or on the bloom layer: the orange reads as a hot-painted
  // engine interior under the scene lights, not as a second light source.
  const engineLength = ENGINE_REAR_Z - ENGINE_FRONT_Z
  const cowling = new THREE.Mesh(
    new THREE.CylinderGeometry(
      ENGINE_OUTER_REAR_RADIUS,
      ENGINE_OUTER_FRONT_RADIUS,
      engineLength,
      12,
      1,
      true,
    ),
    hullMat,
  )
  cowling.rotation.x = Math.PI / 2
  cowling.position.z = (ENGINE_FRONT_Z + ENGINE_REAR_Z) / 2
  ship.add(cowling)

  const lip = new THREE.Mesh(
    new THREE.RingGeometry(ENGINE_OPENING_RADIUS, ENGINE_OUTER_REAR_RADIUS, 12),
    hullMat,
  )
  lip.position.z = ENGINE_REAR_Z
  ship.add(lip)

  const innerDepth = 0.16
  const inner = new THREE.Mesh(
    new THREE.CylinderGeometry(
      ENGINE_OPENING_RADIUS,
      ENGINE_OPENING_RADIUS,
      innerDepth,
      12,
      1,
      true,
    ),
    engineMat,
  )
  inner.rotation.x = Math.PI / 2
  inner.position.z = ENGINE_REAR_Z - innerDepth / 2 - 0.01
  ship.add(inner)

  const backPlate = new THREE.Mesh(
    new THREE.CircleGeometry(ENGINE_OPENING_RADIUS, 12),
    engineMat,
  )
  backPlate.position.z = ENGINE_REAR_Z - innerDepth - 0.01
  ship.add(backPlate)

  // Local +Z is aft for this model. Object3D.getWorldDirection() therefore gives
  // the direction in which exhaust should initially travel.
  const engineNozzle = new THREE.Object3D()
  engineNozzle.name = 'engine-nozzle'
  engineNozzle.position.z = ENGINE_REAR_Z + 0.01
  ship.add(engineNozzle)

  return {
    object: ship,
    engineNozzle,
    engineOpeningRadius: ENGINE_OPENING_RADIUS,
    flashMaterials: [hullMat, accentMat],
  }
}

type Vec = [number, number, number]

/** A single flat triangle mesh (face-normal flat shading); `mat` is shared (DoubleSide). */
function triangle(a: Vec, b: Vec, c: Vec, mat: THREE.MeshStandardMaterial): THREE.Mesh {
  const geom = new THREE.BufferGeometry()
  geom.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array([...a, ...b, ...c]), 3),
  )
  geom.computeVertexNormals()
  return new THREE.Mesh(geom, mat)
}

/** Mirror a point across the x=0 plane, to make the left wing a true mirror of the right. */
function mirrorX(v: Vec): Vec {
  return [-v[0], v[1], v[2]]
}
