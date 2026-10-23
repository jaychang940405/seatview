import { describe, expect, it } from "vitest";
import { expectSeatError, expectVec3Close } from "../test/helpers";
import type { ArcSection, LinearSection, Venue } from "./schema";
import { cameraPose, seatPosition, sectionSeats } from "./seat";

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

describe("seatPosition — rowSpans（每排只用一段範圍）", () => {
  const spanned: Venue = {
    ...venue,
    sections: [
      // from x = −10 到 10（20 m）：第 1 排用 25%–75%（x = −5…5，20 席），第 2 排用 0–25%（x = −10…−5，10 席）
      { ...line, id: "SPAN", rows: 2, seatsPerRow: [20, 10], rowSpans: [[0.25, 0.75], [0, 0.25]] },
      // 60° → 120° 的後半（90°–120°），10 席
      { ...arc, id: "ARC_SPAN", rows: 1, seatsPerRow: 10, rowSpans: [[0.5, 1]] },
    ],
  };

  it("linear：第 1 排的座位只排在 x = −5…5（1 號 −4.75、20 號 4.75）", () => {
    expectVec3Close(seatPosition(spanned, "SPAN", 1, 1), { x: -4.75, y: 0, z: 15 });
    expectVec3Close(seatPosition(spanned, "SPAN", 1, 20), { x: 4.75, y: 0, z: 15 });
  });

  it("linear：第 2 排只排在 x = −10…−5（1 號 −9.75、10 號 −5.25）", () => {
    expectVec3Close(seatPosition(spanned, "SPAN", 2, 1), { x: -9.75, y: 0.5, z: 16 });
    expectVec3Close(seatPosition(spanned, "SPAN", 2, 10), { x: -5.25, y: 0.5, z: 16 });
  });

  it("arc：範圍換算成角度，1 號在 91.5°（= 60° + 60° × (0.5 + 0.05 × 0.5)）", () => {
    const p = seatPosition(spanned, "ARC_SPAN", 1, 1);
    const deg = (Math.atan2(p.z, p.x) * 180) / Math.PI;
    expect(deg).toBeCloseTo(91.5, 6);
    expect(Math.hypot(p.x, p.z)).toBeCloseTo(20, 6);
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

describe("sectionSeats", () => {
  it("依排、號排序，總數 = 各排座位數加總", () => {
    const seats = sectionSeats(venue, "ARC");
    expect(seats).toHaveLength(10 * 31);
    expect(seats[0]).toMatchObject({ row: 1, seat: 1 });
    expect(seats[30]).toMatchObject({ row: 1, seat: 31 });
    expect(seats[31]).toMatchObject({ row: 2, seat: 1 });
    expect(seats.at(-1)).toMatchObject({ row: 10, seat: 31 });
    expect(sectionSeats(venue, "VARIED")).toHaveLength(10 + 12 + 14);
  });

  it("每個座位的位置都等於 seatPosition", () => {
    for (const id of ["ARC", "LINE", "VARIED"]) {
      for (const placement of sectionSeats(venue, id)) {
        expectVec3Close(placement.position, seatPosition(venue, id, placement.row, placement.seat));
      }
    }
  });

  it("arc：90° 方向的座位面向圓心（-z）→ -90°", () => {
    const middle = sectionSeats(venue, "ARC").find((p) => p.row === 1 && p.seat === 16);
    expect(middle?.yawDeg).toBeCloseTo(-90);
  });

  it("arc：每個座位都面向圓心", () => {
    for (const { position, yawDeg } of sectionSeats(venue, "ARC")) {
      const rad = (yawDeg * Math.PI) / 180;
      const toCenter = Math.atan2(arc.center.z - position.z, arc.center.x - position.x);
      expect(Math.cos(rad - toCenter)).toBeCloseTo(1);
    }
  });

  it("linear：面向 facing 那一側", () => {
    // LINE 的 facing 在 -z 側，LINE_BACK 在 +z 側
    for (const p of sectionSeats(venue, "LINE")) expect(p.yawDeg).toBeCloseTo(-90);
    for (const p of sectionSeats(venue, "LINE_BACK")) expect(p.yawDeg).toBeCloseTo(90);
  });

  it("yawDeg 落在 (-180, 180]", () => {
    for (const p of sectionSeats(venue, "ARC_REV")) {
      expect(p.yawDeg).toBeGreaterThan(-180);
      expect(p.yawDeg).toBeLessThanOrEqual(180);
    }
  });

  it("不存在的區 → UNKNOWN_SECTION", () => {
    expectSeatError(() => sectionSeats(venue, "NOPE"), "UNKNOWN_SECTION");
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
