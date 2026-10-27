import * as THREE from 'three';

/**
 * A deliberately simple one-room pavilion.
 *
 * Local coordinates: the origin is the centre of the entrance threshold, +x is right,
 * +y is up and the room extends towards -z. In AR the user places that threshold on the
 * floor and walks forward into the building.
 *
 *   back wall (z = -6)  ── big glass window facing the landscape
 *   side walls          ── x = ±4
 *   front wall (z = 0)  ── door opening
 */
export const DIMS = { W: 8, D: 6, H: 3, T: 0.2 };
export const DECK = { x0: -4.4, x1: 4.4, z0: -6.4, z1: 0.8 }; // walkable slab footprint
export const WINDOW = { w: 5, h: 1.9, sill: 0.7 };

function woodTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 512;
  const g = cv.getContext('2d');
  const plank = 64;
  for (let i = 0; i < 8; i++) {
    const l = 52 + Math.random() * 10;
    g.fillStyle = `hsl(30 ${38 + Math.random() * 8}% ${l}%)`;
    g.fillRect(0, i * plank, 512, plank);
    for (let k = 0; k < 40; k++) {
      g.strokeStyle = `hsla(28 40% ${30 + Math.random() * 20}% / ${0.08 + Math.random() * 0.1})`;
      g.beginPath();
      const y = i * plank + Math.random() * plank;
      g.moveTo(0, y);
      g.lineTo(512, y + (Math.random() - 0.5) * 3);
      g.stroke();
    }
    g.fillStyle = 'rgba(40,25,12,0.55)';
    g.fillRect(0, i * plank, 512, 2);
    const joint = Math.random() * 512;
    g.fillRect(joint, i * plank, 2, plank);
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function createBuilding() {
  const { W, D, H, T } = DIMS;
  const hw = W / 2;
  const group = new THREE.Group();
  group.name = 'building';
  const roofGroup = new THREE.Group();
  group.add(roofGroup);
  const colliders = [];

  const plaster = new THREE.MeshStandardMaterial({ color: 0xf0ebe2, roughness: 0.92 });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x20252a, roughness: 0.4, metalness: 0.6 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x383c42, roughness: 0.8 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55 });
  woodMat.map = woodTexture();
  woodMat.map.repeat.set((DECK.x1 - DECK.x0) / 2, (DECK.z1 - DECK.z0) / 2); // ~2 m per texture tile
  const fabric = new THREE.MeshStandardMaterial({ color: 0x5d7b8a, roughness: 1 });
  const rugMat = new THREE.MeshStandardMaterial({ color: 0xc9b79c, roughness: 1 });
  const darkWood = new THREE.MeshStandardMaterial({ color: 0x4a3526, roughness: 0.6 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f7d3a, roughness: 0.8 });
  const potMat = new THREE.MeshStandardMaterial({ color: 0xb5623f, roughness: 0.8 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff1d6, emissive: 0xffd9a0, emissiveIntensity: 2.2 });

  /** Axis-aligned box from min/max extents. */
  function box(x0, x1, y0, y1, z0, z1, mat, { collide = false, parent = group, shadow = true } = {}) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    m.castShadow = shadow;
    m.receiveShadow = true;
    parent.add(m);
    if (collide && y0 < 1.8) colliders.push({ x0, x1, z0, z1 });
    return m;
  }

  /* ---- floor slab / deck ---- */
  box(DECK.x0, DECK.x1, -0.45, 0, DECK.z0, DECK.z1, woodMat);

  /* ---- walls ---- */
  const wall = (x0, x1, y0, y1, z0, z1) => box(x0, x1, y0, y1, z0, z1, plaster, { collide: true });
  // side walls span the full depth; front/back sit between them
  wall(-hw, -hw + T, 0, H, -D, 0);
  wall(hw - T, hw, 0, H, -D, 0);
  const ix0 = -hw + T, ix1 = hw - T;

  // front wall with a door opening (1.2 x 2.2 m)
  const door = { x: 0.6, h: 2.2 };
  wall(ix0, -door.x, 0, H, -T, 0);
  wall(door.x, ix1, 0, H, -T, 0);
  wall(-door.x, door.x, door.h, H, -T, 0);
  box(-door.x - 0.05, -door.x, 0, door.h + 0.05, -T - 0.01, 0.01, frameMat, { shadow: false });
  box(door.x, door.x + 0.05, 0, door.h + 0.05, -T - 0.01, 0.01, frameMat, { shadow: false });
  box(-door.x - 0.05, door.x + 0.05, door.h, door.h + 0.05, -T - 0.01, 0.01, frameMat, { shadow: false });

  // back wall with the panorama window opening
  const wx = WINDOW.w / 2, wy0 = WINDOW.sill, wy1 = WINDOW.sill + WINDOW.h;
  const bz0 = -D, bz1 = -D + T, bzc = -D + T / 2;
  wall(ix0, -wx, 0, H, bz0, bz1);
  wall(wx, ix1, 0, H, bz0, bz1);
  wall(-wx, wx, 0, wy0, bz0, bz1);
  wall(-wx, wx, wy1, H, bz0, bz1);

  /* ---- window frame + glass ---- */
  const fz0 = bzc - 0.045, fz1 = bzc + 0.045, fw = 0.06;
  box(-wx, wx, wy0, wy0 + fw, fz0, fz1, frameMat, { shadow: false });
  box(-wx, wx, wy1 - fw, wy1, fz0, fz1, frameMat, { shadow: false });
  box(-wx, -wx + fw, wy0, wy1, fz0, fz1, frameMat, { shadow: false });
  box(wx - fw, wx, wy0, wy1, fz0, fz1, frameMat, { shadow: false });
  for (const x of [-wx / 3, wx / 3]) box(x - 0.025, x + 0.025, wy0, wy1, fz0, fz1, frameMat, { shadow: false });
  box(-wx - 0.08, wx + 0.08, wy0 - 0.04, wy0, bz1 - 0.02, bz1 + 0.22, darkWood, { shadow: false }); // inner sill

  const cy = (wy0 + wy1) / 2;
  // faint tint
  const tint = new THREE.Mesh(
    new THREE.PlaneGeometry(WINDOW.w, WINDOW.h),
    new THREE.MeshBasicMaterial({ color: 0x9fd0e8, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide })
  );
  tint.position.set(0, cy, bzc);
  tint.renderOrder = 10;
  // sky reflection added on top of what is behind the glass
  const shine = new THREE.Mesh(
    new THREE.PlaneGeometry(WINDOW.w, WINDOW.h),
    new THREE.MeshStandardMaterial({
      color: 0x000000, metalness: 1, roughness: 0.04, envMapIntensity: 0.22,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    })
  );
  shine.position.set(0, cy, bzc + 0.003);
  shine.renderOrder = 11;
  group.add(tint, shine);

  /* ---- portal mask: writes stencil=1 inside the window opening (visible from inside only) ---- */
  const mask = new THREE.Mesh(
    new THREE.PlaneGeometry(WINDOW.w + 0.02, WINDOW.h + 0.02),
    new THREE.MeshBasicMaterial({
      colorWrite: false, depthWrite: false, side: THREE.FrontSide,
      stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc,
      stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.ReplaceStencilOp,
    })
  );
  mask.position.set(0, cy, bzc - 0.05);
  mask.renderOrder = 1;
  group.add(mask);

  /* ---- roof ---- */
  box(-hw - 0.5, hw + 0.5, H, H + 0.25, -D - 0.5, 0.9, roofMat, { parent: roofGroup });
  box(ix0, ix1, H - 0.05, H, -D + T, -T, plaster, { parent: roofGroup, shadow: false }); // light ceiling lining

  /* ---- furniture ---- */
  // rug
  box(-1.7, 1.7, 0.001, 0.02, -4.7, -2.5, rugMat, { shadow: false });
  // sofa facing the window
  box(-1.1, 1.1, 0.0, 0.42, -2.35, -1.6, fabric, { collide: true });
  box(-1.1, 1.1, 0.42, 0.92, -1.85, -1.6, fabric);
  box(-1.1, -0.9, 0.42, 0.62, -2.35, -1.85, fabric);
  box(0.9, 1.1, 0.42, 0.62, -2.35, -1.85, fabric);
  // coffee table
  box(-0.55, 0.55, 0.36, 0.41, -4.1, -3.5, darkWood, { collide: true });
  for (const [x, z] of [[-0.5, -4.05], [0.5, -4.05], [-0.5, -3.55], [0.5, -3.55]]) box(x - 0.03, x + 0.03, 0, 0.36, z - 0.03, z + 0.03, darkWood);
  // shelf on the west wall
  box(-hw + T, -hw + T + 0.4, 0, 1.9, -4.6, -2.8, darkWood, { collide: true });
  // plant in the corner
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.16, 0.4, 16), potMat);
  pot.position.set(3.3, 0.2, -5.3);
  pot.castShadow = true;
  const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 1), leafMat);
  bush.position.set(3.3, 0.85, -5.3);
  bush.scale.y = 1.3;
  bush.castShadow = true;
  group.add(pot, bush);
  colliders.push({ x0: 3.05, x1: 3.55, z0: -5.55, z1: -5.05 });
  // pendant lamp
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.7), frameMat);
  cord.position.set(0, H - 0.35, -3.2);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 12), lampMat);
  bulb.position.set(0, H - 0.8, -3.2);
  group.add(cord, bulb);
  const lamp = new THREE.PointLight(0xffe0b0, 5, 9, 2);
  lamp.position.set(0, H - 0.9, -3.2);
  group.add(lamp);

  return { group, roofGroup, colliders, mask };
}
