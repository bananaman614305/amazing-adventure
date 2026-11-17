import * as THREE from 'three';

// First-person controller: pointer-lock mouse look, WASD movement and sliding
// AABB collision so the player never leaves the courtyard or walks through props.

export const PLAYER_HEIGHT = 1.7;
export const PLAYER_RADIUS = 0.42;
const WALK_SPEED = 4.2;
const ACCELERATION = 40;
const DAMPING = 12;

export class Player {
  constructor(camera, colliders, { onLock, onUnlock }) {
    this.camera = camera;
    this.colliders = colliders;

    // Position is tracked on the floor plane; the camera sits at eye height.
    this.position = new THREE.Vector3(0, 0, 13);
    this.velocity = new THREE.Vector3();
    this.yaw = 0; // start facing the fountain
    this.pitch = 0;

    this.keys = new Set();
    this.enabled = false;

    this._onLock = onLock;
    this._onUnlock = onUnlock;

    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === document.body;
      this.enabled = locked;
      if (!locked) {
        this.velocity.set(0, 0, 0);
        this.keys.clear();
        this._onUnlock?.();
      } else {
        this._onLock?.();
      }
    });

    document.addEventListener('mousemove', (event) => {
      if (!this.enabled) return;
      const sensitivity = 0.0022;
      this.yaw -= event.movementX * sensitivity;
      this.pitch -= event.movementY * sensitivity;
      const limit = Math.PI / 2 - 0.05;
      this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
    });

    this._onKeyDown = (event) => {
      this.keys.add(event.code);
    };
    this._onKeyUp = (event) => {
      this.keys.delete(event.code);
    };
    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup', this._onKeyUp);

    this.syncCamera();
  }

  requestLock() {
    document.body.requestPointerLock?.();
  }

  isMoving() {
    return this.velocity.lengthSq() > 0.35;
  }

  update(dt) {
    const forward = Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS'));
    const strafe = Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA'));

    // Movement is relative to where the camera is looking, flat on the ground.
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const wishX = -sin * forward + cos * strafe;
    const wishZ = -cos * forward - sin * strafe;
    const wishLength = Math.hypot(wishX, wishZ);

    if (this.enabled && wishLength > 0) {
      const nx = wishX / wishLength;
      const nz = wishZ / wishLength;
      this.velocity.x += nx * ACCELERATION * dt;
      this.velocity.z += nz * ACCELERATION * dt;
    }

    // Cap the speed and apply damping so stopping feels immediate but not stiff.
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (speed > WALK_SPEED) {
      this.velocity.x = (this.velocity.x / speed) * WALK_SPEED;
      this.velocity.z = (this.velocity.z / speed) * WALK_SPEED;
    }
    const damp = Math.exp(-DAMPING * dt);
    this.velocity.x *= damp;
    this.velocity.z *= damp;

    // Move one axis at a time so we slide along walls instead of sticking.
    this.position.x += this.velocity.x * dt;
    if (this._blocked()) {
      this.position.x -= this.velocity.x * dt;
      this.velocity.x = 0;
    }
    this.position.z += this.velocity.z * dt;
    if (this._blocked()) {
      this.position.z -= this.velocity.z * dt;
      this.velocity.z = 0;
    }

    this.syncCamera();
  }

  syncCamera() {
    this.camera.position.set(this.position.x, PLAYER_HEIGHT, this.position.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  /** True when the player's circle overlaps any collider. */
  _blocked() {
    const { x, z } = this.position;
    const r = PLAYER_RADIUS;
    for (const box of this.colliders) {
      if (
        x + r > box.minX &&
        x - r < box.maxX &&
        z + r > box.minZ &&
        z - r < box.maxZ
      ) {
        return true;
      }
    }
    return false;
  }
}
