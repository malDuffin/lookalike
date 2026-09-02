import { create } from "zustand";
import { FALLBACK_COLORS, PRESETS, hsvHex, type ColorSet } from "./recolor";
import { HEADWEAR, type HeadwearId } from "./headwear";

export type DetectedColors = {
  hair: string | null;
  skin: string | null;
  eyes: string | null;
};

type StudioState = {
  colors: ColorSet;
  defaults: ColorSet;
  strength: number;
  clip: string;
  clips: { id: string; label: string }[];
  headwear: HeadwearId;
  ready: boolean;
  loadError: string | null;
  detected: DetectedColors;
  setColors: (partial: Partial<ColorSet>) => void;
  setDefaults: (colors: ColorSet) => void;
  setStrength: (value: number) => void;
  setClip: (clip: string) => void;
  setClips: (clips: { id: string; label: string }[]) => void;
  setHeadwear: (id: HeadwearId) => void;
  setReady: (ready: boolean) => void;
  setLoadError: (message: string | null) => void;
  setDetected: (detected: DetectedColors) => void;
  applyDetected: () => void;
  reset: () => void;
  random: () => void;
  totallyRandom: () => void;
};

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

export const useStudio = create<StudioState>((set, get) => ({
  colors: { ...FALLBACK_COLORS },
  defaults: { ...FALLBACK_COLORS },
  strength: 1,
  clip: "idle",
  clips: [],
  headwear: HEADWEAR[0]!.id,
  ready: false,
  loadError: null,
  detected: { hair: null, skin: null, eyes: null },
  setColors: (partial) => set((s) => ({ colors: { ...s.colors, ...partial } })),
  setDefaults: (colors) =>
    set((s) => ({
      defaults: colors,
      colors: s.ready ? s.colors : colors,
    })),
  setStrength: (strength) => set({ strength }),
  setClip: (clip) => set({ clip }),
  setClips: (clips) => set({ clips }),
  setHeadwear: (headwear) => set({ headwear }),
  setReady: (ready) => set({ ready }),
  setLoadError: (loadError) => set({ loadError }),
  setDetected: (detected) => set({ detected }),
  applyDetected: () => {
    const { detected, colors } = get();
    set({
      colors: {
        hair: detected.hair ?? colors.hair,
        skin: detected.skin ?? colors.skin,
        eyes: detected.eyes ?? colors.eyes,
      },
    });
  },
  reset: () => {
    const { defaults } = get();
    set({ colors: { ...defaults }, headwear: HEADWEAR[0]!.id, strength: 1 });
  },
  random: () =>
    set({
      colors: {
        hair: pick(PRESETS.hair),
        skin: pick(PRESETS.skin),
        eyes: pick(PRESETS.eyes),
      },
    }),
  totallyRandom: () =>
    set({
      colors: {
        hair: hsvHex(Math.random(), 0.4 + Math.random() * 0.6, 0.16 + Math.random() * 0.7),
        skin: hsvHex(Math.random(), 0.12 + Math.random() * 0.55, 0.42 + Math.random() * 0.52),
        eyes: hsvHex(Math.random(), 0.35 + Math.random() * 0.65, 0.18 + Math.random() * 0.55),
      },
    }),
}));
