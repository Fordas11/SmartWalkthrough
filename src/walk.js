import * as THREE from 'three';

const EYE = 1.65;
const RADIUS = 0.3;
const WALK = 1.7;
const RUN = 3.6;

const lerpAngle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

/**
 * First-person walker: WASD + mouse (pointer lock or drag) on desktop,
 * virtual joystick + drag-to-look on touch. Simple circle-vs-AABB wall collision.
 */
export class Walker {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {HTMLElement} dom element receiving pointer events
   * @param {{colliders:{x0:number,x1:number,z0:number,z1:number}[], groundY:(x:number,z:number)=>number, bounds:(x:number,z:number)=>boolean, joystick:HTMLElement}} opts
   */
  constructor(camera, dom, opts) {
    this.camera = camera;
    this.dom = dom;
    this.colliders = opts.colliders;
    this.groundY = opts.groundY;
    this.inBounds = opts.bounds;
    this.stick = opts.joystick;
    this.stickThumb = opts.joystick.querySelector('.thumb');
    this.x = 0; this.z = 5.5; this.yaw = 0; this.pitch = 0; this.y = EYE;
    this.enabled = false;
    this.keys = new Set();
    this.move = new THREE.Vector2(); // joystick, x = strafe, y = forward
    this.onUserInput = () => {};
    this.orientation = null; // optional quaternion from the phone's gyroscope (overrides yaw/pitch)
    this.pending = 0; // metres of queued forward travel from real steps
    this._fwd = new THREE.Vector3();
    camera.rotation.order = 'YXZ';
    this._bind();
  }

  setPose(x, z, yaw, pitch = 0) {
    this.x = x; this.z = z; this.yaw = yaw; this.pitch = pitch;
    this.y = this.groundY(x, z) + EYE;
    this.apply();
  }

  enable(on) {
    this.enabled = on;
    if (!on) {
      this.keys.clear();
      this.move.set(0, 0);
      if (document.pointerLockElement === this.dom) document.exitPointerLock();
    }
  }

  apply() {
    this.camera.position.set(this.x, this.y, this.z);
    if (this.orientation) {
      this.camera.quaternion.copy(this.orientation);
      // keep yaw/pitch in sync so movement follows where the phone points
      this._fwd.set(0, 0, -1).applyQuaternion(this.orientation);
      this.yaw = Math.atan2(-this._fwd.x, -this._fwd.z);
      this.pitch = Math.asin(Math.max(-1, Math.min(1, this._fwd.y)));
    } else {
      this.camera.rotation.set(this.pitch, this.yaw, 0);
    }
  }

  /** A real step was detected: glide forward along the current heading. */
  queueStep(metres) {
    this.pending = Math.min(this.pending + metres, 2);
  }

  update(dt) {
    if (!this.enabled) return;
    dt = Math.min(dt, 0.05);
    const k = this.keys;
    let f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    let s = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    f += this.move.y; s += this.move.x;
    const len = Math.hypot(f, s);
    if (len > 1) { f /= len; s /= len; }
    if (k.has('ArrowLeft')) this.yaw += 1.6 * dt;
    if (k.has('ArrowRight')) this.yaw -= 1.6 * dt;

    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let mx = 0, mz = 0;
    if (len > 0.01) {
      const speed = k.has('ShiftLeft') || k.has('ShiftRight') ? RUN : WALK;
      mx = (-sin * f + cos * s) * speed * dt;
      mz = (-cos * f - sin * s) * speed * dt;
    }
    if (this.pending > 0) {
      const adv = Math.min(this.pending, 1.8 * dt); // glide each real step over ~0.4 s
      this.pending -= adv;
      mx += -sin * adv;
      mz += -cos * adv;
    }
    if (mx || mz) this._moveBy(mx, mz);
    const targetY = this.groundY(this.x, this.z) + EYE;
    this.y += (targetY - this.y) * Math.min(1, dt * 12);
    this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch));
    this.apply();
  }

  /** Move by (mx, mz) metres, sliding along walls. */
  _moveBy(mx, mz) {
    let nx = this.x + mx;
    let nz = this.z + mz;
    for (let pass = 0; pass < 2; pass++) {
      for (const c of this.colliders) {
        const cx = Math.max(c.x0, Math.min(nx, c.x1));
        const cz = Math.max(c.z0, Math.min(nz, c.z1));
        const dx = nx - cx, dz = nz - cz;
        const d = Math.hypot(dx, dz);
        if (d >= RADIUS) continue;
        if (d > 1e-6) { nx = cx + (dx / d) * RADIUS; nz = cz + (dz / d) * RADIUS; }
        else {
          // centre is inside the box: push out along the shallowest axis
          const pushes = [[c.x0 - RADIUS - nx, 0], [c.x1 + RADIUS - nx, 0], [0, c.z0 - RADIUS - nz], [0, c.z1 + RADIUS - nz]];
          pushes.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
          nx += pushes[0][0]; nz += pushes[0][1];
        }
      }
    }
    if (this.inBounds(nx, nz)) { this.x = nx; this.z = nz; }
  }

  /** Smoothly interpolate towards a pose (used by the guided tour). */
  blendTo(pose, t) {
    this.x += (pose.x - this.x) * t;
    this.z += (pose.z - this.z) * t;
    this.yaw = lerpAngle(this.yaw, pose.yaw, t);
    this.pitch += ((pose.pitch ?? 0) - this.pitch) * t;
    this.y += (this.groundY(this.x, this.z) + EYE - this.y) * t;
    this.apply();
  }

  _bind() {
    const dom = this.dom;
    addEventListener('keydown', (e) => {
      if (!this.enabled || e.target instanceof HTMLInputElement) return;
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
      this.keys.add(e.code);
      this.onUserInput();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    // pointers: mouse looks (locked or dragging), touch splits the screen into move / look zones
    const touches = new Map(); // pointerId -> {role, ox, oy, lx, ly}
    let dragging = false;
    dom.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      this.onUserInput();
      if (e.pointerType === 'mouse') {
        dragging = true;
        dom.setPointerCapture(e.pointerId);
        if (document.pointerLockElement !== dom) dom.requestPointerLock?.()?.catch?.(() => {});
      } else {
        const role = e.clientX < innerWidth * 0.5 ? 'move' : 'look';
        touches.set(e.pointerId, { role, ox: e.clientX, oy: e.clientY, lx: e.clientX, ly: e.clientY });
        dom.setPointerCapture(e.pointerId);
        if (role === 'move') {
          this.stick.style.left = `${e.clientX}px`;
          this.stick.style.top = `${e.clientY}px`;
          this.stick.classList.add('active');
        }
      }
    });
    dom.addEventListener('pointermove', (e) => {
      if (!this.enabled) return;
      if (e.pointerType === 'mouse') {
        if (dragging || document.pointerLockElement === dom) {
          this.yaw -= e.movementX * 0.0022;
          this.pitch -= e.movementY * 0.0022;
        }
        return;
      }
      const t = touches.get(e.pointerId);
      if (!t) return;
      if (t.role === 'look') {
        this.yaw -= (e.clientX - t.lx) * 0.005;
        this.pitch -= (e.clientY - t.ly) * 0.005;
      } else {
        const dx = Math.max(-50, Math.min(50, e.clientX - t.ox));
        const dy = Math.max(-50, Math.min(50, e.clientY - t.oy));
        this.move.set(dx / 50, -dy / 50);
        this.stickThumb.style.transform = `translate(${dx}px, ${dy}px)`;
      }
      t.lx = e.clientX; t.ly = e.clientY;
    });
    const end = (e) => {
      dragging = false;
      const t = touches.get(e.pointerId);
      if (t?.role === 'move') {
        this.move.set(0, 0);
        this.stick.classList.remove('active');
        this.stickThumb.style.transform = '';
      }
      touches.delete(e.pointerId);
    };
    dom.addEventListener('pointerup', end);
    dom.addEventListener('pointercancel', end);
  }
}
