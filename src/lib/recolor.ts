import type { BufferAttribute, BufferGeometry, Mesh, Skeleton, Texture } from "three";
import { LinearFilter, SRGBColorSpace } from "three";

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

const CLS_NONE = 0;
const CLS_HAIR = 1;
const CLS_SKIN = 2;
const CLS_EYES = 3;

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

function isFleshHue(h: number, s: number, v: number) {
  const orange = h < 0.12 || h > 0.92;
  return orange && s > 0.14 && v > 0.12 && v < 0.98;
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

type Vec3 = { x: number; y: number; z: number };

function dist3(a: Vec3, b: Vec3) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function findEyeCenters(
  pos: BufferAttribute,
  skinIndex: BufferAttribute,
  skinWeight: BufferAttribute,
  headIds: Set<number>,
): Vec3[] {
  const left = { x: 0, y: 0, z: 0, n: 0 };
  const right = { x: 0, y: 0, z: 0, n: 0 };
  for (let i = 0; i < pos.count; i++) {
    if (boneWeight(skinIndex, skinWeight, i, headIds) < 0.4) continue;
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (y < 0.76 || y > 0.84 || z > -0.12) continue;
    const ax = Math.abs(x);
    if (ax < 0.02 || ax > 0.1) continue;
    const side = x < 0 ? left : right;
    side.x += x;
    side.y += y;
    side.z += z;
    side.n += 1;
  }
  if (left.n < 40 || right.n < 40) return [];
  return [
    { x: left.x / left.n, y: left.y / left.n, z: left.z / left.n },
    { x: right.x / right.n, y: right.y / right.n, z: right.z / right.n },
  ];
}

function fillTri(
  ctx: CanvasRenderingContext2D,
  pa: [number, number],
  pb: [number, number],
  pc: [number, number],
) {
  ctx.beginPath();
  ctx.moveTo(pa[0], pa[1]);
  ctx.lineTo(pb[0], pb[1]);
  ctx.lineTo(pc[0], pc[1]);
  ctx.closePath();
  ctx.fill();
}

function rasterizeClassMask(mesh: Mesh, src: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const n = width * height;
  const mask = new Uint8Array(n);
  const geo = mesh.geometry as BufferGeometry;
  const uvAttr = geo.getAttribute("uv") as BufferAttribute | undefined;
  const posAttr = geo.getAttribute("position") as BufferAttribute | undefined;
  const nrmAttr = geo.getAttribute("normal") as BufferAttribute | undefined;
  const skinIndex = geo.getAttribute("skinIndex") as BufferAttribute | undefined;
  const skinWeight = geo.getAttribute("skinWeight") as BufferAttribute | undefined;
  const skeleton = (mesh as Mesh & { skeleton?: Skeleton }).skeleton;
  if (!uvAttr || !posAttr || !nrmAttr || !skinIndex || !skinWeight || !skeleton) return mask;

  const headIds = new Set<number>();
  const neckIds = new Set<number>();
  const bodyIds = new Set<number>();
  const handIds = new Set<number>();
  skeleton.bones.forEach((bone, i) => {
    const name = bone.name;
    if (/head/i.test(name)) headIds.add(i);
    if (/neck/i.test(name)) neckIds.add(i);
    if (/spine|waist|clavicle|hip|pelvis/i.test(name)) bodyIds.add(i);
    if (/hand|forearm|upperarm/i.test(name)) handIds.add(i);
  });
  if (!headIds.size) return mask;

  const eyes = findEyeCenters(posAttr, skinIndex, skinWeight, headIds);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true, alpha: false });
  if (!ctx) return mask;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);

  const index = geo.index;
  const triCount = index ? index.count / 3 : uvAttr.count / 3;
  const uvAt = (vi: number): [number, number] => {
    const u = uvAttr.getX(vi);
    const v = uvAttr.getY(vi);
    return [u * width, (1 - v) * height];
  };

  type Tri = {
    pa: [number, number];
    pb: [number, number];
    pc: [number, number];
    kind: "hair" | "skin" | "eye";
  };
  const hairTris: Tri[] = [];
  const skinTris: Tri[] = [];
  const eyeTris: Tri[] = [];

  for (let t = 0; t < triCount; t++) {
    const a = index ? index.getX(t * 3) : t * 3;
    const b = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const c = index ? index.getX(t * 3 + 2) : t * 3 + 2;
    const hw =
      (boneWeight(skinIndex, skinWeight, a, headIds) +
        boneWeight(skinIndex, skinWeight, b, headIds) +
        boneWeight(skinIndex, skinWeight, c, headIds)) /
      3;
    const nw =
      (boneWeight(skinIndex, skinWeight, a, neckIds) +
        boneWeight(skinIndex, skinWeight, b, neckIds) +
        boneWeight(skinIndex, skinWeight, c, neckIds)) /
      3;
    const bw =
      (boneWeight(skinIndex, skinWeight, a, bodyIds) +
        boneWeight(skinIndex, skinWeight, b, bodyIds) +
        boneWeight(skinIndex, skinWeight, c, bodyIds)) /
      3;
    const fw =
      (boneWeight(skinIndex, skinWeight, a, handIds) +
        boneWeight(skinIndex, skinWeight, b, handIds) +
        boneWeight(skinIndex, skinWeight, c, handIds)) /
      3;
    const x = (posAttr.getX(a) + posAttr.getX(b) + posAttr.getX(c)) / 3;
    const y = (posAttr.getY(a) + posAttr.getY(b) + posAttr.getY(c)) / 3;
    const z = (posAttr.getZ(a) + posAttr.getZ(b) + posAttr.getZ(c)) / 3;
    const nz = (nrmAttr.getZ(a) + nrmAttr.getZ(b) + nrmAttr.getZ(c)) / 3;
    const pa = uvAt(a);
    const pb = uvAt(b);
    const pc = uvAt(c);

    let kind: Tri["kind"] | null = null;
    const onSkinBone = nw > 0.22 || bw > 0.22 || fw > 0.22;
    if (onSkinBone) kind = "skin";

    if (hw > 0.32) {
      const cen = { x, y, z };
      const onEye =
        eyes.length === 2 &&
        nz < 0.12 &&
        Math.min(dist3(cen, eyes[0]!), dist3(cen, eyes[1]!)) < 0.08;
      if (onEye) {
        kind = "eye";
      } else if (y < 0.705) {
        kind = "skin";
      } else if (y < 0.87 && z < -0.04 && nz < -0.12) {
        kind = "skin";
      } else if (Math.abs(x) > 0.115 && y > 0.7 && y < 0.84 && z > -0.07 && z < 0.09) {
        kind = "skin";
      } else if (!onSkinBone) {
        kind = "hair";
      }
    }

    if (!kind) continue;
    const tri = { pa, pb, pc, kind };
    if (kind === "hair") hairTris.push(tri);
    else if (kind === "skin") skinTris.push(tri);
    else eyeTris.push(tri);
  }

  ctx.fillStyle = "#ff0000";
  for (const tri of hairTris) fillTri(ctx, tri.pa, tri.pb, tri.pc);
  ctx.fillStyle = "#00ff00";
  for (const tri of skinTris) fillTri(ctx, tri.pa, tri.pb, tri.pc);
  ctx.fillStyle = "#0000ff";
  for (const tri of eyeTris) fillTri(ctx, tri.pa, tri.pb, tri.pc);

  const data = ctx.getImageData(0, 0, width, height).data;
  const eyeCover = new Uint8Array(n);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    if (g > 90) mask[p] = CLS_SKIN;
    else if (r > 90) mask[p] = CLS_HAIR;
    if (b > 80) eyeCover[p] = 1;
  }

  const irisSeed = new Uint8Array(n);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    if (!eyeCover[p]) continue;
    const [h, s, v] = rgbToHsv(src[i]!, src[i + 1]!, src[i + 2]!);
    if (v < 0.14) continue;
    if (s < 0.12 && v > 0.55) continue;
    const green = h > 0.1 && h < 0.58 && s > 0.12 && v < 0.85;
    const darkIris = s > 0.18 && v < 0.62;
    if (green || darkIris) irisSeed[p] = 1;
  }

  const q = new Uint32Array(n);
  let qh = 0;
  let qt = 0;
  for (let p = 0; p < n; p++) {
    if (!irisSeed[p]) continue;
    mask[p] = CLS_EYES;
    q[qt++] = p;
  }
  const dirs = [-1, 1, -width, width];
  while (qh < qt) {
    const p = q[qh++]!;
    const x = p % width;
    for (const off of dirs) {
      if (off === -1 && x === 0) continue;
      if (off === 1 && x === width - 1) continue;
      const np = p + off;
      if (np < 0 || np >= n) continue;
      if (!eyeCover[np] || mask[np] === CLS_EYES) continue;
      const i = np * 4;
      const [h, s, v] = rgbToHsv(src[i]!, src[i + 1]!, src[i + 2]!);
      if (v < 0.14) continue;
      if (s < 0.12 && v > 0.58) continue;
      if (isFleshHue(h, s, v) && v > 0.78) continue;
      mask[np] = CLS_EYES;
      q[qt++] = np;
    }
  }

  let eroded = mask;
  for (let pass = 0; pass < 2; pass++) {
    const srcMask = pass === 0 ? mask : eroded;
    const out = new Uint8Array(srcMask);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const p = y * width + x;
        if (srcMask[p] !== CLS_HAIR) continue;
        if (
          srcMask[p - 1] === CLS_SKIN ||
          srcMask[p + 1] === CLS_SKIN ||
          srcMask[p - width] === CLS_SKIN ||
          srcMask[p + width] === CLS_SKIN
        ) {
          out[p] = CLS_SKIN;
        }
      }
    }
    eroded = out;
  }
  return eroded;
}

export class TextureRecolorer {
  original: ImageData;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  map: Texture;
  classMask: Uint8Array;
  defaults: ColorSet;

  constructor(map: Texture, mesh: Mesh) {
    const img = map.image as CanvasImageSource & { width?: number; height?: number };
    const w = img.width || 1024;
    const h = img.height || 1024;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Could not create texture canvas");
    ctx.drawImage(img, 0, 0, w, h);
    this.original = ctx.getImageData(0, 0, w, h);
    this.canvas = canvas;
    this.ctx = ctx;
    map.image = canvas;
    map.colorSpace = SRGBColorSpace;
    map.minFilter = LinearFilter;
    map.generateMipmaps = false;
    map.needsUpdate = true;
    this.map = map;
    this.classMask = rasterizeClassMask(mesh, this.original.data, w, h);
    this.defaults = this.sampleDefaults();
  }

  sampleDefaults(): ColorSet {
    const src = this.original.data;
    const sums = {
      hair: [0, 0, 0, 0],
      skin: [0, 0, 0, 0],
      eyes: [0, 0, 0, 0],
    };
    for (let i = 0, p = 0; i < src.length; i += 4, p++) {
      const cls = this.classMask[p];
      if (cls === CLS_NONE) continue;
      const key = cls === CLS_HAIR ? "hair" : cls === CLS_SKIN ? "skin" : "eyes";
      sums[key][0] += src[i]!;
      sums[key][1] += src[i + 1]!;
      sums[key][2] += src[i + 2]!;
      sums[key][3] += 1;
    }
    const toHex = (arr: number[]) => {
      if (!arr[3]) return null;
      const r = Math.round(arr[0]! / arr[3]!);
      const g = Math.round(arr[1]! / arr[3]!);
      const b = Math.round(arr[2]! / arr[3]!);
      return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
    };
    return {
      hair: toHex(sums.hair) ?? FALLBACK_COLORS.hair,
      skin: toHex(sums.skin) ?? FALLBACK_COLORS.skin,
      eyes: toHex(sums.eyes) ?? FALLBACK_COLORS.eyes,
    };
  }

  apply(colors: ColorSet, strength: number) {
    const src = this.original.data;
    const out = this.ctx.createImageData(this.original.width, this.original.height);
    const dst = out.data;
    const tHair = rgbToHsv(...hexToRgb(colors.hair));
    const tSkin = rgbToHsv(...hexToRgb(colors.skin));
    const tEyes = rgbToHsv(...hexToRgb(colors.eyes));
    const k = strength;
    const mask = this.classMask;

    for (let i = 0, p = 0; i < src.length; i += 4, p++) {
      const r = src[i]!;
      const g = src[i + 1]!;
      const b = src[i + 2]!;
      const a = src[i + 3]!;
      const cls = mask[p] ?? CLS_NONE;
      let nr = r;
      let ng = g;
      let nb = b;
      if (cls !== CLS_NONE && k > 0) {
        const [, ss, vv] = rgbToHsv(r, g, b);
        const tgt = cls === CLS_HAIR ? tHair : cls === CLS_SKIN ? tSkin : tEyes;
        let ns: number;
        let nv: number;
        if (cls === CLS_EYES) {
          ns = Math.min(1, Math.max(tgt[1], 0.92) * (0.25 + 0.75 * k));
          nv = Math.min(0.8, Math.max(0.32, 0.22 * vv + (0.42 + tgt[2] * 0.38) * k));
        } else {
          ns = ss * (1 - 0.72 * k) + tgt[1] * 0.72 * k;
          nv = vv * (1 - 0.35 * k) + (vv * (tgt[2] / Math.max(vv, 0.18))) * 0.35 * k;
        }
        const rgb = hsvToRgb(tgt[0], Math.min(1, ns), Math.min(1, Math.max(0, nv)));
        nr = rgb[0];
        ng = rgb[1];
        nb = rgb[2];
      }
      dst[i] = nr;
      dst[i + 1] = ng;
      dst[i + 2] = nb;
      dst[i + 3] = a;
    }
    this.ctx.putImageData(out, 0, 0);
    this.map.needsUpdate = true;
  }

  reset() {
    this.ctx.putImageData(this.original, 0, 0);
    this.map.needsUpdate = true;
  }
}

export function rgbToHex(rgb: [number, number, number]) {
  return `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export { rgbToHsv, hexToRgb };
