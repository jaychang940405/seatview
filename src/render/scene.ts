import * as THREE from "three";
import type { Vec3, Venue } from "../core/schema";
import { findLayout, listSections } from "../core/view";
import { buildOverlay } from "./overlays";
import { buildSectionMesh, type SectionMesh } from "./seats";

/** 各區輪流使用的顏色（Paul Tol bright，扣掉留給選位的紅色）。 */
export const SECTION_COLORS = ["#4477aa", "#66ccee", "#228833", "#ccbb44", "#aa3377", "#bbbbbb"];
export const HIGHLIGHT_COLOR = new THREE.Color("#ee6677");

/** 地板比所有座位與 overlay 的範圍再往外多幾公尺。 */
const FLOOR_MARGIN = 10;

export interface SeatRef {
  sectionId: string;
  row: number;
  seat: number;
}

export interface VenueScene {
  scene: THREE.Scene;
  /** layout 的 focus（鳥瞰相機繞著它轉） */
  focus: Vec3;
  /** 把一個座位換成 HIGHLIGHT_COLOR；傳 null 或找不到的座位就只清除舊的 */
  highlightSeat(ref: SeatRef | null): void;
  dispose(): void;
}

/** 組出一個 layout 的場景：開放的區、overlays、地板、燈光。 */
export function buildVenueScene(venue: Venue, layoutId: string): VenueScene {
  const layout = findLayout(venue, layoutId);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#1b1d23");
  scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(30, 60, 20);
  scene.add(sun);

  const sections = new THREE.Group();
  sections.name = "sections";
  const sectionMeshes = new Map<string, SectionMesh>();
  listSections(venue, layoutId).forEach(({ id }, i) => {
    const sectionMesh = buildSectionMesh(venue, id, SECTION_COLORS[i % SECTION_COLORS.length] ?? "#bbbbbb");
    sectionMeshes.set(id, sectionMesh);
    sections.add(sectionMesh.mesh);
  });
  scene.add(sections);

  const overlays = new THREE.Group();
  overlays.name = "overlays";
  for (const overlay of layout.overlays ?? []) overlays.add(buildOverlay(overlay));
  scene.add(overlays);

  scene.add(buildFloor(new THREE.Box3().setFromObject(sections).union(new THREE.Box3().setFromObject(overlays))));

  let highlighted: { sectionMesh: SectionMesh; index: number } | null = null;

  return {
    scene,
    focus: { ...layout.focus.position },
    highlightSeat(ref) {
      if (highlighted) {
        setSeatColor(highlighted.sectionMesh, highlighted.index, highlighted.sectionMesh.baseColor);
        highlighted = null;
      }
      if (!ref) return;
      const sectionMesh = sectionMeshes.get(ref.sectionId);
      const index = sectionMesh?.indexOf(ref.row, ref.seat);
      if (!sectionMesh || index === undefined) return;
      setSeatColor(sectionMesh, index, HIGHLIGHT_COLOR);
      highlighted = { sectionMesh, index };
    },
    dispose() {
      scene.traverse((object) => {
        if (object instanceof THREE.InstancedMesh) object.dispose();
        if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
          object.geometry.dispose();
          const materials: THREE.Material[] = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) material.dispose();
        }
      });
    },
  };
}

function setSeatColor(sectionMesh: SectionMesh, index: number, color: THREE.Color): void {
  sectionMesh.mesh.setColorAt(index, color);
  if (sectionMesh.mesh.instanceColor) sectionMesh.mesh.instanceColor.needsUpdate = true;
}

/** y = 0 的地板，蓋住 bounds 的平面範圍。 */
function buildFloor(bounds: THREE.Box3): THREE.Mesh {
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(size.x + 2 * FLOOR_MARGIN, size.z + 2 * FLOOR_MARGIN),
    new THREE.MeshLambertMaterial({ color: "#2c2f38" }),
  );
  floor.rotation.x = -Math.PI / 2; // PlaneGeometry 預設在 XY 平面，轉成躺在地上
  floor.position.set(center.x, 0, center.z);
  floor.name = "floor";
  return floor;
}
