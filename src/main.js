import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createLandscape, SUN_DIR } from './landscape.js';
import { createBuilding, DECK, DIMS } from './building.js';
import { Walker } from './walk.js';
import { ARSession } from './ar.js';
import { MotionControl } from './motion.js';

const $ = (s) => document.querySelector(s);
const stage = $('#stage');
const center = new THREE.Vector3(0, 1.2, -DIMS.D / 2);

/* ------------------------------------------------------------------ renderer / scene */
const renderer = new THREE.WebGLRenderer({ canvas: stage, antialias: true, alpha: true, stencil: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.xr.enabled = true;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xcfe3f1, 90, 420);
const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 1000);

// everything that belongs to the building lives in `world`, so AR can move / scale it as one
const world = new THREE.Group();
scene.add(world);

const landscape = createLandscape();
landscape.group.position.copy(new THREE.Vector3(0, 0, -DIMS.D / 2));
world.add(landscape.group);

const building = createBuilding();
world.add(building.group);

// sun + sky light
const sun = new THREE.DirectionalLight(0xfff0d8, 3.2);
sun.position.copy(SUN_DIR).multiplyScalar(40).add(new THREE.Vector3(0, 0, -3));
sun.target.position.set(0, 0, -3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -13, right: 13, top: 13, bottom: -13, near: 1, far: 90 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
world.add(sun, sun.target);
world.add(new THREE.HemisphereLight(0xcfe6ff, 0x8a9a6a, 0.5));

// image-based light + reflections from the same procedural sky
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(landscape.createEnvScene(), 0.02).texture;
scene.environmentIntensity = 0.55;

// AR-only: lets the building cast a soft shadow on the real floor
const shadowCatcher = new THREE.Mesh(new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.3 }));
shadowCatcher.position.set(0, 0.002, -3);
shadowCatcher.receiveShadow = true;
shadowCatcher.visible = false;
world.add(shadowCatcher);

/* ------------------------------------------------------------------ controls */
const inDeck = (x, z) => x > DECK.x0 && x < DECK.x1 && z > DECK.z0 && z < DECK.z1;
const walker = new Walker(camera, stage, {
  colliders: building.colliders,
  groundY: (x, z) => (inDeck(x, z) ? 0 : landscape.terrainHeight(x, z + DIMS.D / 2)),
  bounds: (x, z) => Math.hypot(x, z + DIMS.D / 2) < 38,
  joystick: $('#joystick'),
});
const motion = new MotionControl(walker, { onState: (text) => { $('#hint').textContent = text; } });
const orbit = new OrbitControls(camera, stage);
orbit.target.copy(center);
orbit.enableDamping = true;
orbit.maxPolarAngle = Math.PI * 0.495;
orbit.minDistance = 4;
orbit.maxDistance = 45;
orbit.enabled = false;

/* ------------------------------------------------------------------ guided tour */
const tourStops = [
  { x: 0, z: 9, yaw: 0, pitch: 0.02, text: 'A simple one-room pavilion. Approach the entrance.' },
  { x: 0, z: 0.9, yaw: 0, pitch: 0, text: 'The door opens straight into the living room.' },
  { x: 0, z: -1.0, yaw: 0, pitch: -0.02, text: 'Living area: sofa, table and a pendant lamp.' },
  { x: 0.4, z: -4.5, yaw: 0.12, pitch: 0.04, text: 'The glass window: a 5 m panorama of the landscape beyond.' },
  { x: -1.6, z: -4.6, yaw: 0.9, pitch: 0.0, text: 'Look along the glass to the lake and the mountains.' },
];
const tour = { active: false, i: 0, t: 0, hold: 0 };

function startTour() {
  tour.active = true; tour.i = 0; tour.hold = 0;
  const s = tourStops[0];
  walker.setPose(s.x, s.z, s.yaw, s.pitch);
  showCaption(s.text);
}
function stopTour() {
  tour.active = false;
  showCaption('');
}
function updateTour(dt) {
  const s = tourStops[tour.i];
  const dist = Math.hypot(walker.x - s.x, walker.z - s.z);
  const aligned = Math.abs(Math.atan2(Math.sin(s.yaw - walker.yaw), Math.cos(s.yaw - walker.yaw)));
  if (dist < 0.05 && aligned < 0.03) {
    tour.hold += dt;
    if (tour.hold > 3.2) {
      tour.i = (tour.i + 1) % tourStops.length;
      tour.hold = 0;
      const n = tourStops[tour.i];
      if (tour.i === 0) walker.setPose(n.x, n.z, n.yaw, n.pitch); // loop back: jump instead of crossing walls
      showCaption(n.text);
    }
  } else {
    // walk to the stop at walking pace, turning smoothly
    const dx = s.x - walker.x, dz = s.z - walker.z, d = Math.hypot(dx, dz);
    const step = Math.min(d, 1.9 * dt);
    const nx = d > 1e-4 ? walker.x + (dx / d) * step : s.x;
    const nz = d > 1e-4 ? walker.z + (dz / d) * step : s.z;
    walker.blendTo({ x: nx, z: nz, yaw: s.yaw, pitch: s.pitch }, 1 - Math.pow(0.02, dt));
  }
}
function showCaption(text) {
  const el = $('#caption');
  el.textContent = text;
  el.classList.toggle('show', !!text);
}

/* ------------------------------------------------------------------ modes */
let mode = 'walk'; // walk | orbit | tour | ar
const hint = $('#hint');
const isTouch = matchMedia('(pointer: coarse)').matches;
const HINTS = {
  walk: isTouch ? 'Left thumb: move · Right thumb: look' : 'Click and drag (or click to lock the mouse) to look · WASD to move · Shift to run',
  orbit: 'Drag to orbit · scroll or pinch to zoom · toggle the roof for a cutaway',
  tour: 'Guided tour · move or click to take over',
};

function setMode(next) {
  if (mode === 'ar') return;
  if (mode === 'tour') stopTour();
  if (next !== 'walk' && motion.active) {
    motion.stop();
    $('#motion').classList.remove('on');
  }
  mode = next;
  walker.enable(next === 'walk' || next === 'tour');
  orbit.enabled = next === 'orbit';
  if (next === 'orbit') {
    camera.position.set(11, 6.5, 10);
    camera.rotation.order = 'XYZ';
    orbit.target.copy(center);
    orbit.update();
  } else {
    camera.rotation.order = 'YXZ';
    walker.setPose(walker.x, walker.z, walker.yaw, walker.pitch);
  }
  if (next === 'tour') startTour();
  document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === next));
  hint.textContent = HINTS[next] || '';
  document.body.classList.toggle('touch-walk', isTouch && (next === 'walk' || next === 'tour'));
}
walker.onUserInput = () => { if (mode === 'tour') setMode('walk'); };
document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

/* Phone-in-hand: gyro looks, real steps move (for browsers without WebXR, e.g. iOS Safari) */
const motionBtn = $('#motion');
motionBtn.hidden = !(isTouch && typeof DeviceOrientationEvent !== 'undefined');
motionBtn.addEventListener('click', async () => {
  if (motion.active) {
    motion.stop();
    motionBtn.classList.remove('on');
    hint.textContent = HINTS.walk;
    return;
  }
  setMode('walk');
  try {
    hint.textContent = 'Starting motion sensors…';
    await motion.start();
    motionBtn.classList.add('on');
  } catch (e) {
    hint.textContent = e.message;
  }
});

$('#roof').addEventListener('click', (e) => {
  building.roofGroup.visible = !building.roofGroup.visible;
  e.currentTarget.classList.toggle('on', !building.roofGroup.visible);
});

/* "AR look" simulation: portal-only landscape over a fake camera backdrop (works without a headset/phone) */
let sim = false;
function setSim(on) {
  sim = on;
  landscape.setPortal(on);
  shadowCatcher.visible = on;
  scene.fog.far = on ? 1e5 : 420;
  document.body.classList.toggle('sim', on);
  $('#sim').classList.toggle('on', on);
}
$('#sim').addEventListener('click', () => setSim(!sim));

/* ------------------------------------------------------------------ real AR (WebXR) */
const overlay = $('#ar-overlay');
const arStatus = $('#ar-status');
const ar = new ARSession({
  renderer, scene, camera, world, overlay,
  onStart() {
    mode = 'ar';
    walker.enable(false);
    orbit.enabled = false;
    landscape.setPortal(true);
    shadowCatcher.visible = true;
    scene.fog.far = 1e5;
    document.body.classList.add('ar');
    overlay.hidden = false;
  },
  onEnd() {
    overlay.hidden = true;
    document.body.classList.remove('ar');
    setSim(false);
    mode = 'walk';
    setMode('walk');
    walker.setPose(0, 5.5, 0, 0);
  },
  onState(s) {
    arStatus.textContent = s === 'placing'
      ? 'Aim the ring at the floor where the entrance should be, then tap.'
      : 'Placed. Walk through the door and look out of the window.';
    $('#ar-replace').hidden = s === 'placing';
  },
});
overlay.addEventListener('beforexrselect', (e) => e.preventDefault());
$('#ar-exit').addEventListener('click', () => ar.end());
$('#ar-replace').addEventListener('click', () => ar.replace());
overlay.querySelectorAll('[data-scale]').forEach((b) =>
  b.addEventListener('click', () => {
    ar.setScale(Number(b.dataset.scale));
    overlay.querySelectorAll('[data-scale]').forEach((x) => x.classList.toggle('on', x === b));
  })
);

const arBtn = $('#ar');
ARSession.supported().then((ok) => {
  if (ok) {
    arBtn.addEventListener('click', () => ar.start().catch((e) => { arBtn.textContent = 'AR failed: ' + e.message; }));
  } else {
    arBtn.disabled = true;
    arBtn.title = 'WebXR immersive-AR needs Chrome on an ARCore Android phone (HTTPS or localhost). Use “AR look” to preview the effect.';
    arBtn.querySelector('span').textContent = 'AR unavailable';
  }
});

/* ------------------------------------------------------------------ loop */
function resize() {
  const w = innerWidth, h = innerHeight;
  if (renderer.xr.isPresenting) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const clock = new THREE.Clock();
renderer.setAnimationLoop((_, frame) => {
  const dt = clock.getDelta();
  if (mode === 'walk') walker.update(dt);
  else if (mode === 'tour') updateTour(dt);
  else if (mode === 'orbit') orbit.update();
  else if (mode === 'ar') ar.update(frame);
  renderer.render(scene, camera);
});

setMode('walk');
walker.setPose(0, 6.5, 0, 0.0);

// handy for debugging from the console
window.__walk = { walker, motion, setMode, setSim, camera, scene, world, renderer };
