import { FilesetResolver, HandLandmarker, FaceLandmarker, PoseLandmarker } from './vendor/vision_bundle.mjs';
import { createGuard, mouthFromFace, closestTip, FINGERTIPS, roiFromPose } from './guard.js';

const $ = (id) => document.getElementById(id);

// ---------- settings (per device, best effort) ----------
const DEFAULTS = { hold: 1.5, dist: 0.32, phrase: 'Oops! Hands down, and the cartoon comes back!', voice: false, cam: true, camId: '' };
let settings = { ...DEFAULTS };
try { Object.assign(settings, JSON.parse(localStorage.getItem('nailbuddy.settings.en') || '{}')); } catch {}
const save = () => { try { localStorage.setItem('nailbuddy.settings.en', JSON.stringify(settings)); } catch {} };

// ---------- cartoons ----------
const CARTOONS = [
  { id: '2aWUgbdD4L0', label: 'Peppa\'s perfume' },
  { id: '9qShcQMq1cA', label: 'Water slide' },
  { id: '_8j4Vxb4DRI', label: 'Peppa and the weather' },
];
let chosen = { kind: 'yt', id: CARTOONS[0].id };

function youtubeId(text) {
  const t = text.trim();
  if (/^[\w-]{11}$/.test(t)) return t;
  const m = t.match(/(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([\w-]{11})/);
  return m ? m[1] : null;
}

const picks = $('picks');
CARTOONS.forEach((c, i) => {
  const b = document.createElement('button');
  b.className = 'pick';
  b.setAttribute('aria-pressed', i === 0);
  b.innerHTML = `<img alt="" src="https://i.ytimg.com/vi/${c.id}/mqdefault.jpg">${c.label}`;
  b.onclick = () => {
    picks.querySelectorAll('.pick').forEach(p => p.setAttribute('aria-pressed', p === b));
    $('url').value = '';
    chosen = { kind: 'yt', id: c.id };
  };
  picks.appendChild(b);
});
$('url').oninput = () => {
  const id = youtubeId($('url').value);
  if (id) { chosen = { kind: 'yt', id }; picks.querySelectorAll('.pick').forEach(p => p.setAttribute('aria-pressed', false)); }
};
$('file').onchange = () => {
  const f = $('file').files[0];
  if (f) { chosen = { kind: 'file', url: URL.createObjectURL(f) }; $('go').textContent = 'Start: ' + f.name.slice(0, 24); }
};

// ---------- player (YouTube or a local file) ----------
let yt = null;
const local = $('local');
const ytReady = new Promise((resolve) => {
  window.onYouTubeIframeAPIReady = resolve;
  const s = document.createElement('script');
  s.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(s);
});

async function startPlayer() {
  if (chosen.kind === 'file') {
    local.style.display = 'block';
    local.src = chosen.url;
    await local.play().catch(() => {});
    return;
  }
  await ytReady;
  yt = new YT.Player('yt', {
    videoId: chosen.id,
    playerVars: { autoplay: 1, rel: 0, playsinline: 1, modestbranding: 1, origin: location.origin },
    events: { onReady: (e) => e.target.playVideo() },
  });
}
const player = {
  isPlaying() {
    if (chosen.kind === 'file') return !local.paused;
    const st = yt?.getPlayerState?.();
    return st === 1 || st === 3; // playing or buffering
  },
  pause() { chosen.kind === 'file' ? local.pause() : yt?.pauseVideo?.(); },
  play() { chosen.kind === 'file' ? local.play().catch(() => {}) : yt?.playVideo?.(); },
};

// ---------- the reminder ----------
let audio = null, wasPlaying = false, alertOn = false, speakTimer = null;

function chime() {
  if (!audio) return;
  const t = audio.currentTime;
  [660, 880].forEach((f, i) => {
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0, t + i * 0.14);
    g.gain.linearRampToValueAtTime(0.25, t + i * 0.14 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.14 + 0.35);
    o.connect(g).connect(audio.destination);
    o.start(t + i * 0.14); o.stop(t + i * 0.14 + 0.4);
  });
}
function speak() {
  if (!settings.voice || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(settings.phrase);
  u.lang = 'en-US'; u.rate = 0.95; u.pitch = 1.5;
  speechSynthesis.speak(u);
}
function showAlert(on) {
  if (on === alertOn) return;
  alertOn = on;
  $('alert').classList.toggle('on', on);
  if (on) {
    wasPlaying = player.isPlaying();
    player.pause();
    chime();
    setTimeout(speak, 350);
    speakTimer = setInterval(speak, 7000); // gentle repeat if the hand stays there
  } else {
    clearInterval(speakTimer);
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    if (wasPlaying) player.play();
  }
}

// ---------- vision ----------
const camVideo = $('cam-video');
const canvas = $('preview'), ctx = canvas.getContext('2d');
let hands = null, face = null, pose = null;
// the zoomed crop the face and hand models look at when the kid is far away
const CROP = 512;
const crop = document.createElement('canvas');
crop.width = crop.height = CROP;
const cropCtx = crop.getContext('2d');
const guard = createGuard({ holdMs: settings.hold * 1000 });

async function loadModels() {
  const fileset = await FilesetResolver.forVisionTasks('./vendor/wasm');
  const make = async (delegate) => Promise.all([
    HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: './models/hand_landmarker.task', delegate },
      runningMode: 'VIDEO', numHands: 2, minHandDetectionConfidence: 0.4, minTrackingConfidence: 0.4,
    }),
    FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: './models/face_landmarker.task', delegate },
      runningMode: 'VIDEO', numFaces: 1, minFaceDetectionConfidence: 0.4, minTrackingConfidence: 0.4,
    }),
    PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: './models/pose_landmarker_full.task', delegate },
      runningMode: 'VIDEO', numPoses: 1, minPoseDetectionConfidence: 0.4, minTrackingConfidence: 0.4,
    }),
  ]);
  try { [hands, face, pose] = await make('GPU'); } catch { [hands, face, pose] = await make('CPU'); }
}
const modelsReady = loadModels();

// ?camsrc=testdata/sequence.mp4 feeds a recorded clip instead of the camera (for testing)
const testSource = (new URLSearchParams(location.search).get('camsrc') || '').match(/^testdata\/[\w.-]+$/)?.[0];

async function startCamera() {
  if (testSource) {
    camVideo.src = testSource; camVideo.loop = true;
  } else {
    camVideo.srcObject?.getTracks().forEach(t => t.stop());
    const which = settings.camId ? { deviceId: { exact: settings.camId } } : { facingMode: 'user' };
    try {
      camVideo.srcObject = await navigator.mediaDevices.getUserMedia({
        video: { ...which, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false,
      });
    } catch (err) {
      if (!settings.camId) throw err;
      settings.camId = ''; save(); // the saved camera was unplugged: fall back to the default one
      return startCamera();
    }
    listCameras();
  }
  await camVideo.play();
  canvas.width = 320;
  canvas.height = Math.round(320 * camVideo.videoHeight / camVideo.videoWidth) || 240;
}

// Camera picker (e.g. a USB camera on top of the TV instead of the laptop's own)
async function listCameras() {
  const sel = $('camSel');
  const cams = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
  const current = camVideo.srcObject?.getVideoTracks()[0]?.getSettings().deviceId;
  sel.innerHTML = cams.map((c, i) => `<option value="${c.deviceId}">${c.label || 'Camera ' + (i + 1)}</option>`).join('');
  sel.value = current || settings.camId;
}
$('camSel').onchange = async () => { settings.camId = $('camSel').value; save(); await startCamera(); };

let lastRun = 0, lastStats = 0, lastMouth = null, lastFaceAt = -Infinity, sessionStart = 0;
const eventLog = [], trace = [];
const FACE_MEMORY_MS = 1500; // a hand over the mouth often hides the face: remember where the mouth was
let roi = null, lastPoseAt = -Infinity;

function setStatus(text, level) {
  $('status').textContent = text;
  $('dot').className = 'dot ' + level;
}

function tick() {
  setTimeout(tick, 66); // ~15 fps is plenty; a timer (unlike rAF) keeps going in a background tab
  const now = performance.now();
  if (now - lastRun < 50 || camVideo.readyState < 2) return;
  lastRun = now;

  const W = camVideo.videoWidth, H = camVideo.videoHeight;

  // 1. find the kid anywhere in the frame (works from the sofa)
  const poses = pose.detectForVideo(camVideo, now).landmarks || [];
  if (poses.length) {
    const next = roiFromPose(poses[0], W, H);
    // smooth the crop so it doesn't jitter with every frame
    roi = roi ? { x: roi.x + (next.x - roi.x) * 0.35, y: roi.y + (next.y - roi.y) * 0.35, side: roi.side + (next.side - roi.side) * 0.35 } : next;
    lastPoseAt = now;
  } else if (now - lastPoseAt > 1000) roi = null;

  // 2. zoom in on the head and run the precise models there; close up, just use the whole frame
  const zoomed = roi && roi.side < 0.8 * Math.min(W, H);
  let source = camVideo, toFrame = (p) => p;
  if (zoomed) {
    const { x, y, side } = roi;
    cropCtx.drawImage(camVideo, x, y, side, side, 0, 0, CROP, CROP);
    source = crop;
    toFrame = (p) => ({ x: (x + p.x * side) / W, y: (y + p.y * side) / H }); // crop coords -> frame coords
  }
  const handPts = (hands.detectForVideo(source, now).landmarks || []).map(h => h.map(toFrame));
  const faces = (face.detectForVideo(source, now).faceLandmarks || []).map(f => f.map(toFrame));

  if (faces.length) { lastMouth = mouthFromFace(faces[0], W, H); lastFaceAt = now; }
  const mouth = now - lastFaceAt < FACE_MEMORY_MS ? lastMouth : null;

  let near = false, tip = null;
  if (mouth && handPts.length) {
    tip = closestTip(handPts, mouth, W, H);
    near = tip.ratio < settings.dist;
  }

  const ev = guard.update(now, near);
  if (testSource && trace.length < 3000) trace.push([+camVideo.currentTime.toFixed(2), handPts.length, faces.length, poses.length, tip ? +tip.ratio.toFixed(2) : null, zoomed ? Math.round(roi.side) : null, guard.state.phase[0]]);
  if (ev) eventLog.push({ ev, at: +camVideo.currentTime.toFixed(2), ratio: tip ? +tip.ratio.toFixed(2) : null });
  if (ev === 'alert') showAlert(true);
  if (ev === 'release') showAlert(false);

  if (guard.state.phase === 'alert') setStatus('Paused', 'bad');
  else if (near) setStatus('Hands at mouth…', 'warn');
  else if (!mouth) setStatus('No face', 'warn');
  else setStatus('Watching', 'ok');

  if (settings.cam) draw(W, H, handPts, zoomed ? roi : null, mouth, near, guard.progress(now));
  if (now - lastStats > 1000) { lastStats = now; renderStats(now); }
}

function draw(W, H, handPts, zoomBox, mouth, near, progress) {
  const cw = canvas.width, ch = canvas.height, sx = cw / W, sy = ch / H;
  ctx.save();
  ctx.translate(cw, 0); ctx.scale(-1, 1); // mirror, like a selfie
  ctx.drawImage(camVideo, 0, 0, cw, ch);
  ctx.restore();
  const X = (x) => cw - x * sx, Y = (y) => y * sy; // pixel coords -> mirrored canvas

  if (mouth) {
    const r = settings.dist * mouth.faceWidth * sx;
    ctx.lineWidth = 3;
    ctx.strokeStyle = near ? '#ff4f7b' : 'rgba(255,255,255,.85)';
    ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.arc(X(mouth.center.x), Y(mouth.center.y), r, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    if (progress > 0) {
      ctx.lineWidth = 6; ctx.strokeStyle = '#ffb300';
      ctx.beginPath();
      ctx.arc(X(mouth.center.x), Y(mouth.center.y), r + 6, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
      ctx.stroke();
    }
  }
  if (zoomBox) { // the zoomed area, so a parent sees the app found the kid far away
    ctx.lineWidth = 2; ctx.strokeStyle = '#5aa9ff';
    ctx.strokeRect(cw - (zoomBox.x + zoomBox.side) * sx, zoomBox.y * sy, zoomBox.side * sx, zoomBox.side * sy);
  }
  for (const hand of handPts) {
    for (const i of FINGERTIPS) {
      const p = hand[i];
      ctx.fillStyle = near ? '#ff4f7b' : '#6fd36a';
      ctx.beginPath(); ctx.arc(cw - p.x * cw, p.y * ch, 5, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function renderStats(now) {
  const s = guard.state;
  const mins = Math.max(0, (now - sessionStart) / 60000);
  $('stats').innerHTML =
    `Pauses: <b>${s.alerts}</b><br>Hands at mouth total: <b>${(s.nearMsTotal / 1000).toFixed(0)} s</b><br>Watching: <b>${mins.toFixed(0)} min</b>`;
}

// ---------- parent panel ----------
function bindPanel() {
  const hold = $('hold'), dist = $('dist');
  hold.value = settings.hold; dist.value = settings.dist;
  $('phrase').value = settings.phrase; $('voice').checked = settings.voice; $('cam').checked = settings.cam;
  const sync = () => {
    $('holdV').textContent = Number(settings.hold).toFixed(1);
    $('distV').textContent = Number(settings.dist).toFixed(2);
    guard.options.holdMs = settings.hold * 1000;
    $('corner').classList.toggle('hide-cam', !settings.cam);
    save();
  };
  hold.oninput = () => { settings.hold = +hold.value; sync(); };
  dist.oninput = () => { settings.dist = +dist.value; sync(); };
  $('phrase').oninput = () => { settings.phrase = $('phrase').value || DEFAULTS.phrase; save(); };
  $('voice').onchange = () => { settings.voice = $('voice').checked; save(); };
  $('cam').onchange = () => { settings.cam = $('cam').checked; sync(); };
  $('gear').onclick = () => $('panel').classList.toggle('open');
  $('test').onclick = () => { showAlert(true); setTimeout(() => showAlert(false), 3000); };
  $('reset').onclick = () => { guard.state.alerts = 0; guard.state.nearMsTotal = 0; sessionStart = performance.now(); renderStats(sessionStart); };
  sync();
}
bindPanel();
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'c') { settings.cam = !settings.cam; $('cam').checked = settings.cam; $('corner').classList.toggle('hide-cam', !settings.cam); save(); }
  if (e.key === 't') $('test').click();
});

// ---------- keep the screen on (iPad on a stand next to the TV) ----------
async function keepAwake() { try { await navigator.wakeLock?.request('screen'); } catch {} }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && sessionStart) keepAwake(); });

// ---------- start ----------
$('go').onclick = async () => {
  const go = $('go');
  go.disabled = true; go.textContent = 'Starting camera…';
  try {
    audio = new (window.AudioContext || window.webkitAudioContext)();
    await startCamera();
  } catch (err) {
    go.disabled = false; go.textContent = 'Start';
    alert('No camera access. Allow the camera for this page and press Start again.\n\n' + err.message);
    return;
  }
  go.textContent = 'Loading models…';
  await modelsReady;
  $('start').style.display = 'none';
  try { await document.documentElement.requestFullscreen?.(); } catch {}
  sessionStart = performance.now();
  keepAwake();
  await startPlayer();
  tick();
};
setStatus('Ready', 'ok');
window.__nailbuddy = { guard, showAlert, settings, eventLog, trace }; // for debugging in the console
