import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/*
 * gear.js: the traveller's sword. Sheathed, its hilt shows above a scabbard on
 * the hip; drawn, it is held in the right hand and follows every swing of the
 * arm. The steel sword the blacksmith sells is longer and brighter than the
 * old one the traveller starts with. Both are placed each frame from the
 * skeleton's bones, like the lantern.
 */

const _m = new THREE.Matrix4();

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

// A sword around its grip (the origin), the blade along +Z.
function swordGeometry(steel) {
  const len = steel ? 0.84 : 0.72;
  const blade = steel ? 0xdfe4ea : 0x9c9a90;
  const brass = steel ? 0xc8a040 : 0x7a6038;
  return mergeGeometries([
    paint(new THREE.BoxGeometry(0.046, 0.012, len).translate(0, 0, 0.09 + len / 2), blade),
    paint(new THREE.ConeGeometry(0.023, 0.08, 4).rotateX(Math.PI / 2).rotateZ(Math.PI / 4).scale(1, 0.3, 1).translate(0, 0, 0.13 + len), blade),
    paint(new THREE.BoxGeometry(0.012, 0.016, len * 0.8).translate(0, 0, 0.09 + len * 0.42), steel ? 0xb8bec6 : 0x7c7a72),
    paint(new THREE.BoxGeometry(0.22, 0.026, 0.028).translate(0, 0, 0.075), brass),
    paint(new THREE.CylinderGeometry(0.017, 0.016, 0.13, 8).rotateX(Math.PI / 2), 0x3a2618),
    paint(new THREE.SphereGeometry(0.026, 8, 6).translate(0, 0, -0.08), brass),
  ]);
}

// The scabbard, its mouth at the origin, hanging along +Z.
function scabbardGeometry(steel) {
  const len = (steel ? 0.84 : 0.72) + 0.06;
  return mergeGeometries([
    paint(new THREE.BoxGeometry(0.07, 0.03, len).translate(0, 0, len / 2), 0x4a3020),
    paint(new THREE.BoxGeometry(0.076, 0.036, 0.05).translate(0, 0, 0.02), 0x7a6038),
    paint(new THREE.BoxGeometry(0.074, 0.034, 0.07).translate(0, 0, len - 0.04), 0x7a6038),
  ]);
}

// Where things sit on the bones: the grip in the right hand, blade forward and a little
// down when the arm hangs; the scabbard on the left hip, pointing down and back.
const IN_HAND = new THREE.Matrix4().compose(new THREE.Vector3(0, -0.08, 0.02), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.45, 0, 0)), new THREE.Vector3(1, 1, 1));
const ON_HIP = new THREE.Matrix4().compose(new THREE.Vector3(-0.19, -0.02, 0.06), new THREE.Quaternion().setFromEuler(new THREE.Euler(2.05, 0.12, 0.15)), new THREE.Vector3(1, 1, 1));
const SHEATHED = new THREE.Matrix4().multiplyMatrices(ON_HIP, new THREE.Matrix4().makeTranslation(0, 0, 0.1));

export class Sword {
  constructor(scene) {
    this.drawn = false;
    this.steel = false;
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.75, roughness: 0.32 });
    const leather = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.2, roughness: 0.7 });
    this.blade = new THREE.Mesh(swordGeometry(false), material);
    this.scabbard = new THREE.Mesh(scabbardGeometry(false), leather);
    for (const m of [this.blade, this.scabbard]) {
      m.name = 'sword';
      m.castShadow = true;
      m.matrixAutoUpdate = false;
      scene.add(m);
    }
  }

  // The blacksmith's steel sword replaces the old one.
  setSteel(on) {
    if (on === this.steel) return;
    this.steel = on;
    this.blade.geometry.dispose();
    this.scabbard.geometry.dispose();
    this.blade.geometry = swordGeometry(on);
    this.scabbard.geometry = scabbardGeometry(on);
  }

  update(player) {
    const { bones, root } = player.figure;
    const shown = root.visible;
    this.blade.visible = shown;
    this.scabbard.visible = shown;
    if (!shown) return;
    bones.hips.updateWorldMatrix(true, false);
    this.scabbard.matrix.multiplyMatrices(bones.hips.matrixWorld, ON_HIP);
    if (this.drawn) {
      bones.handR.updateWorldMatrix(true, false);
      this.blade.matrix.multiplyMatrices(bones.handR.matrixWorld, IN_HAND);
    } else {
      this.blade.matrix.multiplyMatrices(bones.hips.matrixWorld, _m.copy(SHEATHED));
    }
    this.blade.matrixWorldNeedsUpdate = true;
    this.scabbard.matrixWorldNeedsUpdate = true;
  }
}
