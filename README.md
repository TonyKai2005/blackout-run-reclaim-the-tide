# BLACKOUT RUN: RECLAIM THE TIDE

**Play in the browser:** https://tonykai2005.github.io/blackout-run-reclaim-the-tide/ (desktop browser, keyboard and mouse)

A green-technology game made as a group hackathon project for the *Industry & Community Engagement* unit (Theme 5: Sustainability and Green Tech, Week 5, 2026), Hubei University and Manchester Metropolitan University joint programme.

**My contribution (Zeng Hongkai):** mission logic and objective guidance in TypeScript (`src/game/state.ts`, with the state tests in `tests/state.test.mjs`), and 3D models built in Blender and exported to glTF (see `public/assets/ASSET_PROVENANCE.md`).

---

## Web Edition

A desktop browser, third-person green technology game set on Kestrel Island after a storm. Recover a reusable battery, restart material sorting, restore water treatment, bring wind generation online, and leave by the extraction boat. The coastal scene and homepage are bright daytime. Gameplay, UI, journal, and results are in English.

## Play locally

Double-click `Play-Web.cmd`. It starts a server on `http://127.0.0.1:4173` and opens Microsoft Edge with its browser profile inside `Web/.cache/edge-game-profile` on this D-drive project. Keep the launcher window open while playing. The package makes no CDN requests at runtime. Do not double-click `dist/index.html`: browser modules and WASM need local HTTP.

If you are editing source, run `npm install`, `npm run build`, then `Play-Web.cmd`. Node.js is required. `npm run dev` is also available on the same fixed local address. The project's `.npmrc` puts npm's cache in `Web/.cache/npm` on D.

## Controls

| Input | Action |
| --- | --- |
| WASD / mouse | Move / look |
| E | Pick up, drop, install, operate the marked objective, or talk to a nearby crew member |
| G | Put down carried cargo, including while standing beside a crew member |
| Left mouse | Fire unlimited fictional seed pods |
| 1 / 2 | Pod Burst / Seed Repeater (the latter unlocks in phase 2) |
| Shift / Space | Sprint / jump |
| Q | Read the optional drone hint |
| J | Reopen the field journal |
| Tab | Inspect the microgrid |
| Esc | Pause and release the mouse; click Resume Mission to capture it again |

The upper-left card always gives one immediate objective. While fetching cargo it names both its source and destination. The compass, distance, short floor arrows, and scene beacon point to the current item or station. The E prompt appears only nearby. Carried cargo follows the engineer smoothly; dropping it returns it to physics simulation. If cargo falls off the island it returns to a safe pickup point.

Nearby rogue trash cleaners have a small name label above them. Seven friendly island crew members walk between safe work points, inspect their surroundings, look around, or signal. All seven can be approached and spoken to with E for contextual mission and green technology hints. Crew have no collision and cannot block the mission route. The marked objective takes E priority when both are in range; G always puts down carried cargo.

## Campaign

1. **SORT THE TIDE:** Install the reusable battery, clear the recovery line, deliver two waste bundles, run sorting and communications for 20 seconds.
2. **FLOW AGAIN:** Clear two water intakes, install a reused filter frame and fresh cartridge, run the water process for 25 seconds.
3. **RETURN OF THE WIND:** Install wind control, hit two exposed machine nodes, wait for the authored safe wind threshold, start wind generation and capture, hold all critical services for 25 seconds, then extract.

This is an educational game simulation. Its kW/kWh model separately records imported battery energy and wind generation. Water equipment is described as running; no potable-water or carbon-savings claim is made. The fictional plant tools and debris-covered cleaners are game mechanics.

## Project layout

- `src/game/state.ts`: deterministic mission and microgrid rules.
- `src/game/world.ts`: PlayCanvas world, third-person camera and controls, cargo physics, tools, machines, visual restoration.
- `src/game/crewDialogue.ts`: contextual English conversations for all island crew members.
- `src/ui.ts`, `src/style.css`: title, field journal, objective HUD, settings, results.
- `src/game/save.ts`: versioned IndexedDB checkpoint and current run.
- `public/assets`: approved title art, original Blender exports as optimized GLB, local Ammo WASM, sound assets, and provenance.
- `server.mjs`, `Play-Web.ps1`, `Play-Web.cmd`: fixed-origin local delivery.

The Unity project and its saves remain separate. Web Edition begins a new browser save. Browser storage is tied to the exact `127.0.0.1:4173` origin and Edge profile. `Web/.cache` stays on D and is excluded from version control.

## Build and verification

Run `npm run check` for TypeScript, `node --test tests/state.test.mjs` for pure mission rules, and `npm run build` for the distributable `dist` directory. The 20–30 minute duration and 1080p/60 fps are design targets until measured on the classroom computer. Interactive playthrough belongs to the player; automated checks do not drive the gameplay window.

Source assets and conversion details are documented in `public/assets/ASSET_PROVENANCE.md`.
