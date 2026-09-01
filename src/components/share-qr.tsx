import { useEffect, useId, useRef, useState } from "react";
import { Check, Copy, QrCode, X } from "lucide-react";
import { toDataURL } from "qrcode";
import { LiquidGlass } from "./liquid-glass";

function pageUrl() {
  try {
    return window.top?.location.href ?? window.location.href;
  } catch {
    return window.location.href;
  }
}

export function ShareQr() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [src, setSrc] = useState("");
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const next = pageUrl();
    setUrl(next);
    let cancelled = false;
    toDataURL(next, {
      width: 320,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#12141a", light: "#f7f4ee" },
    }).then((data) => {
      if (!cancelled) setSrc(data);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointer = (e: PointerEvent) => {
      const el = rootRef.current;
      if (el && !el.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(t);
  }, [copied]);

  async function copyUrl() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div ref={rootRef} className="share-dock">
      {open ? (
        <LiquidGlass as="section" className="share-pop" role="dialog" aria-labelledby={titleId}>
          <div className="share-pop-head">
            <h2 id={titleId}>Scan to open</h2>
            <button type="button" className="share-icon-btn" aria-label="Close" onClick={() => setOpen(false)}>
              <X className="size-4" />
            </button>
          </div>
          <div className="share-qr">
            {src ? (
              <img src={src} alt={`QR code for ${url}`} width={196} height={196} />
            ) : (
              <div className="share-qr-skel" aria-hidden />
            )}
          </div>
          <p className="share-url" title={url}>
            {url || "Preparing link…"}
          </p>
          <button type="button" className="lg-btn share-copy" onClick={copyUrl}>
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? "Copied" : "Copy link"}
          </button>
        </LiquidGlass>
      ) : null}
      <button
        type="button"
        className="share-fab"
        aria-label="Show QR code for this page"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        <QrCode className="size-5" />
      </button>
    </div>
  );
}
