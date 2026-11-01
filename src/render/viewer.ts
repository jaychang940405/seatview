import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { Venue } from "../core/schema";
import type { CameraPose } from "../core/seat";
import type { SeatView } from "../core/view";
import { createSeatCamera, DEFAULT_FOV, resizeSeatCamera, verticalFovFor } from "./camera";
import { applyLook, clampLook, dragLook, faceFocus, LOOK_AHEAD, zoomLook, type Look } from "./look";
import { toVector3 } from "./convert";
import { buildVenueScene, MARKER_LAYER, type VenueScene } from "./scene";

// 唯一碰 DOM 與 WebGL 的模組；其餘 render 模組都能在 Node 裡測試。

/** 環境光照的強度；搭配場景裡的半球光與平行光，在瀏覽器裡目視調整。 */
const ENVIRONMENT_INTENSITY = 0.4;

export type CameraMode = "seat" | "overview";

export interface Viewer {
  /** 切換場館或 layout 時呼叫，會釋放舊場景 */
  showVenue(venue: Venue, layoutId: string): void;
  /** 相機移到這個座位（正視焦點、轉頭回正），並標記它 */
  showSeat(view: SeatView): void;
  setMode(mode: CameraMode): void;
  /** 座位視角轉頭回正（倍數不變） */
  resetLook(): void;
  /** 座位視角的倍數（0.5–4×，超出範圍會被限制） */
  setZoom(zoom: number): void;
  /** 座位視角轉頭或放大時通知（用來顯示倍率與回正按鈕） */
  onLookChange(listener: (look: Look) => void): void;
  dispose(): void;
}

/** 鍵盤轉頭：每按一次轉幾度、放大幾倍。 */
const KEY_TURN_DEG = 5;
const KEY_ZOOM = 1.25;
/** 滾輪放大的靈敏度：deltaY 每 100 約放大 1.2 倍。 */
const WHEEL_ZOOM_PER_DELTA = 0.002;

type Point = { x: number; y: number };
const pinchDistanceOf = (points: Iterable<Point>) => {
  const [a, b] = [...points];
  return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
};

export function createViewer(container: HTMLElement, opts: { fov?: number } = {}): Viewer {
  const baseFov = opts.fov ?? DEFAULT_FOV;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  // ACES 電影感色調：亮部收得比較柔，畫面不像平塗的動畫
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  // 陰影只在桌機開：手機（觸控為主）的 GPU 撐不住三萬多張椅子的陰影圖
  renderer.shadowMap.enabled = !window.matchMedia("(pointer: coarse)").matches;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  // three 內建的室內環境光照（程式產生，不是外部貼圖），讓面與面之間有自然的明暗
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  const seatCamera = createSeatCamera(1, baseFov);
  const overviewCamera = new THREE.PerspectiveCamera(45, 1, 0.5, 2000);
  overviewCamera.layers.enable(MARKER_LAYER); // 只有鳥瞰看得到選位標記
  const controls = new OrbitControls(overviewCamera, renderer.domElement);
  controls.enabled = false;

  let venueScene: VenueScene | null = null;
  let mode: CameraMode = "seat";
  let frame = 0;
  /** 目前座位的正視姿勢（來自 core）；轉頭只在它上面加偏移 */
  let seatPose: CameraPose | null = null;
  let look: Look = LOOK_AHEAD;
  let lookListener: ((look: Look) => void) | null = null;

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
    // resizeSeatCamera 會把 FOV 設回沒放大的值，放大倍率要重新套用
    if (seatPose) applyLook(seatCamera, seatPose, look, verticalFovFor(width / height, baseFov));
    overviewCamera.aspect = width / height;
    overviewCamera.updateProjectionMatrix();
    requestRender();
  }

  function setLook(next: Look): void {
    look = next;
    if (seatPose) applyLook(seatCamera, seatPose, look, verticalFovFor(seatCamera.aspect, baseFov));
    lookListener?.(look);
    requestRender();
  }

  // 座位視角的轉頭操作；鳥瞰時交給 OrbitControls。dispose 時一次移除所有 listener
  const canvas = renderer.domElement;
  const events = new AbortController();
  const listen = { signal: events.signal };
  const pointers = new Map<number, Point>();
  let pinchDistance = 0;
  canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", "3D 畫面。座位視角：拖曳或方向鍵轉頭，滾輪、兩指或 +/− 放大，0 回正");

  canvas.addEventListener(
    "pointerdown",
    (event) => {
      if (mode !== "seat") return;
      canvas.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      pinchDistance = pinchDistanceOf(pointers.values());
    },
    listen,
  );
  canvas.addEventListener(
    "pointermove",
    (event) => {
      const last = pointers.get(event.pointerId);
      if (mode !== "seat" || !last || !seatPose) return;
      const current = { x: event.clientX, y: event.clientY };
      pointers.set(event.pointerId, current);
      if (pointers.size === 1) {
        setLook(dragLook(seatPose, look, current.x - last.x, current.y - last.y, canvas.clientHeight, seatCamera.fov));
      } else if (pointers.size === 2) {
        const distance = pinchDistanceOf(pointers.values());
        if (pinchDistance > 0) setLook(zoomLook(seatPose, look, distance / pinchDistance));
        pinchDistance = distance;
      }
    },
    listen,
  );
  const release = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    pinchDistance = pinchDistanceOf(pointers.values());
  };
  canvas.addEventListener("pointerup", release, listen);
  canvas.addEventListener("pointercancel", release, listen);
  canvas.addEventListener(
    "wheel",
    (event) => {
      if (mode !== "seat" || !seatPose) return;
      event.preventDefault();
      setLook(zoomLook(seatPose, look, Math.exp(-event.deltaY * WHEEL_ZOOM_PER_DELTA)));
    },
    { ...listen, passive: false },
  );
  canvas.addEventListener(
    "keydown",
    (event) => {
      if (mode !== "seat" || !seatPose) return;
      const turns: Record<string, [number, number]> = {
        ArrowLeft: [-KEY_TURN_DEG, 0],
        ArrowRight: [KEY_TURN_DEG, 0],
        ArrowUp: [0, KEY_TURN_DEG],
        ArrowDown: [0, -KEY_TURN_DEG],
      };
      const turn = turns[event.key];
      if (turn) setLook(clampLook(seatPose, { ...look, yawDeg: look.yawDeg + turn[0], pitchDeg: look.pitchDeg + turn[1] }));
      else if (event.key === "+" || event.key === "=") setLook(zoomLook(seatPose, look, KEY_ZOOM));
      else if (event.key === "-") setLook(zoomLook(seatPose, look, 1 / KEY_ZOOM));
      else if (event.key === "0") setLook(faceFocus(look));
      else return;
      event.preventDefault();
    },
    listen,
  );

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
      next.scene.environment = environment;
      next.scene.environmentIntensity = ENVIRONMENT_INTENSITY;
      next.setColorMode(mode);
      next.setShellVisible(mode === "seat");
      venueScene?.dispose();
      venueScene = next;
      frameOverview(next);
      requestRender();
    },
    showSeat(view) {
      seatPose = view.camera;
      venueScene?.highlightSeat(view);
      // 換座位一定回正；倍數是使用者選的偏好，保留
      setLook(faceFocus(look));
    },
    setMode(next) {
      mode = next;
      controls.enabled = next === "overview";
      venueScene?.setColorMode(next);
      venueScene?.setShellVisible(next === "seat");
      requestRender();
    },
    resetLook() {
      setLook(faceFocus(look));
    },
    setZoom(zoom) {
      setLook(seatPose ? clampLook(seatPose, { ...look, zoom }) : { ...look, zoom });
    },
    onLookChange(listener) {
      lookListener = listener;
    },
    dispose() {
      events.abort();
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      venueScene?.dispose();
      environment.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
