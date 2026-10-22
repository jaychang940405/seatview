import { describe, expect, it } from "vitest";
import demoArenaJson from "../venues/demo-arena.json";
import { expectSeatError, expectVec3Close } from "../test/helpers";
import { parseVenue } from "./schema";
import { getSeatView, listSections } from "./view";

// 每個測試各自 parse，避免 parseVenue 失敗時整個檔案一起掛掉
const demo = () => parseVenue(demoArenaJson);

describe("getSeatView", () => {
  it("A1 第 1 排 16 號（演唱會）：位置、相機與指標", () => {
    const view = getSeatView(demo(), "concert", "A1", 1, 16);

    // A1：半徑 30、90° 方向、baseHeight 3；舞台 focus 在 (0, 3, -30)
    expectVec3Close(view.seatPosition, { x: 0, y: 3, z: 30 });
    expectVec3Close(view.camera.position, { x: 0, y: 4.2, z: 30 });
    expectVec3Close(view.camera.target, { x: 0, y: 3, z: -30 });
    expect(view.metrics.horizontalDistance).toBeCloseTo(60);
    expect(view.metrics.heightAboveFocus).toBeCloseTo(1.2);
    expect(view.metrics.distance).toBeCloseTo(Math.hypot(60, 1.2));
    expect(view.metrics.elevationDeg).toBeCloseTo((Math.atan2(1.2, 60) * 180) / Math.PI);
    expect(view.metrics.horizontalDeg).toBeCloseTo(0);
  });

  it("回傳查詢參數，方便 MCP 直接輸出", () => {
    const view = getSeatView(demo(), "concert", "A1", 2, 3);
    expect(view).toMatchObject({ venueId: "demo-arena", layoutId: "concert", sectionId: "A1", row: 2, seat: 3 });
  });

  it("搖滾區比舞台低 → 仰角為負", () => {
    const view = getSeatView(demo(), "concert", "F1", 1, 20);
    expect(view.metrics.heightAboveFocus).toBeCloseTo(1.2 - 3);
    expect(view.metrics.elevationDeg).toBeLessThan(0);
  });

  it("B1 在觀眾右手邊 → 水平偏角為正", () => {
    expect(getSeatView(demo(), "concert", "B1", 1, 1).metrics.horizontalDeg).toBeGreaterThan(0);
  });

  it("看台在 baseball layout 也有，focus 換成本壘", () => {
    const view = getSeatView(demo(), "baseball", "A1", 1, 16);
    expectVec3Close(view.camera.target, { x: 0, y: 1, z: -25 });
    expect(view.metrics.horizontalDistance).toBeCloseTo(55);
  });

  it("F1 只開在演唱會 → baseball 查詢回 SECTION_NOT_IN_LAYOUT", () => {
    expectSeatError(() => getSeatView(demo(), "baseball", "F1", 1, 1), "SECTION_NOT_IN_LAYOUT");
  });

  it.each(["opera", "toString", "__proto__"])("layout = %s → UNKNOWN_LAYOUT", (layoutId) => {
    expectSeatError(() => getSeatView(demo(), layoutId, "A1", 1, 1), "UNKNOWN_LAYOUT");
  });

  it("不存在的區 → UNKNOWN_SECTION", () => {
    expectSeatError(() => getSeatView(demo(), "concert", "Z9", 1, 1), "UNKNOWN_SECTION");
  });

  it("排號超出範圍 → ROW_OUT_OF_RANGE", () => {
    expectSeatError(() => getSeatView(demo(), "concert", "A1", 21, 1), "ROW_OUT_OF_RANGE");
  });
});

describe("listSections", () => {
  it("演唱會開放 A1、B1、F1", () => {
    expect(listSections(demo(), "concert").map((s) => s.id)).toEqual(["A1", "B1", "F1"]);
  });

  it("棒球沒有搖滾區 F1", () => {
    expect(listSections(demo(), "baseball").map((s) => s.id)).toEqual(["A1", "B1"]);
  });

  it("seatsPerRow 一律展開成每排一個數字", () => {
    const a1 = listSections(demo(), "concert").find((s) => s.id === "A1");
    expect(a1).toMatchObject({ id: "A1", name: "A1 區", rows: 20 });
    expect(a1?.seatsPerRow).toEqual(Array(20).fill(31));
  });

  it("不存在的 layout → UNKNOWN_LAYOUT", () => {
    expectSeatError(() => listSections(demo(), "opera"), "UNKNOWN_LAYOUT");
  });
});
