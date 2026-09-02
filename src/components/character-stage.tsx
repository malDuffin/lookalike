import { Suspense, useEffect, useMemo, useRef } from "react";
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
  type Group,
  type Mesh,
  type MeshStandardMaterial,
  PCFShadowMap,
  SRGBColorSpace,
  Vector3,
  Box3,
} from "three";
import { SkeletonUtils } from "three-stdlib";
import { TextureRecolorer } from "@/lib/recolor";
import { useStudio } from "@/lib/store";
import { LiquidGlass } from "./liquid-glass";

const MODEL_URL = "/character.glb";

function prettyClip(name: string) {
  return name
    .replace("preset:biped:", "")
    .replace(".001", "")
    .replaceAll("_", " ")
    .replace(/\s+\d+$/, "")
    .replace(/\b\w/g, (c) => c.toUpperCase());
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
    cloned.traverse((obj) => {
      const mesh = obj as Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const mat = mesh.material as MeshStandardMaterial;
      if (mat && !recolorer.current) {
        if (mat.map) mat.map.colorSpace = SRGBColorSpace;
        mat.roughness = 0.72;
        mat.metalness = 0.02;
        recolorer.current = new TextureRecolorer(mat.map, mesh);
        setDefaults(recolorer.current.defaults);
        recolorer.current.apply(useStudio.getState().colors, useStudio.getState().strength);
      }
    });

    setClips(
      (gltf.animations ?? []).map((c) => ({
        id: c.name,
        label: prettyClip(c.name),
      })),
    );
    setReady(true);
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
    </group>
  );
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

function LoaderHud() {
  const { progress, active } = useProgress();
  const loadError = useStudio((s) => s.loadError);
  const ready = useStudio((s) => s.ready);
  if (loadError) {
    return (
      <LiquidGlass className="loader-card">
        <p>Could not load the character.</p>
        <p className="text-muted">{loadError}</p>
      </LiquidGlass>
    );
  }
  if (ready && !active) return null;
  return (
    <LiquidGlass className="loader-card">
      <div className="spin" />
      <p>Loading character… {Math.round(progress)}%</p>
    </LiquidGlass>
  );
}

export function CharacterStage() {
  return (
    <div className="absolute inset-0">
      <Canvas
        camera={{ position: [0.28, 0.92, 3.85], fov: 32, near: 0.05, far: 50 }}
        shadows
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
        onCreated={({ gl, scene }) => {
          gl.toneMappingExposure = 1.08;
          gl.shadowMap.type = PCFShadowMap;
          scene.background = new Color("#0b0d12");
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
          <Character />
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
      </Canvas>
      <div className="loader-wrap">
        <LoaderHud />
      </div>
    </div>
  );
}

useGLTF.preload(MODEL_URL);
