import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/*
 * post.js: the finishing passes used by the High preset. The scene renders
 * into a half-float target (multisampled, since the canvas itself then has no
 * antialiasing), lanterns, lit windows, fire, the sun and its glints on the
 * water bloom softly, and a last pass tone-maps, converts to sRGB and darkens
 * the corners a little.
 *
 * When bloom is off but the canvas was created without antialiasing (High was
 * chosen at load, another preset since), the same chain runs without the
 * bloom so the picture keeps its smooth edges until the next load.
 */

const FINISH_SHADER = {
  name: 'FinishShader',
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.3 },
  },
  vertexShader: /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`,
  fragmentShader: /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uVignette;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(tDiffuse, vUv);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  vec2 c = vUv - 0.5;
  gl_FragColor.rgb *= 1.0 - uVignette * smoothstep(0.12, 0.62, dot(c, c) * 1.6);
}
`,
};

// Bloom by day only catches the sun and hard glints; after dark the lanterns and windows glow.
const BLOOM = { strength: 0.5, radius: 0.55, dayThreshold: 1.25, nightThreshold: 0.62 };

export class Post {
  constructor(renderer, scene, camera, contextAntialias) {
    this.renderer = renderer;
    this.contextAntialias = contextAntialias;
    // Bloom needs a render target that can hold values above 1.
    const ext = renderer.extensions;
    this.hdr = ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float');
    this.active = false;
    this._samples = 0;

    const target = new THREE.WebGLRenderTarget(1, 1, { type: this.hdr ? THREE.HalfFloatType : THREE.UnsignedByteType });
    target.texture.name = 'Post.scene';
    this.composer = new EffectComposer(renderer, target);
    this.renderPass = new RenderPass(scene, camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), BLOOM.strength, BLOOM.radius, BLOOM.dayThreshold);
    this.finish = new ShaderPass(FINISH_SHADER);
    // No swap after the last pass: the scene always lands in the same target, so the
    // composer's second target is never allocated.
    this.finish.needsSwap = false;
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.finish);
  }

  // q: the current quality preset. Returns whether frames now go through the passes.
  setQuality(q) {
    const bloom = !!q.bloom && this.hdr;
    // A canvas made without antialiasing still needs it from the passes.
    const smooth = q.antialias && !this.contextAntialias;
    this.active = bloom || smooth;
    this.bloom.enabled = bloom;
    this.finish.uniforms.uVignette.value = bloom ? 0.3 : 0;
    const samples = this.active && q.antialias ? 4 : 0;
    if (samples !== this._samples) {
      this._samples = samples;
      for (const t of [this.composer.renderTarget1, this.composer.renderTarget2]) {
        t.samples = samples;
        t.dispose();
      }
    }
    this.setSize();
    return this.active;
  }

  // Follows the renderer's size and pixel ratio.
  setSize() {
    const size = this.renderer.getSize(new THREE.Vector2());
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(size.x, size.y);
  }

  // night: 0 by day, 1 after dark.
  // Draws another scene through the same passes (the mine).
  setScene(scene) {
    this.renderPass.scene = scene;
  }

  render(night) {
    this.bloom.threshold = THREE.MathUtils.lerp(BLOOM.dayThreshold, BLOOM.nightThreshold, night);
    this.composer.render();
  }
}
