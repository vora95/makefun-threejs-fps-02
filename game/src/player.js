// Movement, shared by the player and the bots: acceleration, friction, gravity,
// crouch and jump, resolved as a box against the world's colliders one axis at a
// time. A body is plain data — position (feet), velocity, yaw, pitch, eye height —
// so the same code drives a human and a bot.
import * as THREE from 'three';
import { moveBody } from './physics.js';

export const STAND_HEIGHT = 1.72;
export const CROUCH_HEIGHT = 1.12;
export const STAND_EYE = 1.6;
export const CROUCH_EYE = 1.02;
const WALK_SPEED = 5.2;
const CROUCH_SPEED = 2.4;
const SLOW_SPEED = 2.9;
const GROUND_ACCEL = 42;
const AIR_ACCEL = 9;
const FRICTION = 9;
const GRAVITY = 20;
const JUMP_SPEED = 6.2;

export function createBody(x, z, yaw = 0) {
  return {
    position: new THREE.Vector3(x, 0, z),
    velocity: new THREE.Vector3(),
    yaw,
    pitch: 0,
    eye: STAND_EYE,
    onGround: true,
    crouching: false,
    height: STAND_HEIGHT,
  };
}

export function look(body, dx, dy, sensitivity = 0.0022) {
  body.yaw -= dx * sensitivity;
  body.pitch = Math.max(-1.45, Math.min(1.45, body.pitch - dy * sensitivity));
}

export function applyRecoil(body, pitchKick, yawKick) {
  body.pitch = Math.min(1.45, body.pitch + pitchKick);
  body.yaw += yawKick;
}

// keys is a Set of event.code strings (real keys for the player, synthetic ones
// for a bot). Returns horizontal distance moved this step, for footstep sounds.
export function stepMovement(body, colliders, keys, dt, slow = false) {
  const crouching = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
  if (crouching && !body.crouching) {
    body.crouching = true;
    body.height = CROUCH_HEIGHT;
  } else if (!crouching && body.crouching) {
    body.crouching = false;
    body.height = STAND_HEIGHT;
  }
  const eyeTarget = body.crouching ? CROUCH_EYE : STAND_EYE;
  body.eye += (eyeTarget - body.eye) * Math.min(1, dt * 12);

  const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  const sin = Math.sin(body.yaw);
  const cos = Math.cos(body.yaw);
  let wx = 0;
  let wz = 0;
  if (forward || strafe) {
    wx = -sin * forward + cos * strafe;
    wz = -cos * forward - sin * strafe;
    const len = Math.hypot(wx, wz);
    wx /= len;
    wz /= len;
  }

  const speed = body.crouching ? CROUCH_SPEED : slow ? SLOW_SPEED : WALK_SPEED;
  const blend = Math.min(1, (body.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt / speed);
  body.velocity.x += (wx * speed - body.velocity.x) * blend;
  body.velocity.z += (wz * speed - body.velocity.z) * blend;
  if (body.onGround && wx === 0 && wz === 0) {
    const damp = Math.max(0, 1 - FRICTION * dt);
    body.velocity.x *= damp;
    body.velocity.z *= damp;
  }

  if (keys.has('Space') && body.onGround) {
    body.velocity.y = JUMP_SPEED;
    body.onGround = false;
  }
  body.velocity.y -= GRAVITY * dt;

  const beforeX = body.position.x;
  const beforeZ = body.position.z;
  moveBody(colliders, body, dt);
  return Math.hypot(body.position.x - beforeX, body.position.z - beforeZ);
}

export function groundSpeed(body) {
  return Math.hypot(body.velocity.x, body.velocity.z);
}
