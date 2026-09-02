import type { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial, Skeleton, Texture } from "three";
import { Color, Float32BufferAttribute, Vector3, type WebGLProgramParametersWithUniforms } from "three";

export type Channel = "hair" | "skin" | "eyes";

export type ColorSet = {
  hair: string;
  skin: string;
  eyes: string;
};

export const FALLBACK_COLORS: ColorSet = {
  hair: "#c45a28",
  skin: "#e0a078",
  eyes: "#3d6b3a",
};

export const PRESETS: Record<Channel, string[]> = {
  hair: ["#c45a28", "#1a120c", "#3b2214", "#8b5a2b", "#d4a017", "#f2d5a3", "#6b2d5b", "#2c4c3b"],
  skin: ["#f3d1b3", "#e0a078", "#c68642", "#8d5524", "#5c3310", "#ffd6c0", "#d9a066", "#b56b45"],
  eyes: ["#3d6b3a", "#2e5aa0", "#5b3a1e", "#1a1a1a", "#6b8f71", "#7a4b2a", "#3a6f8f", "#c4a35a"],
};

export const CLS_NONE = 0;
export const CLS_HAIR = 1;
export const CLS_SKIN = 2;
export const CLS_EYES = 3;

export type EyeRig = {
  left: Vector3;
  right: Vector3;
  iris: number;
  pupil: number;
  faceSign: number;
};

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 1e-6) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  const s = max < 1e-6 ? 0 : d / max;
  return [h, s, max];
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r = 0;
  let g = 0;
  let b = 0;
  switch (i % 6) {
    case 0:
      r = v;
      g = t;
      b = p;
      break;
    case 1:
      r = q;
      g = v;
      b = p;
      break;
    case 2:
      r = p;
      g = v;
      b = t;
      break;
    case 3:
      r = p;
      g = q;
      b = v;
      break;
    case 4:
      r = t;
      g = p;
      b = v;
      break;
    default:
      r = v;
      g = p;
      b = q;
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

export function hsvHex(h: number, s: number, v: number) {
  const [r, g, b] = hsvToRgb(h, s, v);
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

export function rgbToHex(rgb: [number, number, number]) {
  return `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function boneWeight(
  skinIndex: BufferAttribute,
  skinWeight: BufferAttribute,
  vertex: number,
  ids: Set<number>,
) {
  let w = 0;
  for (let k = 0; k < 4; k++) {
    const bone = skinIndex.getComponent(vertex, k);
    if (ids.has(bone)) w += skinWeight.getComponent(vertex, k);
  }
  return w;
}

function percentile(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[i]!;
}

function isWarmGinger(h: number, s: number, v: number) {
  const warm = h < 0.13 || h > 0.92;
  return warm && s > 0.38 && v > 0.12 && v < 0.82;
}

function isPeachSkin(h: number, s: number, v: number) {
  const warm = h < 0.14 || h > 0.9;
  return warm && s > 0.08 && s < 0.62 && v > 0.42;
}

type SampleRgb = (i: number) => [number, number, number] | null;

function makeSampler(map: Texture | null | undefined, uv: BufferAttribute | undefined): SampleRgb {
  const img = map?.image as { width?: number; height?: number; data?: Uint8ClampedArray } | HTMLImageElement | HTMLCanvasElement | undefined;
  if (!img || !uv) return () => null;

  let width = 0;
  let height = 0;
  let data: Uint8ClampedArray | Uint8Array | null = null;

  if ("data" in img && img.data && img.width && img.height) {
    width = img.width;
    height = img.height;
    data = img.data;
  } else if (typeof HTMLCanvasElement !== "undefined") {
    try {
      const w = (img as HTMLImageElement).width || 0;
      const h = (img as HTMLImageElement).height || 0;
      if (!w || !h) return () => null;
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return () => null;
      ctx.drawImage(img as CanvasImageSource, 0, 0);
      const pix = ctx.getImageData(0, 0, w, h);
      width = w;
      height = h;
      data = pix.data;
    } catch {
      return () => null;
    }
  }

  if (!data || !width || !height) return () => null;

  return (i: number) => {
    const u = uv.getX(i);
    const v = uv.getY(i);
    const x = Math.min(width - 1, Math.max(0, Math.floor(((u % 1) + 1) % 1 * width)));
    const y = Math.min(height - 1, Math.max(0, Math.floor((1 - (((v % 1) + 1) % 1)) * height)));
    const p = (y * width + x) * 4;
    return [data![p] ?? 0, data![p + 1] ?? 0, data![p + 2] ?? 0];
  };
}

function classifyVertices(
  mesh: Mesh,
  map?: Texture | null,
): { hair: Float32Array; skin: Float32Array; eyeRig: EyeRig | null; stats: MaskStats } {
  const geo = mesh.geometry as BufferGeometry;
  const pos = geo.getAttribute("position") as BufferAttribute;
  const nrm = geo.getAttribute("normal") as BufferAttribute | undefined;
  const uv = geo.getAttribute("uv") as BufferAttribute | undefined;
  const skinIndex = geo.getAttribute("skinIndex") as BufferAttribute | undefined;
  const skinWeight = geo.getAttribute("skinWeight") as BufferAttribute | undefined;
  const skeleton = (mesh as Mesh & { skeleton?: Skeleton }).skeleton;
  const count = pos.count;
  const hair = new Float32Array(count);
  const skin = new Float32Array(count);
  const sample = makeSampler(map ?? null, uv);

  const headIds = new Set<number>();
  const neckIds = new Set<number>();
  const armIds = new Set<number>();
  skeleton?.bones.forEach((bone, i) => {
    const name = bone.name || "";
    if (/^head$/i.test(name) || (/head/i.test(name) && !/thigh|wear|headwear/i.test(name))) headIds.add(i);
    else if (/neck/i.test(name)) neckIds.add(i);
    else if (/arm|hand|wrist|finger|thumb/i.test(name)) armIds.add(i);
  });

  const headIdx: number[] = [];
  const hwArr = new Float32Array(count);
  let yMin = Infinity;
  let yMax = -Infinity;
  let cx = 0;
  let cy = 0;
  let cz = 0;

  for (let i = 0; i < count; i++) {
    const hw = skinIndex && skinWeight && headIds.size ? boneWeight(skinIndex, skinWeight, i, headIds) : 0;
    const nw = skinIndex && skinWeight ? boneWeight(skinIndex, skinWeight, i, neckIds) : 0;
    const aw = skinIndex && skinWeight ? boneWeight(skinIndex, skinWeight, i, armIds) : 0;
    hwArr[i] = hw;
    if (aw > 0.22) {
      skin[i] = 1;
      continue;
    }
    if (nw > 0.28 && hw < 0.5) {
      skin[i] = 1;
      continue;
    }
    if (hw > 0.22) {
      headIdx.push(i);
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      cx += x;
      cy += y;
      cz += z;
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
    }
  }

  const headN = Math.max(headIdx.length, 1);
  cx /= headN;
  cy /= headN;
  cz /= headN;
  const span = Math.max(yMax - yMin, 0.001);

  const midBand: number[] = [];
  for (const i of headIdx) {
    const y = pos.getY(i);
    const t = (y - yMin) / span;
    if (t > 0.22 && t < 0.58) midBand.push(i);
  }
  let mx = 0;
  let my = 0;
  let mz = 0;
  for (const i of midBand) {
    mx += pos.getX(i);
    my += pos.getY(i);
    mz += pos.getZ(i);
  }
  const midN = Math.max(midBand.length, 1);
  mx /= midN;
  my /= midN;
  mz /= midN;
  const faceSign = Math.sign(mz - cz) || 1;

  const zs: number[] = [];
  const xs: number[] = [];
  const rads: number[] = [];
  for (const i of headIdx) {
    const x = pos.getX(i) - cx;
    const z = pos.getZ(i) - cz;
    xs.push(Math.abs(pos.getX(i) - cx));
    zs.push((pos.getZ(i) - cz) * faceSign);
    rads.push(Math.hypot(x, z));
  }
  xs.sort((a, b) => a - b);
  zs.sort((a, b) => a - b);
  rads.sort((a, b) => a - b);
  const xFace = percentile(xs, 0.42);
  const zFront = percentile(zs, 0.78);
  const rFace = percentile(rads, 0.48);

  const yHair = yMin + span * 0.58;
  const yBrow = yMin + span * 0.52;
  const yLip = yMin + span * 0.22;

  for (const i of headIdx) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const fwd = (z - cz) * faceSign;
    const lat = Math.abs(x - cx);
    const rad = Math.hypot(x - cx, z - cz);
    const nz = nrm ? nrm.getZ(i) * faceSign : 1;
    const rgb = sample(i);
    let texHair = false;
    let texSkin = false;
    if (rgb) {
      const [hh, ss, vv] = rgbToHsv(rgb[0], rgb[1], rgb[2]);
      texHair = isWarmGinger(hh, ss, vv);
      texSkin = isPeachSkin(hh, ss, vv);
    }

    const high = y >= yHair;
    const back = fwd < zFront * 0.15;
    const sideCurl = lat > xFace * 1.15 || rad > rFace * 1.12;
    const facePlate =
      y < yBrow &&
      y > yLip &&
      lat < Math.max(xFace, 0.07) &&
      fwd > zFront * 0.35 &&
      rad < rFace * 1.08 &&
      nz > -0.05;

    if (high || back || sideCurl) {
      hair[i] = 1;
    } else if (facePlate && !texHair) {
      skin[i] = 1;
    } else if (texSkin && !texHair && y < yBrow) {
      skin[i] = 1;
    } else {
      hair[i] = 1;
    }
  }

  const index = geo.index;
  if (index) {
    const nextHair = hair.slice();
    const nextSkin = skin.slice();
    for (let pass = 0; pass < 2; pass++) {
      for (let t = 0; t < index.count; t += 3) {
        const a = index.getX(t);
        const b = index.getX(t + 1);
        const c = index.getX(t + 2);
        const trio = [a, b, c];
        const hairN = trio.filter((v) => hair[v] > 0.5).length;
        const skinN = trio.filter((v) => skin[v] > 0.5).length;
        for (const v of trio) {
          if (hair[v] > 0.5 || skin[v] > 0.5) continue;
          if (hwArr[v] < 0.12) continue;
          if (hairN >= 2) nextHair[v] = 1;
          else if (skinN >= 2) nextSkin[v] = 1;
        }
      }
      hair.set(nextHair);
      skin.set(nextSkin);
    }
  }

  for (let i = 0; i < count; i++) {
    if (hair[i] > 0.5 && skin[i] > 0.5) {
      skin[i] = 0;
    }
  }

  let hairN = 0;
  let skinN = 0;
  for (let i = 0; i < count; i++) {
    if (hair[i] > 0.5) hairN++;
    else if (skin[i] > 0.5) skinN++;
  }

  return {
    hair,
    skin,
    eyeRig: findEyeRig(pos, nrm, headIdx, yMin, yMax, cx, cy, cz, faceSign),
    stats: { width: 0, height: 0, hair: hairN, skin: skinN, eyes: 0, ms: 0, faceSign },
  };
}

function findEyeRig(
  pos: BufferAttribute,
  nrm: BufferAttribute | undefined,
  head: number[],
  yMin: number,
  yMax: number,
  cx: number,
  cy: number,
  cz: number,
  faceSign: number,
): EyeRig | null {
  if (head.length < 40) {
    return {
      left: new Vector3(cx - 0.038, cy, cz + faceSign * 0.08),
      right: new Vector3(cx + 0.038, cy, cz + faceSign * 0.08),
      iris: 0.022,
      pupil: 0.0075,
      faceSign,
    };
  }
  const hy = Math.max(yMax - yMin, 0.001);
  const yLo = yMin + hy * 0.34;
  const yHi = yMin + hy * 0.58;
  const left: number[] = [];
  const right: number[] = [];
  for (const i of head) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (y < yLo || y > yHi) continue;
    const fwd = (z - cz) * faceSign;
    if (fwd < 0.01) continue;
    const ax = Math.abs(x - cx);
    if (ax < 0.016 || ax > 0.09) continue;
    const nz = nrm ? nrm.getZ(i) * faceSign : 1;
    if (nz < -0.2) continue;
    (x < cx ? left : right).push(i);
  }
  const centroid = (ids: number[]) => {
    const c = new Vector3();
    if (!ids.length) return c;
    for (const i of ids) c.add(new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
    return c.multiplyScalar(1 / ids.length);
  };
  const fallbackL = new Vector3(cx - 0.038, yMin + hy * 0.46, cz + faceSign * 0.07);
  const fallbackR = new Vector3(cx + 0.038, yMin + hy * 0.46, cz + faceSign * 0.07);
  return {
    left: left.length >= 5 ? centroid(left) : fallbackL,
    right: right.length >= 5 ? centroid(right) : fallbackR,
    iris: 0.022,
    pupil: 0.0075,
    faceSign,
  };
}

export type MaskStats = {
  width: number;
  height: number;
  hair: number;
  skin: number;
  eyes: number;
  ms: number;
  faceSign?: number;
};

type RecolorUniforms = {
  uHair: { value: Color };
  uSkin: { value: Color };
  uEyes: { value: Color };
  uStrength: { value: number };
  uEyeL: { value: Vector3 };
  uEyeR: { value: Vector3 };
  uPupil: { value: number };
  uIris: { value: number };
  uFaceSign: { value: number };
};

export class TextureRecolorer {
  defaults: ColorSet;
  eyeRig: EyeRig | null;
  stats: MaskStats;
  private uniforms: RecolorUniforms | null = null;
  private mat: MeshStandardMaterial | null = null;

  constructor(map: Texture | null | undefined, mesh: Mesh) {
    const t0 = performance.now();
    const { hair, skin, eyeRig, stats } = classifyVertices(mesh, map);
    const geo = mesh.geometry as BufferGeometry;
    geo.setAttribute("aHair", new Float32BufferAttribute(hair, 1));
    geo.setAttribute("aSkin", new Float32BufferAttribute(skin, 1));

    this.eyeRig = eyeRig;
    this.defaults = { ...FALLBACK_COLORS };
    this.stats = { ...stats, ms: performance.now() - t0 };

    const mat = mesh.material as MeshStandardMaterial;
    this.mat = mat;
    const u: RecolorUniforms = {
      uHair: { value: new Color(FALLBACK_COLORS.hair) },
      uSkin: { value: new Color(FALLBACK_COLORS.skin) },
      uEyes: { value: new Color(FALLBACK_COLORS.eyes) },
      uStrength: { value: 1 },
      uEyeL: { value: eyeRig?.left.clone() ?? new Vector3(-0.04, 0.8, 0.12) },
      uEyeR: { value: eyeRig?.right.clone() ?? new Vector3(0.04, 0.8, 0.12) },
      uPupil: { value: eyeRig?.pupil ?? 0.0075 },
      uIris: { value: eyeRig?.iris ?? 0.022 },
      uFaceSign: { value: eyeRig?.faceSign ?? 1 },
    };
    this.uniforms = u;

    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer) => {
      if (typeof prev === "function") prev(shader, renderer);
      shader.uniforms.uHair = u.uHair;
      shader.uniforms.uSkin = u.uSkin;
      shader.uniforms.uEyes = u.uEyes;
      shader.uniforms.uStrength = u.uStrength;
      shader.uniforms.uEyeL = u.uEyeL;
      shader.uniforms.uEyeR = u.uEyeR;
      shader.uniforms.uPupil = u.uPupil;
      shader.uniforms.uIris = u.uIris;
      shader.uniforms.uFaceSign = u.uFaceSign;

      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
attribute float aHair;
attribute float aSkin;
varying float vHair;
varying float vSkin;
varying vec3 vBindPos;`,
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
vHair = aHair;
vSkin = aSkin;
vBindPos = position;`,
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
uniform vec3 uHair;
uniform vec3 uSkin;
uniform vec3 uEyes;
uniform float uStrength;
uniform vec3 uEyeL;
uniform vec3 uEyeR;
uniform float uPupil;
uniform float uIris;
uniform float uFaceSign;
varying float vHair;
varying float vSkin;
varying vec3 vBindPos;

vec3 tintLuma(vec3 src, vec3 tint) {
  float y = dot(src, vec3(0.2126, 0.7152, 0.0722));
  float ty = max(dot(tint, vec3(0.2126, 0.7152, 0.0722)), 0.08);
  return tint * (y / ty);
}`,
        )
        .replace(
          "#include <map_fragment>",
          `#include <map_fragment>
{
  vec3 src = diffuseColor.rgb;
  float y = dot(src, vec3(0.2126, 0.7152, 0.0722));
  vec3 gray = vec3(y);
  float k = clamp(uStrength, 0.0, 1.0);

  float h = clamp(vHair, 0.0, 1.0);
  float s = clamp(vSkin, 0.0, 1.0);
  if (h > 0.0 && s > 0.0) {
    float sum = h + s;
    h /= sum;
    s /= sum;
  }
  float part = max(h, s);

  vec3 tint = h * uHair + s * uSkin;
  vec3 painted = part > 0.001 ? tintLuma(src, tint) : src;

  float dL = distance(vBindPos, uEyeL);
  float dR = distance(vBindPos, uEyeR);
  vec3 ec = dL < dR ? uEyeL : uEyeR;
  vec2 eyeXy = vBindPos.xy - ec.xy;
  float r = length(eyeXy);
  float fwd = (vBindPos.z - ec.z) * uFaceSign;
  float mx = max(src.r, max(src.g, src.b));
  float mn = min(src.r, min(src.g, src.b));
  bool sclera = (mx - mn) < 0.14 && y > 0.58;
  bool inDisk = r < uIris && abs(fwd) < 0.03 && fwd > -0.012;
  if (inDisk && !sclera) {
    if (r < uPupil) {
      painted = vec3(0.05, 0.035, 0.03);
    } else {
      float t = clamp((r - uPupil) / max(uIris - uPupil, 0.0001), 0.0, 1.0);
      float ring = smoothstep(0.0, 0.18, t) * (1.0 - smoothstep(0.72, 1.0, t));
      painted = tintLuma(src, uEyes) * mix(0.55, 1.12, ring);
    }
    part = 1.0;
  }

  if (part > 0.001) {
    diffuseColor.rgb = mix(gray, painted, k);
  } else {
    diffuseColor.rgb = mix(gray, src, k);
  }
}`,
        );
    };
    mat.customProgramCacheKey = () => "orbyt-region-recolor-v2";
    mat.needsUpdate = true;
  }

  apply(colors: ColorSet, strength: number) {
    if (!this.uniforms) return;
    this.uniforms.uHair.value.set(colors.hair);
    this.uniforms.uSkin.value.set(colors.skin);
    this.uniforms.uEyes.value.set(colors.eyes);
    this.uniforms.uStrength.value = Math.min(1, Math.max(0, strength));
  }

  reset() {
    this.apply(this.defaults, 1);
  }
}

export { rgbToHsv, hexToRgb, hsvToRgb };
