import * as THREE from "three";
import type { PlanPoint, Venue } from "../core/schema";
import { sectionTreads, type RowTread } from "../core/stand";
import { displaySections } from "../core/view";

/**
 * 看台第一排前緣的護欄（m）。C 級：一般看台護欄的高度量級。
 * 大巨蛋實際是玻璃、欄杆還是實心牆不知道，所以畫成半透明：表示「這裡有護欄」，不斷定它擋住多少視線。
 */
export const PARAPET = { height: 0.8, opacity: 0.3 } as const;

/** 踏面（朝上的面）與踢面、牆面、底面的顏色：淺灰與深灰，不靠陰影也看得出一階一階。 */
export const STAND_COLORS = { tread: new THREE.Color("#b4b7bb"), side: new THREE.Color("#8c9096") } as const;

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

/**
 * 這個 layout 開放的區的看台：每區一個實體 "stand:<id>"，升高的看台再加一道護欄 "parapet:<id>"。
 * 踏面的形狀、高度全部來自 core 的 sectionTreads；在地面、不升高的區（搖滾區）沒有看台。
 */
export function buildStands(venue: Venue, layoutId: string): THREE.Group {
  const group = new THREE.Group();
  group.name = "stands";
  for (const { id } of displaySections(venue, layoutId)) {
    const all = sectionTreads(venue, id);
    // 跟地面同高的排（B1 第 1 排、搖滾區）沒有看台實體，它就是地面
    const treads = all.filter((t) => t.top - t.bottom > 1e-6);
    if (treads.length === 0) continue;
    const body = buildBody(id, treads);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);
    // 前緣護欄：只要這一區會往上升（不是平的搖滾區），第 1 排前面就有，即使第 1 排跟場地同高
    const first = all[0];
    if (first && first.row === 1) group.add(buildParapet(id, first));
  }
  return group;
}

/** 一個 non-indexed 的三角形集合；quad 會自動調整頂點順序，讓面朝向 outward。 */
class FaceBuffer {
  readonly positions: number[] = [];
  readonly colors: number[] = [];

  quad(corners: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3], outward: THREE.Vector3, color: THREE.Color): void {
    const [a, b, c, d] = corners;
    const normal = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
    const ordered = normal.dot(outward) >= 0 ? [a, b, c, a, c, d] : [a, d, c, a, c, b];
    for (const p of ordered) {
      this.positions.push(p.x, p.y, p.z);
      this.colors.push(color.r, color.g, color.b);
    }
  }

  toGeometry(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.computeVertexNormals();
    return geometry;
  }
}

const at = (p: PlanPoint, y: number) => new THREE.Vector3(p.x, y, p.z);
/** 平面上 from → to 的方向（y = 0），當垂直面的 outward 用。 */
const toward = (from: PlanPoint, to: PlanPoint) => new THREE.Vector3(to.x - from.x, 0, to.z - from.z);

/** 每一排是一個封閉的柱體：踏面、底面、前後兩面、兩端。 */
function buildBody(sectionId: string, treads: RowTread[]): THREE.Mesh {
  const faces = new FaceBuffer();
  const side = STAND_COLORS.side;
  for (const { top, bottom, front, back } of treads) {
    for (let k = 0; k + 1 < front.length; k++) {
      const [f0, f1, b0, b1] = [front[k], front[k + 1], back[k], back[k + 1]] as PlanPoint[] as [PlanPoint, PlanPoint, PlanPoint, PlanPoint];
      faces.quad([at(f0, top), at(f1, top), at(b1, top), at(b0, top)], UP, STAND_COLORS.tread);
      faces.quad([at(f0, bottom), at(f1, bottom), at(b1, bottom), at(b0, bottom)], DOWN, side);
      faces.quad([at(f0, bottom), at(f1, bottom), at(f1, top), at(f0, top)], toward(b0, f0), side);
      faces.quad([at(b0, bottom), at(b1, bottom), at(b1, top), at(b0, top)], toward(f0, b0), side);
    }
    const n = front.length - 1;
    const [fFirst, bFirst, fSecond] = [front[0], back[0], front[1]] as [PlanPoint, PlanPoint, PlanPoint];
    const [fLast, bLast, fBeforeLast] = [front[n], back[n], front[n - 1]] as [PlanPoint, PlanPoint, PlanPoint];
    faces.quad([at(fFirst, bottom), at(bFirst, bottom), at(bFirst, top), at(fFirst, top)], toward(fSecond, fFirst), side);
    faces.quad([at(fLast, bottom), at(bLast, bottom), at(bLast, top), at(fLast, top)], toward(fBeforeLast, fLast), side);
  }
  const mesh = new THREE.Mesh(faces.toGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
  mesh.name = `stand:${sectionId}`;
  return mesh;
}

/** 沿第 1 排前緣的一道薄牆（沒有厚度，兩面都畫）。 */
function buildParapet(sectionId: string, first: RowTread): THREE.Mesh {
  const faces = new FaceBuffer();
  const color = new THREE.Color("#c9d3de");
  const top = first.top + PARAPET.height;
  for (let k = 0; k + 1 < first.front.length; k++) {
    const [p0, p1] = [first.front[k], first.front[k + 1]] as [PlanPoint, PlanPoint];
    // 朝向哪一側不重要（DoubleSide），隨便給一個水平方向
    faces.quad([at(p0, first.top), at(p1, first.top), at(p1, top), at(p0, top)], new THREE.Vector3(p1.z - p0.z, 0, p0.x - p1.x), color);
  }
  const material = new THREE.MeshStandardMaterial({
    color,
    transparent: true,
    opacity: PARAPET.opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
    roughness: 0.3,
  });
  const mesh = new THREE.Mesh(faces.toGeometry(), material);
  mesh.name = `parapet:${sectionId}`;
  return mesh;
}
