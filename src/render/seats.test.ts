import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { parseVenue } from "../core/schema";
import { sectionSeats } from "../core/seat";
import demoArenaJson from "../venues/demo-arena.json";
import { expectColorClose, expectSeatError, expectVec3Close } from "../test/helpers";
import { buildSectionMesh, SEAT_SIZE } from "./seats";

const demo = () => parseVenue(demoArenaJson);

function instanceMatrix(mesh: THREE.InstancedMesh, index: number): THREE.Matrix4 {
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(index, matrix);
  return matrix;
}

describe("buildSectionMesh", () => {
  it("一個座位一個 instance，name 可用來查找", () => {
    const { mesh } = buildSectionMesh(demo(), "A1", "#4477aa");
    expect(mesh.name).toBe("section:A1");
    expect(mesh.count).toBe(20 * 31);
  });

  it("每個 instance 的位置 = core 座位位置 + 半個方塊高（render 不改座標）", () => {
    const venue = demo();
    for (const id of ["A1", "B1", "F1"]) {
      const { mesh } = buildSectionMesh(venue, id, "#4477aa");
      sectionSeats(venue, id).forEach((placement, i) => {
        const p = new THREE.Vector3().setFromMatrixPosition(instanceMatrix(mesh, i));
        // instance 矩陣存成 Float32Array，數十公尺的座標只有 ~1e-6 精度；比到 0.1 mm 已足夠
        expectVec3Close(p, { ...placement.position, y: placement.position.y + SEAT_SIZE.height / 2 }, 4);
      });
    }
  });

  it("每個 instance 的本地 +x 指向 core 的 yawDeg", () => {
    const venue = demo();
    for (const id of ["A1", "B1"]) {
      const { mesh } = buildSectionMesh(venue, id, "#4477aa");
      sectionSeats(venue, id).forEach(({ yawDeg }, i) => {
        const facing = new THREE.Vector3(1, 0, 0).transformDirection(instanceMatrix(mesh, i));
        const rad = THREE.MathUtils.degToRad(yawDeg);
        expectVec3Close(facing, { x: Math.cos(rad), y: 0, z: Math.sin(rad) });
      });
    }
  });

  it("indexOf：(排, 號) 對應到 instance index", () => {
    const { indexOf } = buildSectionMesh(demo(), "A1", "#4477aa");
    expect(indexOf(1, 1)).toBe(0);
    expect(indexOf(1, 31)).toBe(30);
    expect(indexOf(2, 1)).toBe(31);
    expect(indexOf(20, 31)).toBe(619);
  });

  it.each([
    [21, 1],
    [1, 32],
    [0, 0],
  ])("indexOf(%s, %s)：沒有這個座位 → undefined", (row, seat) => {
    expect(buildSectionMesh(demo(), "A1", "#4477aa").indexOf(row, seat)).toBeUndefined();
  });

  it("每個 instance 的顏色預設是區的顏色", () => {
    const { mesh, baseColor } = buildSectionMesh(demo(), "B1", "#cc6677");
    expect(baseColor.equals(new THREE.Color("#cc6677"))).toBe(true);
    const color = new THREE.Color();
    for (const i of [0, mesh.count - 1]) {
      mesh.getColorAt(i, color);
      // instance color 也是 Float32Array，不能用 equals 比完全相等
      expectColorClose(color, baseColor);
    }
  });

  it("不存在的區 → UNKNOWN_SECTION（core 的錯誤直接往外傳）", () => {
    expectSeatError(() => buildSectionMesh(demo(), "Z9", "#4477aa"), "UNKNOWN_SECTION");
  });
});
