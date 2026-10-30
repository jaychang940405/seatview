import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { parseVenue } from "../core/schema";
import { sectionTreads, TIER_SLAB_THICKNESS } from "../core/stand";
import { displaySections } from "../core/view";
import demoArenaJson from "../venues/demo-arena.json";
import taipeiDomeJson from "../venues/taipei-dome.json";
import { expectColorClose } from "../test/helpers";
import { buildVenueScene } from "./scene";
import { buildStands, PARAPET, STAND_COLORS } from "./stands";

const dome = () => parseVenue(taipeiDomeJson);

function meshNamed(group: THREE.Object3D, name: string): THREE.Mesh {
  const object = group.getObjectByName(name);
  if (!(object instanceof THREE.Mesh)) throw new Error(`找不到 ${name}`);
  return object;
}

function boundsOf(mesh: THREE.Mesh): THREE.Box3 {
  mesh.geometry.computeBoundingBox();
  if (!mesh.geometry.boundingBox) throw new Error("沒有 bounding box");
  return mesh.geometry.boundingBox;
}

interface Face {
  normal: THREE.Vector3;
  /** 面積向量 = 法向量 × 面積 */
  area: THREE.Vector3;
  color: THREE.Color;
}

/** 把 non-indexed 的三角形逐一拆出法向量、面積向量與顏色。 */
function facesOf(mesh: THREE.Mesh): Face[] {
  const position = mesh.geometry.getAttribute("position");
  const color = mesh.geometry.getAttribute("color");
  const faces: Face[] = [];
  const [a, b, c] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  for (let i = 0; i < position.count; i += 3) {
    a.fromBufferAttribute(position, i);
    b.fromBufferAttribute(position, i + 1);
    c.fromBufferAttribute(position, i + 2);
    const cross = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
    faces.push({
      normal: cross.clone().normalize(),
      area: cross.multiplyScalar(0.5),
      color: new THREE.Color().fromBufferAttribute(color, i),
    });
  }
  return faces;
}

describe("buildStands：每區一個看台實體", () => {
  it("大巨蛋演唱會：每個升高的看台區（含示意量體）各有實體與護欄；搖滾區 F1–F3 在地面，沒有看台也沒有護欄", () => {
    const group = buildStands(dome(), "concert");
    const names = group.children.map((child) => child.name).sort();
    const raised = displaySections(dome(), "concert").map((s) => s.id).filter((id) => !id.startsWith("F"));
    expect(raised).toContain("batters-eye");
    expect(names).toEqual([...raised.map((id) => `parapet:${id}`), ...raised.map((id) => `stand:${id}`)].sort());
  });

  it("buildVenueScene 把看台放在 \"stands\" 群組裡", () => {
    const stands = buildVenueScene(parseVenue(demoArenaJson), "concert").scene.getObjectByName("stands");
    expect(stands?.getObjectByName("stand:A1")).toBeDefined();
    expect(stands?.getObjectByName("stand:F1")).toBeUndefined();
  });

  it("實體範圍 = core 踏面的範圍：高度從最低的底到最高的踏面，平面包住所有踏面頂點", () => {
    const venue = dome();
    const group = buildStands(venue, "baseball");
    for (const id of ["113", "105", "212", "140"]) {
      const treads = sectionTreads(venue, id);
      const points = treads.flatMap((t) => [...t.front, ...t.back]);
      const box = boundsOf(meshNamed(group, `stand:${id}`));
      // 頂點存成 Float32Array，比到 0.1 mm
      expect(box.min.y, id).toBeCloseTo(Math.min(...treads.map((t) => t.bottom)), 4);
      expect(box.max.y, id).toBeCloseTo(Math.max(...treads.map((t) => t.top)), 4);
      expect(box.min.x, id).toBeCloseTo(Math.min(...points.map((p) => p.x)), 4);
      expect(box.max.x, id).toBeCloseTo(Math.max(...points.map((p) => p.x)), 4);
      expect(box.min.z, id).toBeCloseTo(Math.min(...points.map((p) => p.z)), 4);
      expect(box.max.z, id).toBeCloseTo(Math.max(...points.map((p) => p.z)), 4);
    }
  });

  it(`solid 看台（113）實心到地面；tier 看台（212）最低點在第 1 排踏面下 ${TIER_SLAB_THICKNESS} m`, () => {
    const venue = dome();
    const group = buildStands(venue, "baseball");
    expect(boundsOf(meshNamed(group, "stand:113")).min.y).toBeCloseTo(0, 4);
    const first = sectionTreads(venue, "212")[0];
    expect(boundsOf(meshNamed(group, "stand:212")).min.y).toBeCloseTo((first?.top ?? Number.NaN) - TIER_SLAB_THICKNESS, 4);
  });

  it("朝上的面都是踏面色、其他面是側面色；113 區的踏面三角形 = 每排的段數 × 2 加總（每排長度不同，段數也不同）", () => {
    const venue = dome();
    const faces = facesOf(meshNamed(buildStands(venue, "baseball"), "stand:113"));
    const up = faces.filter((f) => f.normal.y > 0.999);
    expect(up).toHaveLength(sectionTreads(venue, "113").reduce((sum, t) => sum + (t.front.length - 1) * 2, 0));
    for (const face of faces) expectColorClose(face.color, face.normal.y > 0.999 ? STAND_COLORS.tread : STAND_COLORS.side);
    // 其餘的面不是朝正下方就是垂直面（踢面、牆、兩端）
    for (const face of faces.filter((f) => f.normal.y <= 0.999)) expect(face.normal.y < -0.999 || Math.abs(face.normal.y) < 1e-6).toBe(true);
  });

  it("每一排都是封閉的實體：所有面的面積向量加總為 0（面都朝外、沒有破洞）", () => {
    const group = buildStands(dome(), "baseball");
    for (const id of ["113", "122", "212", "143"]) {
      const sum = facesOf(meshNamed(group, `stand:${id}`)).reduce((acc, f) => acc.add(f.area), new THREE.Vector3());
      // 整區面積上千平方公尺，加總誤差只來自 Float32
      expect(sum.length(), id).toBeLessThan(0.01);
    }
  });
});

describe("buildStands：前緣護欄", () => {
  it(`沿第 1 排踏面的前緣，從踏面往上 ${PARAPET.height} m；半透明、兩面都畫`, () => {
    const venue = dome();
    const parapet = meshNamed(buildStands(venue, "baseball"), "parapet:113");
    const first = sectionTreads(venue, "113")[0];
    if (!first) throw new Error("113 沒有踏面");
    const box = boundsOf(parapet);
    expect(box.min.y).toBeCloseTo(first.top, 4);
    expect(box.max.y).toBeCloseTo(first.top + PARAPET.height, 4);
    // 每個頂點都在第 1 排前緣的折線上（平面上）
    const position = parapet.geometry.getAttribute("position");
    for (let i = 0; i < position.count; i++) {
      const p = { x: position.getX(i), z: position.getZ(i) };
      expect(Math.min(...first.front.map((q) => Math.hypot(q.x - p.x, q.z - p.z)))).toBeLessThan(1e-4);
    }
    const material = parapet.material as THREE.Material;
    expect(material.transparent).toBe(true);
    expect(material.opacity).toBeCloseTo(PARAPET.opacity);
    expect(material.side).toBe(THREE.DoubleSide);
  });
});
