import type { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial, Skeleton } from "three";
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

function classifyVertices(mesh: Mesh): { parts: Float32Array; eyeRig: EyeRig | null; stats: MaskStats } {
  const geo = mesh.geometry as BufferGeometry;
  const pos = geo.getAttribute("position") as BufferAttribute;
  const nrm = geo.getAttribute("normal") as BufferAttribute | undefined;
  const skinIndex = geo.getAttribute("skinIndex") as BufferAttribute | undefined;
  const skinWeight = geo.getAttribute("skinWeight") as BufferAttribute | undefined;
  const skeleton = (mesh as Mesh & { skeleton?: Skeleton }).skeleton;
  const count = pos.count;
  const parts = new Float32Array(count);

  const headIds = new Set<number>();
  const neckIds = new Set<number>();
  const armIds = new Set<number>();
  skeleton?.bones.forEach((bone, i) => {
    const name = bone.name || "";
    if (/^head$/i.test(name) || (/head/i.test(name) && !/thigh|wear/i.test(name))) headIds.add(i);
    else if (/neck/i.test(name)) neckIds.add(i);
    else if (/arm|hand|wrist|finger|thumb/i.test(name)) armIds.add(i);
  });

  const headIdx: number[] = [];
  let yMin = Infinity;
  let yMax = -Infinity;
  let zMin = Infinity;
  for (let i = 0; i < count; i++) {
    const hw = skinIndex && skinWeight && headIds.size ? boneWeight(skinIndex, skinWeight, i, headIds) : 0;
    const nw = skinIndex && skinWeight ? boneWeight(skinIndex, skinWeight, i, neckIds) : 0;
    const aw = skinIndex && skinWeight ? boneWeight(skinIndex, skinWeight, i, armIds) : 0;
    if (aw > 0.28) {
      parts[i] = CLS_SKIN;
      continue;
    }
    if (nw > 0.32 && hw < 0.45) {
      parts[i] = CLS_SKIN;
      continue;
    }
    if (hw > 0.32) {
      headIdx.push(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
      if (z < zMin) zMin = z;
    }
  }

  const span = Math.max(yMax - yMin, 0.001);
  const yHair = yMin + span * 0.56;
  const yBrow = yMin + span * 0.46;
  const yCheek = yMin + span * 0.2;
  const zs: number[] = [];
  const xs: number[] = [];
  for (const i of headIdx) {
    zs.push(pos.getZ(i));
    xs.push(Math.abs(pos.getX(i)));
  }
  zs.sort((a, b) => a - b);
  xs.sort((a, b) => a - b);
  const zFace = percentile(zs, 0.18);
  const xFace = percentile(xs, 0.55);

  for (const i of headIdx) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const nz = nrm ? nrm.getZ(i) : -1;
    const front = z < zFace + 0.02 && nz < 0.2;
    const center = Math.abs(x) < Math.max(xFace, 0.09);
    if (y >= yHair) {
      parts[i] = CLS_HAIR;
    } else if (front && center && y < yBrow + 0.015 && y > yCheek - 0.01) {
      parts[i] = z < zFace - 0.028 ? CLS_HAIR : CLS_SKIN;
    } else if (y >= yCheek) {
      parts[i] = CLS_HAIR;
    } else {
      parts[i] = CLS_SKIN;
    }
  }

  const index = geo.index;
  if (index) {
    const next = parts.slice();
    for (let t = 0; t < index.count; t += 3) {
      const a = index.getX(t);
      const b = index.getX(t + 1);
      const c = index.getX(t + 2);
      const trio = [a, b, c];
      const hasHair = trio.some((v) => parts[v] === CLS_HAIR);
      if (!hasHair) continue;
      for (const v of trio) {
        if (parts[v] !== CLS_NONE) continue;
        const hw = skinIndex && skinWeight ? boneWeight(skinIndex, skinWeight, v, headIds) : 0;
        if (hw > 0.2) next[v] = CLS_HAIR;
      }
    }
    parts.set(next);
  }

  let hair = 0;
  let skin = 0;
  for (let i = 0; i < count; i++) {
    if (parts[i] === CLS_HAIR) hair++;
    else if (parts[i] === CLS_SKIN) skin++;
  }

  return {
    parts,
    eyeRig: findEyeRigFromHead(pos, nrm, headIdx, yMin, yMax, zMin),
    stats: { width: 0, height: 0, hair, skin, eyes: 0, ms: 0 },
  };
}

function findEyeRigFromHead(
  pos: BufferAttribute,
  nrm: BufferAttribute | undefined,
  head: number[],
  yMin: number,
  yMax: number,
  zMin: number,
): EyeRig | null {
  if (head.length < 40) return null;
  const hy = Math.max(yMax - yMin, 0.001);
  const yLo = yMin + hy * 0.28;
  const yHi = yMin + hy * 0.58;
  const zCut = zMin + 0.08;
  const left: number[] = [];
  const right: number[] = [];
  for (const i of head) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (y < yLo || y > yHi || z > zCut) continue;
    const ax = Math.abs(x);
    if (ax < 0.018 || ax > 0.11) continue;
    const nz = nrm ? nrm.getZ(i) : -1;
    if (nz > 0.15) continue;
    (x < 0 ? left : right).push(i);
  }
  const centroid = (ids: number[]) => {
    const c = new Vector3();
    if (!ids.length) return c;
    for (const i of ids) c.add(new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
    return c.multiplyScalar(1 / ids.length);
  };
  if (left.length < 5 || right.length < 5) {
    return {
      left: new Vector3(-0.038, yMin + hy * 0.42, zMin + 0.02),
      right: new Vector3(0.038, yMin + hy * 0.42, zMin + 0.02),
      iris: 0.018,
      pupil: 0.0065,
    };
  }
  return { left: centroid(left), right: centroid(right), iris: 0.018, pupil: 0.0065 };
}

export type MaskStats = {
  width: number;
  height: number;
  hair: number;
  skin: number;
  eyes: number;
  ms: number;
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
};

export class TextureRecolorer {
  defaults: ColorSet;
  eyeRig: EyeRig | null;
  stats: MaskStats;
  private uniforms: RecolorUniforms | null = null;
  private mat: MeshStandardMaterial | null = null;

  constructor(_map: unknown, mesh: Mesh) {
    const t0 = performance.now();
    const { parts, eyeRig, stats } = classifyVertices(mesh);
    const geo = mesh.geometry as BufferGeometry;
    geo.setAttribute("aPart", new Float32BufferAttribute(parts, 1));

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
      uEyeL: { value: eyeRig?.left.clone() ?? new Vector3(-0.04, 0.8, -0.12) },
      uEyeR: { value: eyeRig?.right.clone() ?? new Vector3(0.04, 0.8, -0.12) },
      uPupil: { value: eyeRig?.pupil ?? 0.0065 },
      uIris: { value: eyeRig?.iris ?? 0.018 },
    };
    this.uniforms = u;

    mat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uHair = u.uHair;
      shader.uniforms.uSkin = u.uSkin;
      shader.uniforms.uEyes = u.uEyes;
      shader.uniforms.uStrength = u.uStrength;
      shader.uniforms.uEyeL = u.uEyeL;
      shader.uniforms.uEyeR = u.uEyeR;
      shader.uniforms.uPupil = u.uPupil;
      shader.uniforms.uIris = u.uIris;

      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
attribute float aPart;
varying float vPart;
varying vec3 vBindPos;`,
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
vPart = aPart;
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
varying float vPart;
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
  float y = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  vec3 gray = vec3(y);
  vec3 painted = diffuseColor.rgb;
  float k = clamp(uStrength, 0.0, 1.0);

  if (vPart > 0.5 && vPart < 1.5) {
    painted = tintLuma(diffuseColor.rgb, uHair);
  } else if (vPart > 1.5 && vPart < 2.5) {
    painted = tintLuma(diffuseColor.rgb, uSkin);
  }

  float dL = distance(vBindPos, uEyeL);
  float dR = distance(vBindPos, uEyeR);
  vec3 ec = dL < dR ? uEyeL : uEyeR;
  float r = length(vBindPos.xy - ec.xy);
  float dz = abs(vBindPos.z - ec.z);
  bool inEye = r < uIris && dz < 0.024 && vBindPos.z < -0.06;
  if (inEye) {
    float mx = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b));
    float mn = min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b));
    bool sclera = (mx - mn) < 0.12 && y > 0.62;
    if (r < uPupil) {
      painted = vec3(0.05, 0.035, 0.03);
    } else if (!sclera) {
      float t = clamp((r - uPupil) / max(uIris - uPupil, 0.0001), 0.0, 1.0);
      float ring = smoothstep(0.0, 0.16, t) * (1.0 - smoothstep(0.78, 1.0, t));
      painted = uEyes * mix(0.42, 1.05, ring);
    }
  }

  if (vPart > 0.5 || inEye) {
    diffuseColor.rgb = mix(gray, painted, k);
  } else {
    diffuseColor.rgb = mix(gray, diffuseColor.rgb, k);
  }
}`,
        );
    };
    mat.customProgramCacheKey = () => "orbyt-vertex-recolor-v1";
    mat.needsUpdate = true;
  }

  apply(colors: ColorSet, strength: number) {
    if (!this.uniforms) return;
    this.uniforms.uHair.value.set(colors.hair);
    this.uniforms.uSkin.value.set(colors.skin);
    this.uniforms.uEyes.value.set(colors.eyes);
    this.uniforms.uStrength.value = Math.min(1, Math.max(0, strength));
    if (this.mat) this.mat.needsUpdate = true;
  }

  reset() {
    this.apply(this.defaults, 1);
  }
}

export { rgbToHsv, hexToRgb, hsvToRgb };
