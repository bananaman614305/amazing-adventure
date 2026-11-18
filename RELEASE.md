# Amazing Adventure — playtest release

Versioned, self-contained static web candidate for the Grunt dashboard's **Play**
tab.

| Field | Value |
| --- | --- |
| Version | `0.3.0` |
| Build name | A living world |
| Channel | `playtest` |
| Entry point | `index.html` (open at the site root) |
| Source commit | see `CHECKPOINT` below — the exact commit this document ships with |
| Runtime | static files only; no build step, no bundler, no network calls |
| Third-party code | Three.js r160, vendored at `vendor/three.module.min.js` (MIT, see `vendor/THREE-LICENSE.txt`) |

## How to serve it

The game is plain static files, but it uses ES modules and needs a directory
index, so serve the repository root over HTTP rather than opening the file:

```sh
npm start          # http://127.0.0.1:8000  (HOST/PORT override both)
```

Any static file server works. There is no build, install or compile step at
runtime: `node_modules/` is **not** required to play, only to run the browser
tests. That is deliberate, so the preview can be published without shipping a
dependency tree or contacting a CDN.

## Files to serve

Required, and sufficient:

```
index.html
src/            version.js main.js player.js touch.js perf.js world.js areas.js
                terrain.js npcs.js dialogue.js state.js factions.js ambient.js
                daynight.js
vendor/         three.module.min.js  THREE-LICENSE.txt
```

Not required to play (safe to omit from a preview host):

```
tests/ scripts/ artifacts/ node_modules/ package.json package-lock.json
server.mjs README.md CREDITS.md RELEASE.md GRUNT_STATUS.md
```

## Controls

**Desktop** — WASD to walk, mouse to look (click to capture the pointer), Shift
to run, **E** to talk/interact, **J** journal, **Esc** pause, **P** toggle
adaptive resolution. Rest at the bench with **E** to skip to the next hour.

**Phone / tablet** — the touch layer appears automatically on a coarse pointer
with touch points; it is forced off on a desktop with a mouse.

- **Left thumb** anywhere in the left half: analog walk stick. It appears where
  you press, so you do not have to find it.
- **Right thumb drag** on the right side: look around.
- Both work at once — move and look with two thumbs.
- **Talk / Use** button: appears when an NPC or object is in reach; label
  matches the action (`Talk`, `Pick up`, `Read`, `Rest`, `Gate`).
- **Journal** button: opens the inventory, journal and standing panel.
- **Pause** button: pauses, saves, and offers *Resume* / *Save now*.
- Dialogue choices are tapped directly and are at least 44px tall.

## What was actually tested, and on what

**Honest scope:** no physical phone and no real iOS Safari were available in this
environment. There is one browser engine here — the host Chrome build at
`/opt/google/chrome/chrome`, version 156.0.8078.47 — plus Node. WebKit (the engine
behind iOS Safari) could not be installed: `npx playwright install webkit` fails
on missing system libraries (`libicuuc.so.66`, `libwebp.so.6`, and others) that I
am not permitted to install on this host.

So the mobile testing is **Chrome device emulation**, which is a real test of the
DOM, CSS, touch event plumbing, viewport behaviour and control logic, but is
**not** a substitute for Safari. Specifically:

| Claim | Status |
| --- | --- |
| Touch controls work with two simultaneous fingers | **Tested** — real multi-touch via Chrome DevTools Protocol on four emulated profiles |
| iOS Safari touch behaviour | **Not tested on a real device.** The code avoids the known trap (it does not fire `touch*` and `pointer*` handlers at the same time), but that is a code review, not a test |
| Android Chrome touch behaviour | **Not tested on a real device.** Emulated Chrome on a Pixel 7 profile only |
| Small-viewport layout (320x568) | **Tested** — no sideways scroll, finger-sized targets |
| Landscape | **Tested** — emulated iPhone 13 landscape |
| Frame rate on real hardware | **Not tested.** All figures are software rasterisation with no GPU |

Emulated profiles in `npm run test:mobile`: iPhone 13 portrait, iPhone 13
landscape, Pixel 7 portrait, iPhone SE (small). Each runs the same scripted
playthrough. Real-device verification is a sensible next step before treating the
preview as final.

## What is verified in this candidate

- First quest reachable end to end by touch: walk, look, talk to Mara, accept.
- Save from the pause sheet, reload the page, and *Continue saved game* restores
  quest state, inventory, reputation and position.
- Simultaneous left-thumb movement and right-thumb look.
- Releasing the stick stops movement; the pause sheet blocks movement input.
- No horizontal scrolling; dialogue and journal fit the viewport.
- Adaptive resolution runs and lowers the pixel ratio on slow hardware.
- No network requests to anything outside the served origin (asserted by an
  interception test that aborts every off-origin request, then playing the game).
- The build identifies itself as `0.3.0` both in code and on the page.

Everything above is re-run by `npm run test:mobile` (93 checks × 4 profiles) and
`npm run test:browser` (70 checks).

## A note on frame rate

Everything here was captured on software rasterisation (`SwiftShader`), where
the scene runs at roughly 2–3.5 fps at a phone viewport. That is a property of
this test machine having no GPU, not of the game: adaptive resolution and the
draw-call budget are tuned for it, and the playtest reports the ratio it settled
on. Frame-rate *feel* on a real phone has not been measured, and the candidate
should be judged for correctness and controls first.
