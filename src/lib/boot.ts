import { create } from "zustand";

export const MODEL_URL = "/character.glb";

export type BootKind = "info" | "work" | "ok" | "err";
export type StageStatus = "pending" | "active" | "done" | "error";

export type BootLine = {
  id: number;
  t: number;
  kind: BootKind;
  text: string;
};

export type BootStage = {
  id: string;
  label: string;
  detail: string;
  status: StageStatus;
};

const STAGE_DEFS: { id: string; label: string }[] = [
  { id: "shell", label: "Studio shell" },
  { id: "gpu", label: "WebGL renderer" },
  { id: "mesh", label: "Character mesh" },
  { id: "decode", label: "Draco decode" },
  { id: "atlas", label: "Mesh regions" },
  { id: "lights", label: "Stage lights" },
  { id: "live", label: "Orbyt live" },
];

const WEIGHT: Record<string, number> = {
  shell: 6,
  gpu: 8,
  mesh: 40,
  decode: 12,
  atlas: 22,
  lights: 6,
  live: 6,
};

function blankStages(): BootStage[] {
  return STAGE_DEFS.map((s) => ({ ...s, detail: "", status: "pending" as const }));
}

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function fmtElapsed(ms: number) {
  const s = Math.max(0, ms) / 1000;
  return s.toFixed(2).padStart(5, "0");
}

function prefersReduce() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type BootState = {
  startedAt: number;
  lines: BootLine[];
  stages: BootStage[];
  progress: number;
  bytesLoaded: number;
  bytesTotal: number;
  headline: string;
  done: boolean;
  dismissed: boolean;
  error: string | null;
  characterReady: boolean;
  lightsReady: boolean;
  start: () => void;
  log: (kind: BootKind, text: string) => void;
  setStage: (id: string, status: StageStatus, detail?: string) => void;
  setBytes: (loaded: number, total: number) => void;
  setHeadline: (headline: string) => void;
  gpuReady: (info: { webgl2: boolean; renderer: string; dpr: number }) => void;
  characterLive: () => void;
  lightsLive: () => void;
  fail: (message: string) => void;
  dismiss: () => void;
};

let lineSeq = 0;
const pending: BootLine[] = [];
let drainPromise: Promise<void> | null = null;

function recompute(stages: BootStage[], bytesLoaded: number, bytesTotal: number) {
  let p = 0;
  for (const s of stages) {
    const w = WEIGHT[s.id] ?? 0;
    if (s.status === "done") p += w;
    else if (s.status === "active" && s.id === "mesh" && bytesTotal > 0) {
      p += w * Math.min(1, bytesLoaded / bytesTotal);
    } else if (s.status === "active") p += w * 0.28;
  }
  return Math.min(100, p);
}

export const useBoot = create<BootState>((set, get) => ({
  startedAt: 0,
  lines: [],
  stages: blankStages(),
  progress: 0,
  bytesLoaded: 0,
  bytesTotal: 0,
  headline: "Booting studio…",
  done: false,
  dismissed: false,
  error: null,
  characterReady: false,
  lightsReady: false,
  start: () => {
    if (get().startedAt) return;
    const startedAt = performance.now();
    set({
      startedAt,
      lines: [],
      stages: blankStages(),
      progress: 0,
      bytesLoaded: 0,
      bytesTotal: 0,
      headline: "Hydrating studio…",
      done: false,
      dismissed: false,
      error: null,
      characterReady: false,
      lightsReady: false,
    });
    get().setStage("shell", "active");
    get().log("info", "hydrate studio shell");
    get().log("work", "mount React tree");
    get().setStage("shell", "done");
    get().setStage("gpu", "active", "waiting");
    get().log("work", "request WebGL context");
    get().setHeadline("Requesting WebGL…");
    void fetchCharacter();
  },
  log: (kind, text) => {
    const state = get();
    const line: BootLine = {
      id: ++lineSeq,
      t: state.startedAt ? performance.now() - state.startedAt : 0,
      kind,
      text,
    };
    pending.push(line);
    void drainLines();
  },
  setStage: (id, status, detail) => {
    set((s) => {
      const stages = s.stages.map((st) =>
        st.id === id ? { ...st, status, detail: detail ?? st.detail } : st,
      );
      return { stages, progress: recompute(stages, s.bytesLoaded, s.bytesTotal) };
    });
  },
  setBytes: (loaded, total) => {
    set((s) => {
      const stages = s.stages.map((st) =>
        st.id === "mesh" && st.status === "active"
          ? { ...st, detail: total ? `${fmtBytes(loaded)} / ${fmtBytes(total)}` : fmtBytes(loaded) }
          : st,
      );
      return {
        bytesLoaded: loaded,
        bytesTotal: total,
        stages,
        progress: recompute(stages, loaded, total),
        headline: total
          ? `Receiving character.glb  ${fmtBytes(loaded)} / ${fmtBytes(total)}`
          : `Receiving character.glb  ${fmtBytes(loaded)}`,
      };
    });
  },
  setHeadline: (headline) => set({ headline }),
  gpuReady: ({ webgl2, renderer, dpr }) => {
    const label = `${webgl2 ? "WebGL2" : "WebGL"} · ${renderer} · dpr ${dpr.toFixed(2)}`;
    get().log("ok", label);
    get().setStage("gpu", "done", webgl2 ? "WebGL2" : "WebGL");
    const mesh = get().stages.find((s) => s.id === "mesh");
    if (mesh && mesh.status === "pending") get().setStage("mesh", "active");
  },
  characterLive: () => {
    if (get().characterReady) return;
    set({ characterReady: true });
    maybeFinish();
  },
  lightsLive: () => {
    if (get().lightsReady) return;
    get().setStage("lights", "done");
    get().log("ok", "environment studio HDR");
    set({ lightsReady: true });
    maybeFinish();
  },
  fail: (message) => {
    get().log("err", message);
    set((s) => ({
      error: message,
      headline: "Load failed",
      stages: s.stages.map((st) =>
        st.status === "active" ? { ...st, status: "error" as const } : st,
      ),
    }));
  },
  dismiss: () => set({ dismissed: true }),
}));

async function drainLines() {
  if (drainPromise) return drainPromise;
  const gap = prefersReduce() ? 0 : 55;
  drainPromise = (async () => {
    while (pending.length) {
      const line = pending.shift()!;
      useBoot.setState((s) => ({ lines: [...s.lines, line].slice(-80) }));
      if (gap) await new Promise((r) => setTimeout(r, gap));
    }
  })().finally(() => {
    drainPromise = null;
  });
  return drainPromise;
}

async function maybeFinish() {
  const s = useBoot.getState();
  if (s.done || s.error) return;
  if (!s.characterReady || !s.lightsReady) return;
  await drainLines();
  const latest = useBoot.getState();
  if (latest.done || latest.error) return;
  if (!latest.characterReady || !latest.lightsReady) return;
  latest.setStage("live", "active");
  latest.log("ok", "orbyt live");
  await drainLines();
  latest.setStage("live", "done");
  useBoot.setState({
    done: true,
    headline: "Orbyt live",
    progress: 100,
  });
}

async function fetchCharacter() {
  const boot = useBoot.getState();
  boot.setStage("mesh", "active");
  boot.log("work", "GET /character.glb");
  try {
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`character.glb HTTP ${res.status}`);
    const total = Number(res.headers.get("content-length") || 0);
    if (!res.body) {
      const buf = await res.arrayBuffer();
      boot.setBytes(buf.byteLength, buf.byteLength);
    } else {
      const reader = res.body.getReader();
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        boot.setBytes(received, total || received);
      }
    }
    const loaded = useBoot.getState().bytesLoaded;
    boot.log("ok", `character.glb  ${fmtBytes(loaded || total)}`);
    boot.setStage("mesh", "done", fmtBytes(loaded || total));
    boot.setStage("decode", "active", "Draco");
    boot.setHeadline("Decoding mesh…");
    boot.log("work", "decode Draco primitives");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch character.glb";
    useBoot.getState().fail(message);
  }
}
