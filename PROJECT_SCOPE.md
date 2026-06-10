# Wheelchair Racing & Action Game

## Project Scope & Vision
A 1v1 online multiplayer racing and action web game where players control characters in wheelchairs. The game combines high-speed racing with physical combat (kicking/ramming) and features dynamic ragdoll physics for hilarious and engaging gameplay.

## Technology Stack
- **Frontend / Rendering:** Three.js
- **Physics Engine:** Rapier.js (@dimforge/rapier3d)
- **Frontend Framework:** Vite
- **Backend / Multiplayer:** Node.js (with Socket.io) to be hosted on Render
- **3D Assets:** 
  - Track: `drift_race_track_free.glb`
  - Character: Ready Player Me Avatar
  - Vehicle: `wheel_chair.glb`

## Features & Roadmap

### Phase 1: Core Mechanics (Current)
- [x] Set up project environment (Vite, Three.js, Rapier.js).
- [ ] Load and render the 3D assets (Race track, Wheelchair, Character).
- [ ] Implement basic rigid body physics for the wheelchair.
- [ ] Implement wheelchair driving controls (acceleration, steering, braking/reverse).
- [ ] Implement character ragdoll physics on the wheelchair.

### Phase 2: Action & Combat
- [ ] Implement collision detection between wheelchairs.
- [ ] Add "kick" or "shove" mechanics to interact with the opponent.
- [ ] Refine ragdoll reactions based on impact force and location.
- [ ] Add player reset/recovery mechanics after falling.

### Phase 3: Multiplayer & Networking
- [ ] Set up the backend server (Node.js) for Render deployment.
- [ ] Implement client-server synchronization for position, rotation, and physics states.
- [ ] Implement a matchmaking or simple lobby system for 1v1 races.

### Phase 4: Polish & Environment
- [ ] Add the main race track with proper collision meshes.
- [ ] Add lighting, shadows, and environment maps for visual quality.
- [ ] Implement camera follow logic (third-person chase cam).
- [ ] Add sound effects and UI (speedometer, lap timer).
