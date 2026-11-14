// The Spark Charge: the objective beyond killing. One Vanguard carries it; planting
// takes 3.5 s inside a site, defusing takes 5 s, and a planted charge blows after
// 35 s. The carrier drops it when killed and a teammate picks it up by walking over
// it. Beeps speed up as the timer runs down.
import * as THREE from 'three';
import { playPlantBeep, playDefuseTick } from './audio.js';

export const PLANT_TIME = 3.5;
export const DEFUSE_TIME = 5;
export const BOMB_TIMER = 35;

export function createBomb(scene, sites) {
  const state = {
    status: 'carried', // carried | dropped | planted | exploded | defused
    carrier: null,
    site: null,
    plantAt: null,
    plantProgress: 0,
    planting: null,
    defuseProgress: 0,
    defusing: null,
    timer: BOMB_TIMER,
    lastBeep: 0,
  };

  const chargeGeo = new THREE.BoxGeometry(0.42, 0.26, 0.3);
  const chargeMat = new THREE.MeshStandardMaterial({ color: 0x2b211a, roughness: 0.5, metalness: 0.4, emissive: 0xff3b00, emissiveIntensity: 0.4 });
  const mesh = new THREE.Mesh(chargeGeo, chargeMat);
  mesh.visible = false;
  scene.add(mesh);
  const blink = new THREE.PointLight(0xff3b00, 0, 6, 1.8);
  scene.add(blink);

  function dropAt(pos) {
    state.status = 'dropped';
    state.carrier = null;
    state.planting = null;
    mesh.position.set(pos.x, 0.16, pos.z);
    mesh.visible = true;
  }

  function reset(carrier) {
    state.status = 'carried';
    state.carrier = carrier;
    state.site = null;
    state.plantAt = null;
    state.plantProgress = 0;
    state.planting = null;
    state.defuseProgress = 0;
    state.defusing = null;
    state.timer = BOMB_TIMER;
    state.lastBeep = 0;
    mesh.visible = false;
    blink.intensity = 0;
  }

  // Called every fixed step while a round is live. agents is the full agent list;
  // interact(agent) is true while that agent holds the interact key. Returns an
  // event string ('planted' | 'defused' | 'exploded') or null.
  function step(dt, agents, interact, inSite) {
    if (state.status === 'carried' || state.status === 'dropped') {
      // Pickup: a Vanguard walking over a dropped charge takes it.
      if (state.status === 'dropped') {
        for (const agent of agents) {
          if (!agent.alive || agent.team !== 'vanguard') continue;
          const d = Math.hypot(agent.body.position.x - mesh.position.x, agent.body.position.z - mesh.position.z);
          if (d < 1.1) {
            state.status = 'carried';
            state.carrier = agent;
            mesh.visible = false;
            break;
          }
        }
      }
      // Planting: a Vanguard standing in a site, holding interact, unmoving-ish.
      const planter = state.planting;
      let current = null;
      for (const agent of agents) {
        if (!agent.alive || agent.team !== 'vanguard') continue;
        const site = inSite(agent.body.position);
        if (!site) continue;
        if (interact(agent)) {
          current = { agent, site };
          break;
        }
      }
      if (current) {
        if (!planter || planter.agent !== current.agent || planter.site !== current.site) {
          state.planting = current;
          state.plantProgress = 0;
        }
        state.plantProgress += dt;
        if (Math.floor(state.plantProgress * 2) !== Math.floor((state.plantProgress - dt) * 2)) playPlantBeep(false);
        if (state.plantProgress >= PLANT_TIME) {
          state.status = 'planted';
          state.site = current.site;
          state.plantAt = current.site.center.clone();
          state.timer = BOMB_TIMER;
          state.planting = null;
          state.plantProgress = 0;
          mesh.position.set(current.site.center.x, 0.16, current.site.center.z);
          mesh.visible = true;
          blink.position.copy(mesh.position).add(new THREE.Vector3(0, 0.4, 0));
          return 'planted';
        }
      } else {
        state.planting = null;
        state.plantProgress = 0;
      }
      return null;
    }

    if (state.status === 'planted') {
      state.timer -= dt;
      const interval = state.timer > 20 ? 1 : state.timer > 10 ? 0.5 : 0.25;
      if (state.timer - state.lastBeep >= interval || state.lastBeep === 0) {
        state.lastBeep = state.timer;
        playPlantBeep(state.timer <= 10);
        blink.intensity = 6;
      } else {
        blink.intensity = Math.max(0, blink.intensity - dt * 30);
      }
      // Defusing: a Sentinel in the site holding interact.
      let current = null;
      for (const agent of agents) {
        if (!agent.alive || agent.team !== 'sentinel') continue;
        const site = inSite(agent.body.position);
        if (site !== state.site) continue;
        if (interact(agent)) {
          current = agent;
          break;
        }
      }
      if (current) {
        if (state.defusing !== current) {
          state.defusing = current;
          state.defuseProgress = 0;
        }
        state.defuseProgress += dt;
        if (Math.floor(state.defuseProgress * 3) !== Math.floor((state.defuseProgress - dt) * 3)) playDefuseTick();
        if (state.defuseProgress >= DEFUSE_TIME) {
          state.status = 'defused';
          mesh.visible = false;
          blink.intensity = 0;
          return 'defused';
        }
      } else {
        state.defusing = null;
        state.defuseProgress = 0;
      }
      if (state.timer <= 0) {
        state.status = 'exploded';
        mesh.visible = false;
        blink.intensity = 0;
        return 'exploded';
      }
      return null;
    }
    return null;
  }

  return { state, mesh, reset, dropAt, step };
}
