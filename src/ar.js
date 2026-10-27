import * as THREE from 'three';
import { DECK } from './building.js';

/**
 * WebXR immersive-AR placement.
 *
 * 1. A hit-test reticle follows the real floor; a footprint outline previews the building.
 * 2. Tap to place the entrance threshold on the floor, with the door facing you.
 * 3. Walk (physically) into the building. The landscape is only drawn through the window
 *    (stencil portal), everything else is your real surroundings.
 */
export class ARSession {
  constructor({ renderer, scene, camera, world, overlay, onStart, onEnd, onState }) {
    Object.assign(this, { renderer, scene, camera, world, overlay, onStart, onEnd, onState });
    this.session = null;
    this.hitSource = null;
    this.placing = false;
    this.scale = 1;

    this.reticle = new THREE.Mesh(
      new THREE.RingGeometry(0.12, 0.16, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    this.reticle.matrixAutoUpdate = false;
    this.reticle.visible = false;

    // footprint outline (deck rectangle) + arrow showing where the door is
    const { x0, x1, z0, z1 } = DECK;
    const pts = [[x0, z1], [x1, z1], [x1, z0], [x0, z0]].map(([x, z]) => new THREE.Vector3(x, 0.01, z));
    this.ghost = new THREE.Group();
    this.ghost.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x7fe3c1 })));
    this.ghost.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.01, 1.8), new THREE.Vector3(0, 0.01, 0), new THREE.Vector3(0.3, 0.01, 0.5), new THREE.Vector3(0, 0.01, 0), new THREE.Vector3(-0.3, 0.01, 0.5)]),
        new THREE.LineBasicMaterial({ color: 0x7fe3c1 })
      )
    );
    this.ghost.visible = false;
    scene.add(this.reticle, this.ghost);
  }

  static async supported() {
    try {
      return !!navigator.xr && (await navigator.xr.isSessionSupported('immersive-ar'));
    } catch {
      return false;
    }
  }

  async start() {
    const session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['local-floor', 'dom-overlay'],
      domOverlay: { root: this.overlay },
    });
    this.session = session;
    this.renderer.xr.setReferenceSpaceType('local-floor');
    await this.renderer.xr.setSession(session);

    const viewer = await session.requestReferenceSpace('viewer');
    this.hitSource = await session.requestHitTestSource({ space: viewer });
    session.addEventListener('select', () => this._place());
    session.addEventListener('end', () => this._cleanup());

    this.world.visible = false;
    this.placing = true;
    this.onStart();
    this.onState('placing');
  }

  end() {
    this.session?.end();
  }

  replace() {
    this.placing = true;
    this.world.visible = false;
    this.onState('placing');
  }

  setScale(s) {
    this.scale = s;
    this.world.scale.setScalar(s);
  }

  /** Call once per XR frame. */
  update(frame) {
    if (!this.placing || !this.hitSource || !frame) return;
    const results = frame.getHitTestResults(this.hitSource);
    const refSpace = this.renderer.xr.getReferenceSpace();
    const pose = results.length ? results[0].getPose(refSpace) : null;
    this.reticle.visible = this.ghost.visible = !!pose;
    if (!pose) return;
    this.reticle.matrix.fromArray(pose.transform.matrix);
    const p = new THREE.Vector3().setFromMatrixPosition(this.reticle.matrix);
    this.ghost.position.copy(p);
    this.ghost.rotation.y = this._yawTowardViewer(p);
    this.ghost.scale.setScalar(this.scale);
  }

  _yawTowardViewer(p) {
    const cam = this.renderer.xr.getCamera().position;
    return Math.atan2(cam.x - p.x, cam.z - p.z);
  }

  _place() {
    if (!this.placing || !this.reticle.visible) return;
    const p = new THREE.Vector3().setFromMatrixPosition(this.reticle.matrix);
    this.world.position.copy(p);
    this.world.rotation.y = this._yawTowardViewer(p);
    this.world.scale.setScalar(this.scale);
    this.world.visible = true;
    this.placing = false;
    this.reticle.visible = this.ghost.visible = false;
    this.onState('placed');
  }

  _cleanup() {
    this.hitSource?.cancel();
    this.hitSource = null;
    this.session = null;
    this.placing = false;
    this.reticle.visible = this.ghost.visible = false;
    this.world.position.set(0, 0, 0);
    this.world.rotation.set(0, 0, 0);
    this.world.scale.setScalar(1);
    this.world.visible = true;
    this.scale = 1;
    this.onEnd();
  }
}
