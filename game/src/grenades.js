// Grenades: a thrown frag that bounces, fuses and bursts, and a smoke that blooms
// into a cloud bots and bullets cannot see through. Both are plain physics — gravity,
// a bounce off the collider boxes — plus a small particle set for the smoke.
import * as THREE from 'three';
import { rayVsBoxes, clearLine } from './physics.js';

const GRAVITY = 12;
const FRAG_FUSE = 1.6;
const FRAG_RADIUS = 6.5;
const SMOKE_TIME = 14;
const SMOKE_RADIUS = 4;

export function createGrenades(scene, colliders) {
  const thrown = [];
  const clouds = [];
  const smokeMaterial = new THREE.MeshBasicMaterial({ color: 0x9a938a, transparent: true, opacity: 0.55, depthWrite: false });
  const smokeGeo = new THREE.SphereGeometry(1, 10, 8);
  const flashMaterial = new THREE.MeshBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0.9, depthWrite: false });
  const shellMaterial = new THREE.MeshStandardMaterial({ color: 0x2b211a, roughness: 0.6, metalness: 0.4 });

  function throwGrenade(kind, from, dir, power = 13) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), shellMaterial);
    mesh.position.copy(from);
    scene.add(mesh);
    thrown.push({
      kind,
      mesh,
      pos: from.clone(),
      vel: dir.clone().multiplyScalar(power).add(new THREE.Vector3(0, 3.2, 0)),
      fuse: kind === 'frag' ? FRAG_FUSE : 0.9,
    });
  }

  // The explosion hurts through a clear line only, and less far from the blast.
  function explode(item, damageAgent) {
    const flash = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), flashMaterial.clone());
    flash.position.copy(item.pos);
    flash.scale.setScalar(0.5);
    scene.add(flash);
    let flashLife = 0.25;
    const light = new THREE.PointLight(0xff8c1a, 60, 14, 1.8);
    light.position.copy(item.pos);
    scene.add(light);
    clouds.push({ kind: 'flash', mesh: flash, light, life: flashLife, maxLife: 0.25 });
    for (const agent of damageAgent.targets) {
      if (!agent.alive) continue;
      const to = agent.body.position.clone();
      to.y += 1.1;
      const dist = to.distanceTo(item.pos);
      if (dist > FRAG_RADIUS) continue;
      if (!clearLine(colliders, item.pos, to)) continue;
      const falloff = 1 - (dist / FRAG_RADIUS) * 0.75;
      damageAgent.damage(agent, Math.round(105 * falloff), null, 'frag', item.pos);
    }
  }

  function spawnSmoke(at) {
    const group = new THREE.Group();
    const puffs = [];
    for (let i = 0; i < 16; i += 1) {
      const puff = new THREE.Mesh(smokeGeo, smokeMaterial);
      const angle = (i / 16) * Math.PI * 2;
      const radius = (i % 4) * 0.9;
      puff.position.set(Math.cos(angle) * radius, 0.6 + (i % 3) * 0.7, Math.sin(angle) * radius);
      puff.scale.setScalar(1.1 + (i % 3) * 0.45);
      group.add(puff);
      puffs.push(puff);
    }
    group.position.copy(at);
    scene.add(group);
    clouds.push({ kind: 'smoke', mesh: group, puffs, life: SMOKE_TIME, maxLife: SMOKE_TIME, center: at.clone() });
  }

  // Does a smoke cloud sit between two points? Bots use this to know a sightline
  // is dead; bullets are stopped by it too (a shot into smoke is a wasted shot).
  function smokeBlocks(from, to) {
    for (const cloud of clouds) {
      if (cloud.kind !== 'smoke') continue;
      const c = cloud.center;
      const dir = new THREE.Vector3().subVectors(to, from);
      const len = dir.length();
      if (len < 1e-6) continue;
      dir.multiplyScalar(1 / len);
      const rel = new THREE.Vector3().subVectors(c, from);
      const t = Math.max(0, Math.min(len, rel.dot(dir)));
      const closest = from.clone().addScaledVector(dir, t);
      if (closest.distanceTo(c) < SMOKE_RADIUS * 0.8) return true;
    }
    return false;
  }

  function step(dt, damageAgent) {
    for (let i = thrown.length - 1; i >= 0; i -= 1) {
      const item = thrown[i];
      item.fuse -= dt;
      item.vel.y -= GRAVITY * dt;
      const next = item.pos.clone().addScaledVector(item.vel, dt);
      // Bounce: sample the move against the boxes, axis by axis, and reflect.
      const probe = next.clone();
      const hit = rayVsBoxes(colliders, item.pos, item.vel.clone().normalize(), item.vel.length() * dt + 0.1);
      if (hit) {
        const n = hit.normal;
        const d = item.vel.dot(n);
        item.vel.addScaledVector(n, -2 * d).multiplyScalar(0.55);
        probe.copy(item.pos).addScaledVector(item.vel, dt);
      }
      if (probe.y < 0.09) {
        probe.y = 0.09;
        item.vel.y = Math.abs(item.vel.y) * 0.45;
        item.vel.x *= 0.7;
        item.vel.z *= 0.7;
      }
      item.pos.copy(probe);
      item.mesh.position.copy(item.pos);
      if (item.fuse <= 0) {
        scene.remove(item.mesh);
        thrown.splice(i, 1);
        if (item.kind === 'frag') explode(item, damageAgent);
        else spawnSmoke(item.pos);
      }
    }
    for (let i = clouds.length - 1; i >= 0; i -= 1) {
      const cloud = clouds[i];
      cloud.life -= dt;
      if (cloud.kind === 'flash') {
        const t = cloud.life / cloud.maxLife;
        cloud.mesh.scale.setScalar(0.5 + (1 - t) * 5);
        cloud.mesh.material.opacity = 0.9 * t;
        cloud.light.intensity = 60 * t;
        if (cloud.life <= 0) {
          scene.remove(cloud.mesh);
          scene.remove(cloud.light);
          clouds.splice(i, 1);
        }
      } else {
        const t = cloud.life / cloud.maxLife;
        const fade = t < 0.2 ? t / 0.2 : 1;
        for (const puff of cloud.puffs) {
          puff.material.opacity = 0.55 * fade;
          puff.position.y += dt * 0.12;
          puff.scale.multiplyScalar(1 + dt * 0.03);
        }
        if (cloud.life <= 0) {
          scene.remove(cloud.mesh);
          clouds.splice(i, 1);
        }
      }
    }
  }

  function reset() {
    for (const item of thrown) scene.remove(item.mesh);
    thrown.length = 0;
    for (const cloud of clouds) {
      scene.remove(cloud.mesh);
      if (cloud.light) scene.remove(cloud.light);
    }
    clouds.length = 0;
  }

  return { throwGrenade, step, reset, smokeBlocks };
}
