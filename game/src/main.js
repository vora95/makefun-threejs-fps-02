// EMBERLINE — boot and the one loop: a fixed 60 Hz simulation feeding a render at
// the display's rate. This file owns the shooting ray, the damage, the round flow
// and the bot environment; movement lives in player.js, the map in map.js, the
// bot brain in bots.js, the HUD in hud.js.
// ?shot=start|play|buy|end with &seed=N sets up a deterministic frame for a capture,
// renders it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE, TEAMS } from './palette.js';
import { mulberry32 } from './rng.js';
import { createMap } from './map.js';
import { createBody, stepMovement, look, applyRecoil, groundSpeed } from './player.js';
import { createArsenal, WEAPONS, GRENADES, damageAtRange } from './weapons.js';
import { createBot, planRound, stepBot, resetBot, BOT_NAMES } from './bots.js';
import { createGrenades } from './grenades.js';
import { createBomb, PLANT_TIME, DEFUSE_TIME, BOMB_TIMER } from './bomb.js';
import { createHud } from './hud.js';
import { createInput } from './input.js';
import { createState, resetRoundState, ROUND_TIME, FREEZE_TIME, MAX_ROUNDS, WIN_ROUNDS } from './state.js';
import { BUY_MENU, START_MONEY, KILL_REWARD, WIN_REWARD, lossReward, PLANT_REWARD } from './economy.js';
import { clearLine, rayVsBoxes } from './physics.js';
import * as audio from './audio.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '7', 10) || 7;
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
// Dusk gradient sky: dark overhead, an ember band low over the foundry roofs.
{
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 4;
  skyCanvas.height = 256;
  const ctx = skyCanvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#16100b');
  grad.addColorStop(0.42, '#2a1a10');
  grad.addColorStop(0.6, '#7a3d1e');
  grad.addColorStop(0.74, '#4a2413');
  grad.addColorStop(1, '#1c130c');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 4, 256);
  const skyTex = new THREE.CanvasTexture(skyCanvas);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  scene.background = skyTex;
}
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 26, 62);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const map = createMap(scene);
const grenades = createGrenades(scene, map.colliders);
const bomb = createBomb(scene, map.sites);
const hud = createHud();
const state = createState();
const raycaster = new THREE.Raycaster();
raycaster.far = 100;

// --- agents ---
const playerBody = createBody(-2, 13.5, Math.PI);
const playerArsenal = createArsenal(camera);
const player = {
  id: 'you', name: 'You', team: 'vanguard', isPlayer: true,
  body: playerBody, health: 100, armor: 0, alive: true, money: START_MONEY,
  arsenal: playerArsenal, grenades: { frag: 0, smoke: 0 }, mesh: null,
};
const playerHitGroup = new THREE.Group();
const playerTorsoHit = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.8, 0.34), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
playerTorsoHit.position.y = 1.12;
playerTorsoHit.userData.part = 'torso';
playerTorsoHit.userData.agent = player;
const playerHeadHit = new THREE.Mesh(new THREE.SphereGeometry(0.19, 8, 6), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
playerHeadHit.position.y = 1.62;
playerHeadHit.userData.part = 'head';
playerHeadHit.userData.agent = player;
playerHitGroup.add(playerTorsoHit, playerHeadHit);
scene.add(playerHitGroup);

const bots = [];
BOT_NAMES.vanguard.forEach((name, i) => {
  bots.push(createBot(`v${i}`, name, 'vanguard', map.spawns.vanguard[i + 1] || map.spawns.vanguard[0], scene));
});
BOT_NAMES.sentinel.forEach((name, i) => {
  bots.push(createBot(`s${i}`, name, 'sentinel', map.spawns.sentinel[i], scene));
});
state.agents = [player, ...bots];
state.player = player;

const shootables = map.shootables.slice();
for (const bot of bots) shootables.push(bot.torsoHit, bot.headHit);
shootables.push(playerTorsoHit, playerHeadHit);

// Tracers: a small pool of lines, reused, never allocated per shot.
const tracers = [];
for (let i = 0; i < 10; i += 1) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0 }));
  line.frustumCulled = false;
  scene.add(line);
  tracers.push({ line, life: 0 });
}
let tracerIndex = 0;
function spawnTracer(from, to) {
  const tracer = tracers[tracerIndex];
  tracerIndex = (tracerIndex + 1) % tracers.length;
  const pos = tracer.line.geometry.getAttribute('position');
  pos.setXYZ(0, from.x, from.y, from.z);
  pos.setXYZ(1, to.x, to.y, to.z);
  pos.needsUpdate = true;
  tracer.line.material.opacity = 0.85;
  tracer.life = 0.07;
}

const direction = new THREE.Vector3();
const eyePos = new THREE.Vector3();
const muzzlePos = new THREE.Vector3();

function eyeOf(agent) {
  return eyePos.set(agent.body.position.x, agent.body.position.y + agent.body.eye, agent.body.position.z);
}

function inSite(pos) {
  for (const key of Object.keys(map.sites)) {
    const site = map.sites[key];
    if (Math.hypot(pos.x - site.center.x, pos.z - site.center.z) <= site.radius) return key;
  }
  return null;
}

function canSee(a, b) {
  const from = eyeOf(a).clone();
  const to = new THREE.Vector3(b.body.position.x, b.body.position.y + 1.25, b.body.position.z);
  const dist = from.distanceTo(to);
  if (dist > 46) return false;
  // Facing cone: within 100 degrees, or very close.
  const facing = new THREE.Vector3(-Math.sin(a.body.yaw), 0, -Math.cos(a.body.yaw));
  const toDir = to.clone().sub(from).normalize();
  if (dist > 7 && facing.dot(toDir) < 0.12) return false;
  if (grenades.smokeBlocks(from, to)) return false;
  return clearLine(map.colliders, from, to);
}

// --- damage ---
function damageAgent(victim, amount, attacker, cause, fromPos) {
  if (!victim.alive || state.phase !== 'live') return;
  let remaining = amount;
  if (victim.armor > 0) {
    const absorbed = Math.min(victim.armor, Math.round(amount * 0.5));
    victim.armor -= absorbed;
    remaining -= absorbed;
  }
  victim.health -= remaining;
  if (victim.isPlayer) {
    hud.damageFlash();
    audio.playHurt();
  }
  if (victim.health > 0) return;
  victim.health = 0;
  victim.alive = false;
  if (victim.isPlayer) {
    // Death cam: the view stays where the player fell.
  } else {
    victim.mesh.rotation.x = -Math.PI / 2;
    victim.mesh.position.y = 0.25;
  }
  if (bomb.state.status === 'carried' && bomb.state.carrier === victim) {
    bomb.dropAt(victim.body.position);
  }
  const headshot = cause === 'headshot';
  hud.killfeed(attacker ? attacker.name : '—', victim.name, cause === 'frag' ? '💥' : headshot ? '◎' : '—', headshot);
  if (attacker && attacker !== victim) {
    attacker.money += KILL_REWARD;
    if (attacker.isPlayer) audio.playHit(true);
  }
  checkRoundEnd();
}

function aliveCount(team) {
  return state.agents.filter((a) => a.team === team && a.alive).length;
}

function checkRoundEnd() {
  if (state.phase !== 'live') return;
  if (aliveCount('sentinel') === 0) endRound('vanguard', 'Sentinels eliminated');
  else if (aliveCount('vanguard') === 0) endRound('sentinel', 'Vanguard eliminated');
}

// --- shooting ---
function fireHitscan(agent, aimPoint) {
  const def = WEAPONS[agent.arsenal.state.current];
  if (!agent.arsenal.takeRound()) {
    if (agent.isPlayer) audio.playDryFire();
    return;
  }
  const from = eyeOf(agent).clone();
  direction.subVectors(aimPoint, from).normalize();
  const speed = groundSpeed(agent.body);
  let spread = agent.arsenal.spread(speed);
  if (agent.isPlayer && agent.arsenal.state.scoped) spread /= 6;
  direction.x += (random() * 2 - 1) * spread;
  direction.y += (random() * 2 - 1) * spread;
  direction.z += (random() * 2 - 1) * spread;
  direction.normalize();
  scene.updateMatrixWorld(true);
  raycaster.set(from, direction);
  const hits = raycaster.intersectObjects(shootables, false);
  let end = from.clone().addScaledVector(direction, def.range);
  let victim = null;
  let part = null;
  for (const hit of hits) {
    const obj = hit.object;
    if (obj.userData.agent && obj.userData.agent !== agent && obj.userData.agent.alive) {
      victim = obj.userData.agent;
      part = obj.userData.part;
      end = hit.point.clone();
      break;
    }
    if (!obj.userData.agent) {
      end = hit.point.clone();
      break;
    }
  }
  muzzlePos.copy(from).addScaledVector(direction, 0.6);
  muzzlePos.x += Math.cos(agent.body.yaw) * 0.24;
  muzzlePos.z -= Math.sin(agent.body.yaw) * 0.24;
  spawnTracer(muzzlePos, end);
  agent.arsenal.pullTrigger();
  const distToPlayer = from.distanceTo(player.body.position);
  audio.playShot(def.kind, distToPlayer);
  state.noise.push({ pos: from.clone(), radius: 30, at: state.time });
  if (agent.isPlayer) {
    applyRecoil(agent.body, 0.009 + random() * 0.004, (random() * 2 - 1) * 0.004);
  }
  if (victim) {
    const dist = from.distanceTo(end);
    let amount = Math.round(damageAtRange(def, dist) * (part === 'head' ? def.headMult : 1));
    damageAgent(victim, amount, agent, part === 'head' ? 'headshot' : 'shot', from);
    if (agent.isPlayer) hud.hitMarker(victim.health <= 0);
  }
}

// --- rounds ---
function startRound() {
  resetRoundState(state);
  grenades.reset();
  // Positions and gear.
  player.body.position.set(map.spawns.vanguard[0][0], 0, map.spawns.vanguard[0][1]);
  player.body.velocity.set(0, 0, 0);
  player.body.yaw = 0;
  player.body.pitch = 0;
  player.health = 100;
  player.alive = true;
  player.arsenal.refillAmmo();
  // Bought guns stay yours for the match; only the magazines refill.
  bots.forEach((bot, i) => {
    const spawn = bot.team === 'vanguard'
      ? map.spawns.vanguard[(i % 3) + 1]
      : map.spawns.sentinel[(i - 3) % 4];
    resetBot(bot, spawn, random);
  });
  // The charge goes to a random Vanguard — the player included.
  const vanguards = state.agents.filter((a) => a.team === 'vanguard');
  const carrier = vanguards[Math.floor(random() * vanguards.length)];
  bomb.reset(carrier);
  planRound(bots, random, carrier === player ? null : carrier);
  state.phase = 'freeze';
  hud.hideBanner();
  hud.hideBuyMenu();
  hud.setRound(state.round, MAX_ROUNDS);
  hud.setScore(state.score.vanguard, state.score.sentinel);
  hud.setMoney(player.money);
  hud.setHealth(player.health, player.armor);
  hud.setAmmo(player.arsenal.ammo().mag, player.arsenal.ammo().reserve);
  hud.setWeapon(WEAPONS[player.arsenal.state.current].name);
  hud.setGrenades(player.grenades.frag, player.grenades.smoke, null);
  hud.setBombStatus(carrier === player ? 'You carry the Spark Charge — plant it at A or B' : `${carrier.name} carries the Spark Charge`, false);
  hud.setHint('Press B to buy — freeze time ends soon');
}

function endRound(winner, reason) {
  if (state.phase !== 'live' && state.phase !== 'freeze') return;
  state.phase = 'roundEnd';
  state.winner = winner;
  state.roundEndLeft = 4;
  state.score[winner] += 1;
  const loser = winner === 'vanguard' ? 'sentinel' : 'vanguard';
  state.lossStreak[loser] += 1;
  state.lossStreak[winner] = 0;
  for (const agent of state.agents) {
    if (agent.team === winner) agent.money += WIN_REWARD;
    else agent.money += lossReward(state.lossStreak[loser] - 1);
  }
  hud.setScore(state.score.vanguard, state.score.sentinel);
  hud.setMoney(player.money);
  const won = winner === 'vanguard';
  hud.showBanner(won ? 'Vanguard takes the round' : 'Sentinels take the round', `${reason} — ${state.score.vanguard} : ${state.score.sentinel}`);
  audio.playRoundEnd(won);
  if (document.pointerLockElement) document.exitPointerLock();
}

function nextRound() {
  if (state.score.vanguard >= WIN_ROUNDS || state.score.sentinel >= WIN_ROUNDS || state.round >= MAX_ROUNDS) {
    state.phase = 'matchEnd';
    state.matchWinner = state.score.vanguard > state.score.sentinel ? 'vanguard' : state.score.sentinel > state.score.vanguard ? 'sentinel' : 'draw';
    const text = state.matchWinner === 'draw' ? 'The match is a draw.'
      : state.matchWinner === 'vanguard' ? `Vanguard wins the match ${state.score.vanguard} : ${state.score.sentinel}.`
      : `Sentinels win the match ${state.score.vanguard} : ${state.score.sentinel}.`;
    hud.showOverlay('matchEnd', text);
    return;
  }
  state.round += 1;
  startRound();
  hud.showOverlay('next', state.round);
}

// --- input & play ---
const input = createInput(renderer.domElement, onLockChange);
let started = false;
let buyOpen = false;
let grenadeSelected = 'frag';
let stepAcc = 0;

hud.onPlay(() => {
  audio.ensureAudio();
  if (shot) return;
  if (state.phase === 'matchEnd') {
    state.round = 1;
    state.score.vanguard = 0;
    state.score.sentinel = 0;
    state.lossStreak.vanguard = 0;
    state.lossStreak.sentinel = 0;
    player.money = START_MONEY;
    player.grenades.frag = 0;
    player.grenades.smoke = 0;
    playerArsenal.resetLoadout();
    startRound();
    input.requestLock();
    return;
  }
  if (state.phase === 'roundEnd') {
    nextRound();
  }
  input.requestLock();
});

hud.onBuy((index) => {
  buyItem(index);
});

function buyItem(index) {
  const item = BUY_MENU[index];
  if (!item || state.phase !== 'freeze' || player.money < item.price) return;
  if (item.kind === 'weapon') {
    if (player.arsenal.state.owned[item.id]) return;
    player.money -= item.price;
    player.arsenal.buy(item.id);
    player.arsenal.select(item.id);
  } else if (item.kind === 'grenade') {
    const max = GRENADES[item.id].max;
    if (player.grenades[item.id] >= max) return;
    player.money -= item.price;
    player.grenades[item.id] += 1;
  } else if (item.kind === 'armor') {
    if (player.armor >= 100) return;
    player.money -= item.price;
    player.armor = 100;
  }
  audio.playBuy();
  hud.setMoney(player.money);
  hud.setAmmo(player.arsenal.ammo().mag, player.arsenal.ammo().reserve);
  hud.setWeapon(WEAPONS[player.arsenal.state.current].name);
  hud.setGrenades(player.grenades.frag, player.grenades.smoke, grenadeSelected);
  hud.showBuyMenu(BUY_MENU, player.money, new Set(Object.keys(player.arsenal.state.owned)), player.grenades);
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    buyOpen = false;
    hud.hideOverlay();
    hud.hideBuyMenu();
  } else if (state.phase === 'live' || state.phase === 'freeze') {
    if (!buyOpen) hud.showOverlay('paused', 0);
  }
}

function throwPlayerGrenade() {
  const kind = grenadeSelected;
  if (player.grenades[kind] <= 0) return;
  player.grenades[kind] -= 1;
  player.arsenal.holdGrenade(kind);
  const from = eyeOf(player).clone();
  camera.getWorldDirection(direction);
  grenades.throwGrenade(kind, from, direction.clone(), 13);
  audio.playGrenadePin();
  if (kind === 'smoke') audio.playSmokePop();
  player.arsenal.stowGrenade();
  hud.setGrenades(player.grenades.frag, player.grenades.smoke, grenadeSelected);
}

function syncCamera() {
  if (!player.alive) {
    const mate = bots.find((b) => b.team === 'vanguard' && b.alive);
    if (mate) {
      camera.position.set(mate.body.position.x, mate.body.position.y + mate.body.eye, mate.body.position.z);
      camera.rotation.set(mate.body.pitch, mate.body.yaw, 0, 'YXZ');
      return;
    }
  }
  camera.position.set(playerBody.position.x, playerBody.position.y + playerBody.eye, playerBody.position.z);
  camera.rotation.set(playerBody.pitch, playerBody.yaw, 0, 'YXZ');
}

function syncPlayerHitbox() {
  playerHitGroup.position.set(playerBody.position.x, playerBody.position.y, playerBody.position.z);
  playerHitGroup.rotation.y = playerBody.yaw;
}

// --- simulation step ---
function step(dt) {
  state.time += dt;
  state.noise = state.noise.filter((n) => state.time - n.at < 2);

  if (state.phase === 'freeze') {
    state.freezeLeft -= dt;
    if (state.freezeLeft <= 0) {
      state.phase = 'live';
      hud.setHint('');
      hud.hideBuyMenu();
      buyOpen = false;
    }
  } else if (state.phase === 'live') {
    state.timer -= dt;
    if (state.timer <= 0 && bomb.state.status !== 'planted') {
      endRound('sentinel', 'Time expired — the charge was never planted');
    }
  } else if (state.phase === 'roundEnd') {
    state.roundEndLeft -= dt;
    if (state.roundEndLeft <= 0) nextRound();
  }

  if (state.phase === 'live') {
    // Player movement.
    if (player.alive && input.state.locked) {
      const slow = input.state.keys.has('ShiftLeft') || input.state.keys.has('ShiftRight');
      const moved = stepMovement(playerBody, map.colliders, input.state.keys, dt, slow);
      stepAcc += moved;
      if (stepAcc > 2.4 && playerBody.onGround) {
        stepAcc = 0;
        audio.playStep(!slow && groundSpeed(playerBody) > 3);
      }
      playerArsenal.step(dt);
      // Scope.
      const wantScope = input.state.scoping && playerArsenal.state.current === 'sniper' && !playerArsenal.state.holdingGrenade;
      if (wantScope !== playerArsenal.state.scoped) {
        playerArsenal.state.scoped = wantScope;
        camera.fov = wantScope ? 74 / WEAPONS.sniper.zoom : 74;
        camera.updateProjectionMatrix();
        document.getElementById('scope').hidden = !wantScope;
      }
    }

    // Bots.
    const env = {
      agents: state.agents,
      colliders: map.colliders,
      nodes: map.nodes,
      sites: map.sites,
      bomb,
      random,
      time: state.time,
      canSee,
      fireHitscan,
      throwGrenade: (bot, kind, point) => {
        if (bot.grenades[kind] <= 0) return;
        bot.grenades[kind] -= 1;
        const from = new THREE.Vector3(bot.body.position.x, bot.body.position.y + 1.4, bot.body.position.z);
        const dir = point.clone().sub(from).normalize();
        grenades.throwGrenade(kind, from, dir, 12);
      },
      noise: state.noise,
    };
    for (const bot of bots) stepBot(bot, dt, env);

    // Bomb plant / defuse / explosion.
    const event = bomb.step(dt, state.agents, (agent) => {
      if (agent.isPlayer) return input.state.keys.has('KeyE');
      return agent.interacting;
    }, inSite);
    if (event === 'planted') {
      const carrier = bomb.state.carrier;
      if (carrier) carrier.money += PLANT_REWARD;
      hud.setBombStatus('Charge planted — defend it!', true);
      hud.killfeed('—', 'Charge planted', '💣', false);
      if (carrier && carrier.isPlayer) hud.setMoney(player.money);
    } else if (event === 'defused') {
      endRound('sentinel', 'The charge was defused');
    } else if (event === 'exploded') {
      audio.playExplosion();
      // The blast kills everyone near the site.
      for (const agent of state.agents) {
        if (!agent.alive) continue;
        const d = agent.body.position.distanceTo(bomb.state.plantAt);
        if (d < 12 && clearLine(map.colliders, bomb.state.plantAt.clone().setY(0.5), agent.body.position.clone().setY(1.1))) {
          damageAgent(agent, 500, null, 'frag', bomb.state.plantAt);
        }
      }
      endRound('vanguard', 'The charge detonated');
    }
    grenades.step(dt, {
      targets: state.agents,
      damage: (agent, amount, attacker, cause, from) => damageAgent(agent, amount, attacker, cause, from),
    });
  }

  // Tracers fade.
  for (const tracer of tracers) {
    if (tracer.life > 0) {
      tracer.life -= dt;
      tracer.line.material.opacity = Math.max(0, tracer.life / 0.07) * 0.85;
    }
  }

  // HUD.
  hud.setHealth(player.health, player.armor);
  hud.setAmmo(playerArsenal.ammo().mag, playerArsenal.ammo().reserve);
  hud.setMoney(player.money);
  hud.setTimer(state.phase === 'freeze' ? state.freezeLeft : state.phase === 'live' && bomb.state.status === 'planted' ? bomb.state.timer : state.timer);
  hud.setScore(state.score.vanguard, state.score.sentinel);
  hud.setWeapon(playerArsenal.state.holdingGrenade ? GRENADES[playerArsenal.state.holdingGrenade].name : WEAPONS[playerArsenal.state.current].name);
  hud.setGrenades(player.grenades.frag, player.grenades.smoke, grenadeSelected);
  hud.setCrosshairSpread(4 + playerArsenal.spread(groundSpeed(playerBody)) * 900);
  if (bomb.state.status === 'planted') {
    hud.setBombStatus(`Charge planted at ${bomb.state.site} — ${Math.ceil(bomb.state.timer)}s`, true);
  } else if (bomb.state.planting) {
    hud.setBombStatus(`Planting… ${Math.ceil((PLANT_TIME - bomb.state.plantProgress) * 10) / 10}s`, true);
  } else if (bomb.state.defusing) {
    hud.setBombStatus(`Defusing… ${Math.ceil((DEFUSE_TIME - bomb.state.defuseProgress) * 10) / 10}s`, true);
  } else if (bomb.state.status === 'dropped') {
    hud.setBombStatus('Charge dropped — walk over it to pick it up', false);
  }
  // Context hint.
  if (state.phase === 'live' && player.alive) {
    const site = inSite(playerBody.position);
    if (site && bomb.state.status === 'carried' && bomb.state.carrier === player) hud.setHint('Hold E to plant the charge');
    else if (site && bomb.state.status === 'planted' && bomb.state.site === site && player.team === 'sentinel') hud.setHint('Hold E to defuse');
    else if (site && bomb.state.status === 'planted') hud.setHint('');
    else hud.setHint('');
  }
  // Minimap, a few times a second. Enemies show only while the player can see them.
  if (Math.floor(state.time * 4) !== Math.floor((state.time - dt) * 4)) {
    state.seenEnemies.clear();
    for (const bot of bots) {
      if (bot.team !== player.team && bot.alive && canSee(player, bot)) state.seenEnemies.add(bot);
    }
    hud.drawMinimap(map, state.agents, player, state.seenEnemies, bomb);
    hud.setTeamList(state.agents.filter((a) => a.team === 'vanguard'));
  }
}

// --- per-frame input (not fixed step) ---
function handlePressed() {
  const pressed = input.takePressed();
  if (pressed.size === 0) return;
  if (pressed.has('KeyB') && state.phase === 'freeze') {
    if (buyOpen) {
      buyOpen = false;
      hud.hideBuyMenu();
      input.requestLock();
    } else {
      buyOpen = true;
      hud.showBuyMenu(BUY_MENU, player.money, new Set(Object.keys(playerArsenal.state.owned)), player.grenades);
      if (document.pointerLockElement) document.exitPointerLock();
    }
  }
  if (buyOpen) {
    for (let i = 0; i < BUY_MENU.length; i += 1) {
      if (pressed.has(`Digit${i + 1}`)) buyItem(i);
    }
    if (pressed.has('Escape')) {
      buyOpen = false;
      hud.hideBuyMenu();
      input.requestLock();
    }
    return;
  }
  if (!input.state.locked) return;
  if (pressed.has('KeyR')) {
    if (playerArsenal.reload()) audio.playReload();
  }
  if (pressed.has('KeyQ')) {
    grenadeSelected = grenadeSelected === 'frag' ? 'smoke' : 'frag';
    hud.setGrenades(player.grenades.frag, player.grenades.smoke, grenadeSelected);
  }
  if (pressed.has('KeyG')) throwPlayerGrenade();
  if (pressed.has('Digit1')) playerArsenal.select('pistol');
  if (pressed.has('Digit2') && playerArsenal.state.owned.smg) playerArsenal.select('smg');
  if (pressed.has('Digit3') && playerArsenal.state.owned.rifle) playerArsenal.select('rifle');
  if (pressed.has('Digit4') && playerArsenal.state.owned.sniper) playerArsenal.select('sniper');
}

let accumulator = 0;
let lastTime = performance.now();
let frozen = false;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const lookDelta = input.takeLook();
    if (input.state.locked && player.alive) {
      const sens = playerArsenal.state.scoped ? 0.0009 : 0.0022;
      look(playerBody, lookDelta.x, lookDelta.y, sens);
    }
    handlePressed();
    if (input.state.firing && player.alive && state.phase === 'live' && playerArsenal.ready()) {
      camera.getWorldDirection(direction);
      const aim = eyeOf(player).clone().addScaledVector(direction, 30);
      fireHitscan(player, aim);
    } else if (input.state.firing && player.alive && state.phase === 'live' && playerArsenal.state.current && playerArsenal.ammo().mag === 0 && playerArsenal.state.cooldown === 0) {
      audio.playDryFire();
      playerArsenal.state.cooldown = 0.3;
    }
    // The simulation only runs once the player has clicked play (or in shot mode).
    if (started || shot) {
      accumulator += dt;
      let steps = 0;
      while (accumulator >= FIXED_STEP && steps < 5) {
        step(FIXED_STEP);
        accumulator -= FIXED_STEP;
        steps += 1;
      }
      if (accumulator > FIXED_STEP * 5) accumulator = 0;
    }
    syncCamera();
    syncPlayerHitbox();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    syncPlayerHitbox();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function runShot(name) {
  hud.hideOverlay();
  hud.hideBanner();
  startRound();
  state.phase = 'live';
  if (name === 'start') {
    playerBody.position.set(-6, 0, 13.5);
    playerBody.yaw = -0.35;
    playerBody.pitch = 0.02;
    settle(20);
    hud.showOverlay('start', 0);
  } else if (name === 'buy') {
    player.money = 5200;
    hud.setMoney(player.money);
    hud.showBuyMenu(BUY_MENU, player.money, new Set(Object.keys(playerArsenal.state.owned)), player.grenades);
    playerBody.position.set(-6, 0, 13.5);
    playerBody.yaw = -0.35;
    settle(20);
  } else {
    // play / end: the player pushes the west lane toward site A with a teammate,
    // Sentinels holding the lane and the site. Clear sightlines, no furnace in the way.
    playerBody.position.set(-14, 0, 4);
    playerBody.yaw = 0;
    playerBody.pitch = 0;
    const sentinels = bots.filter((b) => b.team === 'sentinel');
    sentinels[0].body.position.set(-14, 0, -2);
    sentinels[1].body.position.set(-12, 0, -8);
    sentinels[2].body.position.set(-10, 0, -8);
    sentinels[3].body.position.set(10, 0, -6);
    bots.filter((b) => b.team === 'vanguard').forEach((b, i) => {
      b.body.position.set(-10 + i * 2, 0, 9 - i * 2);
    });
    settle(30);
    const target = sentinels[2];
    const aim = new THREE.Vector3(target.body.position.x, target.body.position.y + 1.25, target.body.position.z);
    camera.getWorldDirection(direction);
    playerBody.yaw = Math.atan2(-(aim.x - playerBody.position.x), -(aim.z - playerBody.position.z));
    playerBody.pitch = 0.01;
    syncCamera();
    fireHitscan(player, aim);
    settle(6);
    if (name === 'end') {
      // Eliminate the Sentinels for real so their meshes tip over (damageAgent
      // also ends the round when the last one falls).
      for (const bot of sentinels) if (bot.alive) damageAgent(bot, 9999, player, 'elim');
      settle(30);
    }
  }
  hud.setHealth(player.health, player.armor);
  hud.setAmmo(playerArsenal.ammo().mag, playerArsenal.ammo().reserve);
  hud.setScore(state.score.vanguard, state.score.sentinel);
  paintTwiceThenReady();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
if (shot) runShot(shot);
else {
  startRound();
  requestAnimationFrame(frame);
}
