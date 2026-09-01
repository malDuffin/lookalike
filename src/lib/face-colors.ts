import { rgbToHex, rgbToHsv, type ColorSet } from "./recolor";
import type { DetectedColors } from "./store";

const MP_WASM = "/mediapipe/wasm";
const MP_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

type RunningMode = "IMAGE" | "VIDEO";
type Landmark = { x: number; y: number; z?: number };

type Landmarker = {
  detect: (image: HTMLImageElement) => { faceLandmarks?: Landmark[][] };
  detectForVideo: (video: HTMLVideoElement, ts: number) => { faceLandmarks?: Landmark[][] };
  close: () => void;
};

let landmarker: Landmarker | null = null;
let currentMode: RunningMode | null = null;

export async function ensureLandmarker(mode: RunningMode): Promise<Landmarker> {
  if (landmarker && currentMode === mode) return landmarker;
  const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
  const fileset = await FilesetResolver.forVisionTasks(MP_WASM);
  if (landmarker) {
    landmarker.close();
    landmarker = null;
  }
  landmarker = (await FaceLandmarker.createFromOptions(fileset, {
    runningMode: mode,
    numFaces: 1,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false,
    baseOptions: { modelAssetPath: MP_MODEL, delegate: "CPU" },
  })) as unknown as Landmarker;
  currentMode = mode;
  return landmarker;
}

function samplePatch(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  w: number,
  h: number,
): [number, number, number][] {
  const x0 = Math.max(0, Math.floor(x - radius));
  const y0 = Math.max(0, Math.floor(y - radius));
  const ww = Math.min(w - x0, Math.ceil(radius * 2));
  const hh = Math.min(h - y0, Math.ceil(radius * 2));
  if (ww <= 0 || hh <= 0) return [];
  const data = ctx.getImageData(x0, y0, ww, hh).data;
  const pts: [number, number, number][] = [];
  for (let i = 0; i < data.length; i += 4) {
    const px = (i / 4) % ww;
    const py = Math.floor(i / 4 / ww);
    const dx = px - (x - x0);
    const dy = py - (y - y0);
    if (dx * dx + dy * dy > radius * radius) continue;
    pts.push([data[i], data[i + 1], data[i + 2]]);
  }
  return pts;
}

function medianColor(
  pixels: [number, number, number][],
  filterFn?: (p: [number, number, number]) => boolean,
): [number, number, number] | null {
  const list = filterFn ? pixels.filter(filterFn) : pixels;
  if (!list.length) return null;
  const rs = list.map((p) => p[0]).sort((a, b) => a - b);
  const gs = list.map((p) => p[1]).sort((a, b) => a - b);
  const bs = list.map((p) => p[2]).sort((a, b) => a - b);
  const m = Math.floor(list.length / 2);
  return [rs[m]!, gs[m]!, bs[m]!];
}

function sourceSize(el: HTMLImageElement | HTMLVideoElement) {
  if (el instanceof HTMLVideoElement) {
    return { w: el.videoWidth, h: el.videoHeight };
  }
  return { w: el.naturalWidth, h: el.naturalHeight };
}

export function sampleFaceColors(
  el: HTMLImageElement | HTMLVideoElement,
  lm: Landmark[],
): DetectedColors {
  const { w, h } = sourceSize(el);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { hair: null, skin: null, eyes: null };
  ctx.drawImage(el, 0, 0, w, h);

  const faceW = Math.hypot((lm[234]!.x - lm[454]!.x) * w, (lm[234]!.y - lm[454]!.y) * h);
  const patch = Math.max(5, faceW * 0.045);
  const lmPx = (i: number): [number, number] => [lm[i]!.x * w, lm[i]!.y * h];

  let skinPix: [number, number, number][] = [];
  [50, 101, 205, 280, 330, 425, 10, 67, 297, 151, 116, 345].forEach((i) => {
    if (!lm[i]) return;
    const [x, y] = lmPx(i);
    skinPix = skinPix.concat(samplePatch(ctx, x, y, patch, w, h));
  });
  const skin = medianColor(skinPix, ([r, g, b]) => {
    const [, s, v] = rgbToHsv(r, g, b);
    return v > 0.18 && v < 0.95 && s < 0.72;
  });

  let eyePix: [number, number, number][] = [];
  [468, 469, 470, 471, 472, 473, 474, 475, 476, 477].forEach((i) => {
    if (!lm[i]) return;
    const [x, y] = lmPx(i);
    eyePix = eyePix.concat(samplePatch(ctx, x, y, Math.max(3, patch * 0.45), w, h));
  });
  const eyes = medianColor(eyePix, ([r, g, b]) => {
    const [, s, v] = rgbToHsv(r, g, b);
    return v > 0.12 && v < 0.78 && s > 0.12;
  });

  const top = lm[10]!;
  const chin = lm[152]!;
  const faceH = Math.abs((chin.y - top.y) * h);
  let hairPix: [number, number, number][] = [];
  (
    [
      [top.x, top.y - (faceH * 0.22) / h],
      [top.x - 0.08, top.y - (faceH * 0.12) / h],
      [top.x + 0.08, top.y - (faceH * 0.12) / h],
      [lm[54]!.x, lm[54]!.y - (faceH * 0.08) / h],
      [lm[284]!.x, lm[284]!.y - (faceH * 0.08) / h],
    ] as [number, number][]
  ).forEach(([nx, ny]) => {
    hairPix = hairPix.concat(samplePatch(ctx, nx * w, ny * h, patch * 1.3, w, h));
  });
  const hair = medianColor(hairPix, ([r, g, b]) => {
    const [, s, v] = rgbToHsv(r, g, b);
    if (skin) {
      const d = Math.abs(r - skin[0]) + Math.abs(g - skin[1]) + Math.abs(b - skin[2]);
      if (d < 45) return false;
    }
    return v > 0.05 && v < 0.92;
  });

  return {
    hair: hair ? rgbToHex(hair) : null,
    skin: skin ? rgbToHex(skin) : null,
    eyes: eyes ? rgbToHex(eyes) : null,
  };
}

export const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152,
  148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
];

export function applyDetectedToSet(detected: DetectedColors, current: ColorSet): ColorSet {
  return {
    hair: detected.hair ?? current.hair,
    skin: detected.skin ?? current.skin,
    eyes: detected.eyes ?? current.eyes,
  };
}
