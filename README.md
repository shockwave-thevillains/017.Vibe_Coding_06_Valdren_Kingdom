# Valdren

An explorable medieval kingdom that runs in the browser. It is built with Three.js
as a 100 % static site (HTML, ES modules and JSON), with no build step, backend or
API keys, so it can be hosted on GitHub Pages as is. Every model and texture is
generated in code at load time; the project ships no art assets.

> **Status: complete (all five phases).** The engine core, the whole kingdom,
> its seven inhabitants with branching dialogue, ten secrets that add up to one
> mystery, a journal, compass and maps, saved progress, a running day-night
> cycle, and Low / Medium / High graphics presets.

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

## The people

Seven people live in Valdren. Each has a place, a routine and a story to tell,
and what one of them lets slip can open up another.

| Who | Where | Doing |
| --- | --- | --- |
| **King Osric II** | On the dais of the Throne Hall | Pacing before the throne, hands behind his back |
| **Dame Isolde Varn**, Captain of the Guard | Castle courtyard | Walking her rounds in helmet and breastplate |
| **Brannoc**, Blacksmith | The forge, north-west of the market | Hammering at the anvil |
| **Maera**, keeper of *The Broken Oar* | Outside the tavern | Polishing a tankard |
| **Tobias Fenn**, merchant of Saltmere | The east stalls of the market | Strolling between his stalls |
| **Wynn Hollis**, farmer | The farmstead across the river | Walking out to the ploughed field, hoe in hand |
| **The Old Hermit** | His camp beside the ruined watchtower | Pottering between the fire and the ruin |

Walk up to someone and a prompt appears (their name also floats above their
head). Press `E`, or tap **Interact**, to talk. The camera moves over your
shoulder, the line types itself out (click, tap or press `Space` to show it at
once), and you pick a reply with the mouse, a tap or the keys `1`–`3`. `Esc`
ends the conversation.

## The mystery

Valdren is hiding something about the Red Winter, thirty-one years ago, when the
King's elder brother died in a fire. Ten things around the kingdom tell the real
story: two monuments, two banners, four written pages, a grave and a sealed
door. Each one still to be found catches the light with a faint golden glint.
Stand by it and press `E` (or tap **Interact**) to read or examine it; it goes
into your journal.

- **Journal** (`J`, or the **Journal** button): your discoveries in the order you
  found them, everything people have told you under *Rumours*, and, once all ten
  are found, *The Truth*. What you have read also changes what some people will
  say to you, and the story has an ending to reach in conversation.
- **Compass, clock and minimap:** the compass and the time of day sit at the top;
  the round minimap turns with the camera and marks people (gold once you have
  met them) and your discoveries. Click or tap it, or press `M`, for the full
  map of the kingdom.
- **Day and night:** the sun crosses the sky in about fourteen minutes and the
  night passes in about five. Windows and street lanterns light up after dusk.
- **Saving:** progress (discoveries, conversations, where you stand, the time of
  day) is saved in this browser as you play, and the title screen offers to
  continue or to start a new journey. If the browser blocks storage the game
  still runs; it just cannot remember you.

## Graphics quality

The title screen and the pause menu (`Esc`, or the pause button on a phone)
offer three presets. Touch devices start on **Medium**, everything else on
**High**; the choice is remembered in this browser.

| | Low | Medium | High |
| --- | --- | --- | --- |
| Shadows | **off** | 1024² map, 34 m around you | 2048² map, 46 m around you |
| Resolution (device pixel ratio cap) | 1 | 1.5 | 2 |
| Edge smoothing (MSAA) | off | on | on |
| Lantern lights at night | none | 2 | 4 |
| Grass tufts around you | 2,500 | 6,000 | 18,000 |
| Full-detail trees within | 40 m | 55 m | 75 m |
| Textures | 256 px | 256 px | 512 px |

Shadows, resolution, lantern lights, grass and tree distance change at once.
Texture size, tree and crop detail and edge smoothing are fixed when the world
is built, so the menu says when those will follow on the next load. If the game
runs below 24 frames per second for ten seconds, it suggests a lower preset
(once per visit).

## Run it locally

ES modules do not load from `file://`, so serve the folder over HTTP:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000/>. On a phone on the same network, open
`http://<your-computer-ip>:8000/`. The page needs internet access, because
Three.js loads from jsDelivr.

It runs in current Chrome, Edge, Firefox and Safari (16.4 or later, for import
maps), on desktop and on phones, with WebGL 2.

## Controls

| Action      | Desktop                        | Mobile                                    |
| ----------- | ------------------------------ | ----------------------------------------- |
| Move        | `W` `A` `S` `D` / arrow keys   | Left thumb: virtual joystick              |
| Run         | Hold `Shift`                   | Push the joystick to its edge             |
| Look around | Mouse (click to capture it)    | Drag on the right side of the screen      |
| Zoom        | Mouse wheel                    | n/a                                       |
| Interact    | `E`                            | **Interact** button                       |
| Read, examine | `E` by something that glints | **Interact** button                     |
| Journal     | `J`                            | **Journal** button                        |
| Map         | `M`, or click the minimap      | Tap the minimap                           |
| Close a page | `Esc`, `E` / `J` / `M` again  | The × button                              |
| Pause       | `Esc`                          | Pause button (top right)                  |
| Talk: reply | Click a reply, or `1`–`3`      | Tap a reply                               |
| Talk: skip  | Click the text, `Space`, `E`   | Tap the text                              |
| Talk: leave | `Esc` or the last reply        | The last reply                            |

If the browser refuses pointer lock (for example inside an iframe), hold the
left mouse button and drag to look around.

### Developer options

- `?debug` shows a performance readout (FPS, draw calls, triangles, position).
  `F3` or the backtick key `` ` `` toggles it in game.
- `?time=HH` starts at a given hour (0–24), for example `?time=18` for sunset or
  `?time=22` for night (instead of the saved time).
- `?quality=low`, `medium` or `high` starts with that preset, overriding (but not
  changing) the saved choice. The choice itself is stored under the
  `valdren.settings.v1` key, apart from the journey.
- `window.valdren` exposes the renderer, scene, world, player, people, lore and
  the save in the browser console.
- To forget your progress, use *Start a new journey* on the title screen, or
  remove the `valdren.save.v1` key from the site's local storage.

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
- **People** are built from `data/npcs.json` with the same `createFigure()` as
  the player: a look (colours, build, robe or tunic, hair, beard, age lines, a
  burn scar, a gloved hand) and an outfit of procedural accessories (crown,
  ermine collar, nasal helm, breastplate, pauldrons, sword, aprons, hats, a
  cowl, a hammer, a tankard, a staff, a hoe). Accessories are baked
  into the figure's own skinned mesh, so each person costs four or five draw
  calls; their shadows are dropped beyond 24 m. Poses (hands behind the back,
  hammering, polishing, leaning on a staff) are layered over the walk
  cycle, people turn their heads to watch you pass, and they gesture while
  they speak.
- **Dialogue** trees live in the same file. Each node is a line and two or three
  replies; a reply leads to another node or ends the conversation. Nodes and
  replies can require and set flags (`"if": ["heard_edmund", "!met_king"]`,
  `"set": ["heard_chains"]`), which is how hearing something from one person
  changes what you can ask another. `met_<id>` is set after a first meeting,
  and `"start"` can pick a different greeting for a return visit.
- **Lore** lives in `data/lore.json`: ten entries, each tied to a named spot the
  world builds (`anchor`), with a kind (scroll, monument, banner, grave, door),
  its text, and the traveller's own note; plus the rumour lines that dialogue
  flags unlock, the closing *Truth* and an epilogue. Finding an entry sets the
  flag `lore_<id>`, and all ten set `lore_complete`, which conversations can test.
  The props (the founding stone, a lectern, a ledger page, a song sheet, a
  letter, the burnt standard, heather on a grave) are part of the batched world
  geometry; the glints are a single point cloud.
- **Day and night:** the clock runs continuously. The sky, fog, sun, moon and
  ambient light follow it every frame, while the image-based lighting is only
  rebuilt when the sky has visibly changed (often at dawn and dusk, never at
  noon or midnight). A small pool of point lights (four on High, two on Medium,
  none on Low) moves to the lanterns nearest the player after dark, so the light
  pools on walls and cobbles cost the same anywhere in the kingdom.
- **Maps** are painted once at load from the world itself: the terrain's own
  colours with hill shading, the river, forests drawn as tree marks, the fields,
  and every wall and building taken from the collision shapes, on a parchment
  tint. The minimap draws a rotated window of that picture; the full map adds
  place names, the people you have met and your discoveries.
- **Saving** uses `localStorage` (key `valdren.save.v1`), and every access is
  wrapped in `try`/`catch`. It is written after each discovery and conversation,
  every 20 seconds of play, on pause and when the page is hidden. A saved
  position is only restored if it is still standable ground.
- **Collision:** circles and rotated boxes with a vertical extent, in a uniform
  spatial grid. Walkable surfaces (the bridge deck, the hall floor and dais) sit
  above the terrain; steps up to 45 cm can be climbed; deep water and slopes above
  45° cannot. The camera pulls in rather than pass through walls, and stays under
  the Throne Hall's ceiling.
- **Budget:** one shadow-casting light, the device pixel ratio capped at 2, and
  the presets above. Switching presets re-seeds the grass, resizes or drops the
  shadow map and adds or removes lantern lights in place; the lit materials
  recompile once for the new light setup. In the starting view, High draws about
  200 calls and 0.9 M triangles a frame (shadow pass included), Low about 165
  calls and 0.6 M triangles, at a quarter of the pixels on a high-density screen.

### Project layout

```
index.html        page shell, import map, overlays and touch controls
style.css         UI styles (parchment panels, HUD, touch controls)
src/main.js       renderer, graphics presets, game loop, states (title,
                  playing, paused, talking, reading, journal, map),
                  interaction, saving
src/world.js      terrain, textures, sky, day-night and lighting, every building
                  and prop, vegetation, grass, colliders, walkable surfaces,
                  lore spots, lantern lights, the painted map
src/player.js     skinned human figure (shared with NPCs), its animation and
                  poses, player controller, follow camera
src/npc.js        the people: figures and accessories from data, patrols,
                  who can be talked to, name labels
src/dialogue.js   branching conversations: typewriter, replies, flags
src/lore.js       discoveries and their glints, the reader, the journal, the save
data/npcs.json    the seven inhabitants: looks, outfits, routes, dialogue
data/lore.json    the ten discoverables, rumours, the truth and the epilogue
src/input.js      keyboard, mouse / pointer lock, touch joystick and look, buttons
src/ui.js         start screen, pause menu, graphics choice, toasts, hints,
                  prompt, name labels, compass and clock, minimap, full map,
                  debug readout
.nojekyll         serve files exactly as they are on GitHub Pages
```

## Deploy to GitHub Pages

1. Push this repository to GitHub.
2. Open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, then pick the
   branch that holds these files and the `/ (root)` folder, and click **Save**.
4. After a minute or two the game is live at `https://<username>.github.io/<repo>/`
   (for this repository: `https://shockwave-thevillains.github.io/017.Vibe_Coding_06/`).
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

## Troubleshooting

- **"Still loading…" or "Could not download the game scripts":** the page could
  not reach `cdn.jsdelivr.net`. Check the connection, or a blocker that filters
  CDNs.
- **"WebGL is not available":** turn on hardware acceleration in the browser
  settings, or try another browser.
- **Slow or hot phone:** choose **Low** in the pause menu, then reload for the
  lighter textures as well.
- **Progress is not kept:** private windows and some privacy settings block
  `localStorage`. The title screen says so; the game still runs.
- **404 on GitHub Pages:** wait for the "pages build and deployment" run to
  finish, check that Pages points at the right branch and `/ (root)`, and open
  the address with the repository name exactly as GitHub shows it.

## Credits and licences

- All geometry, textures, colours, the sky and the tower icon are generated in
  code. The project ships no third-party models, textures, fonts or sounds, so
  there are no CC0 or other asset licences to list.
- [Three.js](https://threejs.org/) © three.js authors, MIT licence.
