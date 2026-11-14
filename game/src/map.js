// CINDERWORKS — the map. An open-air foundry yard, 40 x 32 m, drawn with boxes only.
// Two bomb sites (A Furnace Hall west, B Crane Yard east), an attacker spawn in the
// south, a defender spawn in the north, a west lane, an east lane and a middle split
// by the furnace block. Waypoints are wired automatically: two nodes link when a
// straight walk between them clears every wall, then bots pathfind with BFS.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { clearPath2D } from './physics.js';

const WALL_H = 4.6;

export const SITES = {
  A: { name: 'Furnace Hall', center: new THREE.Vector3(-14, 0, -10), radius: 4.2 },
  B: { name: 'Crane Yard', center: new THREE.Vector3(14, 0, -10), radius: 4.2 },
};

export const SPAWNS = {
  vanguard: [
    [-6, 13.5], [-2, 13.5], [2, 13.5], [6, 13.5],
  ],
  sentinel: [
    [-14, -13.5], [-5, -13.5], [5, -13.5], [14, -13.5],
  ],
};

// Waypoint nodes: lanes, connectors, site approaches, hold spots and plant spots.
const WAYPOINTS = [
  // attacker spawn + exits
  [-6, 13.5], [0, 13.5], [6, 13.5], [-10, 10], [0, 9], [10, 10],
  // west lane (A)
  [-15, 8], [-16, 2], [-15, -4], [-14, -8],
  // east lane (B)
  [15, 8], [16, 2], [15, -4], [14, -8],
  // middle, split by the furnace block
  [-5, 4], [5, 4], [-5, -3], [5, -3], [-5, -8], [5, -8],
  // cross connectors
  [-11, 4], [11, 4], [-11, -6], [11, -6],
  // sites and hold spots
  [-14, -10], [-10, -11], [-17, -12], [14, -10], [10, -11], [17, -12],
  [-8, -13], [8, -13], [0, -12],
  // defender spawn
  [-5, -13.5], [5, -13.5],
];

export function createMap(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  const defs = {
    floor: { color: PALETTE.floor, roughness: 0.95 },
    floorLine: { color: PALETTE.floorLine, roughness: 0.95 },
    surface: { color: PALETTE.surface, roughness: 0.92 },
    hairline: { color: PALETTE.hairline, roughness: 0.9 },
    steel: { color: PALETTE.steel, roughness: 0.55, metalness: 0.5 },
    rust: { color: PALETTE.rust, roughness: 0.8, metalness: 0.15 },
    crate: { color: PALETTE.crate, roughness: 0.85 },
    containerA: { color: PALETTE.containerA, roughness: 0.7, metalness: 0.2 },
    containerB: { color: PALETTE.containerB, roughness: 0.7, metalness: 0.2 },
    glow: { color: PALETTE.glow, roughness: 0.4, emissive: new THREE.Color(0xff5a00), emissiveIntensity: 1.6 },
    accent: { color: PALETTE.accent, roughness: 0.6 },
  };
  for (const name of Object.keys(defs)) {
    const d = defs[name];
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(d.color),
      roughness: d.roughness,
      metalness: d.metalness ?? 0.03,
      emissive: d.emissive ?? new THREE.Color(0x000000),
      emissiveIntensity: d.emissiveIntensity ?? 1,
    });
  }

  const colliders = [];
  const shootables = [];

  function box(w, h, d, x, y, z, material, solid = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (solid) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }

  // Ground slab and painted lane markings (flat, non-solid).
  box(40.4, 0.4, 32.4, 0, -0.2, 0, 'floor');
  box(0.5, 0.02, 24, -11.5, 0.01, 0, 'floorLine', false);
  box(0.5, 0.02, 24, 11.5, 0.01, 0, 'floorLine', false);
  box(0.5, 0.02, 24, 0, 0.01, 0, 'floorLine', false);
  // Site markings: glowing corner ticks on the floor.
  for (const site of Object.values(SITES)) {
    const { x, z } = site.center;
    box(1.6, 0.03, 0.18, x - 2.4, 0.015, z - 2.4, 'accent', false);
    box(0.18, 0.03, 1.6, x - 2.4, 0.015, z - 2.4, 'accent', false);
    box(1.6, 0.03, 0.18, x + 2.4, 0.015, z + 2.4, 'accent', false);
    box(0.18, 0.03, 1.6, x + 2.4, 0.015, z + 2.4, 'accent', false);
  }

  // Outer walls (south wall leaves the attacker spawn open behind it — spawn is inside).
  box(0.4, WALL_H, 32.4, -20.2, WALL_H / 2, 0, 'surface');
  box(0.4, WALL_H, 32.4, 20.2, WALL_H / 2, 0, 'surface');
  box(40.4, WALL_H, 0.4, 0, WALL_H / 2, -16.2, 'surface');
  box(40.4, WALL_H, 0.4, 0, WALL_H / 2, 16.2, 'surface');

  // The furnace block: the heart of mid, 6 x 4.2 x 4, with a glowing mouth facing south
  // and a chimney. It splits mid into a west and an east passage.
  box(6, 4.2, 4, 0, 2.1, -2, 'rust');
  box(2.2, 1.4, 0.3, 0, 0.9, 0.05, 'glow', false);
  box(1.2, 3.2, 1.2, -1.6, 5.6, -2, 'steel');
  box(1.2, 3.2, 1.2, 1.6, 5.6, -2, 'steel');

  // Mid connector walls: doorways at x = -5 / +5, z = 6 and z = -7.
  box(7, WALL_H, 0.5, -8.5, WALL_H / 2, 6, 'surface');
  box(7, WALL_H, 0.5, 8.5, WALL_H / 2, 6, 'surface');
  box(7, WALL_H, 0.5, -8.5, WALL_H / 2, -7, 'surface');
  box(7, WALL_H, 0.5, 8.5, WALL_H / 2, -7, 'surface');

  // Lane divider walls with gaps (crouch-height crates fill the gaps visually).
  box(0.5, WALL_H, 9, -8, WALL_H / 2, -11.5, 'surface');
  box(0.5, WALL_H, 9, 8, WALL_H / 2, -11.5, 'surface');
  box(0.5, WALL_H, 9, -8, WALL_H / 2, 11.5, 'surface');
  box(0.5, WALL_H, 9, 8, WALL_H / 2, 11.5, 'surface');

  // Containers: the big cover pieces, two stacked at B, one at A.
  box(5.2, 2.4, 2.2, -14, 1.2, -5.5, 'containerA');
  box(5.2, 2.4, 2.2, 14, 1.2, -5.5, 'containerB');
  box(4.4, 2.4, 2.2, 14, 3.6, -5.5, 'containerA');
  box(4.4, 2.4, 2.2, 12, 1.2, 12.5, 'containerB');

  // Crates: low cover to crouch behind, and a few tall stacks for sightlines.
  const crates = [
    [-15.5, 0.55, 4, 1.2, 1.1, 1.2], [-13.8, 0.55, 5.2, 1.2, 1.1, 1.2],
    [15.5, 0.55, 4, 1.2, 1.1, 1.2], [13.8, 0.55, 5.2, 1.2, 1.1, 1.2],
    [-11, 0.55, -1, 1.2, 1.1, 1.2], [11, 0.55, -1, 1.2, 1.1, 1.2],
    [-5, 0.55, 8.5, 1.4, 1.1, 1.4], [5, 0.55, 8.5, 1.4, 1.1, 1.4],
    [-17.5, 1.05, -12.5, 1.6, 2.1, 1.6], [17.5, 1.05, -12.5, 1.6, 2.1, 1.6],
    [-9, 0.55, -12.5, 1.2, 1.1, 1.2], [9, 0.55, -12.5, 1.2, 1.1, 1.2],
    [-3.5, 0.55, -9.5, 1.2, 1.1, 1.2], [3.5, 0.55, -9.5, 1.2, 1.1, 1.2],
  ];
  for (const [x, y, z, w, h, d] of crates) box(w, h, d, x, y, z, 'crate');

  // Barrels (short cylinders, colliders approximated by their bounding box).
  const barrelGeo = new THREE.CylinderGeometry(0.42, 0.42, 1.05, 12);
  for (const [x, z] of [[-18, 6], [-18.9, 6.8], [18, 6], [18.9, 6.8], [-7.5, 0.5], [7.5, 0.5], [-12, -13], [12, -13]]) {
    const barrel = new THREE.Mesh(barrelGeo, materials.rust);
    barrel.position.set(x, 0.53, z);
    barrel.castShadow = true;
    barrel.receiveShadow = true;
    group.add(barrel);
    colliders.push(new THREE.Box3().setFromObject(barrel));
    shootables.push(barrel);
  }

  // The gantry crane over B: two legs and a beam, high enough to walk under.
  box(0.7, 6.5, 0.7, 10.5, 3.25, -10, 'steel');
  box(0.7, 6.5, 0.7, 17.5, 3.25, -10, 'steel');
  box(7.7, 0.7, 0.9, 14, 6.5, -10, 'steel');

  // Light: dusk sun low from the south-west, cool sky fill, and warm point lights
  // over the sites and the furnace mouth.
  const sky = new THREE.HemisphereLight(new THREE.Color(0x9a8a76), new THREE.Color(0x2a211a), 1.5);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color(0xffb36b), 3.5); // raised from 3.2 so the dusk scene reads brighter in screenshots
  sun.position.set(-14, 18, 16);
  sun.target.position.set(2, 0, -6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -26;
  sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 26;
  sun.shadow.camera.bottom = -26;
  sun.shadow.camera.far = 60;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color(0x6b7a8a), 0.9);
  fill.position.set(10, 12, -14);
  scene.add(fill);
  for (const site of Object.values(SITES)) {
    const lamp = new THREE.PointLight(new THREE.Color(0xff8c1a), 14, 12, 1.6);
    lamp.position.set(site.center.x, 3.6, site.center.z);
    scene.add(lamp);
  }
  const furnaceLight = new THREE.PointLight(new THREE.Color(0xff5a00), 22, 10, 1.6);
  furnaceLight.position.set(0, 1.2, 1.2);
  scene.add(furnaceLight);

  // Waypoint graph: link nodes whose straight walk clears the walls.
  const nodes = WAYPOINTS.map(([x, z]) => ({ x, z, links: [] }));
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i];
      const b = nodes[j];
      const dist = Math.hypot(a.x - b.x, a.z - b.z);
      if (dist > 9.5) continue;
      if (!clearPath2D(colliders, a.x, a.z, b.x, b.z)) continue;
      a.links.push(j);
      b.links.push(i);
    }
  }

  return { colliders, shootables, group, nodes, sites: SITES, spawns: SPAWNS };
}

// Breadth-first path on the waypoint graph. Returns node indices from start to goal.
export function findPath(nodes, start, goal) {
  if (start === goal) return [start];
  const prev = new Array(nodes.length).fill(-1);
  const queue = [start];
  prev[start] = start;
  while (queue.length > 0) {
    const current = queue.shift();
    for (const next of nodes[current].links) {
      if (prev[next] !== -1) continue;
      prev[next] = current;
      if (next === goal) {
        const path = [goal];
        let at = goal;
        while (at !== start) {
          at = prev[at];
          path.unshift(at);
        }
        return path;
      }
      queue.push(next);
    }
  }
  return [start, goal];
}

export function nearestNode(nodes, x, z) {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < nodes.length; i += 1) {
    const d = (nodes[i].x - x) ** 2 + (nodes[i].z - z) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}
