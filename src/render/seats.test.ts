import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { parseVenue } from "../core/schema";
import { DEFAULT_EYE_HEIGHT, sectionSeats } from "../core/seat";
import demoArenaJson from "../venues/demo-arena.json";
import taipeiDomeJson from "../venues/taipei-dome.json";
import { expectColorClose, expectSeatError, expectVec3Close } from "../test/helpers";
import { buildSectionMesh, CHAIR, chairGeometry, OVERVIEW_TINT, SEAT_NEUTRAL } from "./seats";

const demo = () => parseVenue(demoArenaJson);
const VENUES = [demo(), parseVenue(taipeiDomeJson)];

function instanceMatrix(mesh: THREE.InstancedMesh, index: number): THREE.Matrix4 {
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(index, matrix);
  return matrix;
}

function chairBounds(): THREE.Box3 {
  const geometry = chairGeometry();
  geometry.computeBoundingBox();
  if (!geometry.boundingBox) throw new Error("沒有 bounding box");
  return geometry.boundingBox;
}

/** 兩個場館所有區、同一排相鄰座位的最小平面距離。 */
function minSeatPitch(): number {
  let min = Infinity;
  for (const venue of VENUES) {
    for (const section of venue.sections) {
      const seats = sectionSeats(venue, section.id);
      for (let i = 1; i < seats.length; i++) {
        const a = seats[i - 1];
        const b = seats[i];
        if (!a || !b || a.row !== b.row) continue;
        min = Math.min(min, Math.hypot(b.position.x - a.position.x, b.position.z - a.position.z));
      }
    }
  }
  return min;
}

describe("chairGeometry：座椅模型（C 級一般規格；本地 +x 是面向的方向，原點在座位地面中心）", () => {
  it("椅寬 0.44 m，比兩個場館最小的座距少至少 5 cm：相鄰椅子之間看得到縫", () => {
    const box = chairBounds();
    const width = box.max.z - box.min.z;
    expect(width).toBeCloseTo(CHAIR.width, 9);
    expect(minSeatPitch() - width).toBeGreaterThanOrEqual(0.05);
  });

  it("前後都落在踏面內：不超出兩個場館最淺排深的一半", () => {
    const halfDepth = Math.min(...VENUES.flatMap((venue) => venue.sections.map((s) => s.rowDepth))) / 2;
    const box = chairBounds();
    expect(box.min.x).toBeGreaterThan(-halfDepth);
    expect(box.max.x).toBeLessThan(halfDepth);
  });

  it("底部貼齊座位地面；椅背頂 0.82 m，低於坐姿眼高", () => {
    const box = chairBounds();
    expect(box.min.y).toBeCloseTo(0, 9);
    expect(box.max.y).toBeCloseTo(CHAIR.backTop, 9);
    expect(box.max.y).toBeLessThan(DEFAULT_EYE_HEIGHT);
  });

  it("椅背在後方：比椅面高 5 cm 以上的頂點，都在座位中心後方 10 cm 以外", () => {
    const position = chairGeometry().getAttribute("position");
    let above = 0;
    for (let i = 0; i < position.count; i++) {
      if (position.getY(i) <= CHAIR.seatHeight + 0.05) continue;
      above++;
      expect(position.getX(i)).toBeLessThan(-0.1);
    }
    expect(above).toBeGreaterThan(0);
  });

  it("椅面頂在 0.43 m：最前緣的頂點就在這個高度", () => {
    const position = chairGeometry().getAttribute("position");
    let frontTop = -Infinity;
    const maxX = chairBounds().max.x;
    for (let i = 0; i < position.count; i++) {
      if (Math.abs(position.getX(i) - maxX) < 1e-9) frontTop = Math.max(frontTop, position.getY(i));
    }
    expect(frontTop).toBeCloseTo(CHAIR.seatHeight, 9);
  });
});

describe("buildSectionMesh", () => {
  it("一個座位一個 instance，name 可用來查找", () => {
    const { mesh } = buildSectionMesh(demo(), "A1", "#4477aa");
    expect(mesh.name).toBe("section:A1");
    expect(mesh.count).toBe(20 * 31);
  });

  it("每個 instance 的位置 = core 座位位置（椅子原點就在座位地面，render 不改座標）", () => {
    const venue = demo();
    for (const id of ["A1", "B1", "F1"]) {
      const { mesh } = buildSectionMesh(venue, id, "#4477aa");
      sectionSeats(venue, id).forEach((placement, i) => {
        const p = new THREE.Vector3().setFromMatrixPosition(instanceMatrix(mesh, i));
        // instance 矩陣存成 Float32Array，數十公尺的座標只有 ~1e-6 精度；比到 0.1 mm 已足夠
        expectVec3Close(p, placement.position, 4);
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

  it("顏色：座位視角是中性色；鳥瞰混入一半的分區色", () => {
    const { colors } = buildSectionMesh(demo(), "B1", "#cc6677");
    expectColorClose(colors.seat, SEAT_NEUTRAL);
    expectColorClose(colors.overview, SEAT_NEUTRAL.clone().lerp(new THREE.Color("#cc6677"), OVERVIEW_TINT));
  });

  it("paint：每個 instance 換成該模式的顏色，並標記需要上傳 GPU", () => {
    const sectionMesh = buildSectionMesh(demo(), "B1", "#cc6677");
    const color = new THREE.Color();
    for (const mode of ["overview", "seat"] as const) {
      const before = sectionMesh.mesh.instanceColor?.version ?? 0;
      sectionMesh.paint(mode);
      expect(sectionMesh.mesh.instanceColor?.version ?? 0, mode).toBeGreaterThan(before);
      for (const i of [0, sectionMesh.mesh.count - 1]) {
        sectionMesh.mesh.getColorAt(i, color);
        // instance color 也是 Float32Array，不能用 equals 比完全相等
        expectColorClose(color, sectionMesh.colors[mode]);
      }
    }
  });

  it("不存在的區 → UNKNOWN_SECTION（core 的錯誤直接往外傳）", () => {
    expectSeatError(() => buildSectionMesh(demo(), "Z9", "#4477aa"), "UNKNOWN_SECTION");
  });
});
