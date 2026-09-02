import {
  CylinderGeometry,
  ConeGeometry,
  SphereGeometry,
  MeshStandardMaterial,
  Group,
  Mesh,
  Color,
  DoubleSide,
  type Object3D,
} from "three";

export const HEADWEAR = [
  { id: "none", label: "Curls" },
  { id: "cap", label: "Cap" },
  { id: "beanie", label: "Beanie" },
  { id: "bucket", label: "Bucket" },
  { id: "crown", label: "Crown" },
  { id: "bow", label: "Bow" },
] as const;

export type HeadwearId = (typeof HEADWEAR)[number]["id"];

function mat(hex: string, extras: Partial<ConstructorParameters<typeof MeshStandardMaterial>[0]> = {}) {
  return new MeshStandardMaterial({
    color: new Color(hex),
    roughness: 0.62,
    metalness: 0.08,
    side: DoubleSide,
    ...extras,
  });
}

function add(parent: Group, mesh: Mesh) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export function buildHeadwear(id: HeadwearId, hairHex: string): Group {
  const g = new Group();
  g.name = `hat-${id}`;
  if (id === "none") return g;

  if (id === "cap") {
    const navy = mat("#1a3358");
    const brim = mat("#152a4a");
    const button = mat("#e8eef6");
    add(g, new Mesh(new CylinderGeometry(0.088, 0.094, 0.07, 28), navy)).position.set(0, 0.02, 0.008);
    const visor = new Mesh(new CylinderGeometry(0.11, 0.12, 0.012, 28), brim);
    visor.scale.set(1, 1, 1.45);
    visor.position.set(0, -0.012, 0.038);
    visor.rotation.x = -0.18;
    add(g, visor);
    add(g, new Mesh(new SphereGeometry(0.012, 12, 10), button)).position.set(0, 0.056, 0.004);
  }

  if (id === "beanie") {
    const yarn = mat(hairHex, { roughness: 0.86, metalness: 0 });
    const cuff = mat(hairHex, { roughness: 0.8 });
    const body = new Mesh(new SphereGeometry(0.105, 28, 18, 0, Math.PI * 2, 0, Math.PI * 0.62), yarn);
    body.scale.set(1, 0.92, 1.02);
    body.position.set(0, 0.018, 0.006);
    add(g, body);
    add(g, new Mesh(new CylinderGeometry(0.1, 0.102, 0.032, 28), cuff)).position.set(0, -0.018, 0.006);
    add(g, new Mesh(new SphereGeometry(0.022, 12, 10), yarn)).position.set(0, 0.09, 0.004);
  }

  if (id === "bucket") {
    const khaki = mat("#c4a574", { roughness: 0.78 });
    const band = mat("#5c4630");
    add(g, new Mesh(new CylinderGeometry(0.09, 0.1, 0.055, 28), khaki)).position.set(0, 0.02, 0.006);
    const brim = new Mesh(new CylinderGeometry(0.148, 0.1, 0.018, 28), khaki);
    brim.position.set(0, -0.012, 0.006);
    add(g, brim);
    add(g, new Mesh(new CylinderGeometry(0.092, 0.092, 0.012, 28), band)).position.set(0, 0.002, 0.006);
  }

  if (id === "crown") {
    const gold = mat("#d7b25a", { metalness: 0.55, roughness: 0.32 });
    const jewel = mat("#2e5aa0", { metalness: 0.2, roughness: 0.28 });
    add(g, new Mesh(new CylinderGeometry(0.09, 0.094, 0.028, 8), gold)).position.set(0, 0.01, 0.004);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const spike = new Mesh(new ConeGeometry(0.02, 0.06, 6), gold);
      spike.position.set(Math.sin(a) * 0.078, 0.048, Math.cos(a) * 0.078);
      add(g, spike);
      const gem = new Mesh(new SphereGeometry(0.01, 8, 8), jewel);
      gem.position.set(Math.sin(a) * 0.09, 0.012, Math.cos(a) * 0.09);
      add(g, gem);
    }
  }

  if (id === "bow") {
    const ribbon = mat(hairHex, { roughness: 0.55 });
    const knot = mat(hairHex, { roughness: 0.5 });
    const lobe = (x: number, rot: number) => {
      const m = new Mesh(new SphereGeometry(0.038, 16, 12), ribbon);
      m.scale.set(1.35, 0.7, 0.45);
      m.position.set(x, 0.07, 0.06);
      m.rotation.z = rot;
      add(g, m);
    };
    lobe(-0.038, 0.35);
    lobe(0.038, -0.35);
    add(g, new Mesh(new SphereGeometry(0.016, 12, 10), knot)).position.set(0, 0.07, 0.072);
    const tail = new Mesh(new ConeGeometry(0.012, 0.055, 8), ribbon);
    tail.rotation.x = 0.9;
    tail.position.set(0.012, 0.042, 0.07);
    add(g, tail);
    const tail2 = tail.clone();
    tail2.position.set(-0.012, 0.042, 0.07);
    tail2.rotation.z = 0.4;
    add(g, tail2);
  }

  return g;
}

export function disposeGroup(group: Group) {
  group.traverse((obj) => {
    const mesh = obj as Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) m.dispose();
  });
}

export function findHeadBone(root: Object3D): Object3D | null {
  let found: Object3D | null = null;
  root.traverse((obj) => {
    if (found) return;
    if (obj.name === "Head") found = obj;
  });
  return found;
}
