# Nail Buddy

The cartoon plays while hands stay away from the mouth. The camera tracks the face and hands (MediaPipe, fully local in the browser).
A fingertip at the mouth for more than 1.5 s pauses the video, shows a cartoon germ and plays a voice line. Hands down, and after ~0.7 s the cartoon continues.

Live: https://evgenyskoropisov.github.io/nailbuddy/

## Run on an iPad next to the TV
Open the live link in Safari, allow the camera, then Control Center → Screen Mirroring → your TV. Keep the iPad on charge. Guided Access (Settings → Accessibility) keeps the kid inside Safari.

## Run on the MacBook
Double-click `start.command`, allow the camera, pick a cartoon, press Start.

## For parents
Gear icon, bottom right: seconds at the mouth, size of the mouth zone, the germ's phrase, voice on/off, camera preview (key `c`), Test (key `t`), pause counter.

## Files
- `guard.js` geometry and timer (no DOM), tests: `node test-guard.mjs`
- `app.js` camera, models, player, reminder screen
- `models/`, `vendor/` local models and MediaPipe 0.10.14 (works offline except YouTube)
- Test without a camera (local only, `testdata/` is not in the repo): `http://localhost:4175/?camsrc=testdata/sequence.mp4`

