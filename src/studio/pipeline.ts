import * as THREE from 'three';
import { HALFTONE_STYLES, hexToVec, type HalftoneParams, type StudioParams } from './params';

export type StudioMode = 'Photogram' | 'Halftone';
export type Look = { mode: StudioMode; photo: StudioParams; halftone: HalftoneParams };

/** Layer that flower meshes enable so the light-depth camera sees only casters. */
export const CASTER_LAYER = 1;

const DEPTH_SIZE = 4096;
/** Distances are stored normalised by this so a half-float target keeps precision. */
const DEPTH_FAR = 20;

const fullscreenVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/**
 * Light-distance pass. R = distance to the light; G = how opaque the nearest caster is there.
 * Petals and leaves are thin: they pass light, thinner toward their edges, with fine veins of
 * denser tissue, so their shadows carry subtle vein detail. Stems have no tissue data: opaque.
 */
const depthMaterial = new THREE.ShaderMaterial({
  side: THREE.DoubleSide,
  uniforms: {
    lightPos: { value: new THREE.Vector3() },
    translucency: { value: 0.5 },
    veinDetail: { value: 0.6 },
  },
  vertexShader: /* glsl */ `
    attribute float aThin;
    attribute float aVein;
    varying vec3 vWorld;
    varying vec2 vUv;
    varying float vThin;
    varying float vVein;
    void main() {
      vec4 w = modelMatrix * vec4(position, 1.0);
      vWorld = w.xyz;
      vUv = uv;
      vThin = aThin;
      vVein = aVein;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 lightPos;
    uniform float translucency, veinDetail;
    varying vec3 vWorld;
    varying vec2 vUv;
    varying float vThin;
    varying float vVein;
    float line(float x, float sharp) { return pow(0.5 + 0.5 * cos(x * 6.2831853), sharp); }
    void main() {
      float opacity = 1.0;
      if (vThin > 0.001) {
        float across = vUv.x - 0.5;
        float edge = abs(across) * 2.0;
        float vein;
        if (vVein < 0.5) {
          // Petal: veins fan out from the claw, a few forking near the tip.
          float fan = across / (0.18 + vUv.y);
          vein = line(fan * 7.0, 60.0) * smoothstep(0.02, 0.15, vUv.y);
          vein = max(vein, 0.5 * line(fan * 14.0 + 0.5, 70.0) * smoothstep(0.45, 0.8, vUv.y));
        } else {
          // Leaf: midrib plus paired laterals sweeping toward the tip.
          float mid = exp(-pow(across / 0.022, 2.0));
          float lat = line(vUv.y * 9.0 - abs(across) * 5.0, 60.0) * (1.0 - smoothstep(0.75, 1.0, edge));
          vein = max(mid, lat * 0.8);
        }
        // Thinner toward the margin and tip, thicker at the base.
        float thin = vThin * translucency * mix(0.75, 1.25, max(edge, vUv.y * 0.8));
        opacity = clamp(1.0 - thin * (1.0 - vein * veinDetail), 0.05, 1.0);
      }
      gl_FragColor = vec4(distance(vWorld, lightPos) / ${DEPTH_FAR.toFixed(1)}, opacity, 0.0, 1.0);
    }`,
});

/**
 * Receiver shader: percentage-closer soft shadows against the light-distance map.
 * Penumbra width = lightRadius · (dReceiver − dBlocker) / dBlocker, so shadows are crisp where a
 * caster is close to the canvas and smear out where it is close to the light.
 */
const maskMaterial = new THREE.ShaderMaterial({
  uniforms: {
    tDepth: { value: null as THREE.Texture | null },
    lightVP: { value: new THREE.Matrix4() },
    lightPos: { value: new THREE.Vector3() },
    lightRadius: { value: 0.08 },
    softness: { value: 1 },
    tanHalf: { value: 0.5 },
    seed: { value: 0 },
    hard: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec3 vWorld;
    void main() {
      vec4 w = modelMatrix * vec4(position, 1.0);
      vWorld = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDepth;
    uniform mat4 lightVP;
    uniform vec3 lightPos;
    uniform float lightRadius, softness, tanHalf, seed, hard;
    varying vec3 vWorld;
    const float FAR = ${DEPTH_FAR.toFixed(1)};
    const int BLOCKER_SAMPLES = 20;
    const int PCF_SAMPLES = 40;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + seed) * 43758.5453); }
    vec2 spiral(int i, int n, float rot) {
      float fi = float(i) + 0.5;
      float r = sqrt(fi / float(n));
      float a = fi * 2.39996323 + rot;
      return r * vec2(cos(a), sin(a));
    }
    void main() {
      vec4 lc = lightVP * vec4(vWorld, 1.0);
      if (lc.w <= 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
      vec2 uv = lc.xy / lc.w * 0.5 + 0.5;
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
      float dR = distance(vWorld, lightPos);
      float dRn = dR / FAR;
      float bias = 0.012 / FAR;
      if (hard > 0.5) {
        // Exact silhouette: one depth test at this texel, no search, no filtering.
        vec2 s = texture2D(tDepth, uv).rg;
        gl_FragColor = vec4(s.r < dRn - bias ? s.g : 0.0, 0.0, 0.0, 1.0);
        return;
      }
      float rot = hash(gl_FragCoord.xy) * 6.2831853;
      // Blocker search: the cone from this point to the light disc, evaluated at ~0.6 m from the light.
      float searchUV = clamp(lightRadius * softness * (dR - 0.6) / dR / (2.0 * 0.6 * tanHalf), 0.002, 0.12);
      float sum = 0.0; float count = 0.0;
      for (int i = 0; i < BLOCKER_SAMPLES; i++) {
        float d = texture2D(tDepth, uv + spiral(i, BLOCKER_SAMPLES, rot) * searchUV).r;
        if (d < dRn - bias) { sum += d; count += 1.0; }
      }
      if (count < 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
      float dB = sum / count * FAR;
      float penumbra = lightRadius * softness * (dR - dB) / max(dB, 0.05);
      float filterUV = clamp(penumbra / (2.0 * dR * tanHalf), 0.0004, 0.09);
      float shadow = 0.0;
      for (int i = 0; i < PCF_SAMPLES; i++) {
        vec2 s = texture2D(tDepth, uv + spiral(i, PCF_SAMPLES, rot + 1.7) * filterUV).rg;
        shadow += s.r < dRn - bias ? s.g : 0.0;
      }
      shadow /= float(PCF_SAMPLES);
      // G: how far the occluding part sits from the canvas relative to its distance from the light
      // (0 = touching the paper). B marks where a blocker was found, so blurred G / blurred B gives
      // a smooth local caster distance for the depth-weighted blur downstream.
      float far = clamp((dR - dB) / dB / 1.5, 0.0, 1.0);
      gl_FragColor = vec4(shadow, far, 1.0, 1.0);
    }`,
});

const blurMaterial = new THREE.ShaderMaterial({
  uniforms: { tInput: { value: null as THREE.Texture | null }, dir: { value: new THREE.Vector2() } },
  vertexShader: fullscreenVert,
  fragmentShader: /* glsl */ `
    uniform sampler2D tInput;
    uniform vec2 dir;
    varying vec2 vUv;
    void main() {
      float w[7]; w[0]=0.1995; w[1]=0.1760; w[2]=0.1210; w[3]=0.0648; w[4]=0.0270; w[5]=0.0088; w[6]=0.0022;
      vec4 acc = texture2D(tInput, vUv) * w[0];
      for (int i = 1; i < 7; i++) {
        acc += texture2D(tInput, vUv + dir * float(i)) * w[i];
        acc += texture2D(tInput, vUv - dir * float(i)) * w[i];
      }
      gl_FragColor = acc;
    }`,
});

const processMaterial = new THREE.ShaderMaterial({
  uniforms: {
    tMask: { value: null as THREE.Texture | null },
    tBlur: { value: null as THREE.Texture | null },
    tBlurWide: { value: null as THREE.Texture | null },
    blurFalloff: { value: 1 },
    basePx: { value: new THREE.Vector2(1600, 1000) },
    time: { value: 0 },
    paper: { value: new THREE.Vector3() },
    rampLight: { value: new THREE.Vector3() },
    rampMid: { value: new THREE.Vector3() },
    rampDeep: { value: new THREE.Vector3() },
    midPosition: { value: 0.45 },
    density: { value: 1 },
    hue: { value: 0 },
    saturation: { value: 1 },
    brightness: { value: 0 },
    contrast: { value: 1 },
    gammaV: { value: 1 },
    blackPoint: { value: 0 },
    whitePoint: { value: 1 },
    temperature: { value: 0 },
    tintV: { value: 0 },
    extraBlur: { value: 0 },
    bloom: { value: 0 },
    ghost: { value: 0 },
    ghostVec: { value: new THREE.Vector2() },
    misregister: { value: 0 },
    grain: { value: 0 },
    grainSize: { value: 1 },
    fiber: { value: 0 },
    dust: { value: 0 },
    scratches: { value: 0 },
    banding: { value: 0 },
    unevenLight: { value: 0 },
    vignette: { value: 0 },
    scanRotation: { value: 0 },
    border: { value: 0 },
    castColor: { value: new THREE.Vector3(1, 1, 1) },
    castAmount: { value: 0 },
    inverse: { value: 0 },
  },
  vertexShader: fullscreenVert,
  fragmentShader: /* glsl */ `
    uniform sampler2D tMask, tBlur, tBlurWide;
    uniform vec2 basePx, ghostVec;
    uniform float time, midPosition, density, hue, saturation, brightness, contrast, gammaV, blackPoint,
      whitePoint, temperature, tintV, extraBlur, blurFalloff, bloom, ghost, misregister, grain, grainSize, fiber, dust,
      scratches, banding, unevenLight, vignette, scanRotation, border, castAmount, inverse;
    uniform vec3 paper, rampLight, rampMid, rampDeep, castColor;
    varying vec2 vUv;

    float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    float vnoise(vec2 p) {
      vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
    }
    float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }

    // Shadow density at uv. Extra blur is depth-weighted: parts of a flower close to the canvas stay
    // crisp, parts far from it pick up the medium and then the wide blur.
    float densityAt(vec2 uv) {
      vec4 sm = texture2D(tMask, uv);
      vec4 md = texture2D(tBlur, uv);
      vec4 wide = texture2D(tBlurWide, uv);
      float sharp = sm.r;
      float med = md.r;
      // Caster distance from the canvas, kept local so one flower can be crisp where a petal
      // nearly touches the paper and soft where it curls away.
      float far = mix(wide.g / max(wide.b, 0.02), md.g / max(md.b, 0.02), 0.8);
      far = mix(far, sm.g, sm.b * 0.5);
      float k = clamp(pow(far, blurFalloff) * extraBlur * 2.5, 0.0, 1.0);
      float m = mix(sharp, med, smoothstep(0.0, 0.45, k));
      m = mix(m, wide.r, smoothstep(0.4, 1.0, k));
      float echo = mix(texture2D(tMask, uv + ghostVec).r, texture2D(tBlur, uv + ghostVec).r, 0.5);
      m = max(m, echo * ghost) + echo * ghost * 0.25;
      m = clamp(m * density, 0.0, 1.0);
      return mix(m, 1.0 - m, inverse);
    }
    vec3 ramp(float d) {
      if (d < midPosition * 0.5) return mix(paper, rampLight, d / (midPosition * 0.5));
      if (d < midPosition) return mix(rampLight, rampMid, (d - midPosition * 0.5) / (midPosition * 0.5));
      return mix(rampMid, rampDeep, (d - midPosition) / (1.0 - midPosition));
    }
    vec3 hueRotate(vec3 c, float a) {
      const mat3 toYIQ = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
      const mat3 toRGB = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
      vec3 yiq = toYIQ * c;
      float h = atan(yiq.z, yiq.y) + a, ch = length(yiq.yz);
      return toRGB * vec3(yiq.x, ch * cos(h), ch * sin(h));
    }

    void main() {
      vec2 px = vUv * basePx;                       // base-resolution pixel units: same look at 1x/2x/4x
      float aspect = basePx.x / basePx.y;
      // Slightly rotated scan: the print sits rotated inside the scanner bed.
      vec2 c = (vUv - 0.5) * vec2(aspect, 1.0);
      float ra = radians(scanRotation);
      c = mat2(cos(ra), -sin(ra), sin(ra), cos(ra)) * c;
      vec2 uv = c / vec2(aspect, 1.0) / max(1.0 - 2.0 * border, 0.2) + 0.5;

      // RGB misregistration: each channel reads the mask at its own offset.
      vec2 mis = vec2(misregister * 4.0) / basePx;
      float dR = densityAt(uv + mis);
      float dG = densityAt(uv);
      float dB = densityAt(uv - mis * vec2(1.0, -0.6));
      vec3 col = vec3(ramp(dR).r, ramp(dG).g, ramp(dB).b);

      // Bloom: light areas glow softly (screen blend of the blurred light field).
      float lightField = 1.0 - mix(texture2D(tBlur, uv).r * density, 1.0 - texture2D(tBlur, uv).r * density, inverse);
      col = 1.0 - (1.0 - col) * (1.0 - bloom * 0.7 * lightField * vec3(1.0, 0.96, 0.98));

      // Grade.
      col = hueRotate(col, radians(hue));
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, saturation);
      col += brightness;
      col = (col - 0.5) * contrast + 0.5;
      col *= vec3(1.0 + temperature * 0.12, 1.0 + tintV * 0.08, 1.0 - temperature * 0.12);
      col = clamp((col - blackPoint) / max(whitePoint - blackPoint, 0.001), 0.0, 1.0);
      col = pow(col, vec3(1.0 / max(gammaV, 0.01)));

      // Scan: uneven illumination, vignette, paper fibre, banding, colour cast.
      col *= 1.0 - unevenLight * 0.35 * (fbm(px / 420.0 + 3.1) - 0.3);
      float v = length((vUv - 0.5) * vec2(aspect, 1.0)) / length(vec2(aspect, 1.0) * 0.5);
      col *= 1.0 - vignette * 0.6 * pow(v, 2.2);
      float fib = fbm(vec2(px.x / 90.0, px.y / 9.0) + fbm(px / 60.0) * 2.0);
      col *= 1.0 - fiber * 0.12 * (fib - 0.5) * 2.0;
      col *= 1.0 + banding * (0.05 * sin(px.y * 0.35) + 0.06 * (vnoise(vec2(0.0, px.y / 3.0)) - 0.5));
      col = mix(col, col * castColor * 1.15, castAmount);

      // Dust specks and scratches (static: they belong to the print).
      vec2 dc = floor(px / 26.0);
      float hd = hash12(dc);
      vec2 dpos = (dc + vec2(hash12(dc + 7.1), hash12(dc + 3.7))) * 26.0;
      float speck = step(1.0 - dust * 0.06, hd) * (1.0 - smoothstep(0.6, 1.6 + 2.0 * hash12(dc + 9.0), length(px - dpos)));
      col = mix(col, hd > 0.5 + 0.47 * (1.0 - dust) ? vec3(0.96) : col * 0.35, speck);
      float sc = floor(px.x / 140.0);
      float sx = (sc + hash12(vec2(sc, 2.0))) * 140.0 + sin(px.y / 180.0 + sc) * 6.0;
      float scratch = step(1.0 - scratches * 0.5, hash12(vec2(sc, 5.0))) * (1.0 - smoothstep(0.2, 0.9, abs(px.x - sx)))
        * step(hash12(vec2(sc, 8.0)) * basePx.y * 0.6, px.y) * step(px.y, (0.4 + hash12(vec2(sc, 11.0)) * 0.6) * basePx.y);
      col = mix(col, vec3(0.97, 0.95, 0.93), scratch * 0.7);

      // Animated film grain.
      vec2 g = floor(px / max(grainSize, 0.5));
      float n = hash12(g + fract(time * 13.37) * 157.0) + hash12(g * 1.7 + fract(time * 7.1) * 91.0) - 1.0;
      col += n * grain * 0.35;

      // Scanner bed outside the rotated print.
      vec2 inside = step(vec2(0.0), uv) * step(uv, vec2(1.0));
      float onPrint = inside.x * inside.y;
      vec3 bed = vec3(0.93, 0.92, 0.9) + (hash12(floor(px / max(grainSize, 0.5)) + fract(time) * 31.0) - 0.5) * grain * 0.1;
      col = mix(bed, col, onPrint);

      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
});

/**
 * Halftone studio: screens an exact hard-edged shadow into exactly two colours. Each pixel tests
 * its own tone against the screen, so silhouettes follow the true flower/leaf outline and the
 * pattern only shows inside translucent tissue. No blur, no anti-aliasing.
 */
const halftoneMaterial = new THREE.ShaderMaterial({
  uniforms: {
    tMask: { value: null as THREE.Texture | null },
    basePx: { value: new THREE.Vector2(1600, 1000) },
    styleId: { value: 0 },
    cellSize: { value: 9 },
    angle: { value: 45 },
    threshold: { value: 0.5 },
    contrast: { value: 1 },
    gammaV: { value: 1 },
    ink: { value: new THREE.Vector3() },
    paper: { value: new THREE.Vector3(1, 1, 1) },
    invert: { value: 0 },
  },
  vertexShader: fullscreenVert,
  fragmentShader: /* glsl */ `
    uniform sampler2D tMask;
    uniform vec2 basePx;
    uniform float styleId, cellSize, angle, threshold, contrast, gammaV, invert;
    uniform vec3 ink, paper;
    varying vec2 vUv;
    const float PI = 3.14159265;

    float toneAt(vec2 uv) {
      float t = texture2D(tMask, clamp(uv, 0.0, 1.0)).r;
      t = mix(t, 1.0 - t, invert);
      t = clamp((t - 0.5) * contrast + 0.5 + (0.5 - threshold), 0.0, 1.0);
      // Dead zone at both ends so soft-shadow sampling noise never prints stray marks.
      t = clamp((t - 0.03) / 0.94, 0.0, 1.0);
      return pow(t, 1.0 / max(gammaV, 0.01));
    }
    float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
    float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
    float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }

    void main() {
      vec2 px = vUv * basePx;
      float isInk;
      if (styleId > 3.5) {
        // Threshold (4) or ordered dither (5): per pixel, still strictly two-tone.
        float raw = texture2D(tMask, vUv).r;
        raw = mix(raw, 1.0 - raw, invert);
        if (styleId < 4.5) {
          isInk = step(threshold, raw);
        } else {
          float t = toneAt(vUv);
          isInk = step(bayer8(px / max(cellSize / 4.0, 1.0)) + 1.0 / 128.0, t);
        }
      } else {
        float a = radians(angle);
        mat2 rot = mat2(cos(a), sin(a), -sin(a), cos(a));
        vec2 q = rot * px / cellSize;
        vec2 f = fract(q) - 0.5;
        float t = toneAt(vUv);
        if (styleId < 0.5) {
          // Round dots; past 50% coverage, paper dots on ink so area keeps tracking tone.
          isInk = t <= 0.5 ? step(length(f), sqrt(t / PI)) : 1.0 - step(length(f), sqrt((1.0 - t) / PI));
        } else if (styleId < 1.5) {
          isInk = step(max(abs(f.x), abs(f.y)), sqrt(t) * 0.5);
        } else if (styleId < 2.5) {
          float d = abs(f.x) + abs(f.y);
          isInk = t <= 0.5 ? step(d, sqrt(t * 0.5)) : 1.0 - step(d, sqrt((1.0 - t) * 0.5));
        } else {
          isInk = step(abs(f.y), t * 0.5);
        }
      }
      gl_FragColor = vec4(mix(paper, ink, isInk), 1.0);
    }`,
});

/** Display shader for the wall, preview and fullscreen view: shows the processed output untouched. */
export function createOutputMaterial(texture: THREE.Texture, rounded = false) {
  return new THREE.ShaderMaterial({
    uniforms: { tOut: { value: texture }, sizePx: { value: new THREE.Vector2(1, 1) }, radiusPx: { value: 0 } },
    vertexShader: rounded ? fullscreenVert : /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tOut;
      uniform vec2 sizePx;
      uniform float radiusPx;
      varying vec2 vUv;
      void main() {
        if (radiusPx > 0.0) {
          vec2 p = abs(vUv - 0.5) * sizePx - (sizePx * 0.5 - radiusPx);
          if (length(max(p, 0.0)) > radiusPx) discard;
        }
        gl_FragColor = texture2D(tOut, vUv);
      }`,
    depthTest: !rounded,
    depthWrite: !rounded,
  });
}

export type CanvasRect = { center: THREE.Vector3; width: number; height: number };

export class ShadowPipeline {
  readonly depthRT = new THREE.WebGLRenderTarget(DEPTH_SIZE, DEPTH_SIZE, {
    type: THREE.HalfFloatType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: true,
  });
  readonly lightCamera = new THREE.PerspectiveCamera(60, 1, 0.05, DEPTH_FAR);
  readonly output: THREE.WebGLRenderTarget;
  private mask: THREE.WebGLRenderTarget;
  private blurA: THREE.WebGLRenderTarget;
  private blurB: THREE.WebGLRenderTarget;
  private blurC: THREE.WebGLRenderTarget;
  private blurD: THREE.WebGLRenderTarget;
  private receiverScene = new THREE.Scene();
  private receiver: THREE.Mesh;
  private receiverCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10);
  private quadScene = new THREE.Scene();
  private quad: THREE.Mesh;
  private quadCam = new THREE.Camera();
  basePx = new THREE.Vector2(1600, 1000);
  rect: CanvasRect = { center: new THREE.Vector3(), width: 2.6, height: 1.625 };

  constructor(private renderer: THREE.WebGLRenderer) {
    this.output = this.makeTarget(1600, 1000, THREE.UnsignedByteType);
    this.mask = this.makeTarget(1600, 1000, THREE.HalfFloatType);
    this.blurA = this.makeTarget(400, 250, THREE.HalfFloatType);
    this.blurB = this.makeTarget(400, 250, THREE.HalfFloatType);
    this.blurC = this.makeTarget(200, 125, THREE.HalfFloatType);
    this.blurD = this.makeTarget(200, 125, THREE.HalfFloatType);
    this.receiver = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), maskMaterial);
    this.receiver.name = 'receiver (hidden, mask pass only)';
    this.receiverScene.add(this.receiver);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), processMaterial);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
    this.lightCamera.layers.set(CASTER_LAYER);
  }

  private makeTarget(w: number, h: number, type: THREE.TextureDataType) {
    return new THREE.WebGLRenderTarget(w, h, { type, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
  }

  setCanvas(rect: CanvasRect, basePx: THREE.Vector2) {
    this.rect = rect;
    this.basePx.copy(basePx);
    this.output.setSize(basePx.x, basePx.y);
    this.mask.setSize(basePx.x, basePx.y);
    this.blurA.setSize(Math.ceil(basePx.x / 4), Math.ceil(basePx.y / 4));
    this.blurB.setSize(Math.ceil(basePx.x / 4), Math.ceil(basePx.y / 4));
    this.blurC.setSize(Math.ceil(basePx.x / 8), Math.ceil(basePx.y / 8));
    this.blurD.setSize(Math.ceil(basePx.x / 8), Math.ceil(basePx.y / 8));
    this.receiver.position.copy(rect.center);
    this.receiver.scale.set(rect.width, rect.height, 1);
    this.receiver.updateMatrixWorld();
    const cam = this.receiverCam;
    cam.left = -rect.width / 2; cam.right = rect.width / 2; cam.top = rect.height / 2; cam.bottom = -rect.height / 2;
    cam.position.copy(rect.center).add(new THREE.Vector3(0, 0, 1));
    cam.lookAt(rect.center);
    cam.updateProjectionMatrix();
  }

  /** Aim the light-depth camera from the disc so it just covers the canvas. */
  private aimLight(lightPos: THREE.Vector3) {
    const cam = this.lightCamera;
    cam.position.copy(lightPos);
    cam.lookAt(this.rect.center);
    cam.updateMatrixWorld();
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    let maxTan = 0.1;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const corner = this.rect.center.clone().add(new THREE.Vector3((sx * this.rect.width) / 2, (sy * this.rect.height) / 2, 0));
      const local = corner.sub(lightPos).applyQuaternion(cam.quaternion.clone().invert());
      maxTan = Math.max(maxTan, Math.abs(local.x / local.z), Math.abs(local.y / local.z));
    }
    const tanHalf = Math.min(maxTan * 1.08, 4);
    cam.fov = THREE.MathUtils.radToDeg(Math.atan(tanHalf)) * 2;
    cam.updateProjectionMatrix();
    return tanHalf;
  }

  private renderTo(target: THREE.WebGLRenderTarget, scene: THREE.Scene, camera: THREE.Camera) {
    this.renderer.setRenderTarget(target);
    this.renderer.render(scene, camera);
  }

  update(scene: THREE.Scene, lightPos: THREE.Vector3, look: Look, time: number, target = this.output, maskTarget = this.mask) {
    const p = look.photo;
    const halftone = look.mode === 'Halftone';
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevClear = r.getClearColor(new THREE.Color());
    const prevAlpha = r.getClearAlpha();
    const prevAuto = r.autoClear;
    r.autoClear = true;

    // 1. Light-distance map of the casters only.
    const tanHalf = this.aimLight(lightPos);
    depthMaterial.uniforms.lightPos.value.copy(lightPos);
    depthMaterial.uniforms.translucency.value = p.translucency;
    depthMaterial.uniforms.veinDetail.value = p.veinDetail;
    const prevOverride = scene.overrideMaterial;
    const prevBg = scene.background;
    scene.overrideMaterial = depthMaterial;
    scene.background = null;
    r.setClearColor(0xffffff, 1);
    this.renderTo(this.depthRT, scene, this.lightCamera);
    scene.overrideMaterial = prevOverride;
    scene.background = prevBg;

    // 2. Mask pass: head-on orthographic render of the hidden receiver plane.
    const mu = maskMaterial.uniforms;
    mu.tDepth.value = this.depthRT.texture;
    mu.lightVP.value.multiplyMatrices(this.lightCamera.projectionMatrix, this.lightCamera.matrixWorldInverse);
    mu.lightPos.value.copy(lightPos);
    mu.lightRadius.value = p.lightSize;
    mu.softness.value = p.softness;
    mu.hard.value = halftone ? 1 : 0;
    mu.tanHalf.value = tanHalf;
    r.setClearColor(0x000000, 1);
    this.renderTo(maskTarget, this.receiverScene, this.receiverCam);

    if (halftone) {
      // Halftone studio: screen the raw mask, skipping every blur and scan stage.
      const h = look.halftone;
      const hu = halftoneMaterial.uniforms;
      hu.tMask.value = maskTarget.texture;
      hu.basePx.value.copy(this.basePx);
      hu.styleId.value = Math.max(0, HALFTONE_STYLES.indexOf(h.style));
      hu.cellSize.value = h.cellSize;
      hu.angle.value = h.angle;
      hu.threshold.value = h.threshold;
      hu.contrast.value = h.contrast;
      hu.gammaV.value = h.gamma;
      hu.ink.value.set(...hexToVec(h.ink));
      hu.paper.value.set(...hexToVec(h.paper));
      hu.invert.value = h.invert ? 1 : 0;
      this.quad.material = halftoneMaterial;
      this.renderTo(target, this.quadScene, this.quadCam);
      r.setRenderTarget(prevTarget);
      r.setClearColor(prevClear, prevAlpha);
      r.autoClear = prevAuto;
      return;
    }

    // 3. Two separable blur levels (medium at 1/4 res, wide at 1/8 res) for the depth-weighted
    //    extra blur, bloom and ghosting.
    this.quad.material = blurMaterial;
    const pass = (src: THREE.WebGLRenderTarget, dst: THREE.WebGLRenderTarget, dx: number, dy: number) => {
      blurMaterial.uniforms.tInput.value = src.texture;
      blurMaterial.uniforms.dir.value.set(dx / dst.width, dy / dst.height);
      this.renderTo(dst, this.quadScene, this.quadCam);
    };
    pass(maskTarget, this.blurA, 1.6, 0);
    pass(this.blurA, this.blurB, 0, 1.6);
    pass(this.blurB, this.blurC, 2.2, 0);
    pass(this.blurC, this.blurD, 0, 2.2);

    // 4. Colour + scan processing into the output.
    const u = processMaterial.uniforms;
    u.tMask.value = maskTarget.texture;
    u.tBlur.value = this.blurB.texture;
    u.tBlurWide.value = this.blurD.texture;
    u.blurFalloff.value = p.blurFalloff;
    u.basePx.value.copy(this.basePx);
    u.time.value = time;
    u.paper.value.set(...hexToVec(p.paper));
    u.rampLight.value.set(...hexToVec(p.rampLight));
    u.rampMid.value.set(...hexToVec(p.rampMid));
    u.rampDeep.value.set(...hexToVec(p.rampDeep));
    u.castColor.value.set(...hexToVec(p.castColor));
    u.midPosition.value = p.midPosition;
    u.density.value = p.density;
    u.hue.value = p.hue;
    u.saturation.value = p.saturation;
    u.brightness.value = p.brightness;
    u.contrast.value = p.contrast;
    u.gammaV.value = p.gamma;
    u.blackPoint.value = p.blackPoint;
    u.whitePoint.value = p.whitePoint;
    u.temperature.value = p.temperature;
    u.tintV.value = p.tint;
    u.extraBlur.value = p.extraBlur;
    u.bloom.value = p.bloom;
    u.ghost.value = p.ghost;
    const ga = THREE.MathUtils.degToRad(p.ghostAngle);
    u.ghostVec.value.set((Math.cos(ga) * p.ghostOffset) / this.basePx.x, (Math.sin(ga) * p.ghostOffset) / this.basePx.y);
    u.misregister.value = p.misregister;
    u.grain.value = p.grain;
    u.grainSize.value = p.grainSize;
    u.fiber.value = p.fiber;
    u.dust.value = p.dust;
    u.scratches.value = p.scratches;
    u.banding.value = p.banding;
    u.unevenLight.value = p.unevenLight;
    u.vignette.value = p.vignette;
    u.scanRotation.value = p.scanRotation;
    u.border.value = p.border;
    u.castAmount.value = p.cast;
    u.inverse.value = p.inverse;
    this.quad.material = processMaterial;
    this.renderTo(target, this.quadScene, this.quadCam);

    r.setRenderTarget(prevTarget);
    r.setClearColor(prevClear, prevAlpha);
    r.autoClear = prevAuto;
  }

  /** Render the canvas at scale × base resolution and return a PNG blob. */
  async exportPNG(scene: THREE.Scene, lightPos: THREE.Vector3, look: Look, time: number, scale: number): Promise<Blob> {
    const w = Math.round(this.basePx.x * scale);
    const h = Math.round(this.basePx.y * scale);
    const out = this.makeTarget(w, h, THREE.UnsignedByteType);
    const mask = this.makeTarget(w, h, THREE.HalfFloatType);
    this.update(scene, lightPos, look, time, out, mask);
    const pixels = new Uint8Array(w * h * 4);
    this.renderer.readRenderTargetPixels(out, 0, 0, w, h, pixels);
    out.dispose();
    mask.dispose();
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      // WebGL rows start at the bottom.
      img.data.set(pixels.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    }
    ctx.putImageData(img, 0, 0);
    return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encode failed'))), 'image/png'));
  }
}
