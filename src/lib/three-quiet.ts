/**
 * THREE r185 deprecates Clock (R3F 9.x still constructs one) and logs every
 * WebGL context loss. React DevTools also wraps console.*, so setConsoleFunction
 * alone is not enough — we mute the known lines on console itself, then on THREE.
 */

const DROP = [
  "THREE.Clock: This module has been deprecated",
  "Clock: This module has been deprecated",
  "THREE.WebGLRenderer: Context Lost",
  "THREE.WebGLRenderer: Context Restored",
  "WebGLRenderer: Context Lost",
  "WebGLRenderer: Context Restored",
  "THREE.WebGLShadowMap: PCFSoftShadowMap has been deprecated",
  "WebGLShadowMap: PCFSoftShadowMap has been deprecated",
];

type ConsoleFn = (...args: unknown[]) => void;
type QuietWindow = Window & { __lookalikeQuietConsole?: boolean };

function shouldDrop(args: unknown[]): boolean {
  const first = args[0];
  if (typeof first === "string") {
    return DROP.some((line) => first.includes(line));
  }
  if (first instanceof Error && typeof first.message === "string") {
    return DROP.some((line) => first.message.includes(line));
  }
  return false;
}

function wrapConsole() {
  if (typeof window === "undefined") return;
  const w = window as QuietWindow;
  if (w.__lookalikeQuietConsole) return;
  w.__lookalikeQuietConsole = true;

  for (const method of ["log", "warn", "error", "info", "debug"] as const) {
    const orig = console[method].bind(console) as ConsoleFn;
    console[method] = ((...args: unknown[]) => {
      if (shouldDrop(args)) return;
      orig(...args);
    }) as typeof console.log;
  }
}

wrapConsole();

export function installThreeConsoleFilter() {
  wrapConsole();
  if (typeof window === "undefined") return;
  void import("three")
    .then((THREE) => {
      THREE.setConsoleFunction((type, message, ...params) => {
        if (shouldDrop([message, ...params])) return;
        (console[type] as ConsoleFn)(message, ...params);
      });
    })
    .catch(() => {
      /* three not loaded yet — console wrap is enough */
    });
}

installThreeConsoleFilter();
