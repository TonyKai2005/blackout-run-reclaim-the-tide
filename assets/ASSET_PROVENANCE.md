# Web asset provenance and loading notes

All assets in this folder are local project assets. The web package makes no
requests to a stock model, image, or sound CDN.

## 3D models

The original 18 `models/*.glb` were converted from the editable Blender sources in
`BlackoutRun/ArtSource/Blender` via their existing FBX exports in
`BlackoutRun/Assets/BlackoutRun/Resources/Models`. The reproducible conversion
scripts are in `BlackoutRun/Web/tools/asset-export`. The 18 GLBs total 36.57 MiB.
The original `.blend` and FBX files are kept in the Unity project and are not
modified by the conversion. `IslandTechnician.glb` is a Web-only addition made
directly by `Tools/Art/GenerateIslandTechnician.py` from original procedural
meshwork and tiny generated material textures. Its editable source is
`ArtSource/Blender/Actors/IslandTechnician.blend`; the generated texture PNGs
are in the adjacent `IslandTechnician_Textures` folder. No downloaded model,
stock texture, font or photograph is used. The current complete inventory is
recorded in `models/manifest.json`.

Each GLB is a self-contained glTF 2.0 asset with +Y up, +Z front, and metre
units. `models/manifest.json` lists bounds, node positions, file sizes, and
materials. Relevant named nodes are `Muzzle`, `Head`, `Node_Left`,
`Node_Right`, `RecycleLever`, and wind turbine `Rotor`. The technician also
has `Pelvis`, `Torso`, `Head`, `Arm_Left`, `Arm_Right`, `Leg_Left`, and
`Leg_Right` pivots for lightweight browser animation. Render meshes are
visual; browser gameplay supplies its own colliders and hit zones.

The exporter preserves the source material families and converts the baked
Unity metallic/smoothness texture to glTF roughness/metallic channels. Base
color, normal, and scalar maps are resized to at most 1024 pixels and encoded
at high JPEG quality for browser loading. Solid models are opaque. The
optional legacy `MothDrone.glb` has material colors and scalar PBR defaults
because its FBX did not contain baked PBR maps. All other exported models have
embedded base color, normal, and metallic/roughness textures. The technician
uses 13 small, original procedurally varied PBR texture sets embedded in its GLB.

`TrashCleaner_A.glb` and `TrashCleaner_B.glb` use cleaner-only retints of the
original Reclaim base color maps. The retint retains the source map's wear and
surface variation while raising the body to slate and sage, the warning parts
to orange/red, and the scanner to cyan. Their metallic channels are reduced
to 30% of the original and roughness has a floor of 140/255 so painted panels
remain legible in the browser scene without an environment reflection map.
The scanner and warning material reuse their base color maps for mild emission.
Other GLBs and the original source maps are unaffected. Static previews can be
rendered from the exported GLBs with `preview_cleaners.py`; they are saved under
`Web/tools/asset-export/cache` on D:.

Suggested loading: load only the assets needed for the current chapter. The
core first-stage set (`PodBurst`, `TrashCleaner_A`, `SortingConveyor`,
`WasteBundle`, `BatteryModule`, `ServiceTerminal`) is about 11 MiB. The
original 18-model library also includes optional crane, launch, cargo
container, drone, and second trash cleaner assets.

The technician measures 0.70 × 1.84 × 0.42 metres, with feet at the origin,
and is an island engineer in a hard hat and high-visibility workwear. A static
preview rendered from the exported GLB is at
`Evidence/Models/Actors/IslandTechnician_Web.png`.

`IslandTechnician_Green.glb` and `IslandTechnician_Orange.glb` are original
workwear variants exported by `Tools/Art/GenerateIslandTechnicianVariants.py`
from the same technician mesh. The green variant has lime safety panels,
charcoal-teal clothing and a pale green helmet; the orange variant has a
deeper orange vest, navy clothing and a yellow helmet. Skin tones also vary.
Both retain the exact source dimensions, orientation and animation pivots.
Editable variant `.blend` files and procedural colour PNGs are in
`ArtSource/Blender/Actors/`; previews are in `Evidence/Models/Actors/`.
No outside character or texture source is involved.

`EngineerPlayer.glb` is an original third-person player model made in Blender
by `Tools/Art/GenerateEngineerPlayer.py`. It is visually distinct from the
island technician: yellow hard hat, dark blue-green workwear, reflective teal
harness, wrist diagnostics unit, and a weatherproof pack with two visible
reusable battery cells. The pack is designed for rear-camera readability.
Its pivot names match the technician so a lightweight walk and idle animation
can use the same code. Feet are at the origin; source axes are Z up and -Y
front, while the self-contained GLB is +Y up and +Z front. Editable source,
packed procedural PBR maps, and render previews are stored at
`ArtSource/Blender/Actors/EngineerPlayer.blend`,
`ArtSource/Blender/Actors/EngineerPlayer_Textures/`, and
`Evidence/Models/Actors/EngineerPlayer_{Rear,Front}.png`. No third-party
mesh or texture is used.

## Title art

`hero/daylight-keyart.webp` is an optimized copy of the approved bright coast
concept generated for this project. Its unmodified PNG source is retained at
`Web/tools/asset-export/source/daylight-keyart-source.png` outside the runtime
`public` folder. The title and menu text should be HTML, not painted on the
image.

## Audio

`audio/*.wav` and `audio/StormCurrent.ogg` are copies of the original
project's procedural sound effects and music. They were synthesized by the
project's `Tools/Audio/GenerateReclaimSfx.py`, `GenerateSfx.py`, and
`GenerateMusic.py`; see `ArtSource/Audio/RECLAIM_SFX_README.md` and
`ArtSource/Audio/MUSIC_README.md` for source notes. `StormCurrent.ogg` was
written for the earlier storm scene; the brighter web music bed can use it as
an optional fallback only. Browser audio starts after a user click.

## Rebuilding

From `BlackoutRun` on D:, with Python/Pillow and `D:\blender.exe` installed:

```powershell
python Web/tools/asset-export/prepare_textures.py
$env:TEMP = Join-Path (Get-Location) 'Web/tools/asset-export/tmp'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null
& 'D:\blender.exe' --background --factory-startup --python Web/tools/asset-export/export_glb.py
python Web/tools/asset-export/copy_static_assets.py
& 'D:\blender.exe' --background --factory-startup --python Tools/Art/GenerateIslandTechnician.py
& 'D:\blender.exe' --background --factory-startup --python Tools/Art/GenerateIslandTechnicianVariants.py
& 'D:\blender.exe' --background --factory-startup --python Tools/Art/GenerateEngineerPlayer.py
python Web/tools/asset-export/verify_glb.py
```

`verify_glb.py` checks the binary container, named pivots, and required PBR
texture references without starting or controlling the game.
For a static image of each exported cleaner, run:

```powershell
& 'D:\blender.exe' --background --factory-startup --python Web/tools/asset-export/preview_cleaners.py
```
