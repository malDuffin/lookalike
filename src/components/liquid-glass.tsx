import { useEffect, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function useLiquidLight() {
  useEffect(() => {
    const root = document.documentElement;
    const move = (e: PointerEvent) => {
      root.style.setProperty("--lg-x", `${e.clientX}px`);
      root.style.setProperty("--lg-y", `${e.clientY}px`);
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => window.removeEventListener("pointermove", move);
  }, []);
}

export function LiquidGlassDefs() {
  return (
    <svg width="0" height="0" className="lg-defs" aria-hidden>
      <filter
        id="lg-refract"
        x="-8%"
        y="-8%"
        width="116%"
        height="116%"
        colorInterpolationFilters="sRGB"
      >
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.008 0.01"
          numOctaves="2"
          seed="3"
          result="noise"
        />
        <feGaussianBlur in="noise" stdDeviation="0.45" result="soft" />
        <feDisplacementMap
          in="SourceGraphic"
          in2="soft"
          scale="6"
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>
    </svg>
  );
}

type GlassProps = HTMLAttributes<HTMLElement> & {
  as?: "div" | "aside" | "section" | "header";
  children?: ReactNode;
};

export function LiquidGlass({ as: Tag = "div", className, children, ...props }: GlassProps) {
  return (
    <Tag className={cn("lg", className)} {...props}>
      <span className="lg-refraction" aria-hidden />
      <span className="lg-specular" aria-hidden />
      <span className="lg-content">{children}</span>
    </Tag>
  );
}
