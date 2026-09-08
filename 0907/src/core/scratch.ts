import * as THREE from 'three';

/**
 * Scratch vectors reused across the frame.
 *
 * Allocating a Vector3 per calculation in a 60 Hz loop is what produces the
 * periodic GC stutter that reads as a dropped frame on mobile, so the hot paths
 * borrow these instead. They carry no state between uses: anything that needs
 * to survive the call has to `.clone()`.
 */
export const _v1 = new THREE.Vector3();
export const _v2 = new THREE.Vector3();
export const _v3 = new THREE.Vector3();
export const _v4 = new THREE.Vector3();
export const _c1 = new THREE.Color();
