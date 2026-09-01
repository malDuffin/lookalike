import { useState } from "react";
import { Palette, RotateCcw, ScanFace, Shuffle } from "lucide-react";
import { PRESETS, type Channel } from "@/lib/recolor";
import { useStudio } from "@/lib/store";
import { FaceMatch } from "./face-match";
import { ShareQr } from "./share-qr";
import { LiquidGlass, LiquidGlassDefs, useLiquidLight } from "./liquid-glass";
import { cn } from "@/lib/utils";

function ChannelRow({
  channel,
  label,
}: {
  channel: Channel;
  label: string;
}) {
  const value = useStudio((s) => s.colors[channel]);
  const setColors = useStudio((s) => s.setColors);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <span className="w-12 text-sm text-fg">{label}</span>
        <label className="swatch-input">
          <input
            type="color"
            value={value}
            aria-label={`${label} color`}
            suppressHydrationWarning
            onChange={(e) => setColors({ [channel]: e.target.value })}
          />
        </label>
        <input
          className="hex-field"
          value={value}
          maxLength={7}
          spellCheck={false}
          suppressHydrationWarning
          onChange={(e) => {
            const next = e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`;
            if (/^#[0-9a-fA-F]{6}$/.test(next)) setColors({ [channel]: next.toLowerCase() });
          }}
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {PRESETS[channel].map((hex) => (
          <button
            key={hex}
            type="button"
            className={cn("preset-dot", value === hex && "is-active")}
            style={{ background: hex }}
            aria-label={`${label} ${hex}`}
            onClick={() => setColors({ [channel]: hex })}
          />
        ))}
      </div>
    </div>
  );
}

export function StudioOverlay() {
  useLiquidLight();
  const [tab, setTab] = useState<"colors" | "face">("colors");
  const clips = useStudio((s) => s.clips);
  const clip = useStudio((s) => s.clip);
  const setClip = useStudio((s) => s.setClip);
  const strength = useStudio((s) => s.strength);
  const setStrength = useStudio((s) => s.setStrength);
  const reset = useStudio((s) => s.reset);
  const surprise = useStudio((s) => s.surprise);

  return (
    <>
      <LiquidGlassDefs />
      <div className="studio-chrome">
        <div className="studio-top">
          <header className="brand-lockup stagger-item">
            <p className="eyebrow">Studio</p>
            <h1>Lookalike</h1>
            <p className="lede">Recolor hair, skin and eyes — or match them from a face.</p>
          </header>

          <LiquidGlass className="anim-dock stagger-item">
            <button
              type="button"
              className={cn("dock-btn", clip === "idle" && "is-active")}
              aria-pressed={clip === "idle"}
              onClick={() => setClip("idle")}
            >
              Idle
            </button>
            {clips.map((c) => (
              <button
                key={c.id}
                type="button"
                className={cn("dock-btn", clip === c.id && "is-active")}
                aria-pressed={clip === c.id}
                onClick={() => setClip(c.id)}
              >
                {c.label}
              </button>
            ))}
          </LiquidGlass>
        </div>

        <LiquidGlass as="aside" className="studio-panel">
          <div className="panel-head">
            <h2>Customize</h2>
            <p>Colors remap on the atlas. Shading stays on the model.</p>
          </div>

          <div className="lg-tabs" role="tablist" aria-label="Studio panels">
            <span className={cn("lg-tab-thumb", tab === "face" && "is-face")} />
            <button
              type="button"
              role="tab"
              aria-selected={tab === "colors"}
              className="lg-tab"
              onClick={() => setTab("colors")}
            >
              <Palette className="size-3.5" />
              Colors
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "face"}
              className="lg-tab"
              onClick={() => setTab("face")}
            >
              <ScanFace className="size-3.5" />
              Face
            </button>
          </div>

          {tab === "colors" ? (
            <section className="lg-well">
              <h3>Colors</h3>
              <div className="space-y-4">
                <ChannelRow channel="hair" label="Hair" />
                <ChannelRow channel="skin" label="Skin" />
                <ChannelRow channel="eyes" label="Eyes" />
              </div>
              <div className="mt-4 flex gap-2">
                <button type="button" className="lg-btn" onClick={reset}>
                  <RotateCcw className="size-3.5" />
                  Reset
                </button>
                <button type="button" className="lg-btn" onClick={surprise}>
                  <Shuffle className="size-3.5" />
                  Surprise
                </button>
              </div>
              <label className="mt-4 flex items-center gap-3 text-sm text-muted">
                <span className="w-16">Strength</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(strength * 100)}
                  suppressHydrationWarning
                  onChange={(e) => setStrength(Number(e.target.value) / 100)}
                  className="strength-range"
                />
              </label>
            </section>
          ) : (
            <FaceMatch />
          )}
        </LiquidGlass>

        <p className="orbit-hint">Drag to orbit</p>
        <ShareQr />
      </div>
    </>
  );
}
