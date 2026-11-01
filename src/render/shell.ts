import * as THREE from "three";
import type { PlanPoint, Screen, Shell } from "../core/schema";
import { isScreenOn, roofHeightAt, roofLattice, screenCorners, screenNormal, shellCenter } from "../core/shell";

// 穹頂外殼：形狀與高度全部來自 core（shell 資料、roofHeightAt、roofLattice），這裡只負責畫。
// 顏色與間距依使用者照片目視估計（C）；圖案自己生成，不複製任何照片或網站的畫面。

const COLORS = {
  wall: "#c9cbcd",
  seam: "#a6a9ad",
  roof: "#2a2e35",
  lattice: "#d5d9dd",
  light: "#ffe9b8",
  /** 螢幕亮的時候：中性的漸層色塊（不放文字、標誌、廣告或品牌色），下深上淺 */
  screenBottom: "#2b3f58",
  screenTop: "#86a7c4",
  screenOff: "#121418",
  screenFrame: "#1b1d21",
  vent: "#5d6166",
} as const;

/** 螢幕外框比螢幕大多少、厚多少、退到螢幕後面多少（m）。 */
const FRAME = { margin: 0.3, depth: 0.4, back: 0.25 } as const;
/** 螢幕網格的切分（給漸層用）。 */
const SCREEN_GRID = { columns: 8, rows: 4 } as const;

/** 格柵線間距、牆面接縫間距、屋頂邊緣燈的間距（m，C）。 */
export const SHELL_SPACING = { lattice: 6, seam: 6, light: 5 } as const;
/** 屋頂網格從中心到牆頂分幾圈。 */
const ROOF_RINGS = 36;
/** 接縫線與燈往內縮多少（m），避免和牆面重疊閃爍。 */
const INSET = 0.05;
const LIGHT_SIZE = { length: 1.6, height: 0.6, depth: 0.6 } as const;
/** 燈離牆往內多少（m）：放在深色屋頂前面才看得出來。 */
const LIGHT_INSET = 2.5;
/** 牆上一圈圓形通風孔（現場照片；高度、間距、大小是目視估計，C）：離牆頂 below 公尺，每隔 spacing 公尺一個。 */
const VENTS = { below: 3, spacing: 6, radius: 0.6 } as const;

export function buildShell(shell: Shell, layoutId: string): THREE.Group {
  const group = new THREE.Group();
  group.name = "shell";
  group.add(buildWall(shell), buildSeams(shell), buildVents(shell), buildRoof(shell), buildLattice(shell), buildLights(shell), buildScreens(shell, layoutId));
  return group;
}

/** 牆上的螢幕：這個 layout 亮就用自己發光的漸層，熄滅就用深色材質；外框是一圈深色的薄框。 */
function buildScreens(shell: Shell, layoutId: string): THREE.Group {
  const group = new THREE.Group();
  group.name = "shell-screens";
  for (const screen of shell.screens ?? []) group.add(buildScreenFace(screen, isScreenOn(screen, layoutId)), buildScreenFrame(screen));
  return group;
}

/** 螢幕面：頂點由 core 的四個角雙線性內插，正面朝 screenNormal。 */
function buildScreenFace(screen: Screen, lit: boolean): THREE.Mesh {
  const [bl, br, , tl] = screenCorners(screen);
  if (!bl || !br || !tl) throw new Error(`${screen.id} 螢幕的角不足`);
  const { columns, rows } = SCREEN_GRID;
  const [bottom, top] = [new THREE.Color(COLORS.screenBottom), new THREE.Color(COLORS.screenTop)];
  const positions: number[] = [];
  const colors: number[] = [];
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= columns; i++) {
      const [u, v] = [i / columns, j / rows];
      positions.push(bl.x + u * (br.x - bl.x) + v * (tl.x - bl.x), bl.y + v * (tl.y - bl.y), bl.z + u * (br.z - bl.z) + v * (tl.z - bl.z));
      // 下深上淺，中間略亮一點，像一塊沒有內容的發光面板
      const color = bottom.clone().lerp(top, v).multiplyScalar(1 + 0.12 * (1 - Math.abs(2 * u - 1)));
      colors.push(color.r, color.g, color.b);
    }
  }
  const at = (i: number, j: number) => j * (columns + 1) + i;
  const indices: number[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) indices.push(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i, j + 1));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material = lit
    ? new THREE.MeshBasicMaterial({ vertexColors: true })
    : new THREE.MeshStandardMaterial({ color: COLORS.screenOff, roughness: 0.5 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `screen:${screen.id}`;
  return mesh;
}

function buildScreenFrame(screen: Screen): THREE.Mesh {
  const n = screenNormal(screen);
  const geometry = new THREE.BoxGeometry(screen.width + 2 * FRAME.margin, screen.height + 2 * FRAME.margin, FRAME.depth);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: COLORS.screenFrame, roughness: 0.7 }));
  // 方塊的本地 +z 轉到 n；整個退到螢幕面後方，前面剛好在螢幕面後 5 cm
  mesh.position.set(screen.center.x - n.x * FRAME.back, screen.center.y, screen.center.z - n.z * FRAME.back);
  mesh.rotation.y = Math.atan2(n.x, n.z);
  mesh.name = `screen-frame:${screen.id}`;
  return mesh;
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

/** 牆上的圓形通風孔：深灰色圓片，貼在牆內側、面朝場內；跟接縫錯開半個間距。 */
function buildVents(shell: Shell): THREE.InstancedMesh {
  // 相鄰兩個接縫點的中點：輪廓是凸的，中點一定在輪廓內
  const seams = alongOutline(shell.outline, VENTS.spacing).map((s) => s.point);
  const spots = seams.map((a, i) => {
    const b = seams[(i + 1) % seams.length] ?? a;
    return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
  });
  const geometry = new THREE.CircleGeometry(VENTS.radius, 16);
  const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshStandardMaterial({ color: COLORS.vent, roughness: 0.8 }), spots.length);
  const transform = new THREE.Object3D();
  const y = shell.wallHeight - VENTS.below;
  const center = shellCenter(shell);
  spots.forEach((spot, i) => {
    const p = inward(shell, spot, INSET * 2);
    transform.position.set(p.x, y, p.z);
    // 圓片預設面朝 +z；轉到面朝形心
    transform.lookAt(center.x, y, center.z);
    transform.updateMatrix();
    mesh.setMatrixAt(i, transform.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.name = "shell-vents";
  return mesh;
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
