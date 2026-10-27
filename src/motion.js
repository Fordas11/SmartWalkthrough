import * as THREE from 'three';

const DEG = Math.PI / 180;
const STEP_LENGTH = 0.7; // metres of virtual travel per real step
const STEP_THRESHOLD = 1.1; // m/s² above the gravity baseline
const STEP_MIN_GAP = 380; // ms

const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);
const Q_TO_CAMERA = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // device frame → camera frame (-90° about X)

/**
 * Phone-in-hand control for browsers without WebXR (iOS Safari):
 *  - looking: gyroscope (deviceorientation) drives the camera directly
 *  - moving:  real steps (accelerometer peaks) move you forward along the camera heading
 * There is no true positional tracking here – steps are an approximation.
 */
export class MotionControl {
  constructor(walker, { onState }) {
    this.walker = walker;
    this.onState = onState;
    this.active = false;
    this.steps = 0;
    this._euler = new THREE.Euler();
    this._q = new THREE.Quaternion();
    this._qOffset = new THREE.Quaternion();
    this._qTmp = new THREE.Quaternion();
    this._fwd = new THREE.Vector3();
    this._onOrientation = (e) => this._orientation(e);
    this._onMotion = (e) => this._motion(e);
  }

  async start() {
    if (!window.isSecureContext) throw new Error('Motion sensors need HTTPS – open the https:// link.');
    if (typeof DeviceOrientationEvent === 'undefined') throw new Error('This browser has no motion sensors.');
    // iOS 13+: must be called straight from a tap
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      const res = await DeviceOrientationEvent.requestPermission();
      if (res !== 'granted') throw new Error('Motion access was denied. Allow it in Safari settings and reload.');
      try { await DeviceMotionEvent.requestPermission?.(); } catch { /* same permission prompt on iOS */ }
    }

    this.offset = null; // set from the first reading so you start facing where you were looking
    this.got = false;
    this.steps = 0;
    this.g = 9.81; this.s = 0; this.prev = 0; this.lastStep = 0;
    addEventListener('deviceorientation', this._onOrientation);
    addEventListener('devicemotion', this._onMotion);
    this.active = true;

    await new Promise((r) => setTimeout(r, 1500));
    if (!this.got) {
      this.stop();
      throw new Error('No motion data received. Is this a phone?');
    }
    this._report();
  }

  stop() {
    removeEventListener('deviceorientation', this._onOrientation);
    removeEventListener('devicemotion', this._onMotion);
    this.active = false;
    this.walker.orientation = null;
    this.walker.pending = 0;
  }

  _report() {
    this.onState(`Motion on · tilt the phone to look · walk to move · steps: ${this.steps}`);
  }

  _orientation(e) {
    if (e.alpha == null) return;
    this.got = true;
    const orient = (screen.orientation?.angle ?? window.orientation ?? 0) * DEG;
    this._euler.set(e.beta * DEG, e.alpha * DEG, -e.gamma * DEG, 'YXZ');
    this._q.setFromEuler(this._euler).multiply(Q_TO_CAMERA).multiply(this._qTmp.setFromAxisAngle(AXIS_Z, -orient));

    if (this.offset === null) {
      this._fwd.set(0, 0, -1).applyQuaternion(this._q);
      const heading = Math.atan2(-this._fwd.x, -this._fwd.z);
      this.offset = this.walker.yaw - heading;
      this._qOffset.setFromAxisAngle(AXIS_Y, this.offset);
    }
    this.walker.orientation = (this.walker.orientation || new THREE.Quaternion()).copy(this._qOffset).multiply(this._q);
  }

  _motion(e) {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null) return;
    const m = Math.hypot(a.x, a.y, a.z);
    this.g += (m - this.g) * 0.02; // slow baseline = gravity
    this.s += (m - this.g - this.s) * 0.35; // fast smoothing = body bounce
    if (this.s > STEP_THRESHOLD && this.prev <= STEP_THRESHOLD && e.timeStamp - this.lastStep > STEP_MIN_GAP) {
      this.lastStep = e.timeStamp;
      this.steps++;
      this.walker.queueStep(STEP_LENGTH);
      this._report();
    }
    this.prev = this.s;
  }
}
