# Smart Walkthrough (prototype)

Walk through a simple AR building in the browser. three.js + WebXR, no build step.

```bash
npm install
npm start        # http://localhost:8000
```

## The building
A one-room pavilion (8 × 6 m). Origin is the centre of the front door threshold; the room extends toward -z.
The back wall has a 5 × 1.9 m glass window with a landscape behind it (hills, pine forest, lake, mountains, sky).

## Modes
| Mode | What it does |
|---|---|
| Walk | First person. WASD + mouse (click to lock / drag), Shift to run. Touch: left thumb moves, right thumb looks. Walls collide. |
| Orbit | Outside view. **Cutaway** hides the roof. |
| Tour | Guided walk with captions. Any input takes over. |
| AR look | Desktop preview of the AR effect: the landscape is drawn *only through the window* over a fake camera backdrop. |
| Motion | Phone in hand (iOS/Android, touch devices only): the gyroscope controls where you look and real steps move you forward along that heading. Needs **HTTPS** for sensor permission, see below. No true position tracking, steps are estimated from accelerometer bounces. The left-thumb joystick still works. |
| Enter AR | Real WebXR immersive-AR (Android Chrome / ARCore). Aim the ring at the floor, tap to place the door threshold, then physically walk in. Scale: life-size, 1:4, 1:20 tabletop. |

## How the window "portal" works
The window opening has an invisible mask that writes `stencil = 1`. In AR mode every landscape material only renders where stencil equals 1,
so the real world shows everywhere except through the glass. See `src/building.js` (`mask`) and `src/landscape.js` (`setPortal`).

## Trying real AR on a phone
WebXR needs a secure context. Easiest: plug in an Android phone with USB debugging, then

```bash
adb reverse tcp:8000 tcp:8000
```

and open `http://localhost:8000` in Chrome on the phone (localhost counts as secure).
iOS Safari has no WebXR immersive-AR, so it only gets Walk / Orbit / Tour / AR look.

## Motion mode on an iPhone (needs HTTPS)
iOS only gives web pages motion sensors on a secure (https) page, so plain `http://<pc-ip>:8000` will not work for Motion. Use a temporary tunnel:

```bash
npm start
npx cloudflared tunnel --url http://localhost:8000
```

Open the printed `https://….trycloudflare.com` link in Safari, tap **Motion**, and allow *Motion & Orientation Access*.

## Layout
- `src/motion.js` – gyro look + step detection for phones
- `src/building.js` – walls, glass window, furniture, colliders, portal mask
- `src/landscape.js` – sky shader, terrain, lake, trees, portal switch
- `src/walk.js` – first-person controller + collision
- `src/ar.js` – WebXR session, hit-test reticle, placement
- `src/main.js` – scene, modes, tour, UI wiring
