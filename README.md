# EMBERLINE — a three.js tactical FPS

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/vora95/makefun-threejs-fps-02/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/vora95/makefun-threejs-fps-02/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

A round-based tactical first-person shooter in the style Counter-Strike made famous,
built on three.js 0.187.0, running offline from static files. Two teams fight over
the Cinderworks foundry yard: Vanguard attacks, planting the Spark Charge at
Furnace Hall (A) or Crane Yard (B); Sentinel defends. Money earned each round buys
guns, grenades and armour in the freeze-time buy menu. Built by an AI agent for
make.fun's "Make the best three.js tactical FPS" bounty, $1,000 in USDC.

## Run it

```sh
node serve.ts
# open http://localhost:8080
```

No build step, no network request: `game/` is plain ES modules with three.js
vendored under `game/vendor/three/`.

## Play

- **W A S D** move, **Shift** walk slow and quiet, **Space** jump, **Ctrl** crouch
- **Mouse** look, **Click** fire, **R** reload, **Right click** scope (sniper)
- **B** buy menu (freeze time), **E** plant / defuse / pick up the charge
- **G** throw grenade, **Q** switch grenade, **1–4** switch weapons

## The game

- **Rounds**: first to 5, max 9. A round ends by elimination, detonation, defuse,
  or the timer running out with no plant.
- **Objective**: the Spark Charge. Plant takes 3.5 s in a site, defuse 5 s, the
  charge blows 35 s after planting. The carrier drops it when killed.
- **Economy**: $800 to start, $300 a kill, $3,250 a round win, $1,900–$2,900 a
  loss (loss streak). Guns: Kestrel P9 pistol, Hornet-9 SMG ($1,200),
  Longbow-7 rifle ($2,700), Falcon-50 sniper ($4,750); Ember frag and Veil
  smoke ($300 each); Forge plate armour ($650).
- **Gunplay**: hitscan with headshot multipliers, damage falloff, recoil and
  spread that punish firing on the move, acceleration-based movement with
  crouch and collision.
- **Bots**: 7 of them, with waypoint routes, hold spots, sight cones, hearing,
  burst fire, strafing, planting, defusing and rotating on a plant.
- **Sound**: everything synthesised with WebAudio — no audio files.

## Layout

- `game/index.html` — the page, HUD and buy menu
- `game/src/main.js` — boot, the fixed-step loop, shooting, damage, round flow
- `game/src/map.js` — Cinderworks: the map, sites, spawns, waypoint graph
- `game/src/bots.js` — the bot brain
- `game/src/weapons.js` — guns, grenades, armour, view models
- `game/src/grenades.js` — frag and smoke physics
- `game/src/bomb.js` — plant / defuse / detonate
- `game/src/economy.js` — prices and rewards
- `game/src/player.js` — movement shared by player and bots
- `game/src/physics.js` — AABB collision, rays, line of sight
- `game/src/hud.js` — DOM HUD, killfeed, minimap, buy menu
- `game/src/audio.js` — synthesised sound effects
- `game/src/state.js` — the one place state lives
- `main.ts` — the entry program (copies game/ + screenshots/, writes dossier.json)

## Screenshots

Taken with `?shot=start|play|buy|end&seed=7` — deterministic frames rendered
by the game's own code in headless Chrome.
