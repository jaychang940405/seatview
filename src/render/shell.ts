import * as THREE from "three";
import type { PlanPoint, Shell } from "../core/schema";
import { roofHeightAt, roofLattice, shellCenter } from "../core/shell";

// 穹頂外殼：形狀與高度全部來自 core（shell 資料、roofHeightAt、roofLattice），這裡只負責畫。
// 顏色與間距依使用者照片目視估計（C）；圖案自己生成，不複製任何照片或網站的畫面。

const COLORS = {
  wall: "#c9cbcd",
  seam: "#a6a9ad",
  roof: "#2a2e35",
  lattice: "#d5d9dd",
  light: "#ffe9b8",
} as const;

/** 格柵線間距、牆面接縫間距、屋頂邊緣燈的間距（m，C）。 */
export const SHELL_SPACING = { lattice: 6, seam: 6, light: 5 } as const;
/** 屋頂網格從中心到牆頂分幾圈。 */
const ROOF_RINGS = 36;
/** 接縫線與燈往內縮多少（m），避免和牆面重疊閃爍。 */
const INSET = 0.05;
const LIGHT_SIZE = { length: 1.6, height: 0.6, depth: 0.6 } as const;
/** 燈離牆往內多少（m）：放在深色屋頂前面才看得出來。 */
const LIGHT_INSET = 2.5;

export function buildShell(shell: Shell, _layoutId: string): THREE.Group {
  const group = new THREE.Group();
  group.name = "shell";
  group.add(buildWall(shell), buildSeams(shell), buildRoof(shell), buildLattice(shell), buildLights(shell));
  return group;
}

const edges = (outline: PlanPoint[]) => outline.map((p, i) => [p, outline[(i + 1) % outline.length] as PlanPoint] as const);

/** 沿著輪廓每隔 spacing 公尺取一點（含方向），給接縫與燈用。 */
function alongOutline(outline: PlanPoint[], spacing: number): { point: PlanPoint; tangent: PlanPoint }[] {
  const result: { point: PlanPoint; tangent: PlanPoint }[] = [];
  let carry = 0;
  for (const [a, b] of edges(outline)) {
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const tangent = { x: (b.x - a.x) / length, z: (b.z - a.z) / length };
    for (let d = carry; d < length; d += spacing) result.push({ point: { x: a.x + tangent.x * d, z: a.z + tangent.z * d }, tangent });
    carry = (((carry - length) % spacing) + spacing) % spacing;
  }
  return result;
}

/** 往形心方向縮 distance 公尺。 */
function inward(shell: Shell, p: PlanPoint, distance: number): PlanPoint {
  const center = shellCenter(shell);
  const length = Math.hypot(center.x - p.x, center.z - p.z);
  return { x: p.x + ((center.x - p.x) / length) * distance, z: p.z + ((center.z - p.z) / length) * distance };
}

function buildWall(shell: Shell): THREE.Mesh {
  const positions: number[] = [];
  const top = shell.wallHeight;
  for (const [a, b] of edges(shell.outline)) {
    positions.push(a.x, 0, a.z, b.x, 0, b.z, b.x, top, b.z, a.x, 0, a.z, b.x, top, b.z, a.x, top, a.z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: COLORS.wall, roughness: 0.9, side: THREE.DoubleSide }));
  mesh.name = "shell-wall";
  return mesh;
}

function buildSeams(shell: Shell): THREE.LineSegments {
  const positions: number[] = [];
  for (const { point } of alongOutline(shell.outline, SHELL_SPACING.seam)) {
    const p = inward(shell, point, INSET);
    positions.push(p.x, 0, p.z, p.x, shell.wallHeight, p.z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: COLORS.seam }));
  lines.name = "shell-seams";
  return lines;
}

/** 屋頂：從形心往每個輪廓頂點拉放射線，分 ROOF_RINGS 圈；每個頂點都在殼面上。 */
function buildRoof(shell: Shell): THREE.Mesh {
  const center = shellCenter(shell);
  const n = shell.outline.length;
  const positions = [center.x, roofHeightAt(shell, center), center.z];
  for (let ring = 1; ring <= ROOF_RINGS; ring++) {
    const t = ring / ROOF_RINGS;
    for (const p of shell.outline) {
      const q = { x: center.x + (p.x - center.x) * t, z: center.z + (p.z - center.z) * t };
      positions.push(q.x, roofHeightAt(shell, q), q.z);
    }
  }
  const at = (ring: number, k: number) => 1 + (ring - 1) * n + (k % n);
  const indices: number[] = [];
  for (let k = 0; k < n; k++) indices.push(0, at(1, k), at(1, k + 1));
  for (let ring = 1; ring < ROOF_RINGS; ring++) {
    for (let k = 0; k < n; k++) indices.push(at(ring, k), at(ring + 1, k), at(ring + 1, k + 1), at(ring, k), at(ring + 1, k + 1), at(ring, k + 1));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    color: COLORS.roof,
    roughness: 0.85,
    side: THREE.DoubleSide,
    // 網格是弦面，比真正的殼面低一點；往後推，讓畫在殼面上的格柵線不被擋住
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 4,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "shell-roof";
  return mesh;
}

function buildLattice(shell: Shell): THREE.LineSegments {
  const positions: number[] = [];
  for (const line of roofLattice(shell, SHELL_SPACING.lattice)) {
    for (let i = 1; i < line.length; i++) {
      const [a, b] = [line[i - 1], line[i]];
      if (a && b) positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: COLORS.lattice }));
  lines.name = "shell-lattice";
  return lines;
}

/** 屋頂邊緣一圈燈：自己發光（MeshBasicMaterial 不受光線影響），掛在牆頂往內一點、殼面下方。 */
function buildLights(shell: Shell): THREE.InstancedMesh {
  const spots = alongOutline(shell.outline, SHELL_SPACING.light);
  const geometry = new THREE.BoxGeometry(LIGHT_SIZE.length, LIGHT_SIZE.height, LIGHT_SIZE.depth);
  const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial({ color: COLORS.light }), spots.length);
  const transform = new THREE.Object3D();
  spots.forEach(({ point, tangent }, i) => {
    const p = inward(shell, point, LIGHT_INSET);
    transform.position.set(p.x, roofHeightAt(shell, p) - LIGHT_SIZE.height, p.z);
    transform.rotation.set(0, -Math.atan2(tangent.z, tangent.x), 0);
    transform.updateMatrix();
    mesh.setMatrixAt(i, transform.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.name = "shell-lights";
  return mesh;
}
