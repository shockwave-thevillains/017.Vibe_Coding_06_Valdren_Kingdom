import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp } from './world.js';

/*
 * lantern.js: the traveller's hand lantern, a brass bullseye lantern whose lens
 * throws a beam like a torch. It is lit and put out at will (F, or the lantern
 * button). While lit it hangs from the right hand, held out in front, its glass
 * glows, a spotlight shines where the traveller faces (tilted with the camera),
 * and after dark a faint shaft of light shows in the air.
 *
 * The spotlight stays in the scene at zero intensity when the lantern is out,
 * so lighting it never recompiles the materials. On High the beam casts
 * shadows too, and its shadow map is only redrawn while it is lit.
 */

const BEAM = { color: 0xffdcaa, intensity: 40, distance: 42, angle: 0.52, penumbra: 0.6, decay: 1.5 };
const LENS = new THREE.Vector3(0, -0.14, 0.085); // the lens, in the lantern's own space
const FADE = 7;                                    // how fast the flame comes up and dies down
const SHAFT = 0.32;                                // the visible shaft's share of the beam's reach

const BEAM_VERT = /* glsl */ `
varying float vAlong;
varying float vFacing;
void main() {
  vAlong = position.z / ${(BEAM.distance * SHAFT).toFixed(2)};
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 n = normalize(normalMatrix * normal);
  vFacing = abs(dot(n, normalize(-mv.xyz)));
  gl_Position = projectionMatrix * mv;
}
`;

const BEAM_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uStrength;
varying float vAlong;
varying float vFacing;
void main() {
  // Brightest at the lens, fading along the shaft and towards its silhouette.
  float a = pow(clamp(1.0 - vAlong, 0.0, 1.0), 1.6) * smoothstep(0.0, 0.25, vAlong) * vFacing * vFacing;
  gl_FragColor = vec4(uColor * a * uStrength, 1.0);
}
`;

function paint(geometry, hex) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(col, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  return g;
}

// The lantern in its own space: grip at the origin, body hanging below, lens facing +Z.
function lanternGeometry() {
  const brass = 0x8a6a34;
  const dark = 0x3a3026;
  const parts = [
    // Body, base and conical top with a little chimney.
    paint(new THREE.CylinderGeometry(0.06, 0.062, 0.15, 14).translate(0, -0.14, 0), brass),
    paint(new THREE.CylinderGeometry(0.07, 0.07, 0.016, 14).translate(0, -0.222, 0), dark),
    paint(new THREE.ConeGeometry(0.068, 0.07, 14).translate(0, -0.03, 0), brass),
    paint(new THREE.CylinderGeometry(0.016, 0.02, 0.04, 8).translate(0, 0.012, 0), dark),
    // Vents round the top and a hoop of a handle above it.
    paint(new THREE.TorusGeometry(0.062, 0.006, 5, 18).rotateX(Math.PI / 2).translate(0, -0.066, 0), dark),
    paint(new THREE.TorusGeometry(0.045, 0.005, 5, 14, Math.PI).translate(0, 0.02, 0), dark),
    // The lens tube on the front.
    paint(new THREE.CylinderGeometry(0.044, 0.04, 0.05, 14).rotateX(Math.PI / 2).translate(0, -0.14, 0.07), brass),
    paint(new THREE.TorusGeometry(0.044, 0.007, 6, 16).translate(0, -0.14, 0.094), dark),
  ];
  return mergeGeometries(parts);
}

export class Lantern {
  constructor(scene, quality) {
    this.on = false;
    this.level = 0; // 0 out .. 1 fully lit
    this._dir = new THREE.Vector3(0, -0.1, 1).normalize();
    this._hand = new THREE.Vector3();
    this._grip = new THREE.Vector3(0, -0.075, 0.02);
    this._v = new THREE.Vector3();
    this._q = new THREE.Quaternion();

    // The lantern itself.
    this.prop = new THREE.Group();
    this.prop.name = 'lantern';
    const body = new THREE.Mesh(lanternGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.75, roughness: 0.42 }));
    body.castShadow = true;
    this.glassMaterial = new THREE.MeshStandardMaterial({ color: 0x3a3020, emissive: 0xffc070, emissiveIntensity: 0, roughness: 0.15 });
    const glass = new THREE.Mesh(new THREE.CircleGeometry(0.038, 16).translate(0, 0, 0.096 + 1e-3).translate(0, -0.14, 0), this.glassMaterial);
    // A warm glow through the vents and the horn panes on the sides.
    const panes = new THREE.Mesh(new THREE.CylinderGeometry(0.0605, 0.0625, 0.09, 14, 1, true).translate(0, -0.14, 0), this.glassMaterial);
    this.prop.add(body, glass, panes);
    this.prop.visible = false;
    scene.add(this.prop);

    // The beam.
    this.light = new THREE.SpotLight(BEAM.color, 0, BEAM.distance, BEAM.angle, BEAM.penumbra, BEAM.decay);
    this.light.name = 'lantern-beam';
    this.light.shadow.mapSize.set(512, 512);
    this.light.shadow.camera.near = 0.2;
    this.light.shadow.camera.far = BEAM.distance;
    this.light.shadow.bias = -0.0006;
    this.light.shadow.normalBias = 0.03;
    this.light.shadow.autoUpdate = false;
    scene.add(this.light, this.light.target);

    // A faint shaft of light in the night air: an open cone, added on top.
    const length = BEAM.distance * SHAFT;
    const shaft = new THREE.ConeGeometry(Math.tan(BEAM.angle * 0.8) * length, length, 28, 1, true);
    shaft.translate(0, -length / 2, 0);
    shaft.rotateX(-Math.PI / 2);
    this.beamUniforms = { uColor: { value: new THREE.Color(BEAM.color) }, uStrength: { value: 0 } };
    this.shaft = new THREE.Mesh(shaft, new THREE.ShaderMaterial({
      uniforms: this.beamUniforms,
      vertexShader: BEAM_VERT,
      fragmentShader: BEAM_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
    }));
    this.shaft.name = 'lantern-shaft';
    this.shaft.frustumCulled = false;
    this.shaft.renderOrder = 5;
    this.shaft.visible = false;
    scene.add(this.shaft);

    this.setQuality(quality);
  }

  // Shadows from the beam cost a second shadow pass, so only High has them.
  setQuality(q) {
    this.light.castShadow = !!q.lanternShadow;
  }

  toggle(on = !this.on) {
    this.on = on;
    return on;
  }

  /*
   * player: the Player (its right hand and heading place the lantern);
   * camera: tilts the beam up or down with the view; night: 0 by day, 1 after dark.
   */
  update(dt, player, camera, night) {
    this.level += ((this.on ? 1 : 0) - this.level) * (1 - Math.exp(-FADE * dt));
    if (!this.on && this.level < 0.002) this.level = 0;
    const lit = this.level;
    const shown = this.on || lit > 0;
    this.light.shadow.autoUpdate = shown;

    // The lantern hangs upright from the grip, turned the way the traveller faces.
    const hand = player.figure.bones.handR;
    hand.updateWorldMatrix(true, false);
    this._hand.copy(this._grip).applyMatrix4(hand.matrixWorld);
    this.prop.position.copy(this._hand);
    this.prop.rotation.set(0, player.heading, 0);
    this.prop.visible = shown && player.figure.root.visible;
    this.glassMaterial.emissiveIntensity = lit * 4.5;

    // The beam points where the traveller faces, tilted with the camera, and lags a little.
    const cam = camera.getWorldDirection(this._v);
    const pitch = clamp(Math.asin(clamp(cam.y, -1, 1)) * 0.6 + 0.05, -0.55, 0.3);
    const want = this._v.set(Math.sin(player.heading) * Math.cos(pitch), Math.sin(pitch), Math.cos(player.heading) * Math.cos(pitch));
    this._dir.lerp(want, 1 - Math.exp(-12 * dt)).normalize();

    const origin = this.prop.localToWorld(this._v.copy(LENS));
    this.light.position.copy(origin);
    this.light.target.position.copy(origin).addScaledVector(this._dir, 10);
    this.light.target.updateMatrixWorld();
    // A living flame: the light breathes very slightly.
    const t = performance.now() * 0.001;
    this.light.intensity = BEAM.intensity * lit * (1 + Math.sin(t * 7.3) * 0.025 + Math.sin(t * 13.1) * 0.015);

    this.shaft.visible = shown && night > 0.05;
    if (this.shaft.visible) {
      this.shaft.position.copy(origin);
      this._q.setFromUnitVectors(Z_AXIS, this._dir);
      this.shaft.quaternion.copy(this._q);
      this.beamUniforms.uStrength.value = 0.035 * lit * night;
    }
  }
}

const Z_AXIS = new THREE.Vector3(0, 0, 1);
