import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, ImageUp, ScanFace, Sparkles } from "lucide-react";
import { FACE_OVAL, ensureLandmarker, sampleFaceColors } from "@/lib/face-colors";
import { useStudio } from "@/lib/store";
import { cn } from "@/lib/utils";

export function FaceMatch() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const photoRef = useRef<HTMLImageElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camOn, setCamOn] = useState(false);
  const [hasPhoto, setHasPhoto] = useState(false);
  const [status, setStatus] = useState("Open the camera or drop a photo. Faces stay on this device.");
  const [statusKind, setStatusKind] = useState<"idle" | "ok" | "err">("idle");
  const detected = useStudio((s) => s.detected);
  const setDetected = useStudio((s) => s.setDetected);
  const applyDetected = useStudio((s) => s.applyDetected);
  const lastDetect = useRef(0);

  const stopCam = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
    setCamOn(false);
  }, []);

  useEffect(() => () => stopCam(), [stopCam]);

  const drawOverlay = (lm: { x: number; y: number }[]) => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(232,238,246,0.92)";
    ctx.lineWidth = 2 * (window.devicePixelRatio || 1);
    ctx.beginPath();
    FACE_OVAL.forEach((i, n) => {
      const pt = lm[i];
      if (!pt) return;
      const x = pt.x * w;
      const y = pt.y * h;
      if (n === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = "rgba(180,210,255,0.95)";
    [468, 473].forEach((i) => {
      const pt = lm[i];
      if (!pt) return;
      ctx.beginPath();
      ctx.arc(pt.x * w, pt.y * h, 3 * (window.devicePixelRatio || 1), 0, Math.PI * 2);
      ctx.fill();
    });
  };

  const handleLandmarks = (
    faces: { x: number; y: number }[][],
    source: HTMLImageElement | HTMLVideoElement,
  ) => {
    if (!faces.length) {
      setStatus("No face found — move closer or try another photo.");
      setStatusKind("err");
      return;
    }
    const colors = sampleFaceColors(source, faces[0]!);
    setDetected(colors);
    drawOverlay(faces[0]!);
    const bits = [
      colors.skin ? "skin" : null,
      colors.hair ? "hair" : null,
      colors.eyes ? "eyes" : null,
    ].filter(Boolean);
    setStatus(bits.length ? `Detected ${bits.join(", ")}.` : "Face found, but colors were inconclusive.");
    setStatusKind(bits.length ? "ok" : "err");
  };

  const syncOverlay = () => {
    const canvas = overlayRef.current;
    const box = canvas?.parentElement;
    if (!canvas || !box) return;
    canvas.width = box.clientWidth * devicePixelRatio;
    canvas.height = box.clientHeight * devicePixelRatio;
  };

  const toggleCam = async () => {
    if (camOn) {
      stopCam();
      return;
    }
    try {
      setStatus("Loading face model…");
      setStatusKind("idle");
      await ensureLandmarker("VIDEO");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();
      setHasPhoto(false);
      setCamOn(true);
      setStatus("Point your face at the camera…");
      setStatusKind("ok");
      requestAnimationFrame(syncOverlay);
    } catch {
      setStatus("Camera blocked. You can still upload a photo.");
      setStatusKind("err");
    }
  };

  useEffect(() => {
    if (!camOn) return;
    let raf = 0;
    const tick = async () => {
      const now = performance.now();
      const video = videoRef.current;
      if (video && now - lastDetect.current > 280 && video.readyState >= 2) {
        lastDetect.current = now;
        try {
          const lm = await ensureLandmarker("VIDEO");
          const res = lm.detectForVideo(video, now);
          handleLandmarks(res.faceLandmarks ?? [], video);
        } catch {
          /* mode switch */
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camOn]);

  const loadFile = async (file: File) => {
    stopCam();
    const url = URL.createObjectURL(file);
    const img = photoRef.current;
    if (!img) return;
    img.onload = async () => {
      setHasPhoto(true);
      syncOverlay();
      try {
        setStatus("Reading face…");
        const lm = await ensureLandmarker("IMAGE");
        const res = lm.detect(img);
        handleLandmarks(res.faceLandmarks ?? [], img);
      } catch {
        setStatus("Could not read a face in that photo.");
        setStatusKind("err");
      }
    };
    img.src = url;
  };

  const loadSample = async () => {
    const res = await fetch("/demo-face.jpg");
    const blob = await res.blob();
    await loadFile(new File([blob], "demo-face.jpg", { type: blob.type }));
  };

  const canApply = Boolean(detected.hair || detected.skin || detected.eyes);

  return (
    <section className="lg-well">
      <h3>Match a face</h3>
      <div className="media-box">
        <video
          ref={videoRef}
          className={cn("media-el", !camOn && "hidden")}
          playsInline
          muted
        />
        <img
          ref={photoRef}
          alt=""
          className={cn("media-el", (!hasPhoto || camOn) && "hidden")}
        />
        <canvas ref={overlayRef} className="overlay-el" />
        {!camOn && !hasPhoto && (
          <div className="media-empty">
            <ScanFace className="size-5 opacity-70" />
            <span>Webcam or a photo — the face stays on your device</span>
          </div>
        )}
      </div>
      <div className="mt-3 flex gap-2">
        <button type="button" className="lg-btn" onClick={toggleCam}>
          <Camera className="size-3.5" />
          {camOn ? "Stop camera" : "Start camera"}
        </button>
        <button
          type="button"
          className="lg-btn"
          onClick={() => fileRef.current?.click()}
        >
          <ImageUp className="size-3.5" />
          Upload
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        suppressHydrationWarning
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void loadFile(f);
        }}
      />
      <button
        type="button"
        className="drop-zone"
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f) void loadFile(f);
        }}
      >
        Drop a photo here, or try the sample
      </button>
      <button type="button" className="sample-link" onClick={() => void loadSample()}>
        Use sample portrait
      </button>
      <div className="detected-grid">
        {(
          [
            ["Hair", detected.hair],
            ["Skin", detected.skin],
            ["Eyes", detected.eyes],
          ] as const
        ).map(([label, hex]) => (
          <div key={label} className="det-card">
            <div className="det-dot" style={{ background: hex ?? "#222" }} />
            <span>{label}</span>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="lg-btn primary mt-3 w-full"
        disabled={!canApply}
        onClick={() => {
          applyDetected();
          setStatus("Applied to the character.");
          setStatusKind("ok");
        }}
      >
        <Sparkles className="size-3.5" />
        Apply to character
      </button>
      <p className={cn("status-line", statusKind === "ok" && "is-ok", statusKind === "err" && "is-err")}>
        {status}
      </p>
    </section>
  );
}
