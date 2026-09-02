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
    if (ids.has(skinIndex.getComponent(vertex, k))) w += skinWeight.getComponent(vertex, k);
  }
  return w;
}

function weldKey(x: number, y: number, z: number) {
  return `${Math.round(x * 6000)},${Math.round(y * 6000)},${Math.round(z * 6000)}`;
}

type Island = {
  id: number;
  tris: number;
  verts: number[];
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  head: number;
  neck: number;
  arm: number;
  cloth: number;
};

function vertOf(index: BufferAttribute | null, t: number, k: number) {
  return index ? index.getX(t * 3 + k) : t * 3 + k;
}

function buildUvIslands(
  count: number,
  uv: BufferAttribute,
  index: BufferAttribute | null,
  triCount: number,
) {
  const edgeToTris = new Map<string, number[]>();
  const uvEdge = (a: number, b: number) => {
    const ka = `${Math.round(uv.getX(a) * 4096)},${Math.round(uv.getY(a) * 4096)}`;
    const kb = `${Math.round(uv.getX(b) * 4096)},${Math.round(uv.getY(b) * 4096)}`;
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  };
  for (let t = 0; t < triCount; t++) {
    const a = vertOf(index, t, 0);
    const b = vertOf(index, t, 1);
    const c = vertOf(index, t, 2);
    for (const [p, q] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const k = uvEdge(p, q);
      const arr = edgeToTris.get(k);
      if (arr) arr.push(t);
      else edgeToTris.set(k, [t]);
    }
  }
  const uvAdj: number[][] = Array.from({ length: triCount }, () => []);
  for (const arr of edgeToTris.values()) {
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        uvAdj[arr[i]!]!.push(arr[j]!);
        uvAdj[arr[j]!]!.push(arr[i]!);
      }
    }
  }
  const islandOfTri = new Int32Array(triCount).fill(-1);
  let nIslands = 0;
  for (let t = 0; t < triCount; t++) {
    if (islandOfTri[t] !== -1) continue;
    const stack = [t];
    islandOfTri[t] = nIslands;
    while (stack.length) {
      const cur = stack.pop()!;
      for (const nb of uvAdj[cur]!) {
        if (islandOfTri[nb] === -1) {
          islandOfTri[nb] = nIslands;
          stack.push(nb);
        }
      }
    }
    nIslands++;
  }
  const islandOfVert = new Int32Array(count).fill(-1);
  const islandVerts: number[][] = Array.from({ length: nIslands }, () => []);
  for (let t = 0; t < triCount; t++) {
    const id = islandOfTri[t]!;
    for (let k = 0; k < 3; k++) {
      const v = vertOf(index, t, k);
      if (islandOfVert[v] === -1) {
        islandOfVert[v] = id;
        islandVerts[id]!.push(v);
      }
    }
  }
  return { nIslands, islandOfTri, islandOfVert, islandVerts };
}

function summarizeIslands(
  nIslands: number,
  islandVerts: number[][],
  islandOfTri: Int32Array,
  pos: BufferAttribute,
  nrm: BufferAttribute | undefined,
  hw: Float32Array,
  nw: Float32Array,
  aw: Float32Array,
  cw: Float32Array,
): Island[] {
  const islands: Island[] = [];
  for (let id = 0; id < nIslands; id++) {
    const verts = islandVerts[id]!;
    let x = 0;
    let y = 0;
    let z = 0;
    let nx = 0;
    let ny = 0;
    let nz = 0;
    let head = 0;
    let neck = 0;
    let arm = 0;
    let cloth = 0;
    const n = Math.max(verts.length, 1);
    for (const v of verts) {
      x += pos.getX(v);
      y += pos.getY(v);
      z += pos.getZ(v);
      if (nrm) {
        nx += nrm.getX(v);
        ny += nrm.getY(v);
        nz += nrm.getZ(v);
      }
      head += hw[v]!;
      neck += nw[v]!;
      arm += aw[v]!;
      cloth += cw[v]!;
    }
    islands.push({
      id,
      tris: 0,
      verts,
      x: x / n,
      y: y / n,
      z: z / n,
      nx: nx / n,
      ny: ny / n,
      nz: nz / n,
      head: head / n,
      neck: neck / n,
      arm: arm / n,
      cloth: cloth / n,
    });
  }
  for (let t = 0; t < islandOfTri.length; t++) islands[islandOfTri[t]!]!.tris++;
  return islands;
}

function buildSpatialGraph(count: number, pos: BufferAttribute, index: BufferAttribute | null, triCount: number) {
  const weldOf = new Int32Array(count);
  const weldMembers: number[][] = [];
  const buckets = new Map<string, number>();
  for (let i = 0; i < count; i++) {
    const key = weldKey(pos.getX(i), pos.getY(i), pos.getZ(i));
    let id = buckets.get(key);
    if (id === undefined) {
      id = weldMembers.length;
      buckets.set(key, id);
      weldMembers.push([]);
    }
    weldOf[i] = id;
    weldMembers[id]!.push(i);
  }
  const nWeld = weldMembers.length;
  const wx = new Float32Array(nWeld);
  const wy = new Float32Array(nWeld);
  const wz = new Float32Array(nWeld);
  for (let w = 0; w < nWeld; w++) {
    const mem = weldMembers[w]!;
    let x = 0;
    let y = 0;
    let z = 0;
    for (const v of mem) {
      x += pos.getX(v);
      y += pos.getY(v);
      z += pos.getZ(v);
    }
    const n = mem.length;
    wx[w] = x / n;
    wy[w] = y / n;
    wz[w] = z / n;
  }

  const adj: number[][] = Array.from({ length: nWeld }, () => []);
  const seen = new Set<number>();
  const link = (a: number, b: number) => {
    if (a === b) return;
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    const k = lo * 1_000_000 + hi;
    if (seen.has(k)) return;
    seen.add(k);
    adj[a]!.push(b);
    adj[b]!.push(a);
  };
  for (let t = 0; t < triCount; t++) {
    const a = weldOf[vertOf(index, t, 0)]!;
    const b = weldOf[vertOf(index, t, 1)]!;
    const c = weldOf[vertOf(index, t, 2)]!;
    link(a, b);
    link(b, c);
    link(c, a);
  }

  const cell = 0.012;
  const grid = new Map<string, number[]>();
  const cellKey = (x: number, y: number, z: number) =>
    `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (let w = 0; w < nWeld; w++) {
    const k = cellKey(wx[w]!, wy[w]!, wz[w]!);
    const list = grid.get(k);
    if (list) list.push(w);
    else grid.set(k, [w]);
  }
  const radius = 0.014;
  const r2 = radius * radius;
  for (let w = 0; w < nWeld; w++) {
    const x = wx[w]!;
    const y = wy[w]!;
    const z = wz[w]!;
    const cx0 = Math.floor(x / cell);
    const cy0 = Math.floor(y / cell);
    const cz0 = Math.floor(z / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const list = grid.get(`${cx0 + dx},${cy0 + dy},${cz0 + dz}`);
          if (!list) continue;
          for (const u of list) {
            if (u <= w) continue;
            const ddx = wx[u]! - x;
            const ddy = wy[u]! - y;
            const ddz = wz[u]! - z;
            if (ddx * ddx + ddy * ddy + ddz * ddz <= r2) link(w, u);
          }
        }
      }
    }
  }

  return { weldOf, weldMembers, nWeld, adj };
}

function floodFill(
  cls: Uint8Array,
  weldOf: Int32Array,
  weldMembers: number[][],
  adj: number[][],
  allow: (v: number, kind: number) => boolean,
) {
  const nWeld = weldMembers.length;
  const wcls = new Uint8Array(nWeld);
  for (let w = 0; w < nWeld; w++) {
    let hairN = 0;
    let skinN = 0;
    let eyeN = 0;
    for (const v of weldMembers[w]!) {
      if (cls[v] === CLS_HAIR) hairN++;
      else if (cls[v] === CLS_SKIN) skinN++;
      else if (cls[v] === CLS_EYES) eyeN++;
    }
    wcls[w] = eyeN >= 1 ? CLS_EYES : hairN >= skinN && hairN > 0 ? CLS_HAIR : skinN > 0 ? CLS_SKIN : CLS_NONE;
  }
  const queue: number[] = [];
  for (let w = 0; w < nWeld; w++) {
    if (wcls[w] === CLS_HAIR || wcls[w] === CLS_SKIN) queue.push(w);
  }
  let qi = 0;
  while (qi < queue.length) {
    const w = queue[qi++]!;
    const kind = wcls[w]!;
    for (const u of adj[w]!) {
      if (wcls[u] !== CLS_NONE) continue;
      const sample = weldMembers[u]![0]!;
      if (!allow(sample, kind)) continue;
      wcls[u] = kind;
      queue.push(u);
    }
  }
  for (let w = 0; w < nWeld; w++) {
    const kind = wcls[w]!;
    if (kind === CLS_NONE) continue;
    for (const v of weldMembers[w]!) cls[v] = kind;
  }
}

/**
 * Geometry-first mapper for the Tripo single-mesh bake.
 *
 * The atlas overlaps hair/face/shirt, and the mesh is ~2k disconnected
 * UV shells (curls are not watertight). So we:
 *   1. label each UV island from bones + a neck-based face frame
 *   2. flood-fill across welded 3D + proximity so curls become one region
 *   3. pick a left/right eye island pair on the face
 *
 * Never paints the atlas — labels live on vertices.
 */
function classifyVertices(mesh: Mesh) {
  const geo = mesh.geometry as BufferGeometry;
  const pos = geo.getAttribute("position") as BufferAttribute;
  const nrm = geo.getAttribute("normal") as BufferAttribute | undefined;
  const uv = geo.getAttribute("uv") as BufferAttribute | undefined;
  const skinIndex = geo.getAttribute("skinIndex") as BufferAttribute | undefined;
  const skinWeight = geo.getAttribute("skinWeight") as BufferAttribute | undefined;
  const skeleton = (mesh as Mesh & { skeleton?: Skeleton }).skeleton;
  const count = pos.count;
  const index = geo.index;
  const triCount = index ? index.count / 3 : Math.floor(count / 3);

  const headIds = new Set<number>();
  const neckIds = new Set<number>();
  const armIds = new Set<number>();
  const clothIds = new Set<number>();
  skeleton?.bones.forEach((bone, i) => {
    const name = bone.name || "";
    if (/head/i.test(name) && !/thigh|wear/i.test(name)) headIds.add(i);
    else if (/neck/i.test(name)) neckIds.add(i);
    else if (/forearm|upperarm|hand|wrist|finger|thumb/i.test(name)) armIds.add(i);
    else if (/spine|waist|pelvis|hip|thigh|calf|foot|toe|root|clavicle/i.test(name)) clothIds.add(i);
  });

  const hw = new Float32Array(count);
  const nw = new Float32Array(count);
  const aw = new Float32Array(count);
  const cw = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    if (!skinIndex || !skinWeight) continue;
    hw[i] = headIds.size ? boneWeight(skinIndex, skinWeight, i, headIds) : 0;
    nw[i] = boneWeight(skinIndex, skinWeight, i, neckIds);
    aw[i] = boneWeight(skinIndex, skinWeight, i, armIds);
    cw[i] = boneWeight(skinIndex, skinWeight, i, clothIds);
  }

  let hx = 0;
  let hy = 0;
  let hz = 0;
  let headN = 0;
  let yMin = Infinity;
  let yMax = -Infinity;
  let nz = 0;
  let neckZ = 0;
  let neckN = 0;
  let coreZ = 0;
  let coreN = 0;
  for (let i = 0; i < count; i++) {
    if (nw[i]! > 0.28) {
      neckZ += pos.getZ(i);
      neckN++;
    }
    if (hw[i]! <= 0.22) continue;
    headN++;
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    hx += x;
    hy += y;
    hz += z;
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
    if (nrm) nz += nrm.getZ(i);
  }
  headN = Math.max(headN, 1);
  hx /= headN;
  hy /= headN;
  hz /= headN;
  const span = Math.max(yMax - yMin, 0.001);
  if (neckN) neckZ /= neckN;

  // Face direction from the neck (in front of the torso), not hair volume.
  // Hair puffs are asymmetric and previously flipped this sign, painting the face as hair.
  let faceSign = Math.sign(neckN ? neckZ - hz : 0);
  if (faceSign === 0) {
    for (let i = 0; i < count; i++) {
      if (hw[i]! <= 0.4) continue;
      const rad = Math.hypot(pos.getX(i) - hx, pos.getZ(i) - hz);
      if (rad > 0.08) continue;
      coreZ += pos.getZ(i);
      coreN++;
    }
    faceSign = Math.sign(coreN ? coreZ / coreN - hz : nz) || 1;
  }

  const yJaw = yMin + span * 0.16;
  const yHairline = yMin + span * 0.66;
  const yEyeLo = yMin + span * 0.36;
  const yEyeHi = yMin + span * 0.58;

  const inFaceCone = (x: number, y: number, z: number, nzVert: number) => {
    const t = (y - yMin) / span;
    const fwd = (z - hz) * faceSign;
    const lat = Math.abs(x - hx);
    const rad = Math.hypot(x - hx, z - hz);
    const nzFwd = nzVert * faceSign;
    if (t < 0.08 || t > 0.68) return false;
    if (fwd < 0.02) return false;
    if (lat > 0.11) return false;
    if (rad > 0.12) return false;
    if (nzFwd < -0.2) return false;
    return true;
  };
  const onEar = (x: number, y: number, z: number) => {
    const t = (y - yMin) / span;
    const fwd = (z - hz) * faceSign;
    const lat = Math.abs(x - hx);
    return lat > 0.1 && lat < 0.18 && t > 0.18 && t < 0.55 && Math.abs(fwd) < 0.055;
  };
  const inMouth = (x: number, y: number, z: number) => {
    const t = (y - yMin) / span;
    const fwd = (z - hz) * faceSign;
    const lat = Math.abs(x - hx);
    return t > 0.1 && t < 0.42 && fwd > 0.03 && lat < 0.072;
  };

  const cls = new Uint8Array(count);
  let nIslands = 0;
  let islandOfVert = new Int32Array(count).fill(-1);
  let islands: Island[] = [];

  if (uv) {
    const built = buildUvIslands(count, uv, index, triCount);
    nIslands = built.nIslands;
    islandOfVert = built.islandOfVert;
    islands = summarizeIslands(
      nIslands,
      built.islandVerts,
      built.islandOfTri,
      pos,
      nrm,
      hw,
      nw,
      aw,
      cw,
    );
    const islandClass = new Uint8Array(nIslands);
    for (const isl of islands) {
      let kind = CLS_NONE;
      if (isl.arm > 0.4) kind = CLS_SKIN;
      else if (isl.cloth > 0.5 && isl.head < 0.22) kind = CLS_NONE;
      else if (isl.neck > 0.32 && isl.head < 0.55) {
        const fwd = (isl.z - hz) * faceSign;
        kind = fwd > 0.0 ? CLS_SKIN : CLS_HAIR;
      } else if (isl.head > 0.28) {
        const face = inFaceCone(isl.x, isl.y, isl.z, isl.nz);
        const ear = onEar(isl.x, isl.y, isl.z);
        const mouth = inMouth(isl.x, isl.y, isl.z);
        kind = face || ear || mouth ? CLS_SKIN : CLS_HAIR;
      }
      islandClass[isl.id] = kind;
    }
    for (let i = 0; i < count; i++) {
      const id = islandOfVert[i]!;
      if (id >= 0) cls[i] = islandClass[id]!;
    }
  } else {
    for (let i = 0; i < count; i++) {
      if (aw[i]! > 0.4) cls[i] = CLS_SKIN;
      else if (cw[i]! > 0.5 && hw[i]! < 0.22) cls[i] = CLS_NONE;
      else if (hw[i]! > 0.28) {
        cls[i] = inFaceCone(pos.getX(i), pos.getY(i), pos.getZ(i), nrm ? nrm.getZ(i) : 1) ? CLS_SKIN : CLS_HAIR;
      }
    }
  }

  const { weldOf, weldMembers, adj } = buildSpatialGraph(count, pos, index, triCount);

  floodFill(cls, weldOf, weldMembers, adj, (v, kind) => {
    if (kind === CLS_HAIR) {
      if (aw[v]! > 0.45) return false;
      if (cw[v]! > 0.55 && hw[v]! < 0.2) return false;
      if (inFaceCone(pos.getX(v), pos.getY(v), pos.getZ(v), nrm ? nrm.getZ(v) : 1)) return false;
      if (inMouth(pos.getX(v), pos.getY(v), pos.getZ(v))) return false;
      if (hw[v]! > 0.18) return true;
      if (nw[v]! > 0.2 && (pos.getZ(v) - hz) * faceSign < 0) return true;
      return false;
    }
    if (kind === CLS_SKIN) {
      if (cls[v] === CLS_HAIR) return false;
      if (aw[v]! > 0.28) return true;
      if (nw[v]! > 0.22 && (pos.getZ(v) - hz) * faceSign > 0) return true;
      if (inFaceCone(pos.getX(v), pos.getY(v), pos.getZ(v), nrm ? nrm.getZ(v) : 1)) return true;
      if (inMouth(pos.getX(v), pos.getY(v), pos.getZ(v))) return true;
      if (onEar(pos.getX(v), pos.getY(v), pos.getZ(v)) && hw[v]! > 0.2) return true;
      return false;
    }
    return false;
  });

  // Eyes: small UV islands on the face, paired left/right.
  type EyeCand = { id: number; x: number; y: number; z: number; ax: number; fwd: number; tris: number; side: number };
  const cands: EyeCand[] = [];
  for (const isl of islands) {
    if (isl.tris < 5 || isl.tris > 80) continue;
    if (isl.head < 0.45) continue;
    if (isl.y < yEyeLo - 0.02 || isl.y > yEyeHi + 0.02) continue;
    const fwd = (isl.z - hz) * faceSign;
    if (fwd < 0.04) continue;
    const ax = Math.abs(isl.x - hx);
    if (ax < 0.022 || ax > 0.1) continue;
    const nzFwd = isl.nz * faceSign;
    if (nzFwd < -0.1) continue;
    cands.push({
      id: isl.id,
      x: isl.x,
      y: isl.y,
      z: isl.z,
      ax,
      fwd,
      tris: isl.tris,
      side: isl.x < hx ? -1 : 1,
    });
  }
  let bestL: EyeCand | null = null;
  let bestR: EyeCand | null = null;
  let bestScore = Infinity;
  const left = cands.filter((c) => c.side < 0);
  const right = cands.filter((c) => c.side > 0);
  for (const L of left) {
    for (const R of right) {
      const dy = Math.abs(L.y - R.y);
      const dz = Math.abs(L.z - R.z);
      const dax = Math.abs(L.ax - R.ax);
      const dtris = Math.abs(L.tris - R.tris) / 80;
      if (dy > 0.028 || dz > 0.03 || dax > 0.03) continue;
      const score = dy * 4 + dz * 3 + dax * 2 + dtris - (L.fwd + R.fwd) * 0.15;
      if (score < bestScore) {
        bestScore = score;
        bestL = L;
        bestR = R;
      }
    }
  }

  let eyeRig: EyeRig;
  if (bestL && bestR) {
    for (let i = 0; i < count; i++) {
      const id = islandOfVert[i]!;
      if (id === bestL.id || id === bestR.id) cls[i] = CLS_EYES;
    }
    const growEyes = (cx0: number, cy0: number, cz0: number) => {
      for (let i = 0; i < count; i++) {
        if (cls[i] !== CLS_SKIN && cls[i] !== CLS_EYES) continue;
        const dx = pos.getX(i) - cx0;
        const dy = pos.getY(i) - cy0;
        const dz = pos.getZ(i) - cz0;
        if (dx * dx + dy * dy + dz * dz < 0.012 * 0.012) cls[i] = CLS_EYES;
      }
    };
    growEyes(bestL.x, bestL.y, bestL.z);
    growEyes(bestR.x, bestR.y, bestR.z);
    eyeRig = {
      left: new Vector3(bestL.x, bestL.y, bestL.z),
      right: new Vector3(bestR.x, bestR.y, bestR.z),
      iris: 0.022,
      pupil: 0.0075,
      faceSign,
    };
  } else {
    const leftIds: number[] = [];
    const rightIds: number[] = [];
    for (let i = 0; i < count; i++) {
      if (cls[i] !== CLS_SKIN) continue;
      const y = pos.getY(i);
      if (y < yEyeLo || y > yEyeHi) continue;
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const fwd = (z - hz) * faceSign;
      if (fwd < 0.05) continue;
      const ax = Math.abs(x - hx);
      if (ax < 0.025 || ax > 0.09) continue;
      (x < hx ? leftIds : rightIds).push(i);
    }
    const centroid = (ids: number[], fallback: Vector3) => {
      if (ids.length < 6) return fallback;
      const c = new Vector3();
      for (const i of ids) c.add(new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
      return c.multiplyScalar(1 / ids.length);
    };
    const yMid = (yEyeLo + yEyeHi) * 0.5;
    const leftC = centroid(leftIds, new Vector3(hx - 0.05, yMid, hz + faceSign * 0.1));
    const rightC = centroid(rightIds, new Vector3(hx + 0.05, yMid, hz + faceSign * 0.1));
    for (const i of [...leftIds, ...rightIds]) {
      const c = pos.getX(i) < hx ? leftC : rightC;
      const dx = pos.getX(i) - c.x;
      const dy = pos.getY(i) - c.y;
      const dz = pos.getZ(i) - c.z;
      if (dx * dx + dy * dy + dz * dz < 0.018 * 0.018) cls[i] = CLS_EYES;
    }
    eyeRig = { left: leftC, right: rightC, iris: 0.02, pupil: 0.007, faceSign };
  }

  // Weld consensus — eyes win, then majority hair/skin
  for (const members of weldMembers) {
    let hairN = 0;
    let skinN = 0;
    let eyeN = 0;
    for (const i of members) {
      if (cls[i] === CLS_EYES) eyeN++;
      else if (cls[i] === CLS_HAIR) hairN++;
      else if (cls[i] === CLS_SKIN) skinN++;
    }
    const maj =
      eyeN > 0 ? CLS_EYES : hairN === 0 && skinN === 0 ? CLS_NONE : hairN >= skinN ? CLS_HAIR : CLS_SKIN;
    for (const i of members) cls[i] = maj;
  }

  const hair = new Float32Array(count);
  const skin = new Float32Array(count);
  const eyes = new Float32Array(count);
  const color = new Float32Array(count * 3);
  let hairN = 0;
  let skinN = 0;
  let eyeN = 0;
  for (let i = 0; i < count; i++) {
    if (cls[i] === CLS_HAIR) {
      hair[i] = 1;
      color[i * 3] = 1;
      hairN++;
    } else if (cls[i] === CLS_SKIN) {
      skin[i] = 1;
      color[i * 3 + 1] = 1;
      skinN++;
    } else if (cls[i] === CLS_EYES) {
      eyes[i] = 1;
      color[i * 3 + 2] = 1;
      eyeN++;
    }
  }

  return {
    hair,
    skin,
    eyes,
    color,
    eyeRig,
    stats: {
      width: nIslands,
      height: weldMembers.length,
      hair: hairN,
      skin: skinN,
      eyes: eyeN,
      ms: 0,
      faceSign,
    },
  };
}

export function findEyeRig(mesh: Mesh): EyeRig | null {
  const geo = mesh.geometry as BufferGeometry;
  const pos = geo.getAttribute("position") as BufferAttribute | undefined;
  if (!pos) return null;
  const { eyeRig } = classifyVertices(mesh);
  return eyeRig;
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
};

/**
 * Vertex-region recolorer. Leaves the atlas untouched.
 * Hair / skin / eyes are UV-island labels grown by a 3D flood-fill.
 */
export class TextureRecolorer {
  defaults: ColorSet;
  eyeRig: EyeRig | null;
  stats: MaskStats;
  private uniforms: RecolorUniforms | null = null;

  constructor(_map: Texture | null | undefined, mesh: Mesh) {
    const t0 = performance.now();
    const { hair, skin, eyes, color, eyeRig, stats } = classifyVertices(mesh);
    const geo = mesh.geometry as BufferGeometry;
    geo.setAttribute("aHair", new Float32BufferAttribute(hair, 1));
    geo.setAttribute("aSkin", new Float32BufferAttribute(skin, 1));
    geo.setAttribute("aEyes", new Float32BufferAttribute(eyes, 1));
    geo.setAttribute("color", new Float32BufferAttribute(color, 3));

    this.eyeRig = eyeRig;
    this.defaults = { ...FALLBACK_COLORS };
    this.stats = { ...stats, ms: performance.now() - t0 };

    const mat = mesh.material as MeshStandardMaterial;
    mat.vertexColors = true;
    const u: RecolorUniforms = {
      uHair: { value: new Color(FALLBACK_COLORS.hair) },
      uSkin: { value: new Color(FALLBACK_COLORS.skin) },
      uEyes: { value: new Color(FALLBACK_COLORS.eyes) },
      uStrength: { value: 1 },
      uEyeL: { value: eyeRig.left.clone() },
      uEyeR: { value: eyeRig.right.clone() },
      uPupil: { value: eyeRig.pupil },
      uIris: { value: eyeRig.iris },
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
attribute float aHair;
attribute float aSkin;
attribute float aEyes;
varying float vHair;
varying float vSkin;
varying float vEyes;
varying vec3 vBindPos;`,
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
vHair = aHair;
vSkin = aSkin;
vEyes = aEyes;
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
varying float vHair;
varying float vSkin;
varying float vEyes;
varying vec3 vBindPos;

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
vec3 applyTint(vec3 src, vec3 tint) {
  vec3 sh = rgb2hsv(src);
  vec3 th = rgb2hsv(tint);
  float v = mix(max(sh.z, 0.14), max(th.z, max(sh.z, 0.14)), 0.42);
  return hsv2rgb(vec3(th.x, th.y, v));
}`,
        )
        .replace(
          "#include <color_fragment>",
          `{
  vec3 src = diffuseColor.rgb;
  float y = dot(src, vec3(0.2126, 0.7152, 0.0722));
  vec3 gray = vec3(y);
  float k = clamp(uStrength, 0.0, 1.0);
  float h = max(vHair, vColor.r);
  float s = max(vSkin, vColor.g);
  float e = max(vEyes, vColor.b);
  vec3 painted = src;
  float winner = 0.0;
  if (e > 0.45) {
    vec3 ec = distance(vBindPos, uEyeL) < distance(vBindPos, uEyeR) ? uEyeL : uEyeR;
    float r = distance(vBindPos, ec);
    float mx = max(src.r, max(src.g, src.b));
    float mn = min(src.r, min(src.g, src.b));
    bool sclera = (mx - mn) < 0.16 && y > 0.58;
    if (r < uPupil) {
      painted = vec3(0.045, 0.03, 0.025);
      winner = 1.0;
    } else if (!sclera) {
      painted = applyTint(src, uEyes);
      winner = 1.0;
    }
  } else if (h > 0.45 && h >= s) {
    painted = applyTint(src, uHair);
    winner = 1.0;
  } else if (s > 0.45) {
    painted = applyTint(src, uSkin);
    winner = 1.0;
  }
  if (winner > 0.5) {
    diffuseColor.rgb = mix(gray, painted, k);
  } else {
    diffuseColor.rgb = mix(gray, src, k);
  }
}`,
        );
    };
    mat.customProgramCacheKey = () => "orbyt-island-flood-v6";
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
