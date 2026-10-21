// node test-guard.mjs
import assert from 'node:assert/strict';
import { createGuard, mouthFromFace, closestTip, roiFromPose } from './guard.js';

function run(frames, opts) {
  const g = createGuard(opts);
  const events = [];
  for (const [t, near] of frames) { const e = g.update(t, near); if (e) events.push([t, e]); }
  return { g, events };
}
const seq = (from, to, near, step = 66) => {
  const out = []; for (let t = from; t <= to; t += step) out.push([t, near]); return out;
};

// 1. A quick touch (1s) never triggers
{
  const { events } = run([...seq(0, 1000, true), ...seq(1066, 3000, false)]);
  assert.deepEqual(events, []);
}
// 2. Holding 2s triggers once, around 1.5s
{
  const { events, g } = run(seq(0, 2000, true));
  assert.equal(events.length, 1);
  assert.equal(events[0][1], 'alert');
  assert.ok(events[0][0] >= 1500 && events[0][0] < 1600);
  assert.equal(g.state.alerts, 1);
}
// 3. One missed frame in the middle does not reset the timer
{
  const frames = [...seq(0, 800, true), [866, false], ...seq(932, 1700, true)];
  const { events } = run(frames);
  assert.equal(events.length, 1);
}
// 4. Release only after hands are away 0.8s, then a new hold re-triggers
{
  const frames = [...seq(0, 2000, true), ...seq(2066, 2500, false), ...seq(2566, 2700, true),
    ...seq(2766, 3700, false), ...seq(3766, 5500, true)];
  const { events } = run(frames);
  assert.deepEqual(events.map(e => e[1]), ['alert', 'release', 'alert']);
}
// 5. Geometry: fingertip at the mouth vs at the ear
{
  const face = []; for (let i = 0; i < 478; i++) face[i] = { x: 0.5, y: 0.5 };
  face[13] = { x: 0.5, y: 0.6 }; face[14] = { x: 0.5, y: 0.62 };
  face[234] = { x: 0.35, y: 0.5 }; face[454] = { x: 0.65, y: 0.5 };
  const mouth = mouthFromFace(face, 640, 480);
  const hand = (x, y) => { const h = []; for (let i = 0; i < 21; i++) h[i] = { x: 0.9, y: 0.9 }; h[8] = { x, y }; return h; };
  assert.ok(closestTip([hand(0.51, 0.61)], mouth, 640, 480).ratio < 0.1);
  assert.ok(closestTip([hand(0.33, 0.45)], mouth, 640, 480).ratio > 0.5);
}
// 6. Crop around a small, far-away kid: square, inside the frame, centered near the face
{
  const pose = []; for (let i = 0; i < 33; i++) pose[i] = { x: 0.5, y: 0.5 };
  pose[0] = { x: 0.7, y: 0.4 }; pose[7] = { x: 0.68, y: 0.39 }; pose[8] = { x: 0.72, y: 0.39 };
  pose[11] = { x: 0.65, y: 0.5 }; pose[12] = { x: 0.75, y: 0.5 };
  const r = roiFromPose(pose, 1280, 720);
  assert.ok(r.side > 200 && r.side < 400, 'side ' + r.side);
  assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.side <= 1280 && r.y + r.side <= 720);
  assert.ok(Math.abs(r.x + r.side / 2 - 0.7 * 1280) < 2);
  // a kid right at the camera: the crop is clamped to the frame
  pose[11] = { x: 0.1, y: 0.9 }; pose[12] = { x: 0.9, y: 0.9 };
  const big = roiFromPose(pose, 1280, 720);
  assert.equal(big.side, 720);
}
console.log('all guard tests passed');
