import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { Overlay } from "../core/schema";
import { expectColorClose, expectVec3Close } from "../test/helpers";
import { buildOverlay, GROUND_RENDER_ORDER } from "./overlays";

const stage: Overlay = {
  type: "box",
  id: "stage",
  center: { x: 0, y: 0.9, z: -30 },
  size: { x: 24, y: 1.8, z: 12 },
};

function asMesh(object: THREE.Object3D): THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> {
  if (!(object instanceof THREE.Mesh)) throw new Error("不是 Mesh");
  return object as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
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
    expect((mesh.geometry as THREE.BoxGeometry).parameters).toMatchObject({ width: 24, height: 1.8, depth: 12 });
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

describe("buildOverlay：polygon 的地面材質（程式產生的紋理，不用外部貼圖）", () => {
  const square = (surface?: "turf" | "dirt"): Overlay => ({
    type: "polygon",
    id: "ground",
    points: [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }],
    color: "#5a9a3a",
    ...(surface && { surface }),
  });

  it("沒有 surface：單色，沒有紋理", () => {
    expect(asMesh(buildOverlay(square())).material.map).toBeNull();
  });

  it.each(["turf", "dirt"] as const)("%s：有一張重複鋪貼、以公尺為單位的紋理，顏色仍是 polygon 的 color", (surface) => {
    const { material } = asMesh(buildOverlay(square(surface)));
    const map = material.map;
    if (!map) throw new Error("沒有紋理");
    expect(map.wrapS).toBe(THREE.RepeatWrapping);
    expect(map.wrapT).toBe(THREE.RepeatWrapping);
    expect(map.repeat.x).toBeGreaterThan(0);
    expect(map.repeat.x).toBeLessThan(1); // UV 是公尺，一張紋理鋪好幾公尺
    expectColorClose(material.color, new THREE.Color("#5a9a3a"));
  });

  it("草皮與紅土是不同的紋理（草皮有條紋、紅土是顆粒）", () => {
    const turf = asMesh(buildOverlay(square("turf"))).material.map;
    const dirt = asMesh(buildOverlay(square("dirt"))).material.map;
    expect(turf).not.toBe(dirt);
    expect(turf?.repeat.x).not.toBe(dirt?.repeat.x);
  });
});

describe("buildOverlay：polygon（球場地面、投手丘）", () => {
  const triangle = [
    { x: 0, z: 0 },
    { x: 10, z: 0 },
    { x: 0, z: 5 },
  ];

  function boundsOf(object: THREE.Object3D): THREE.Box3 {
    if (!(object instanceof THREE.Mesh)) throw new Error("不是 Mesh");
    object.updateMatrixWorld();
    return new THREE.Box3().setFromObject(object);
  }

  it("平面：name = overlay:<id>，所有頂點在 y 高度，平面範圍 = points，用指定顏色", () => {
    const object = buildOverlay({ type: "polygon", id: "grass", points: triangle, y: 0.02, color: "#5c9a3c" });
    expect(object.name).toBe("overlay:grass");
    const box = boundsOf(object);
    expect(box.min.y).toBeCloseTo(0.02, 6);
    expect(box.max.y).toBeCloseTo(0.02, 6);
    expectVec3Close({ x: box.min.x, y: 0, z: box.min.z }, { x: 0, y: 0, z: 0 });
    expectVec3Close({ x: box.max.x, y: 0, z: box.max.z }, { x: 10, y: 0, z: 5 });
    expectColorClose(asMesh(object).material.color, new THREE.Color("#5c9a3c"));
  });

  it("平面朝上：法向量都是 +y（從看台往下看得到）", () => {
    const mesh = asMesh(buildOverlay({ type: "polygon", id: "grass", points: triangle, y: 0.02 }));
    const normal = mesh.geometry.getAttribute("normal");
    for (let i = 0; i < normal.count; i++) expect(normal.getY(i)).toBeCloseTo(1, 6);
  });

  it("沒給 y → 貼地（y = 0）", () => {
    const box = boundsOf(buildOverlay({ type: "polygon", id: "dirt", points: triangle }));
    expect(box.max.y).toBeCloseTo(0, 6);
  });

  it("有 height：從 y − height 長到 y 的柱體（投手丘）", () => {
    const box = boundsOf(buildOverlay({ type: "polygon", id: "mound", points: triangle, y: 0.254, height: 0.254 }));
    expect(box.min.y).toBeCloseTo(0, 6);
    expect(box.max.y).toBeCloseTo(0.254, 6);
  });

  it("疊放的平面圖層：不寫深度、依 layer 由下往上畫，而且都在一般物件（renderOrder 0）之前", () => {
    const flat = (layer: number) => asMesh(buildOverlay({ type: "polygon", id: `p${layer}`, points: triangle }, layer));
    expect(flat(1).material.depthWrite).toBe(false);
    expect(flat(3).renderOrder).toBeGreaterThan(flat(1).renderOrder);
    expect(flat(6).renderOrder).toBeLessThan(0);
    expect(flat(1).renderOrder).toBeGreaterThan(GROUND_RENDER_ORDER);
  });

  it("有 height 的實體（投手丘）照常寫深度、照一般順序畫", () => {
    const mound = asMesh(buildOverlay({ type: "polygon", id: "mound", points: triangle, y: 0.254, height: 0.254 }, 7));
    expect(mound.material.depthWrite).toBe(true);
    expect(mound.renderOrder).toBe(0);
  });
});
