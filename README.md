# Valdren

An explorable medieval kingdom that runs in the browser. It is built with Three.js
as a 100 % static site (HTML, ES modules and JSON), with no build step, backend or
API keys, so it can be hosted on GitHub Pages as is. Every model and texture is
generated in code at load time; the project ships no art assets.

> **Status: Phase 2 of 5, the world.** The engine core (phase 1) and the whole
> kingdom are in place. NPCs and dialogue (phase 3), lore, journal, minimap,
> saving and the day-night cycle (phase 4), and the quality menu (phase 5) are
> still to come.

## The kingdom

- **Castle Valdren** crowns the hill to the north: an octagonal curtain wall with
  eight round towers, a twin-towered gatehouse with a raised portcullis, a cobbled
  courtyard with barracks, stables, a well and training dummies, the great
  donjon (with a sealed, chained door), and the **Throne Hall**, which you can
  walk into: columns, a long carpet, a two-step dais and throne, stained-glass
  windows, banners, braziers and a chandelier.
- **The walled town** below: a twelve-sided wall with towers and three gates,
  winding cobbled streets with kerbs and lamp posts, about thirty half-timbered
  and stone houses, a market square with stalls, a well and a king's statue, the
  tavern *The Broken Oar*, the blacksmith's forge, and a chapel with a bell tower
  and graveyard.
- **Outside the walls:** the royal road winding up the castle hill, a
  three-arched stone bridge over the river, wheat, barley and cabbage fields with
  fences, a farmstead with a barn and haystacks, a turning windmill, woods to the
  west, north-east and south-west, and a ruined watchtower on a knoll at the
  forest edge with a hermit's camp beside it.

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
- **Terrain:** a single 256 × 256 grid mesh, 800 m across, sampled from a height
  function: rolling meadows, the castle hill, the town shelf, farmland, the ruins'
  knoll, a ring of mountains and a carved river. Roads cut and fill the land along
  smoothed profiles. Gameplay height queries interpolate the actual mesh
  triangles, so feet always meet the rendered ground.
- **Procedural textures:** stone, cobbles, plaster, timber, planks, roof tiles,
  thatch, dirt, soil, bark, ground detail and water ripples are painted into data
  textures at load time, each with a matching normal map. The banner arms and the
  tavern sign are drawn with the 2D canvas API.
- **Lighting:** physically based materials, ACES filmic tone mapping, and
  image-based lighting from a slightly desaturated copy of the sky. One
  shadow-casting directional light follows the player, with its shadow frustum
  snapped to shadow-map texels so shadows do not shimmer. The sky's horizon
  colour drives the fog. Windows and lanterns glow after dusk.
- **Batching:** static architecture is merged per material and per 160 m chunk,
  so the whole kingdom is about 90 meshes. UVs are projected in world space, so
  textures keep their real-world scale on every wall.
- **Instancing:** trees, bushes, crops, market stalls, roof-tile courses, fence
  posts and rails, barrels, crates, gravestones and boulders are `InstancedMesh`es.
- **Trees** come in two levels of detail. Both are drawn instanced, and the shader
  keeps each tree in exactly one of them depending on its distance from the
  camera, so detail changes per tree rather than per chunk. Foliage close to the
  camera dissolves instead of filling the screen.
- **Grass** is drawn entirely on the GPU: one instanced tuft mesh wraps around the
  player, reads the terrain height and a density/colour mask from textures, and
  sways in the wind. Wheat, leaves, flags and the river surface move too.
- **The traveller** is one skinned mesh built in code and bound to a 19-bone
  skeleton: a lofted torso, limbs, hands and boots, a pleated tunic skirt and a
  cloak, and a head sculpted from a sphere (brow, eye sockets, nose, cheekbones,
  lips, jaw and chin). The face (eyes, brows, lips, skin shading, stubble) is
  painted onto a canvas at load time. Hair and beards are a shell around the
  head whose edge fades out through a strand mask, so the hairline breaks into
  strands instead of ending in a hard rim. The walk and run cycles are
  procedural: pelvis sway and twist, counter-rotating shoulders, bending knees
  and elbows, heel-to-toe feet and a trailing cloak. The same `createFigure()`
  builds every NPC with its own colours, hair and beard (about 12k triangles
  each).
- **Collision:** circles and rotated boxes with a vertical extent, in a uniform
  spatial grid. Walkable surfaces (the bridge deck, the hall floor and dais) sit
  above the terrain; steps up to 45 cm can be climbed; deep water and slopes above
  45° cannot. The camera pulls in rather than pass through walls, and stays under
  the Throne Hall's ceiling.
- **Budget:** the device pixel ratio is capped at 2 (1.5 on touch devices). Touch
  devices also get a 1024² shadow map (2048² on desktop), half-size textures,
  fewer grass tufts and simpler trees.

### Project layout

```
index.html        page shell, import map, overlays and touch controls
style.css         UI styles (parchment panels, HUD, touch controls)
src/main.js       renderer, game loop, title / playing / paused states
src/world.js      terrain, textures, sky and lighting, every building and prop,
                  vegetation, grass, colliders and walkable surfaces
src/player.js     skinned human figure (shared with NPCs), its animation,
                  player controller, follow camera
src/input.js      keyboard, mouse / pointer lock, touch joystick and look, buttons
src/ui.js         start screen, pause menu, toasts, hints, debug readout
.nojekyll         serve files exactly as they are on GitHub Pages
```

## Deploy to GitHub Pages

1. Push this repository to GitHub.
2. Open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, then pick the
   branch that holds these files and the `/ (root)` folder, and click **Save**.
4. After a minute or two the game is live at `https://<username>.github.io/<repo>/`
   (for this repository: `https://shockwave-thevillains.github.io/017.vibe_coding_06/`).
   The **Actions** tab shows the "pages build and deployment" run while it
   publishes.

Nothing needs building: GitHub serves the files as they are (`.nojekyll` turns
Jekyll off), every path in the project is relative, and Three.js comes from
jsDelivr. A free account can publish Pages from a public repository; a private
repository needs a paid plan.

To check the sub-folder setup before publishing, serve the parent directory and
open the game from its folder, the way GitHub Pages will:

```bash
cd ..
python -m http.server 8000
# then open http://localhost:8000/<repo-folder>/
```

## Credits and licences

- All geometry, textures, colours and the sky are generated procedurally in code.
  The project ships no third-party models, textures, fonts or sounds.
- [Three.js](https://threejs.org/) © three.js authors, MIT licence.
