import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { parseVenue } from "../core/schema";
import { DEFAULT_EYE_HEIGHT, sectionSeats } from "../core/seat";
import demoArenaJson from "../venues/demo-arena.json";
import taipeiDomeJson from "../venues/taipei-dome.json";
import { expectColorClose, expectSeatError, expectVec3Close } from "../test/helpers";
import { buildSectionMesh, CHAIR, chairGeometry, OVERVIEW_TINT, SEAT_NEUTRAL, SEAT_PALETTE, seatPaletteIndex } from "./seats";

const demo = () => parseVenue(demoArenaJson);
const VENUES = [demo(), parseVenue(taipeiDomeJson)];

function instanceMatrix(mesh: THREE.InstancedMesh, index: number): THREE.Matrix4 {
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(index, matrix);
  return matrix;
}

// geometry 的頂點存成 Float32Array，只有 ~1e-8 精度；尺寸比到 1 µm（toBeCloseTo 第 6 位）
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
    expect(width).toBeCloseTo(CHAIR.width, 6);
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
    expect(box.min.y).toBeCloseTo(0, 6);
    expect(box.max.y).toBeCloseTo(CHAIR.backTop, 6);
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
    expect(frontTop).toBeCloseTo(CHAIR.seatHeight, 6);
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

  it("鳥瞰（除錯）：整區混入一半的分區色", () => {
    const sectionMesh = buildSectionMesh(demo(), "B1", "#cc6677");
    const expected = SEAT_NEUTRAL.clone().lerp(new THREE.Color("#cc6677"), OVERVIEW_TINT);
    for (const i of [0, 7, sectionMesh.mesh.count - 1]) expectColorClose(sectionMesh.colorAt("overview", i), expected);
  });

  it("座位視角：每席是黑、白、淺灰其中之一，由 (區、排、號) 決定", () => {
    const venue = demo();
    const sectionMesh = buildSectionMesh(venue, "B1", "#cc6677");
    sectionSeats(venue, "B1").forEach(({ row, seat }, i) => {
      expectColorClose(sectionMesh.colorAt("seat", i), SEAT_PALETTE[seatPaletteIndex("B1", row, seat)] ?? new THREE.Color());
    });
  });

  it("paint：每個 instance 換成該模式的顏色，並標記需要上傳 GPU", () => {
    const sectionMesh = buildSectionMesh(demo(), "B1", "#cc6677");
    const color = new THREE.Color();
    for (const mode of ["overview", "seat"] as const) {
      const before = sectionMesh.mesh.instanceColor?.version ?? 0;
      sectionMesh.paint(mode);
      expect(sectionMesh.mesh.instanceColor?.version ?? 0, mode).toBeGreaterThan(before);
      for (const i of [0, 1, 2, sectionMesh.mesh.count - 1]) {
        sectionMesh.mesh.getColorAt(i, color);
        // instance color 也是 Float32Array，不能用 equals 比完全相等
        expectColorClose(color, sectionMesh.colorAt(mode, i));
      }
    }
  });
});

describe("座椅混色（座位視角）：黑、白、淺灰，依 (區、排、號) 雜湊決定（比例是 C 級）", () => {
  const ALL = VENUES.flatMap((venue) => venue.sections.map((section) => ({ venue, id: section.id })));

  it("同一個座位每次都是同一個顏色（重建也一樣）", () => {
    expect(seatPaletteIndex("I1-HP", 15, 48)).toBe(seatPaletteIndex("I1-HP", 15, 48));
    const venue = demo();
    const a = buildSectionMesh(venue, "A1", "#4477aa");
    const b = buildSectionMesh(venue, "A1", "#4477aa");
    for (let i = 0; i < a.mesh.count; i++) expect(a.colorAt("seat", i).equals(b.colorAt("seat", i))).toBe(true);
  });

  it("每一區三種顏色各占 1/3 ± 5%", () => {
    for (const { venue, id } of ALL) {
      const counts = [0, 0, 0];
      const seats = sectionSeats(venue, id);
      for (const { row, seat } of seats) counts[seatPaletteIndex(id, row, seat)] = (counts[seatPaletteIndex(id, row, seat)] ?? 0) + 1;
      for (const count of counts) {
        expect(Math.abs(count / seats.length - 1 / 3), `${venue.id}/${id}：${counts.join("/")}`).toBeLessThanOrEqual(0.05);
      }
    }
  });

  it("不同區不是同一個樣式：大小相同的 I1-1B 與 I1-3B，同排同號同色的比例不到一半", () => {
    const venue = VENUES[1] ?? demo();
    let same = 0;
    const seats = sectionSeats(venue, "I1-1B");
    for (const { row, seat } of seats) if (seatPaletteIndex("I1-1B", row, seat) === seatPaletteIndex("I1-3B", row, seat)) same++;
    expect(same / seats.length).toBeLessThan(0.5);
  });

  it("相鄰座位不是固定循環：同一排連續三席同色的情況會出現（不規則配置）", () => {
    let runs = 0;
    for (let seat = 1; seat + 2 <= 115; seat++) {
      const c = seatPaletteIndex("I1-1B", 15, seat);
      if (c === seatPaletteIndex("I1-1B", 15, seat + 1) && c === seatPaletteIndex("I1-1B", 15, seat + 2)) runs++;
    }
    expect(runs).toBeGreaterThan(0);
  });
});

describe("buildSectionMesh：錯誤", () => {
  it("不存在的區 → UNKNOWN_SECTION（core 的錯誤直接往外傳）", () => {
    expectSeatError(() => buildSectionMesh(demo(), "Z9", "#4477aa"), "UNKNOWN_SECTION");
  });
});
