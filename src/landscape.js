import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const WATER_LEVEL = -3.5;
export const SUN_DIR = new THREE.Vector3(-0.45, 0.55, -0.8).normalize();

/* ---------- tiny value-noise helpers (deterministic) ---------- */
function hash(ix, iz) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function noise2(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  let fx = x - ix, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx);
  fz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}
function fbm(x, z, oct = 4) {
  let s = 0, a = 0.5;
  for (let i = 0; i < oct; i++) {
    s += a * noise2(x, z);
    x *= 2.03; z *= 2.03; a *= 0.5;
  }
  return s;
}
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/**
 * Terrain height in landscape-local coordinates (origin = building centre).
 * Flat plateau around the building, rolling hills, a lake to the north and a ring of mountains.
 */
export function terrainHeight(x, z) {
  const d = Math.hypot(x, z);
  let h = (fbm(x * 0.012, z * 0.012) - 0.5) * 24 + (fbm(x * 0.045, z * 0.045) - 0.5) * 5;
  h += smoothstep(120, 300, d) * (38 + fbm(x * 0.008 + 9, z * 0.008 + 4) * 95);
  const lake = 1 - smoothstep(18, 60, Math.hypot(x - 15, z + 95));
  h -= lake * 15;
  return -0.3 + h * smoothstep(12, 46, d);
}

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const SKY_FRAG = /* glsl */ `
  varying vec3 vDir;
  uniform vec3 sunDir;
  float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n2(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 5; i++) { s += a * n2(p); p *= 2.03; a *= 0.5; }
    return s;
  }
  void main() {
    vec3 d = normalize(vDir);
    vec3 horizon = vec3(0.80, 0.89, 0.96);
    vec3 zenith = vec3(0.20, 0.44, 0.82);
    vec3 col = mix(horizon, zenith, pow(clamp(d.y, 0.0, 1.0), 0.5));
    float s = max(dot(d, normalize(sunDir)), 0.0);
    col += vec3(1.0, 0.85, 0.6) * pow(s, 8.0) * 0.28 + vec3(1.0, 0.95, 0.85) * pow(s, 500.0) * 3.0;
    if (d.y > 0.02) {
      vec2 uv = d.xz / (d.y + 0.18) * 1.4;
      float c = smoothstep(0.48, 0.82, fbm(uv + vec2(3.0, 1.0)));
      col = mix(col, vec3(1.0), c * 0.85 * smoothstep(0.02, 0.25, d.y));
    }
    if (d.y < 0.0) col = mix(horizon, vec3(0.55, 0.62, 0.5), clamp(-d.y * 4.0, 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

function makeSkyMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { sunDir: { value: SUN_DIR.clone() } },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
}

/**
 * Builds the landscape that sits behind the glass window.
 * Everything in `materials` can be switched into "portal" mode (visible only where the
 * window mask wrote the stencil buffer) – that is what makes it look like a view through
 * the glass when the building is placed in the real world with AR.
 */
export function createLandscape() {
  const group = new THREE.Group();
  group.name = 'landscape';
  const materials = [];
  const ORDER = 3; // after the building (0) and the portal mask (1)

  /* --- sky dome --- */
  const skyMat = makeSkyMaterial();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(450, 32, 16), skyMat);
  sky.renderOrder = 2;
  sky.frustumCulled = false;
  group.add(sky);
  materials.push(skyMat);

  /* --- terrain --- */
  const SIZE = 900, SEG = 240;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const grassA = new THREE.Color(0x5b8a38), grassB = new THREE.Color(0x86ab4f);
  const sand = new THREE.Color(0xd2c391), seabed = new THREE.Color(0x8d8a6a);
  const rock = new THREE.Color(0x7d7b76), snow = new THREE.Color(0xf2f5f7);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = terrainHeight(x, z);
    pos.setY(i, h);
    c.copy(grassA).lerp(grassB, noise2(x * 0.05, z * 0.05));
    c.lerp(sand, smoothstep(WATER_LEVEL + 1.4, WATER_LEVEL + 0.3, h));
    c.lerp(seabed, smoothstep(WATER_LEVEL, WATER_LEVEL - 2, h));
    c.lerp(rock, smoothstep(26, 48, h));
    c.lerp(snow, smoothstep(75, 95, h));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  const terrain = new THREE.Mesh(geo, terrainMat);
  terrain.receiveShadow = true;
  terrain.renderOrder = ORDER;
  group.add(terrain);
  materials.push(terrainMat);

  /* --- lake --- */
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x1f6f9a, roughness: 0.06, metalness: 0.1 });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE).rotateX(-Math.PI / 2), waterMat);
  water.position.y = WATER_LEVEL;
  water.renderOrder = ORDER;
  group.add(water);
  materials.push(waterMat);

  /* --- pine trees (instanced) --- */
  const trunkGeo = new THREE.CylinderGeometry(0.12, 0.2, 1.8, 6).translate(0, 0.9, 0);
  const leafGeo = mergeGeometries([
    new THREE.ConeGeometry(1.5, 3.2, 8).translate(0, 3.0, 0),
    new THREE.ConeGeometry(1.1, 2.6, 8).translate(0, 4.7, 0),
  ]);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a3f2a, roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
  const spots = [];
  for (let tries = 0; tries < 9000 && spots.length < 700; tries++) {
    const a = hash(tries, 11) * Math.PI * 2;
    const r = 20 + Math.sqrt(hash(tries, 23)) * 240;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const h = terrainHeight(x, z);
    if (h < WATER_LEVEL + 1.2 || h > 32) continue;
    const forest = noise2(x * 0.02 + 5, z * 0.02 + 5);
    if (forest < 0.52 && !(r < 50 && hash(tries, 37) < 0.12)) continue;
    spots.push([x, h, z, 0.8 + hash(tries, 5) * 0.9, hash(tries, 7)]);
  }
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
  const leaves = new THREE.InstancedMesh(leafGeo, leafMat, spots.length);
  const dummy = new THREE.Object3D();
  const leafCol = new THREE.Color();
  spots.forEach(([x, h, z, s, v], i) => {
    dummy.position.set(x, h - 0.1, z);
    dummy.rotation.y = v * 6.28;
    dummy.scale.set(s, s * (0.9 + v * 0.4), s);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    leaves.setMatrixAt(i, dummy.matrix);
    leaves.setColorAt(i, leafCol.setHSL(0.30 + v * 0.05, 0.45, 0.2 + v * 0.1));
  });
  trunks.renderOrder = leaves.renderOrder = ORDER;
  group.add(trunks, leaves);
  materials.push(trunkMat, leafMat);

  /** Show the landscape only where the window mask wrote stencil=1 (AR), or everywhere (normal). */
  function setPortal(on) {
    for (const m of materials) {
      m.stencilWrite = on;
      m.stencilRef = 1;
      m.stencilFunc = THREE.EqualStencilFunc;
      m.stencilFail = m.stencilZFail = m.stencilZPass = THREE.KeepStencilOp;
      m.needsUpdate = true;
    }
  }

  /** Scene used to bake a reflection / ambient environment map. */
  function createEnvScene() {
    const s = new THREE.Scene();
    s.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), makeSkyMaterial()));
    return s;
  }

  return { group, setPortal, createEnvScene, terrainHeight };
}
