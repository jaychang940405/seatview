import * as THREE from "three";
import type { Overlay } from "../core/schema";
import { planYawToRotationY, toVector3 } from "./convert";
import { surfaceTexture } from "./textures";

/** polyline 沒給 y 時稍微抬離地板，避免和地板重疊閃爍。 */
const LINE_DEFAULT_Y = 0.01;

/** 地面（地板與平面 polygon）的 renderOrder 起點：比其他所有東西都早畫。地板用這個值，polygon 依 layer 往上加。 */
export const GROUND_RENDER_ORDER = -100;

/**
 * overlay 本來就是世界座標，這裡只負責轉成 three.js 物件。name = "overlay:<id>"。
 * layer：平面 polygon 由下往上的順序（1 起算），決定 renderOrder。
 */
export function buildOverlay(overlay: Overlay, layer = 0): THREE.Object3D {
  switch (overlay.type) {
    case "box": {
      const { size } = overlay;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size.x, size.y, size.z),
        new THREE.MeshStandardMaterial({ color: overlay.color ?? "#d9d9d9", roughness: 0.8 }),
      );
      mesh.position.copy(toVector3(overlay.center));
      mesh.rotation.y = planYawToRotationY(overlay.yawDeg ?? 0);
      mesh.name = `overlay:${overlay.id}`;
      return mesh;
    }
    case "polyline": {
      const y = overlay.y ?? LINE_DEFAULT_Y;
      const geometry = new THREE.BufferGeometry().setFromPoints(
        overlay.points.map((p) => new THREE.Vector3(p.x, y, p.z)),
      );
      const material = new THREE.LineBasicMaterial({ color: overlay.color ?? "#ffffff" });
      const line = overlay.closed ? new THREE.LineLoop(geometry, material) : new THREE.Line(geometry, material);
      line.name = `overlay:${overlay.id}`;
      return line;
    }
    case "polygon": {
      const y = overlay.y ?? 0;
      // Shape 在 XY 平面；繞 x 轉 −90° 後 (x, y, z) → (x, z, −y)，所以點用 (x, −z) 才會落回平面上的 (x, z)
      const shape = new THREE.Shape(overlay.points.map((p) => new THREE.Vector2(p.x, -p.z)));
      const geometry =
        overlay.height === undefined
          ? new THREE.ShapeGeometry(shape)
          : new THREE.ExtrudeGeometry(shape, { depth: overlay.height, bevelEnabled: false });
      geometry.rotateX(-Math.PI / 2);
      geometry.translate(0, y - (overlay.height ?? 0), 0);
      const flat = overlay.height === undefined;
      // 平面地面圖層幾乎同高，遠處深度精度不夠會閃爍：改成不寫深度、依 layer 由下往上畫。
      // 場景裡沒有東西在地面以下，所以線條、看台、投手丘之後畫時一定蓋在地面上。
      const material = new THREE.MeshStandardMaterial({
        color: overlay.color ?? "#8a8a8a",
        roughness: 0.95,
        depthWrite: !flat,
        // ShapeGeometry 的 UV 就是平面上的公尺，紋理的 repeat 已經換算好
        map: overlay.surface === undefined ? null : surfaceTexture(overlay.surface),
      });
      const mesh = new THREE.Mesh(geometry, material);
      if (flat) mesh.renderOrder = GROUND_RENDER_ORDER + layer;
      mesh.name = `overlay:${overlay.id}`;
      return mesh;
    }
  }
}
