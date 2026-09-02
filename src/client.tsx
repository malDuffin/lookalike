import "@/lib/three-quiet";
import { startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { StartClient } from "@tanstack/react-start/client";
import { installThreeConsoleFilter } from "@/lib/three-quiet";

installThreeConsoleFilter();

startTransition(() => {
  hydrateRoot(document, <StartClient />);
});
