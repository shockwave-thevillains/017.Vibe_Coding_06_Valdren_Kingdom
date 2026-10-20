# Valdren

An explorable low-poly medieval kingdom that runs in the browser. It is built with
Three.js as a 100 % static site (HTML, ES modules and JSON), with no build step,
backend or API keys, so it can be hosted on GitHub Pages as is.

> **Status: Phase 1 of 5, engine core.** Terrain, sky, fog, lighting, the river,
> the player, the third-person camera, and desktop and mobile input are in place.
> The castle, town and other landmarks (phase 2), NPCs and dialogue (phase 3),
> lore, journal, minimap, saving and the day-night cycle (phase 4), and quality
> presets (phase 5) are still to come.

## Run it locally

ES modules do not load from `file://`, so serve the folder over HTTP:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000/>. On a phone on the same network, open
`http://<your-computer-ip>:8000/`. The page needs internet access, because
Three.js loads from jsDelivr.

## Controls

| Action      | Desktop                        | Mobile                                    |
| ----------- | ------------------------------ | ----------------------------------------- |
| Move        | `W` `A` `S` `D` / arrow keys   | Left thumb: virtual joystick              |
| Run         | Hold `Shift`                   | Push the joystick to its edge             |
| Look around | Mouse (click to capture it)    | Drag on the right side of the screen      |
| Zoom        | Mouse wheel                    | n/a                                       |
| Interact    | `E`                            | **Interact** button                       |
| Journal     | `J`                            | **Journal** button                        |
| Map         | `M`                            | n/a (minimap arrives in phase 4)          |
| Pause       | `Esc`                          | Pause button (top right)                  |

If the browser refuses pointer lock (for example inside an iframe), hold the
left mouse button and drag to look around.

### Developer options

- `?debug` shows a performance readout (FPS, draw calls, triangles, position).
  `F3` or the backtick key `` ` `` toggles it in game.
- `?time=HH` starts at a given hour (0–24), for example `?time=18` for sunset or
  `?time=22` for night.
- `window.valdren` exposes the renderer, scene, world and player in the browser
  console.

## Technical notes

- **Three.js r170** (npm `three@0.170.0`). The core and the addons are loaded from
  jsDelivr through an `<script type="importmap">` pinned to that exact version.
- All paths are relative, so the site works from `username.github.io/<repo>/`.
- The terrain is a single 200 × 200 grid mesh, 800 m across, sampled from a height
  function: rolling meadows, the castle hill, the town shelf, farmland, the ruins'
  knoll, a ring of mountains and a carved river. Gameplay height queries
  interpolate the actual mesh triangles, so feet always meet the rendered ground.
- One shadow-casting directional light follows the player. Its shadow frustum is
  snapped to shadow-map texels so shadows do not shimmer. A hemisphere light
  provides fill. The sky is a small shader dome whose horizon colour drives the
  fog, so distant land melts into the sky.
- Boulders are a single `InstancedMesh`. Obstacles are circles and rotated boxes
  in a uniform spatial grid. Deep water and slopes above 45° cannot be walked into.
- The device pixel ratio is capped at 2 (1.5 on touch devices). The shadow map is
  2048² on desktop and 1024² on touch devices.

### Project layout

```
index.html        page shell, import map, overlays and touch controls
style.css         UI styles (parchment panels, HUD, touch controls)
src/main.js       renderer, game loop, title / playing / paused states
src/world.js      terrain, river, sky and lighting, colliders, boulders
src/player.js     low-poly figure, player controller, follow camera
src/input.js      keyboard, mouse / pointer lock, touch joystick and look, buttons
src/ui.js         start screen, pause menu, toasts, hints, debug readout
.nojekyll         serve files exactly as they are on GitHub Pages
```

## Deploy to GitHub Pages

1. Push this repository to GitHub.
2. Open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, then pick the
   branch that holds these files and the `/ (root)` folder, and click **Save**.
4. After a minute the game is live at `https://<username>.github.io/<repo>/`.

## Credits and licences

- All geometry, colours and the sky are generated procedurally in code. The
  project ships no third-party models, textures, fonts or sounds.
- [Three.js](https://threejs.org/) © three.js authors, MIT licence.
