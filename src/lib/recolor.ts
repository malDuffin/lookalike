import type { BufferAttribute, BufferGeometry, Mesh, Skeleton, Texture } from "three";
import { LinearFilter, SRGBColorSpace, Vector3 } from "three";

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

function luma(r: number, g: number, b: number) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function isWarm(h: number) {
  return h < 0.14 || h > 0.9;
}

function isHairCore(h: number, s: number, v: number) {
  return isWarm(h) && s > 0.45 && v > 0.08 && v < 0.88;
}

function isHairSoft(h: number, s: number, v: number) {
  return isWarm(h) && s > 0.16 && v > 0.06 && v < 0.94;
}

function isPeachSkin(h: number, s: number, v: number) {
  if (!isWarm(h)) return false;
  if (s < 0.05 || s > 0.62) return false;
  if (v < 0.28 || v > 0.98) return false;
  if (s > 0.56 && v < 0.62) return false;
  return true;
}

function isIrisColor(h: number, s: number, v: number) {
  if (v < 0.12 || v > 0.62 || s < 0.18) return false;
  const olive = h > 0.14 && h < 0.48;
  const brown = (h < 0.1 || h > 0.92) && v < 0.45;
  return olive || brown;
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

function rasterLayer(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true, alpha: false });
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#fff";
  return ctx;
}

function growSeeds(seeds: Uint8Array, allow: Uint8Array, width: number, height: number, steps: number) {
  const out = new Uint8Array(seeds);
  const q: number[] = [];
  for (let p = 0; p < seeds.length; p++) if (seeds[p]) q.push(p);
  let head = 0;
  const dirs = [-1, 1, -width, width];
  const dist = new Int16Array(seeds.length);
  dist.fill(-1);
  for (const p of q) dist[p] = 0;
  while (head < q.length) {
    const p = q[head++]!;
    const d = dist[p]!;
    if (d >= steps) continue;
    for (const dir of dirs) {
      const n = p + dir;
      if (n < 0 || n >= out.length) continue;
      if (out[n] || !allow[n]) continue;
      if (Math.abs((n % width) - (p % width)) > 1) continue;
      out[n] = 1;
      dist[n] = d + 1;
      q.push(n);
    }
  }
  return out;
}

function fillHoles(mask: Uint8Array, allow: Uint8Array, cls: number, width: number, height: number) {
  const out = new Uint8Array(mask);
  for (let round = 0; round < 5; round++) {
    const src = new Uint8Array(out);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const p = y * width + x;
        if (src[p] || !allow[p]) continue;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            if (src[p + dy * width + dx] === cls) n++;
          }
        }
        if (n >= 5) out[p] = cls;
      }
    }
  }
  return out;
}

function dilateMask(src: Uint8Array, width: number, height: number, radius: number) {
  const out = new Uint8Array(src);
  if (radius <= 0) return out;
  for (let y = radius; y < height - radius; y++) {
    for (let x = radius; x < width - radius; x++) {
      const p = y * width + x;
      if (src[p]) {
        out[p] = 1;
        continue;
      }
      let hit = 0;
      for (let dy = -radius; dy <= radius && !hit; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (src[p + dy * width + dx]) {
            hit = 1;
            break;
          }
        }
      }
      if (hit) out[p] = 1;
    }
  }
  return out;
}
