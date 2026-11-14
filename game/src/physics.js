// Collision and line-of-sight, shared by the player, the bots, the bullets and the
// grenades. Everything is an axis-aligned box; agents move as a vertical capsule
// approximated by a box of half-width RADIUS. No allocations in the hot path: the
// probe box and the ray result are module-level scratch.
import * as THREE from 'three';

export const RADIUS = 0.34;

const probe = new THREE.Box3();
const rayHit = { distance: Infinity, point: new THREE.Vector3(), normal: new THREE.Vector3() };

// Does a body box at (x, y, z) with the given height overlap any collider? lift
// keeps the feet and the crown out of the horizontal tests, so standing on the floor
// is not read as walking into a wall.
export function overlaps(colliders, x, y, z, height, lift = 0) {
  probe.min.set(x - RADIUS, y + lift, z - RADIUS);
  probe.max.set(x + RADIUS, y + height - lift, z + RADIUS);
  for (let i = 0; i < colliders.length; i += 1) {
    if (probe.intersectsBox(colliders[i])) return colliders[i];
  }
  return null;
}

// Move a body one fixed step, resolving one axis at a time so a wall never swallows
// it. body has position (Vector3, feet), velocity (Vector3), height, onGround.
export function moveBody(colliders, body, dt) {
  const nextX = body.position.x + body.velocity.x * dt;
  if (!overlaps(colliders, nextX, body.position.y, body.position.z, body.height, 0.04)) {
    body.position.x = nextX;
  } else {
    body.velocity.x = 0;
  }
  const nextZ = body.position.z + body.velocity.z * dt;
  if (!overlaps(colliders, body.position.x, body.position.y, nextZ, body.height, 0.04)) {
    body.position.z = nextZ;
  } else {
    body.velocity.z = 0;
  }
  body.position.y += body.velocity.y * dt;
  body.onGround = false;
  const hit = overlaps(colliders, body.position.x, body.position.y, body.position.z, body.height, 0);
  if (hit && body.velocity.y <= 0) {
    body.position.y = hit.max.y;
    body.velocity.y = 0;
    body.onGround = true;
  } else if (hit) {
    body.position.y = hit.min.y - body.height;
    body.velocity.y = 0;
  }
  if (body.position.y < 0) {
    body.position.y = 0;
    body.velocity.y = 0;
    body.onGround = true;
  }
  if (body.velocity.y < -30) body.velocity.y = -30;
}

// Ray against the collider boxes (slab test). Returns the nearest hit within maxDist
// or null. Scratch fields are reused; copy the result if it must survive a call.
export function rayVsBoxes(colliders, origin, dir, maxDist) {
  let best = Infinity;
  let bestBox = null;
  let bestT = 0;
  for (let i = 0; i < colliders.length; i += 1) {
    const box = colliders[i];
    let tmin = 0;
    let tmax = maxDist;
    let axis = -1;
    let sign = 0;
    // X slab
    let inv = 1 / (dir.x === 0 ? 1e-9 : dir.x);
    let t1 = (box.min.x - origin.x) * inv;
    let t2 = (box.max.x - origin.x) * inv;
    let s = -1;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = 0; sign = s; }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) continue;
    // Y slab
    inv = 1 / (dir.y === 0 ? 1e-9 : dir.y);
    t1 = (box.min.y - origin.y) * inv;
    t2 = (box.max.y - origin.y) * inv;
    s = -1;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = 1; sign = s; }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) continue;
    // Z slab
    inv = 1 / (dir.z === 0 ? 1e-9 : dir.z);
    t1 = (box.min.z - origin.z) * inv;
    t2 = (box.max.z - origin.z) * inv;
    s = -1;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = 2; sign = s; }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) continue;
    if (tmin < best) {
      best = tmin;
      bestBox = box;
      bestT = tmin;
      rayHit.normal.set(0, 0, 0);
      if (axis === 0) rayHit.normal.x = sign;
      else if (axis === 1) rayHit.normal.y = sign;
      else rayHit.normal.z = sign;
    }
  }
  if (!bestBox) return null;
  rayHit.distance = best;
  rayHit.point.copy(origin).addScaledVector(dir, bestT);
  return rayHit;
}

// Is the straight line between two points clear of walls? Used for bot sight and for
// checking whether an explosion reaches a body.
export function clearLine(colliders, from, to) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const dist = dir.length();
  if (dist < 1e-6) return true;
  dir.multiplyScalar(1 / dist);
  return rayVsBoxes(colliders, from, dir, dist - 0.05) === null;
}

// 2D segment (y ignored) against the collider footprints: does a straight walk between
// two ground points cross a wall? Used when auto-wiring the waypoint graph.
export function clearPath2D(colliders, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return true;
  const steps = Math.ceil(len / 0.4);
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    const x = ax + dx * t;
    const z = az + dz * t;
    probe.min.set(x - RADIUS - 0.05, 0.4, z - RADIUS - 0.05);
    probe.max.set(x + RADIUS + 0.05, 1.6, z + RADIUS + 0.05);
    for (let j = 0; j < colliders.length; j += 1) {
      if (probe.intersectsBox(colliders[j])) return false;
    }
  }
  return true;
}
