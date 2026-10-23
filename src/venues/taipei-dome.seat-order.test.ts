import { describe, expect, it } from "vitest";
import { parseVenue } from "../core/schema.ts";
import { sectionSeats } from "../core/seat.ts";
import taipeiDomeJson from "./taipei-dome.json";

/*
 * 座號方向的「慣例測試」，不是驗證。
 *
 * 這裡記錄我們採用的慣例：面向場地時，內野座號往左增加。
 * 依據只有兩區：本人坐過的 113 區，以及相鄰的 114 區的照片（見 docs/manual-checks.md 的照片佐證）；其餘各區沒有證據。
 * 這不代表官方票區的真實座號方向；模型的區、排、號仍是內部編號，不對應實際票面。
 */

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => String(a + i));
// 內野 = B1 內野 102–124、L2 內野 201–212、214–225（213 不建）
const INFIELD = [...range(102, 124), ...range(201, 212), ...range(214, 225)];
const DEG = Math.PI / 180;

/** 座位朝向 yawDeg 時的左手邊（平面 x 向右、z 向下）。 */
const leftOf = (yawDeg: number) => ({ x: Math.sin(yawDeg * DEG), z: -Math.cos(yawDeg * DEG) });

const dome = () => parseVenue(taipeiDomeJson);

describe("座號方向慣例：面向場地時，內野座號往左增加", () => {
  it("左手邊向量：yaw = −90°（面向 −z）→ (−1, 0)；yaw = 0°（面向 +x）→ (0, −1)", () => {
    expect(leftOf(-90).x).toBeCloseTo(-1);
    expect(leftOf(-90).z).toBeCloseTo(0);
    expect(leftOf(0).x).toBeCloseTo(0);
    expect(leftOf(0).z).toBeCloseTo(-1);
  });

  it.each(INFIELD)("%s：每一排相鄰座位 s → s+1 的位移，在座位左手邊方向的分量 > 0", (sectionId) => {
    const seats = sectionSeats(dome(), sectionId);
    const violations: string[] = [];
    let pairs = 0;
    for (let i = 1; i < seats.length; i++) {
      const a = seats[i - 1];
      const b = seats[i];
      if (!a || !b || a.row !== b.row) continue;
      pairs++;
      const left = leftOf(a.yawDeg);
      const along = (b.position.x - a.position.x) * left.x + (b.position.z - a.position.z) * left.z;
      if (!(along > 0)) violations.push(`第 ${a.row} 排 ${a.seat}→${b.seat} 號：左手邊分量 ${along.toFixed(3)} m`);
    }
    expect(pairs).toBeGreaterThan(0);
    expect(violations.length, violations.slice(0, 3).join("；")).toBe(0);
  });

  it.todo("外野座號方向待查，目前無照片證據");
});
