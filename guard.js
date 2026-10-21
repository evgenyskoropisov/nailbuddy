// Pure logic: geometry "is a fingertip at the mouth?" + the timer state machine.
// No DOM here, so it can be tested in node (see test-guard.mjs).

export const FINGERTIPS = [4, 8, 12, 16, 20];
const MOUTH_TOP = 13, MOUTH_BOTTOM = 14, CHEEK_L = 234, CHEEK_R = 454;

// Landmarks are normalized (0..1). Convert to pixels so x and y share a scale.
const px = (p, w, h) => ({ x: p.x * w, y: p.y * h });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function mouthFromFace(face, w, h) {
  const top = px(face[MOUTH_TOP], w, h), bottom = px(face[MOUTH_BOTTOM], w, h);
  const center = { x: (top.x + bottom.x) / 2, y: (top.y + bottom.y) / 2 };
  const faceWidth = dist(px(face[CHEEK_L], w, h), px(face[CHEEK_R], w, h));
  return { center, faceWidth };
}

// Long range: on the sofa 3-4 m away the face is too small for the face and hand models.
// The body (pose) model still finds the kid, so we use it only to say WHERE the head is,
// then crop that square (head plus room for hands) and run the precise models on the zoomed crop.
const P_NOSE = 0, P_EAR_L = 7, P_EAR_R = 8, P_SHOULDER_L = 11, P_SHOULDER_R = 12;

export function roiFromPose(pose, w, h) {
  const nose = px(pose[P_NOSE], w, h);
  const ears = dist(px(pose[P_EAR_L], w, h), px(pose[P_EAR_R], w, h));
  const shoulders = dist(px(pose[P_SHOULDER_L], w, h), px(pose[P_SHOULDER_R], w, h));
  const head = Math.max(ears, shoulders * 0.45); // ears ~ face width; shoulders keep it sane when the head turns
  // generous: hands at the mouth stick out well past the face; never zoom tighter than ~28% of the frame
  const side = Math.min(Math.max(head * 6, 0.28 * Math.min(w, h)), w, h);
  const cx = nose.x, cy = nose.y + head * 0.6; // hands come up from below the chin
  return {
    x: Math.min(Math.max(cx - side / 2, 0), w - side),
    y: Math.min(Math.max(cy - side / 2, 0), h - side),
    side,
  };
}

// Returns the closest fingertip distance, measured in face widths (scale-free:
// works whether the kid sits close to the screen or far away).
export function closestTip(hands, mouth, w, h) {
  let best = Infinity, bestPoint = null;
  for (const hand of hands) {
    for (const i of FINGERTIPS) {
      const p = px(hand[i], w, h);
      const d = dist(p, mouth.center) / mouth.faceWidth;
      if (d < best) { best = d; bestPoint = p; }
    }
  }
  return { ratio: best, point: bestPoint };
}

export function createGuard(opts) {
  const o = { holdMs: 1500, graceMs: 400, releaseMs: 800, ...opts };
  const s = { phase: 'watching', nearSince: null, lastNearAt: -Infinity, alerts: 0, nearMsTotal: 0, lastT: null };

  function update(now, near) {
    if (near && s.lastT !== null) s.nearMsTotal += now - s.lastT;
    s.lastT = now;
    let event = null;

    if (s.phase === 'watching') {
      if (near) {
        if (s.nearSince === null) s.nearSince = now;
        s.lastNearAt = now;
        if (now - s.nearSince >= o.holdMs) {
          s.phase = 'alert'; s.alerts++; event = 'alert';
        }
      } else if (s.nearSince !== null && now - s.lastNearAt > o.graceMs) {
        // short flickers (detector missed one frame) don't reset the timer
        s.nearSince = null;
      }
    } else {
      if (near) s.lastNearAt = now;
      else if (now - s.lastNearAt >= o.releaseMs) {
        s.phase = 'watching'; s.nearSince = null; event = 'release';
      }
    }
    return event;
  }

  // 0..1 progress of the hold timer, for the little ring on the camera preview
  const progress = (now) =>
    s.phase === 'alert' ? 1 : s.nearSince === null ? 0 : Math.min(1, (now - s.nearSince) / o.holdMs);

  return { update, progress, state: s, options: o };
}
