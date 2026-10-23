import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Venue } from "../core/schema";
import type { SeatView } from "../core/view";
import { applyCameraPose, createSeatCamera, DEFAULT_FOV, resizeSeatCamera } from "./camera";
import { toVector3 } from "./convert";
import { buildVenueScene, MARKER_LAYER, type VenueScene } from "./scene";

// 唯一碰 DOM 與 WebGL 的模組；其餘 render 模組都能在 Node 裡測試。

export type CameraMode = "seat" | "overview";

export interface Viewer {
  /** 切換場館或 layout 時呼叫，會釋放舊場景 */
  showVenue(venue: Venue, layoutId: string): void;
  /** 相機移到這個座位，並標記它 */
  showSeat(view: SeatView): void;
  setMode(mode: CameraMode): void;
  dispose(): void;
}

export function createViewer(container: HTMLElement, opts: { fov?: number } = {}): Viewer {
  const baseFov = opts.fov ?? DEFAULT_FOV;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  const seatCamera = createSeatCamera(1, baseFov);
  const overviewCamera = new THREE.PerspectiveCamera(45, 1, 0.5, 2000);
  overviewCamera.layers.enable(MARKER_LAYER); // 只有鳥瞰看得到選位標記
  const controls = new OrbitControls(overviewCamera, renderer.domElement);
  controls.enabled = false;

  let venueScene: VenueScene | null = null;
  let mode: CameraMode = "seat";
  let frame = 0;

  // 只在畫面需要更新時畫一次；同一個 frame 內多次呼叫只會畫一次
  function requestRender(): void {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (venueScene) renderer.render(venueScene.scene, mode === "seat" ? seatCamera : overviewCamera);
    });
  }

  function resize(): void {
    const { clientWidth: width, clientHeight: height } = container;
    if (width === 0 || height === 0) return;
    renderer.setSize(width, height);
    resizeSeatCamera(seatCamera, width / height, baseFov);
    overviewCamera.aspect = width / height;
    overviewCamera.updateProjectionMatrix();
    requestRender();
  }

  /**
   * 鳥瞰相機繞著「座位 + overlay」的中心轉，距離剛好讓整個 bounding sphere 入鏡。
   * 不繞 focus：端台的舞台在場館一端，繞它轉會把另一端的看台切掉。
   */
  function frameOverview(current: VenueScene): void {
    const bounds = new THREE.Box3();
    for (const name of ["sections", "overlays"]) {
      const group = current.scene.getObjectByName(name);
      if (group) bounds.union(new THREE.Box3().setFromObject(group));
    }
    if (bounds.isEmpty()) bounds.expandByPoint(toVector3(current.focus));
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    const distance = sphere.radius / Math.sin(THREE.MathUtils.degToRad(overviewCamera.fov) / 2);
    controls.target.copy(sphere.center);
    overviewCamera.position.copy(sphere.center).add(new THREE.Vector3(0, 0.8, 1).normalize().multiplyScalar(distance));
    controls.update();
  }

  controls.addEventListener("change", requestRender);
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  return {
    showVenue(venue, layoutId) {
      const next = buildVenueScene(venue, layoutId);
      next.setColorMode(mode);
      venueScene?.dispose();
      venueScene = next;
      frameOverview(next);
      requestRender();
    },
    showSeat(view) {
      applyCameraPose(seatCamera, view.camera);
      venueScene?.highlightSeat(view);
      requestRender();
    },
    setMode(next) {
      mode = next;
      controls.enabled = next === "overview";
      venueScene?.setColorMode(next);
      requestRender();
    },
    dispose() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      venueScene?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
