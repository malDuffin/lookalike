import "@/lib/three-quiet";
import { installThreeConsoleFilter } from "@/lib/three-quiet";
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import {
  ContactShadows,
  Environment,
  MeshReflectorMaterial,
  OrbitControls,
  useAnimations,
  useGLTF,
  useProgress,
} from "@react-three/drei";
import {
  Color,
  Group,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  PCFShadowMap,
  SRGBColorSpace,
  Vector3,
  Box3,
} from "three";
import { SkeletonUtils } from "three-stdlib";
import { TextureRecolorer } from "@/lib/recolor";
import { buildHeadwear, disposeGroup, findHeadBone } from "@/lib/headwear";
import { MODEL_URL, useBoot } from "@/lib/boot";
import { useStudio } from "@/lib/store";

installThreeConsoleFilter();

function prettyClip(name: string) {
  return name
    .replace("preset:biped:", "")
    .replace(".001", "")
    .replaceAll("_", " ")
    .replace(/\s+\d+$/, "")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function prettyAsset(url: string) {
  const clean = url.split("?")[0] ?? url;
  if (clean.startsWith("blob:") || clean.startsWith("data:")) return "";
  const name = clean.split("/").pop() || clean;
  if (name.length > 42) return name.slice(-40);
  return name;
}

function shortGpu(raw: string) {
  const inner = raw.replace(/^ANGLE \((.+)\)$/s, "$1");
  const gpu = inner
    .split(",")[0]
    ?.replace(/\(0x[0-9a-f]+\)/i, "")
    .replace(/\s+Direct3D.*$/i, "")
    .trim();
  return (gpu || "GPU").slice(0, 36);
}

function Character() {
  const gltf = useGLTF(MODEL_URL);
  const recolorer = useRef<TextureRecolorer | null>(null);
  const lastKey = useRef("");
  const group = useRef<Group>(null);
  const colors = useStudio((s) => s.colors);
  const strength = useStudio((s) => s.strength);
  const clip = useStudio((s) => s.clip);
  const setDefaults = useStudio((s) => s.setDefaults);
  const setClips = useStudio((s) => s.setClips);
  const setReady = useStudio((s) => s.setReady);

  const cloned = useMemo(() => {
    const root = SkeletonUtils.clone(gltf.scene);
    const box = new Box3().setFromObject(root);
    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());
    root.position.sub(center);
    root.position.y += size.y * 0.5;
    return root;
  }, [gltf.scene]);
  const { actions } = useAnimations(gltf.animations, cloned);

  useEffect(() => {
    const boot = useBoot.getState();
    boot.setStage("decode", "done", "Draco");
    boot.log("ok", "Draco primitives ready");
    boot.setStage("atlas", "active");
    boot.setHeadline("Mapping mesh regions…");
    boot.log("work", "UV islands + spatial flood-fill (hair / skin / iris)");

    let best: Mesh | null = null;
    let bestCount = 0;
    cloned.traverse((obj) => {
      const mesh = obj as Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const n = mesh.geometry?.getAttribute("position")?.count ?? 0;
      if (n > bestCount) {
        best = mesh;
        bestCount = n;
      }
    });

    if (best) {
      const mesh = best as Mesh;
      const srcMat = mesh.material as MeshStandardMaterial;
      const mat = srcMat.clone();
      mesh.material = mat;
      if (mat.map) mat.map.colorSpace = SRGBColorSpace;
      mat.roughness = 0.72;
      mat.metalness = 0.02;
      recolorer.current = new TextureRecolorer(mat.map, mesh);
      setDefaults(recolorer.current.defaults);
      const studio = useStudio.getState();
      recolorer.current.apply(studio.colors, studio.strength);
      const st = recolorer.current.stats;
      if (typeof window !== "undefined") {
        Object.assign(window, {
          __orbyt: {
            stats: st,
            eyeRig: recolorer.current.eyeRig,
            setColors: studio.setColors,
            setStrength: studio.setStrength,
          },
        });
      }
      boot.log(
        "ok",
        `islands ${st.width}  welds ${st.height}  hair ${st.hair}  skin ${st.skin}  eyes ${st.eyes}  face ${st.faceSign ?? 0}  ${st.ms.toFixed(0)}ms`,
      );
      if (recolorer.current.eyeRig) {
        boot.log("ok", `iris  r ${recolorer.current.eyeRig.iris.toFixed(3)}`);
      }
    }

    boot.setStage("atlas", "done");
    boot.setStage("lights", "active");
    boot.setHeadline("Lighting stage…");

    setClips(
      (gltf.animations ?? []).map((c) => ({
        id: c.name,
        label: prettyClip(c.name),
      })),
    );
    setReady(true);
    boot.characterLive();
  }, [cloned, gltf.animations, setClips, setDefaults, setReady]);

  useEffect(() => {
    const rec = recolorer.current;
    if (!rec) return;
    const key = `${colors.hair}|${colors.skin}|${colors.eyes}|${strength}`;
    if (key === lastKey.current) return;
    lastKey.current = key;
    rec.apply(colors, strength);
  }, [colors, strength]);

  useEffect(() => {
    Object.values(actions).forEach((action) => action?.fadeOut(0.25));
    if (clip === "idle") return;
    const action = actions[clip];
    action?.reset().fadeIn(0.25).play();
  }, [actions, clip]);

  useFrame((state) => {
    if (!group.current) return;
    group.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.35) * 0.1;
  });

  return (
    <group ref={group}>
      <primitive object={cloned} />
      <HeadwearMount root={cloned} />
    </group>
  );
}

function HeadwearMount({ root }: { root: Object3D }) {
  const style = useStudio((s) => s.headwear);
  const hair = useStudio((s) => s.colors.hair);
  const slot = useRef<Group | null>(null);

  useLayoutEffect(() => {
    const head = findHeadBone(root);
    if (!head) return;
    const holder = new Group();
    holder.name = "OrbytHeadwear";
    holder.position.set(0, 0.11, 0.02);
    head.add(holder);
    slot.current = holder;
    return () => {
      head.remove(holder);
      slot.current = null;
    };
  }, [root]);

  useLayoutEffect(() => {
    const holder = slot.current;
    if (!holder) return;
    while (holder.children.length) {
      const child = holder.children[0]!;
      holder.remove(child);
      disposeGroup(child as Group);
    }
    const next = buildHeadwear(style, hair);
    holder.add(next);
    return () => {
      holder.remove(next);
      disposeGroup(next);
    };
  }, [style, hair]);

  return null;
}

function GlassStage() {
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <circleGeometry args={[4.2, 64]} />
        <MeshReflectorMaterial
          blur={[200, 60]}
          resolution={256}
          mixBlur={0.85}
          mixStrength={22}
          roughness={0.82}
          metalness={0.35}
          color="#12141c"
          mirror={0.18}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]}>
        <circleGeometry args={[0.92, 80]} />
        <meshPhysicalMaterial
          transmission={0.9}
          thickness={1.2}
          roughness={0.06}
          ior={1.48}
          color="#e8eef6"
          metalness={0}
          clearcoat={1}
          clearcoatRoughness={0.08}
          iridescence={0.4}
          iridescenceIOR={1.3}
          iridescenceThicknessRange={[100, 420]}
          transparent
          opacity={0.95}
          attenuationColor="#c9d6ea"
          attenuationDistance={2.4}
        />
      </mesh>
    </>
  );
}

function BootBridge() {
  const { active, loaded, item } = useProgress();
  const meshDone = useBoot((s) => s.stages.find((st) => st.id === "mesh")?.status === "done");
  const last = useRef("");
  const hdrOnce = useRef(false);

  useEffect(() => {
    if (!item || item === last.current) return;
    last.current = item;
    if (/\.hdr|\.exr|hdri|polyhaven|cloudinary/i.test(item)) {
      if (hdrOnce.current) return;
      hdrOnce.current = true;
      useBoot.getState().log("work", "hdri  studio environment");
      return;
    }
    const name = prettyAsset(item);
    if (name) useBoot.getState().log("work", `asset  ${name}`);
  }, [item]);

  useEffect(() => {
    if (!active && loaded > 0 && meshDone) useBoot.getState().lightsLive();
  }, [active, loaded, meshDone]);

  return null;
}

export function CharacterStage() {
  const meshDone = useBoot((s) => s.stages.find((st) => st.id === "mesh")?.status === "done");
  const bootError = useBoot((s) => s.error);

  return (
    <div className="absolute inset-0">
      <Canvas
        camera={{ position: [0.28, 0.92, 3.85], fov: 32, near: 0.05, far: 50 }}
        shadows="percentage"
        dpr={[1, 2]}
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: "default",
          failIfMajorPerformanceCaveat: false,
          preserveDrawingBuffer: true,
        }}
        onCreated={({ gl, scene }) => {
          gl.toneMappingExposure = 1.08;
          gl.shadowMap.type = PCFShadowMap;
          scene.background = new Color("#0b0d12");
          const canvas = gl.domElement;
          canvas.addEventListener(
            "webglcontextlost",
            (event) => {
              event.preventDefault();
            },
            false,
          );
          const ctx = gl.getContext();
          const ext = ctx.getExtension("WEBGL_debug_renderer_info");
          const raw = ext ? String(ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "GPU";
          useBoot.getState().gpuReady({
            webgl2: "isWebGL2" in gl.capabilities ? Boolean(gl.capabilities.isWebGL2) : true,
            renderer: shortGpu(raw),
            dpr: gl.getPixelRatio(),
          });
        }}
      >
        <hemisphereLight args={["#c9d6ff", "#2a241c", 0.55]} />
        <spotLight
          castShadow
          position={[1.6, 3.6, 2.4]}
          angle={0.48}
          penumbra={0.7}
          intensity={2.1}
          color="#fff4e8"
          shadow-mapSize={1024}
          shadow-bias={-0.0002}
        />
        <directionalLight position={[-3, 1.6, -1.4]} intensity={0.4} color="#9bb7ff" />
        <directionalLight position={[-1.2, 2.2, -2.6]} intensity={0.32} color="#ffd9b0" />
        <Suspense fallback={null}>
          <GlassStage />
          {meshDone && !bootError ? <Character /> : null}
        </Suspense>
        <ContactShadows opacity={0.38} scale={6} blur={2.2} far={2.6} />
        <Environment preset="studio" environmentIntensity={0.55} frames={1} />
        <OrbitControls
          makeDefault
          enableDamping
          enablePan={false}
          target={[0.02, 0.7, 0]}
          minDistance={2.2}
          maxDistance={8}
          maxPolarAngle={Math.PI * 0.495}
        />
        <BootBridge />
      </Canvas>
    </div>
  );
}

useGLTF.preload(MODEL_URL);
