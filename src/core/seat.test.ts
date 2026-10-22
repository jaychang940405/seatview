import { describe, expect, it } from "vitest";
import { expectSeatError, expectVec3Close } from "../test/helpers";
import type { ArcSection, LinearSection, Venue } from "./schema";
import { cameraPose, seatPosition } from "./seat";

// 數字刻意挑好算的，方便手算預期值
const arc: ArcSection = {
  id: "ARC",
  type: "arc",
  center: { x: 0, z: 0 },
  innerRadius: 20,
  fromDeg: 60,
  toDeg: 120,
  rows: 10,
  seatsPerRow: 31,
  rowDepth: 0.8,
  rowRise: 0.4,
  baseHeight: 2,
};

const line: LinearSection = {
  id: "LINE",
  type: "linear",
  from: { x: -10, z: 15 },
  to: { x: 10, z: 15 },
  facing: { x: 0, z: 0 },
  rows: 5,
  seatsPerRow: 20,
  rowDepth: 1,
  rowRise: 0.5,
  baseHeight: 0,
};

const venue: Venue = {
  schemaVersion: 1,
  id: "test-venue",
  name: "測試場館",
  sections: [
    arc,
    { ...arc, id: "ARC_REV", fromDeg: 120, toDeg: 60 },
    line,
    { ...line, id: "LINE_BACK", facing: { x: 0, z: 30 } },
    { ...line, id: "VARIED", rows: 3, seatsPerRow: [10, 12, 14] },
  ],
  layouts: {
    concert: { name: "演唱會", focus: { position: { x: 0, y: 3, z: -30 }, facingDeg: 90 } },
  },
};

describe("seatPosition — arc", () => {
  it("第 1 排中間（16 號）在 90° 方向 → (0, 2, 20)", () => {
    expectVec3Close(seatPosition(venue, "ARC", 1, 16), { x: 0, y: 2, z: 20 });
  });

  it("第 6 排中間：半徑 +5×0.8、高度 +5×0.4 → (0, 4, 24)", () => {
    expectVec3Close(seatPosition(venue, "ARC", 6, 16), { x: 0, y: 4, z: 24 });
  });

  it("1 號和 31 號左右對稱", () => {
    const first = seatPosition(venue, "ARC", 1, 1);
    const last = seatPosition(venue, "ARC", 1, 31);
    expect(first.x).toBeCloseTo(-last.x);
    expect(first.z).toBeCloseTo(last.z);
    expect(first.x).not.toBeCloseTo(0);
  });

  it("同一排每個座位都在同一個半徑、同一個高度", () => {
    for (let s = 1; s <= 31; s++) {
      const p = seatPosition(venue, "ARC", 3, s);
      expect(Math.hypot(p.x, p.z)).toBeCloseTo(21.6);
      expect(p.y).toBeCloseTo(2.8);
    }
  });

  it("fromDeg/toDeg 對調 → 1 號換到另一邊", () => {
    const normal = seatPosition(venue, "ARC", 1, 1);
    const reversed = seatPosition(venue, "ARC_REV", 1, 1);
    expect(reversed.x).toBeCloseTo(-normal.x);
    expect(reversed.z).toBeCloseTo(normal.z);
  });
});

describe("seatPosition — linear", () => {
  it("第 1 排 1 號：從 from 往內半個座位 → (-9.5, 0, 15)", () => {
    expectVec3Close(seatPosition(venue, "LINE", 1, 1), { x: -9.5, y: 0, z: 15 });
  });

  it("第 1 排最後一號 → (9.5, 0, 15)", () => {
    expectVec3Close(seatPosition(venue, "LINE", 1, 20), { x: 9.5, y: 0, z: 15 });
  });

  it("第 3 排往遠離 facing 的方向退 2 排、升高 2×0.5 → (-9.5, 1, 17)", () => {
    expectVec3Close(seatPosition(venue, "LINE", 3, 1), { x: -9.5, y: 1, z: 17 });
  });

  it("facing 在另一側時往反方向退 → (-9.5, 1, 13)", () => {
    expectVec3Close(seatPosition(venue, "LINE_BACK", 3, 1), { x: -9.5, y: 1, z: 13 });
  });

  it("seatsPerRow 是陣列時每排座位數不同", () => {
    // 第 2 排 12 席：12 號在 t = 11.5 / 12
    expectVec3Close(seatPosition(venue, "VARIED", 2, 12), { x: -10 + (11.5 / 12) * 20, y: 0.5, z: 16 });
    expectSeatError(() => seatPosition(venue, "VARIED", 2, 13), "SEAT_OUT_OF_RANGE");
    expectVec3Close(seatPosition(venue, "VARIED", 3, 14), { x: -10 + (13.5 / 14) * 20, y: 1, z: 17 });
  });
});

describe("seatPosition — 錯誤", () => {
  it("不存在的區 → UNKNOWN_SECTION", () => {
    expectSeatError(() => seatPosition(venue, "NOPE", 1, 1), "UNKNOWN_SECTION");
  });

  it.each([0, 11, 1.5, Number.NaN])("row = %s → ROW_OUT_OF_RANGE", (row) => {
    expectSeatError(() => seatPosition(venue, "ARC", row, 1), "ROW_OUT_OF_RANGE");
  });

  it.each([0, 32, 1.5])("seat = %s → SEAT_OUT_OF_RANGE", (seat) => {
    expectSeatError(() => seatPosition(venue, "ARC", 1, seat), "SEAT_OUT_OF_RANGE");
  });
});

describe("cameraPose", () => {
  const seat = { x: 1, y: 2, z: 3 };
  const focus = { x: 0, y: 3, z: -30 };

  it("眼睛 = 座位 + 預設眼高 1.2，看向 focus", () => {
    const pose = cameraPose(seat, focus);
    expectVec3Close(pose.position, { x: 1, y: 3.2, z: 3 });
    expect(pose.target).toEqual(focus);
  });

  it("可以指定眼高（站姿 1.6）", () => {
    expectVec3Close(cameraPose(seat, focus, { eyeHeight: 1.6 }).position, { x: 1, y: 3.6, z: 3 });
  });

  it("不共用輸入物件", () => {
    const pose = cameraPose(seat, focus);
    pose.target.x = 99;
    pose.position.x = 99;
    expect(focus.x).toBe(0);
    expect(seat.x).toBe(1);
  });
});
