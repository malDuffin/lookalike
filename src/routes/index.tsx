import { lazy, Suspense, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { StudioOverlay } from "@/components/studio-overlay";

const CharacterStage = lazy(() =>
  import("@/components/character-stage").then((m) => ({ default: m.CharacterStage })),
);

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <main className="studio-root">
      {mounted ? (
        <Suspense fallback={null}>
          <CharacterStage />
        </Suspense>
      ) : (
        <div className="absolute inset-0" />
      )}
      <StudioOverlay />
    </main>
  );
}
