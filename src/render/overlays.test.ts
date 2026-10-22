import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { Overlay } from "../core/schema";
import { expectColorClose, expectVec3Close } from "../test/helpers";
import { buildOverlay } from "./overlays";

const stage: Overlay = {
  type: "box",
  id: "stage",
  center: { x: 0, y: 0.9, z: -30 },
  size: { x: 24, y: 1.8, z: 12 },
};

function asMesh(object: THREE.Object3D): THREE.Mesh<THREE.BoxGeometry, THREE.MeshLambertMaterial> {
  if (!(object instanceof THREE.Mesh)) throw new Error("不是 Mesh");
  return object as THREE.Mesh<THREE.BoxGeometry, THREE.MeshLambertMaterial>;
}

function linePoints(object: THREE.Object3D): THREE.Vector3[] {
  if (!(object instanceof THREE.Line)) throw new Error("不是 Line");
  const position = object.geometry.getAttribute("position");
  return Array.from({ length: position.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(position, i));
}

describe("buildOverlay：box", () => {
  it("位置 = center、尺寸 = size、name = overlay:<id>", () => {
    const mesh = asMesh(buildOverlay(stage));
    expect(mesh.name).toBe("overlay:stage");
    expectVec3Close(mesh.position, { x: 0, y: 0.9, z: -30 });
    expect(mesh.geometry.parameters).toMatchObject({ width: 24, height: 1.8, depth: 12 });
  });

  it("沒給 yawDeg → 不旋轉", () => {
    expect(asMesh(buildOverlay(stage)).rotation.y).toBeCloseTo(0);
  });

  it("yawDeg 90：本地 +x（寬）轉到世界 +z，跟座位的 yaw 慣例相同", () => {
    const mesh = asMesh(buildOverlay({ ...stage, yawDeg: 90 }));
    mesh.updateMatrixWorld();
    expectVec3Close(new THREE.Vector3(1, 0, 0).transformDirection(mesh.matrixWorld), { x: 0, y: 0, z: 1 });
  });

  it("有給 color 就用它", () => {
    const mesh = asMesh(buildOverlay({ ...stage, color: "#ff0000" }));
    expectColorClose(mesh.material.color, new THREE.Color("#ff0000"));
  });
});

describe("buildOverlay：polyline", () => {
  const points = [
    { x: 0, z: 0 },
    { x: 10, z: 0 },
    { x: 10, z: 10 },
  ];

  it("開放的折線：Line，點數不變，預設稍微抬離地板", () => {
    const line = buildOverlay({ type: "polyline", id: "foul", points });
    expect(line).toBeInstanceOf(THREE.Line);
    expect(line).not.toBeInstanceOf(THREE.LineLoop);
    expect(line.name).toBe("overlay:foul");
    const vertices = linePoints(line);
    expect(vertices).toHaveLength(3);
    for (const v of vertices) expect(v.y).toBeGreaterThan(0);
    expect(vertices[2]?.x).toBeCloseTo(10);
    expect(vertices[2]?.z).toBeCloseTo(10);
  });

  it("closed：LineLoop 自動接回起點，點數仍是 N；可指定 y", () => {
    const loop = buildOverlay({ type: "polyline", id: "infield", points, closed: true, y: 0.5 });
    expect(loop).toBeInstanceOf(THREE.LineLoop);
    const vertices = linePoints(loop);
    expect(vertices).toHaveLength(3);
    for (const v of vertices) expect(v.y).toBeCloseTo(0.5);
  });
});
