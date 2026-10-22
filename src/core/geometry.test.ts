import { describe, expect, it } from "vitest";
import { distance, elevationAngle, horizontalAngle, horizontalDistance } from "./geometry";
import type { Focus } from "./schema";

const origin = { x: 0, y: 0, z: 0 };

describe("distance", () => {
  it("3-4-5 三角形", () => {
    expect(distance(origin, { x: 3, y: 0, z: 4 })).toBeCloseTo(5);
  });

  it("包含高度差", () => {
    expect(distance(origin, { x: 0, y: 12, z: 5 })).toBeCloseTo(13);
  });

  it("同一點為 0", () => {
    expect(distance({ x: 1, y: 2, z: 3 }, { x: 1, y: 2, z: 3 })).toBe(0);
  });
});

describe("horizontalDistance", () => {
  it("忽略高度", () => {
    expect(horizontalDistance({ x: 0, y: 100, z: 0 }, { x: 3, y: 0, z: 4 })).toBeCloseTo(5);
  });
});

describe("elevationAngle", () => {
  it("比目標高 → 正值（往下看）", () => {
    expect(elevationAngle({ x: 0, y: 10, z: 10 }, origin)).toBeCloseTo(45);
  });

  it("比目標低 → 負值（往上看）", () => {
    expect(elevationAngle({ x: 0, y: 0, z: 10 }, { x: 0, y: 10, z: 0 })).toBeCloseTo(-45);
  });

  it("同高 → 0", () => {
    expect(elevationAngle({ x: 5, y: 2, z: 5 }, { x: 0, y: 2, z: 0 })).toBeCloseTo(0);
  });
});

describe("horizontalAngle", () => {
  // 舞台在原點、正面朝 +z（平面圖上朝下）；觀眾在 +z 那側、面向 -z
  const stage: Focus = { position: origin, facingDeg: 90 };

  it("正前方 → 0", () => {
    expect(horizontalAngle({ x: 0, y: 3, z: 10 }, stage)).toBeCloseTo(0);
  });

  it("觀眾的右手邊（+x）→ 正值", () => {
    expect(horizontalAngle({ x: 10, y: 3, z: 10 }, stage)).toBeCloseTo(45);
  });

  it("觀眾的左手邊（-x）→ 負值", () => {
    expect(horizontalAngle({ x: -10, y: 3, z: 10 }, stage)).toBeCloseTo(-45);
  });

  it("正側面 → 90", () => {
    expect(horizontalAngle({ x: 10, y: 3, z: 0 }, stage)).toBeCloseTo(90);
  });

  it("舞台正後方 → 180", () => {
    expect(horizontalAngle({ x: 0, y: 3, z: -10 }, stage)).toBeCloseTo(180);
  });

  it("在 focus 正上方 → 0，不是 NaN", () => {
    expect(horizontalAngle({ x: 0, y: 10, z: 0 }, stage)).toBe(0);
  });

  it("facingDeg 超過 360 時等同取餘數", () => {
    expect(horizontalAngle({ x: 10, y: 3, z: 10 }, { position: origin, facingDeg: 450 })).toBeCloseTo(45);
  });

  it("舞台朝 +x 時，z 較大的一側是觀眾左手邊", () => {
    // 觀眾在 +x 側面向 -x，右手邊是 -z
    expect(horizontalAngle({ x: 10, y: 0, z: 10 }, { position: origin, facingDeg: 0 })).toBeCloseTo(-45);
  });

  it("結果一律落在 (-180, 180]", () => {
    for (const facingDeg of [0, 45, 90, 180, 270, 359, -90]) {
      for (let deg = 0; deg < 360; deg += 15) {
        const rad = (deg * Math.PI) / 180;
        const eye = { x: 10 * Math.cos(rad), y: 0, z: 10 * Math.sin(rad) };
        const angle = horizontalAngle(eye, { position: origin, facingDeg });
        expect(angle).toBeGreaterThan(-180);
        expect(angle).toBeLessThanOrEqual(180);
      }
    }
  });
});
