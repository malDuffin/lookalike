import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import appCss from "../styles.css?url";

const APP_NAME = "Orbyt: Custom Character";

/** Classic (non-module) script — runs before deferred Vite chunks and R3F. */
const QUIET_CONSOLE = `(function(){if(window.__lookalikeQuietConsole)return;window.__lookalikeQuietConsole=true;var n=["THREE.Clock: This module has been deprecated","Clock: This module has been deprecated","THREE.WebGLRenderer: Context Lost","THREE.WebGLRenderer: Context Restored","WebGLRenderer: Context Lost","WebGLRenderer: Context Restored","THREE.WebGLShadowMap: PCFSoftShadowMap has been deprecated","WebGLShadowMap: PCFSoftShadowMap has been deprecated"];function drop(a){var x=a[0];if(typeof x==="string"){for(var i=0;i<n.length;i++)if(x.indexOf(n[i])!==-1)return true}if(x&&typeof x.message==="string"){for(var j=0;j<n.length;j++)if(x.message.indexOf(n[j])!==-1)return true}return false}function wrap(m){var o=console[m].bind(console);console[m]=function(){if(drop(arguments))return;return o.apply(console,arguments)};}wrap("log");wrap("warn");wrap("error");wrap("info");wrap("debug");})();`;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: APP_NAME },
      {
        name: "description",
        content: "Match hair, skin and eye color on a 3D cartoon character from a photo or webcam.",
      },
      { name: "theme-color", content: "#101218" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Outfit:wght@400;500;600&display=swap",
      },
    ],
  }),
  component: () => (
    <html lang="en" className="antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: QUIET_CONSOLE }} />
        <HeadContent />
      </head>
      <body>
        <PreviewHostBridge />
        <AuthProvider>
          <Outlet />
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  ),
});
