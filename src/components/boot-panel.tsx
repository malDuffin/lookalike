import { useEffect, useRef, useState } from "react";
import { fmtElapsed, useBoot, type BootKind } from "@/lib/boot";
import { LiquidGlass } from "./liquid-glass";
import { cn } from "@/lib/utils";

const KIND: Record<BootKind, string> = {
  info: "INF",
  work: "RUN",
  ok: "OK ",
  err: "ERR",
};

export function BootPanel() {
  const lines = useBoot((s) => s.lines);
  const stages = useBoot((s) => s.stages);
  const progress = useBoot((s) => s.progress);
  const headline = useBoot((s) => s.headline);
  const done = useBoot((s) => s.done);
  const dismissed = useBoot((s) => s.dismissed);
  const error = useBoot((s) => s.error);
  const startedAt = useBoot((s) => s.startedAt);
  const [now, setNow] = useState(() => performance.now());
  const [leaving, setLeaving] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!startedAt || done || error) return;
    const id = window.setInterval(() => setNow(performance.now()), 80);
    return () => window.clearInterval(id);
  }, [startedAt, done, error]);

  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  useEffect(() => {
    if (!done || error) return;
    const id = window.setTimeout(() => setLeaving(true), 1600);
    return () => window.clearTimeout(id);
  }, [done, error]);

  useEffect(() => {
    if (!leaving) return;
    const id = window.setTimeout(() => useBoot.getState().dismiss(), 280);
    return () => window.clearTimeout(id);
  }, [leaving]);

  if (dismissed || !startedAt) return null;

  const elapsed = (done ? (lines.at(-1)?.t ?? now - startedAt) : now - startedAt) || 0;
  const pct = Math.round(progress);

  return (
    <div
      className={cn("boot-wrap", leaving && "is-out")}
      role="status"
      aria-live="polite"
      aria-busy={!done && !error}
    >
      <LiquidGlass className="boot-card">
        <header className="boot-head">
          <div>
            <p className="eyebrow">Boot</p>
            <h2>Orbyt</h2>
          </div>
          <p className="boot-clock" aria-label="Elapsed">
            {fmtElapsed(elapsed)}s
          </p>
        </header>

        <div className="boot-meter" aria-hidden={false}>
          <div className="boot-meter-track">
            <span className="boot-meter-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="boot-meter-meta">
            <span className="boot-headline">{headline}</span>
            <span className="boot-pct">{pct}%</span>
          </div>
        </div>

        <ol className="boot-stages">
          {stages.map((st) => (
            <li key={st.id} className={cn("boot-stage", `is-${st.status}`)}>
              <span className="boot-dot" aria-hidden />
              <span className="boot-stage-label">{st.label}</span>
              {st.detail ? <span className="boot-stage-detail">{st.detail}</span> : null}
            </li>
          ))}
        </ol>

        <div className="boot-log" ref={logRef}>
          {lines.map((line) => (
            <p key={line.id} className={cn("boot-line", `is-${line.kind}`)}>
              <span className="boot-t">{fmtElapsed(line.t)}</span>
              <span className="boot-k">{KIND[line.kind]}</span>
              <span className="boot-msg">{line.text}</span>
            </p>
          ))}
        </div>

        {error ? <p className="boot-fail">{error}</p> : null}
      </LiquidGlass>
    </div>
  );
}
