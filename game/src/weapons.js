// Weapons: four guns, two grenades, armour. Each gun owns its numbers — damage,
// headshot multiplier, magazine, fire rate, spread standing still vs on the move,
// price and the kind of sound it makes. The view model is boxes on the camera; the
// simulation (main.js) owns the ray and the damage.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'Kestrel P9', kind: 'pistol', price: 0,
    damage: 26, headMult: 4, mag: 12, reserve: 48, rate: 0.16, auto: false,
    reloadTime: 1.25, spreadStill: 0.004, spreadMove: 0.03, range: 40, zoom: 1,
  },
  smg: {
    id: 'smg', name: 'Hornet-9', kind: 'smg', price: 1200,
    damage: 22, headMult: 3, mag: 28, reserve: 112, rate: 0.075, auto: true,
    reloadTime: 1.7, spreadStill: 0.009, spreadMove: 0.05, range: 34, zoom: 1,
  },
  rifle: {
    id: 'rifle', name: 'Longbow-7', kind: 'rifle', price: 2700,
    damage: 33, headMult: 4, mag: 25, reserve: 75, rate: 0.11, auto: true,
    reloadTime: 2.1, spreadStill: 0.003, spreadMove: 0.034, range: 60, zoom: 1,
  },
  sniper: {
    id: 'sniper', name: 'Falcon-50', kind: 'sniper', price: 4750,
    damage: 95, headMult: 4, mag: 5, reserve: 15, rate: 1.15, auto: false,
    reloadTime: 2.8, spreadStill: 0.0006, spreadMove: 0.06, range: 90, zoom: 2.4,
  },
};

export const GRENADES = {
  frag: { id: 'frag', name: 'Ember frag', price: 300, max: 2 },
  smoke: { id: 'smoke', name: 'Veil smoke', price: 300, max: 1 },
};

export const ARMOR_PRICE = 650;
export const ARMOR_MAX = 100;

// Damage falls off past half range, down to 55% at full range.
export function damageAtRange(def, distance) {
  const half = def.range * 0.5;
  if (distance <= half) return def.damage;
  const t = Math.min(1, (distance - half) / half);
  return def.damage * (1 - 0.45 * t);
}

const GRIP = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
const BODY = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
const DARK = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.6, metalness: 0.4 });
const FLASH_MAT = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });

// Build the first-person view model for one weapon kind. Returns the group; the
// caller positions it on the camera and calls step() for kick/reload animation.
function buildViewModel(kind) {
  const model = new THREE.Group();
  function part(w, h, d, x, y, z, mat) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    model.add(mesh);
    return mesh;
  }
  if (kind === 'pistol') {
    part(0.06, 0.07, 0.24, 0, 0, -0.1, DARK);
    part(0.05, 0.1, 0.08, 0, -0.06, 0.02, GRIP);
    part(0.02, 0.03, 0.02, 0, 0.05, -0.2, BODY);
  } else if (kind === 'smg') {
    part(0.08, 0.09, 0.4, 0, 0, -0.12, BODY);
    part(0.04, 0.04, 0.22, 0, 0.02, -0.4, GRIP);
    part(0.06, 0.12, 0.08, 0, -0.08, 0.02, GRIP);
    part(0.05, 0.05, 0.1, 0, -0.04, -0.14, DARK);
  } else if (kind === 'sniper') {
    part(0.09, 0.1, 0.62, 0, 0, -0.2, BODY);
    part(0.05, 0.05, 0.5, 0, 0.03, -0.42, GRIP);
    part(0.07, 0.07, 0.12, 0, 0.08, -0.18, DARK);
    part(0.06, 0.09, 0.16, 0, -0.05, 0.14, GRIP);
  } else {
    // rifle
    part(0.09, 0.1, 0.46, 0, 0, -0.14, BODY);
    part(0.045, 0.045, 0.34, 0, 0.025, -0.5, GRIP);
    part(0.075, 0.08, 0.2, 0, -0.03, 0.16, GRIP);
    part(0.05, 0.06, 0.12, 0, -0.05, -0.08, DARK);
  }
  model.position.set(0.24, -0.2, -0.42);
  return model;
}

// One agent's weapon state: the guns it owns, the one in hand, magazines, cooldowns.
// camera may be null (bots): then no view models are built and the state API still
// works exactly the same, so the simulation treats every agent alike.
export function createArsenal(camera) {
  const models = {};
  for (const kind of Object.keys(WEAPONS)) {
    const model = buildViewModel(kind);
    model.visible = false;
    if (camera) camera.add(model);
    models[kind] = model;
  }
  // Grenade in hand: a small dark sphere with a pin ring.
  const grenadeModel = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), DARK);
  const pin = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 6, 12), BODY);
  pin.position.set(0.07, 0.04, 0);
  grenadeModel.add(shell, pin);
  grenadeModel.position.set(0.24, -0.18, -0.4);
  grenadeModel.visible = false;
  if (camera) camera.add(grenadeModel);

  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26), FLASH_MAT);
  flash.position.set(0.24, -0.17, -0.95);
  flash.visible = false;
  if (camera) camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  if (camera) camera.add(flashLight);

  const state = {
    owned: { pistol: { mag: WEAPONS.pistol.mag, reserve: WEAPONS.pistol.reserve } },
    current: 'pistol',
    cooldown: 0,
    reloadLeft: 0,
    flash: 0,
    kick: 0,
    holdingGrenade: null,
    scoped: false,
  };

  function showCurrent() {
    for (const kind of Object.keys(models)) models[kind].visible = false;
    grenadeModel.visible = false;
    if (state.holdingGrenade) grenadeModel.visible = true;
    else if (models[state.current]) models[state.current].visible = true;
  }
  showCurrent();

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    const model = models[state.current];
    if (model) {
      model.position.z = -0.42 + state.kick;
      model.rotation.x = state.kick * 2.2;
      if (state.reloadLeft > 0) {
        const def = WEAPONS[state.current];
        model.rotation.x = -0.55 * Math.min(1, (def.reloadTime - state.reloadLeft) * 2);
      }
    }
    flash.visible = state.flash > 0;
    if (state.flash > 0) flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      if (state.reloadLeft === 0) {
        const def = WEAPONS[state.current];
        const slot = state.owned[state.current];
        const need = def.mag - slot.mag;
        const take = Math.min(need, slot.reserve);
        slot.mag += take;
        slot.reserve -= take;
      }
    }
  }

  return {
    state,
    step,
    buy(weaponId) {
      const def = WEAPONS[weaponId];
      if (!def || state.owned[weaponId]) return false;
      state.owned[weaponId] = { mag: def.mag, reserve: def.reserve };
      return true;
    },
    select(weaponId) {
      if (!state.owned[weaponId]) return false;
      state.current = weaponId;
      state.holdingGrenade = null;
      state.reloadLeft = 0;
      state.scoped = false;
      showCurrent();
      return true;
    },
    holdGrenade(kind) {
      state.holdingGrenade = kind;
      showCurrent();
    },
    stowGrenade() {
      state.holdingGrenade = null;
      showCurrent();
    },
    ready() {
      const slot = state.owned[state.current];
      return !state.holdingGrenade && slot && slot.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    takeRound() {
      const slot = state.owned[state.current];
      if (!slot || slot.mag <= 0) return false;
      slot.mag -= 1;
      return true;
    },
    pullTrigger() {
      state.cooldown = WEAPONS[state.current].rate;
      state.flash = 0.06;
      state.kick = state.current === 'sniper' ? 0.11 : 0.055;
    },
    reload() {
      const def = WEAPONS[state.current];
      const slot = state.owned[state.current];
      if (state.reloadLeft > 0 || !slot || slot.mag === def.mag || slot.reserve === 0) return false;
      state.reloadLeft = def.reloadTime;
      return true;
    },
    refillAmmo() {
      for (const id of Object.keys(state.owned)) {
        state.owned[id].mag = WEAPONS[id].mag;
        state.owned[id].reserve = WEAPONS[id].reserve;
      }
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
    },
    // A fresh match: back to the pistol, everything else forgotten.
    resetLoadout() {
      state.owned = { pistol: { mag: WEAPONS.pistol.mag, reserve: WEAPONS.pistol.reserve } };
      state.current = 'pistol';
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      state.holdingGrenade = null;
      state.scoped = false;
      showCurrent();
    },
    spread(speed) {
      const def = WEAPONS[state.current];
      const moving = Math.min(1, speed / 5.2);
      return def.spreadStill + moving * def.spreadMove;
    },
    ammo() {
      const slot = state.owned[state.current];
      return slot ? { mag: slot.mag, reserve: slot.reserve } : { mag: 0, reserve: 0 };
    },
  };
}
