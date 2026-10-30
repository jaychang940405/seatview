import * as THREE from "three";
import type { Vec3, Venue } from "../core/schema";
import { seatPosition } from "../core/seat";
import { displaySections, findLayout } from "../core/view";
import { buildOverlay, GROUND_RENDER_ORDER } from "./overlays";
import { buildSectionMesh, CHAIR, type ColorMode, type SectionMesh } from "./seats";
import { buildShell } from "./shell";
import { buildStands } from "./stands";

/** 各區輪流使用的顏色（Paul Tol bright，扣掉留給選位的紅色）。 */
export const SECTION_COLORS = ["#4477aa", "#66ccee", "#228833", "#ccbb44", "#aa3377", "#bbbbbb"];
export const HIGHLIGHT_COLOR = new THREE.Color("#ee6677");
/** 選位標記所在的 layer；只有鳥瞰相機啟用它，座位相機看不到，才不會擋住座位視角。 */
export const MARKER_LAYER = 1;

/** 地板比所有座位與 overlay 的範圍再往外多幾公尺。 */
const FLOOR_MARGIN = 10;
/** 選位標記：倒立的錐，尖端浮在座位上方。尺寸以鳥瞰距離（約 100–200 m）看得到為準。 */
const MARKER = { radius: 1.5, height: 4, hover: 1 } as const;

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
  /** 座位視角用中性色，鳥瞰混入分區色；選中的座位維持 HIGHLIGHT_COLOR */
  setColorMode(mode: ColorMode): void;
  /** 鳥瞰（除錯）時藏起整個外殼（38 m 的牆會擋住裡面）；沒有外殼的場館什麼都不做 */
  setShellVisible(visible: boolean): void;
  dispose(): void;
}

/** 組出一個 layout 的場景：開放的區、overlays、地板、燈光。 */
export function buildVenueScene(venue: Venue, layoutId: string): VenueScene {
  const layout = findLayout(venue, layoutId);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#1b1d23");
  // 室內場館：屋頂燈光從上方均勻照下。半球光給整體漫射，平行光讓踏面比踢面亮；不開陰影（燈光分散、也太吃效能）
  scene.add(new THREE.HemisphereLight("#e6ecf5", "#2a2c33", 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(30, 80, 20);
  scene.add(sun);

  const sections = new THREE.Group();
  sections.name = "sections";
  const sectionMeshes = new Map<string, SectionMesh>();
  displaySections(venue, layoutId).forEach(({ id }, i) => {
    const sectionMesh = buildSectionMesh(venue, id, SECTION_COLORS[i % SECTION_COLORS.length] ?? "#bbbbbb");
    sectionMeshes.set(id, sectionMesh);
    sections.add(sectionMesh.mesh);
  });
  scene.add(sections);
  scene.add(buildStands(venue, layoutId));
  const shell = venue.shell ? buildShell(venue.shell, layoutId) : null;
  if (shell) scene.add(shell);

  const overlays = new THREE.Group();
  overlays.name = "overlays";
  // polygon 的 layer 從 1 起算：最底層也要比地板（layer 0）優先
  let layer = 1;
  for (const overlay of layout.overlays ?? []) overlays.add(buildOverlay(overlay, overlay.type === "polygon" ? layer++ : 0));
  scene.add(overlays);

  scene.add(buildFloor(new THREE.Box3().setFromObject(sections).union(new THREE.Box3().setFromObject(overlays))));

  const marker = buildSeatMarker();
  scene.add(marker);

  let highlighted: { sectionMesh: SectionMesh; index: number } | null = null;
  let colorMode: ColorMode = "seat";

  return {
    scene,
    focus: { ...layout.focus.position },
    highlightSeat(ref) {
      if (highlighted) {
        setSeatColor(highlighted.sectionMesh, highlighted.index, highlighted.sectionMesh.colorAt(colorMode, highlighted.index));
        highlighted = null;
      }
      marker.visible = false;
      if (!ref) return;
      const sectionMesh = sectionMeshes.get(ref.sectionId);
      const index = sectionMesh?.indexOf(ref.row, ref.seat);
      if (!sectionMesh || index === undefined) return;
      setSeatColor(sectionMesh, index, HIGHLIGHT_COLOR);
      highlighted = { sectionMesh, index };

      const seat = seatPosition(venue, ref.sectionId, ref.row, ref.seat);
      marker.position.set(seat.x, seat.y + CHAIR.backTop + MARKER.hover + MARKER.height / 2, seat.z);
      marker.visible = true;
    },
    setShellVisible(visible) {
      if (shell) shell.visible = visible;
    },
    setColorMode(mode) {
      colorMode = mode;
      for (const sectionMesh of sectionMeshes.values()) sectionMesh.paint(mode);
      if (highlighted) setSeatColor(highlighted.sectionMesh, highlighted.index, HIGHLIGHT_COLOR);
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

function buildSeatMarker(): THREE.Mesh {
  const geometry = new THREE.ConeGeometry(MARKER.radius, MARKER.height, 16);
  geometry.rotateX(Math.PI); // ConeGeometry 尖端朝上，轉成朝下指向座位
  const marker = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: HIGHLIGHT_COLOR }));
  marker.name = "seat-marker";
  marker.layers.set(MARKER_LAYER);
  marker.visible = false;
  return marker;
}

/** y = 0 的地板，蓋住 bounds 的平面範圍。 */
function buildFloor(bounds: THREE.Box3): THREE.Mesh {
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(size.x + 2 * FLOOR_MARGIN, size.z + 2 * FLOOR_MARGIN),
    // 地板跟球場地面圖層一樣：最先畫、不寫深度（場景裡沒有東西在地面以下）
    new THREE.MeshStandardMaterial({ color: "#2c2f38", roughness: 0.95, depthWrite: false }),
  );
  floor.rotation.x = -Math.PI / 2; // PlaneGeometry 預設在 XY 平面，轉成躺在地上
  floor.position.set(center.x, 0, center.z);
  floor.renderOrder = GROUND_RENDER_ORDER;
  floor.name = "floor";
  return floor;
}
