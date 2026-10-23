import { describe, expect, it } from "vitest";
import { parseVenue } from "../src/core/schema.ts";
import { sectionSeats } from "../src/core/seat.ts";
import {
  areaSeatEstimate,
  buildStands,
  fieldGeometry,
  fitLayout,
  homeArcFits,
  maxLineLength,
  outfieldArcAngles,
  outfieldRowsFit,
  sectionSeatCount,
  type LayoutParams,
  type StandSection,
} from "./dome-layout.ts";
import { insetConvexPolygon, radialChecker, superellipsePolygon, type Superellipse } from "./outline.ts";

// 每個測試各自建立：實作壞掉時各案例各自失敗，不會整個檔案在收集階段就掛掉
const field = () => fieldGeometry(60.95, 102.11, 121.92);

const params: LayoutParams = {
  foulOffset: 18.3,
  rowDepth: 0.85,
  pitch: 0.5,
  lower: { rows: 30, lineLength: 49.5, rowRise: 0.35, baseHeight: 3 },
  upper: { startRow: 15, rows: 15, lineLength: 49.5, rowRise: 0.5, headroom: 2.5 },
  outfield: { clearance: 3, insetDeg: 8, sideRows: 8, centerRows: 30, rowRise: 0.35, baseHeight: 3 },
};

/** 用 core 把看台變成真正的座位（跟 App 與 MCP 用的是同一套算式）。 */
function seatsOf(stands: StandSection[]) {
  const venue = parseVenue({
    schemaVersion: 1,
    id: "layout-test",
    name: "layout-test",
    sections: stands,
    layouts: { baseball: { name: "棒球", focus: { position: { x: 0, y: 0.8, z: 60.95 }, facingDeg: 90 } } },
  });
  return venue.sections.flatMap((s) => sectionSeats(venue, s.id).map((p) => ({ id: s.id, ...p.position })));
}

/** 外框放在 center、內縮 margin 後的快速判斷。 */
function insideOf(shape: Omit<Superellipse, "center">, center: { x: number; z: number }, margin: number) {
  const polygon = insetConvexPolygon(superellipsePolygon({ ...shape, center }, 1), margin);
  return radialChecker(polygon, center);
}

describe("外野牆圓弧的角度（aL 符號回歸）", () => {
  it("右桿約 −20.9°、左桿 = −180° − 右桿（約 −159.1°），不是 180° − 右桿", () => {
    const { right, left } = outfieldArcAngles(field());
    expect(right).toBeCloseTo(-20.9, 1);
    expect(left).toBeCloseTo(-180 - right, 9);
    expect(left).toBeLessThan(-90); // 寫成 180 − right 會變成約 +200.9°
    expect((right + left) / 2).toBeCloseTo(-90, 9); // 弧的中點就是中外野方向
  });

  it("外野看台的座位全部在外野牆外側、中外野那一邊；右外野在 +x、左外野在 −x", () => {
    const seats = seatsOf(buildStands(field(), params)).filter((s) => s.id.startsWith("O1"));
    expect(seats.length).toBeGreaterThan(0);
    for (const s of seats) {
      expect(s.z).toBeLessThan(field().wallCenter.z);
      expect(Math.hypot(s.x - field().wallCenter.x, s.z - field().wallCenter.z)).toBeGreaterThanOrEqual(
        field().wallRadius + params.outfield.clearance - 1e-6,
      );
    }
    for (const s of seats.filter((q) => q.id === "O1-RF")) expect(s.x).toBeGreaterThan(0);
    for (const s of seats.filter((q) => q.id === "O1-LF")) expect(s.x).toBeLessThan(0);
  });
});

describe("左右對稱", () => {
  const symmetric = { semiAxisX: 80, semiAxisZ: 102, exponent: 2.5, rotationDeg: 0 };
  const center = { x: 0, z: 7 };

  it("外框左右對稱時，一三壘兩側直線看台的最大長度相等、本壘後方弧的判斷不受影響", () => {
    const inside = insideOf(symmetric, center, 3);
    for (let back = 18.3; back < 50; back += 0.85 * 4) {
      expect(maxLineLength(field(), inside, back, 1, 95), `back ${back}`).toBe(maxLineLength(field(), inside, back, -1, 95));
    }
    expect(homeArcFits(field(), inside, 30)).toBe(true);
  });

  it("外框左右對稱時，外野左右兩區能放的排數相等", () => {
    const inside = insideOf(symmetric, center, 3);
    for (const inset of [0, 4, 8, 12]) {
      const rows = outfieldRowsFit(field(), inside, 3, 0.85, inset, 30);
      expect(rows.right, `inset ${inset}`).toBe(rows.left);
    }
  });

  it("外框旋轉 +θ 與 −θ 時，左右結果互換", () => {
    const plus = insideOf({ ...symmetric, rotationDeg: 6 }, center, 3);
    const minus = insideOf({ ...symmetric, rotationDeg: -6 }, center, 3);
    for (let back = 18.3; back < 50; back += 0.85 * 4) {
      expect(maxLineLength(field(), plus, back, 1, 95)).toBe(maxLineLength(field(), minus, back, -1, 95));
    }
    const a = outfieldRowsFit(field(), plus, 3, 0.85, 8, 30);
    const b = outfieldRowsFit(field(), minus, 3, 0.85, 8, 30);
    expect([a.right, a.center, a.left]).toEqual([b.left, b.center, b.right]);
  });

  it("外框左右對稱時，擬合出的外框中心在中線上（x = 0）", () => {
    const result = fitLayout(field(), symmetric, params, {
      margin: 3,
      anchors: { lower: 17000, upper: 4700 },
      tolerance: 0.1,
      maxLowerRows: 30,
      minOutfieldRows: 6,
      plateRange: [50, 58],
      lateralRange: [-2, 2],
      insetOptions: [8],
      lineCap: 95,
    });
    expect(result).not.toBeNull();
    expect(result?.outlineCenter.x).toBe(0);
  });
});

describe("座位數：兩種算法互相驗證", () => {
  it("每區：逐排取整加總 ≤ 面積估算，且差距 < 2%", () => {
    const stands = buildStands(field(), params);
    for (const section of stands) {
      const discrete = sectionSeatCount(section);
      const area = areaSeatEstimate(section, params.pitch);
      expect(discrete, section.id).toBeLessThanOrEqual(area);
      expect((area - discrete) / area, section.id).toBeLessThan(0.02);
    }
  });

  it("逐排加總 = core 實際列出來的座位數", () => {
    const stands = buildStands(field(), params);
    const seats = seatsOf(stands);
    for (const section of stands) {
      expect(seats.filter((s) => s.id === section.id).length, section.id).toBe(sectionSeatCount(section));
    }
  });
});
