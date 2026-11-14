// Bots: seven of them, three Vanguard teammates and four Sentinels. Each bot is a
// small state machine — route to an objective, hold a spot, engage what it sees,
// investigate what it hears, plant or defuse — driven through the same movement,
// weapons and damage code as the player. Perception is a sight cone plus a clear
// line; hearing is a gunshot event inside a radius. No bot knows anything the
// player could not see or hear.
import * as THREE from 'three';
import { createBody, stepMovement, look } from './player.js';
import { createArsenal, WEAPONS } from './weapons.js';
import { findPath, nearestNode } from './map.js';
import { pick, shuffle } from './rng.js';

export const BOT_NAMES = {
  vanguard: ['Rook', 'Mira', 'Juno'],
  sentinel: ['Ash', 'Bram', 'Koda', 'Vex'],
};

const REACTION_BASE = 0.42;
const AIM_ERROR_BASE = 0.055;
const SIGHT_RANGE = 46;
const HEAR_RANGE = 26;

function buildBotMesh(team) {
  const group = new THREE.Group();
  const teamColor = team === 'vanguard' ? 0x35c4b5 : 0xe5484d;
  const suit = new THREE.MeshStandardMaterial({ color: 0x2b211a, roughness: 0.8 });
  const vest = new THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.6 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc9a586, roughness: 0.7 });

  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.78, 0.24), suit);
  legs.position.y = 0.39;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.72, 0.3), vest);
  torso.position.y = 1.12;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), skin);
  head.position.y = 1.62;
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.03, 6, 14), new THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.5 }));
  band.position.y = 1.66;
  band.rotation.x = Math.PI / 2;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.62), suit);
  gun.position.set(0.24, 1.25, -0.3);
  group.add(legs, torso, head, band, gun);
  group.traverse((mesh) => {
    if (mesh.isMesh) {
      mesh.castShadow = true;
    }
  });

  // Invisible hitboxes: the raycaster tests these, never the visible meshes.
  // Opacity 0 (not material.visible = false) so the raycaster still hits them.
  const torsoHit = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.8, 0.34), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  torsoHit.position.y = 1.12;
  torsoHit.userData.part = 'torso';
  const headHit = new THREE.Mesh(new THREE.SphereGeometry(0.19, 8, 6), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  headHit.position.y = 1.62;
  headHit.userData.part = 'head';
  group.add(torsoHit, headHit);
  return { group, torsoHit, headHit };
}

export function createBot(id, name, team, spawn, scene) {
  const { group, torsoHit, headHit } = buildBotMesh(team);
  scene.add(group);
  const bot = {
    id,
    name,
    team,
    isPlayer: false,
    body: createBody(spawn[0], spawn[1], team === 'vanguard' ? 0 : Math.PI),
    health: 100,
    armor: 0,
    alive: true,
    money: 800,
    arsenal: createArsenal(null),
    mesh: group,
    torsoHit,
    headHit,
    // AI state
    mode: 'route',
    path: [],
    pathIndex: 0,
    site: null,
    role: 'push',
    target: null,
    lastSeenPos: new THREE.Vector3(),
    lastSeenAt: -99,
    reactionLeft: 0,
    aimTime: 0,
    burstLeft: 0,
    burstPause: 0,
    strafeDir: 0,
    strafeAt: 0,
    holdAt: null,
    holdYaw: 0,
    scanAt: 0,
    skill: 0.5,
    keys: new Set(),
    interacting: false,
    grenades: { frag: 0, smoke: 0 },
    heardAt: -99,
    heardPos: new THREE.Vector3(),
    deathAt: 0,
    stepAcc: 0,
    stepSide: 0,
  };
  torsoHit.userData.agent = bot;
  headHit.userData.agent = bot;
  return bot;
}

// Pick the round's plan: Vanguard split across the sites, Sentinels hold them.
export function planRound(bots, random, bombCarrier) {
  const vanguards = bots.filter((b) => b.team === 'vanguard');
  const sentinels = bots.filter((b) => b.team === 'sentinel');
  const sites = shuffle(random, ['A', 'B']);
  vanguards.forEach((bot, i) => {
    bot.site = i === 0 ? sites[0] : sites[1];
    bot.role = bot === bombCarrier ? 'carry' : 'push';
  });
  sentinels.forEach((bot, i) => {
    bot.site = i < 2 ? 'A' : 'B';
    bot.role = i % 2 === 0 ? 'hold' : 'roam';
  });
}

function routeTo(bot, nodes, tx, tz) {
  const from = nearestNode(nodes, bot.body.position.x, bot.body.position.z);
  const to = nearestNode(nodes, tx, tz);
  bot.path = findPath(nodes, from, to);
  bot.pathIndex = 0;
  bot.mode = 'route';
}

function facePoint(bot, x, z, dt) {
  const dx = x - bot.body.position.x;
  const dz = z - bot.body.position.z;
  const want = Math.atan2(-dx, -dz);
  let diff = want - bot.body.yaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  bot.body.yaw += Math.max(-3.2 * dt, Math.min(3.2 * dt, diff));
  return Math.abs(diff) < 0.15;
}

function moveAlongPath(bot, nodes, colliders, dt, speed = 1) {
  bot.keys.clear();
  if (bot.pathIndex >= bot.path.length) {
    bot.mode = 'hold';
    return true;
  }
  const node = nodes[bot.path[bot.pathIndex]];
  const dx = node.x - bot.body.position.x;
  const dz = node.z - bot.body.position.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.6) {
    bot.pathIndex += 1;
    return bot.pathIndex >= bot.path.length;
  }
  facePoint(bot, node.x, node.z, dt);
  bot.keys.add('KeyW');
  if (speed < 1) bot.keys.add('ShiftLeft');
  stepMovement(bot.body, colliders, bot.keys, dt);
  return false;
}

// One fixed step of one bot. env is the world the bot lives in:
// { agents, colliders, nodes, sites, bomb, random, time, canSee(a, b),
//   fireHitscan(agent, point), throwGrenade(agent, kind, point), noise: [{pos, radius, at}] }
export function stepBot(bot, dt, env) {
  if (!bot.alive) return;
  bot.arsenal.step(dt);
  bot.scanAt -= dt;

  // --- perception, a few times a second ---
  let visible = null;
  if (bot.scanAt <= 0) {
    bot.scanAt = 0.12;
    let bestDist = Infinity;
    for (const other of env.agents) {
      if (other === bot || !other.alive || other.team === bot.team) continue;
      const dist = bot.body.position.distanceTo(other.body.position);
      if (dist > SIGHT_RANGE || dist >= bestDist) continue;
      if (env.canSee(bot, other)) {
        visible = other;
        bestDist = dist;
      }
    }
    if (visible) {
      if (bot.target !== visible) {
        bot.reactionLeft = REACTION_BASE * (0.7 + bot.skill * 0.6);
        bot.aimTime = 0;
      }
      bot.target = visible;
      bot.lastSeenPos.copy(visible.body.position);
      bot.lastSeenAt = env.time;
    } else if (bot.target && env.time - bot.lastSeenAt > 1.6) {
      bot.target = null;
    }
    // Hearing: a recent gunshot nearby pulls the bot toward it.
    for (const event of env.noise) {
      if (env.time - event.at > 1.2) continue;
      const d = bot.body.position.distanceTo(event.pos);
      if (d < HEAR_RANGE && (!bot.target || d < 12)) {
        bot.heardPos.copy(event.pos);
        bot.heardAt = env.time;
      }
    }
  }

  // --- combat: aim, burst, strafe ---
  bot.interacting = false;
  if (bot.target && bot.target.alive) {
    const target = bot.target;
    const tp = target.body.position;
    const aimAt = new THREE.Vector3(tp.x, tp.y + 1.25, tp.z);
    // Lead the aim slightly and add error that shrinks while aiming.
    bot.aimTime += dt;
    const error = Math.max(0.008, AIM_ERROR_BASE * (1 - Math.min(1, bot.aimTime / 0.9)) * (0.6 + bot.skill));
    aimAt.x += (env.random() * 2 - 1) * error * 8;
    aimAt.y += (env.random() * 2 - 1) * error * 4;
    aimAt.z += (env.random() * 2 - 1) * error * 8;
    facePoint(bot, aimAt.x, aimAt.z, dt);
    const dy = aimAt.y - (bot.body.position.y + bot.body.eye);
    const dist = Math.hypot(aimAt.x - bot.body.position.x, aimAt.z - bot.body.position.z);
    bot.body.pitch = Math.max(-1.45, Math.min(1.45, Math.atan2(dy, dist)));

    if (bot.reactionLeft > 0) {
      bot.reactionLeft -= dt;
    } else if (bot.burstPause > 0) {
      bot.burstPause -= dt;
    } else if (bot.arsenal.ready()) {
      if (bot.burstLeft <= 0) bot.burstLeft = 3 + Math.floor(env.random() * 3);
      env.fireHitscan(bot, aimAt);
      bot.burstLeft -= 1;
      if (bot.burstLeft <= 0) bot.burstPause = 0.45 + env.random() * 0.5;
    }
    // Strafe while fighting, changing direction now and then.
    bot.keys.clear();
    if (env.time > bot.strafeAt) {
      bot.strafeDir = pick(env.random, [-1, 0, 1]);
      bot.strafeAt = env.time + 0.5 + env.random() * 0.8;
    }
    if (bot.strafeDir === -1) bot.keys.add('KeyA');
    if (bot.strafeDir === 1) bot.keys.add('KeyD');
    if (env.random() < 0.02) bot.keys.add('ControlLeft');
    stepMovement(bot.body, env.colliders, bot.keys, dt);
    // Reload when the mag runs dry mid-fight.
    if (bot.arsenal.ammo().mag === 0) bot.arsenal.reload();
    syncMesh(bot);
    return;
  }

  // --- bomb behaviours ---
  const bomb = env.bomb;
  if (bomb.state.status === 'planted' && bot.team === 'sentinel') {
    // Rotate to the planted site; the first one there defuses, the rest cover.
    if (bot.mode !== 'defuse' && bot.mode !== 'cover') {
      const site = bomb.state.site;
      routeTo(bot, env.nodes, site.center.x, site.center.z);
      bot.mode = 'defuse';
    }
    if (bot.mode === 'defuse' || bot.mode === 'cover') {
      if (bot.mode === 'cover') {
        // Still on the charge: keep defusing until it is done.
        const site = bomb.state.site;
        const d = Math.hypot(bot.body.position.x - site.center.x, bot.body.position.z - site.center.z);
        if (d < site.radius) {
          bot.interacting = true;
          facePoint(bot, site.center.x, site.center.z, dt);
          syncMesh(bot);
          return;
        }
        bot.mode = 'defuse';
      }
      const arrived = moveAlongPath(bot, env.nodes, env.colliders, dt);
      if (arrived) {
        const site = bomb.state.site;
        const d = Math.hypot(bot.body.position.x - site.center.x, bot.body.position.z - site.center.z);
        if (d < site.radius) {
          bot.interacting = true;
          bot.mode = 'cover';
          facePoint(bot, site.center.x, site.center.z, dt);
        } else {
          routeTo(bot, env.nodes, site.center.x, site.center.z);
        }
      }
      syncMesh(bot);
      return;
    }
  }
  if (bot.team === 'vanguard' && bomb.state.status === 'carried' && bomb.state.carrier === bot) {
    // The carrier plants when the site is clear of visible enemies.
    const site = env.sites[bot.site];
    const d = Math.hypot(bot.body.position.x - site.center.x, bot.body.position.z - site.center.z);
    if (d >= site.radius) {
      if (bot.mode !== 'plant' || bot.path.length === 0) routeTo(bot, env.nodes, site.center.x, site.center.z);
      bot.mode = 'plant';
    } else {
      let enemyNear = false;
      for (const other of env.agents) {
        if (other.team === bot.team || !other.alive) continue;
        if (other.body.position.distanceTo(bot.body.position) < 14) enemyNear = true;
      }
      if (!enemyNear) {
        bot.interacting = true;
        facePoint(bot, site.center.x, site.center.z, dt);
        syncMesh(bot);
        return;
      }
      // Site is hot: hold a corner and wait for the team.
      if (!bot.holdAt) bot.holdAt = { x: site.center.x - 3, z: site.center.z + 2 };
      routeTo(bot, env.nodes, bot.holdAt.x, bot.holdAt.z);
      bot.mode = 'hold';
    }
  }

  // Grenades: a bot that heard a shot lobs a frag at where it heard it.
  if (bot.grenades.frag > 0 && !bot.target && env.time - bot.heardAt < 1.5) {
    if (env.random() < dt * 0.6) {
      env.throwGrenade(bot, 'frag', bot.heardPos.clone().setY(1.2));
    }
  }

  // --- routing / holding ---
  if (bot.mode === 'route' || bot.mode === 'plant' || bot.mode === 'defuse') {
    const arrived = moveAlongPath(bot, env.nodes, env.colliders, dt);
    if (arrived) {
      if (bot.mode === 'plant' && bot.team === 'vanguard') {
        // Reached the site: plant next step (handled above) or hold.
        bot.mode = 'hold';
      } else if (bot.role === 'hold' || bot.role === 'roam') {
        bot.mode = 'hold';
        bot.holdYaw = bot.body.yaw + (env.random() - 0.5) * 1.2;
      } else {
        // Pushers keep moving: pick a new waypoint inside their site.
        const site = env.sites[bot.site];
        const tx = site.center.x + (env.random() * 2 - 1) * 3;
        const tz = site.center.z + (env.random() * 2 - 1) * 3;
        routeTo(bot, env.nodes, tx, tz);
      }
    }
  } else if (bot.mode === 'hold' || bot.mode === 'cover') {
    // Hold the angle, scanning slowly; investigate a heard shot nearby.
    bot.keys.clear();
    const yawTarget = bot.holdYaw ?? bot.body.yaw;
    let diff = yawTarget - bot.body.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    bot.body.yaw += Math.max(-1.1 * dt, Math.min(1.1 * dt, diff));
    if (env.time - bot.heardAt < 2 && bot.role === 'roam') {
      routeTo(bot, env.nodes, bot.heardPos.x, bot.heardPos.z);
      bot.mode = 'route';
    }
  } else {
    // Fresh round with no plan yet: route to the assigned site.
    const site = env.sites[bot.site || 'A'];
    routeTo(bot, env.nodes, site.center.x, site.center.z);
  }

  // Footsteps for nearby bots (quiet, only the closest ones matter).
  bot.stepAcc += Math.hypot(bot.body.velocity.x, bot.body.velocity.z) * dt;
  if (bot.stepAcc > 2.2) {
    bot.stepAcc = 0;
  }
  syncMesh(bot);
}

function syncMesh(bot) {
  const body = bot.body;
  bot.mesh.position.set(body.position.x, body.position.y, body.position.z);
  bot.mesh.rotation.y = body.yaw;
  bot.mesh.visible = bot.alive;
}

export function resetBot(bot, spawn, random) {
  bot.body.position.set(spawn[0], 0, spawn[1]);
  bot.body.velocity.set(0, 0, 0);
  bot.body.yaw = bot.team === 'vanguard' ? 0 : Math.PI;
  bot.body.pitch = 0;
  bot.health = 100;
  bot.armor = 0;
  bot.alive = true;
  bot.mode = 'route';
  bot.path = [];
  bot.pathIndex = 0;
  bot.target = null;
  bot.reactionLeft = 0;
  bot.aimTime = 0;
  bot.burstLeft = 0;
  bot.burstPause = 0;
  bot.interacting = false;
  bot.holdAt = null;
  bot.skill = 0.35 + random() * 0.4;
  bot.mesh.rotation.set(0, bot.body.yaw, 0);
  bot.mesh.visible = true;
  // Bots buy like a player would: a rifle when they can afford it, armour often.
  bot.arsenal = createArsenal(null);
  if (bot.money >= WEAPONS.rifle.price + 300 && random() < 0.7) {
    bot.money -= WEAPONS.rifle.price;
    bot.arsenal.buy('rifle');
    bot.arsenal.select('rifle');
  } else if (bot.money >= WEAPONS.smg.price && random() < 0.6) {
    bot.money -= WEAPONS.smg.price;
    bot.arsenal.buy('smg');
    bot.arsenal.select('smg');
  }
  if (bot.money >= 650 && random() < 0.5) {
    bot.money -= 650;
    bot.armor = 100;
  }
  if (random() < 0.4) bot.grenades.frag = 1;
  if (random() < 0.25) bot.grenades.smoke = 1;
  syncMesh(bot);
}
