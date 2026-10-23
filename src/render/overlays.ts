import * as THREE from "three";
import type { Overlay } from "../core/schema";
import { planYawToRotationY, toVector3 } from "./convert";

/** polyline 沒給 y 時稍微抬離地板，避免和地板重疊閃爍。 */
const LINE_DEFAULT_Y = 0.01;

/** overlay 本來就是世界座標，這裡只負責轉成 three.js 物件。name = "overlay:<id>"。 */
export function buildOverlay(overlay: Overlay): THREE.Object3D {
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
    case "polygon":
      throw new Error("not implemented");
  }
}
