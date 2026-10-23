import { describe, expect, it } from "vitest";
import {
  areaCentroid,
  fitInscribedSuperellipse,
  insetConvexPolygon,
  pointInPolygon,
  radialChecker,
  signedDistance,
  superellipsePolygon,
  superellipseRadius,
  type Superellipse,
} from "./outline.ts";

const ellipse: Superellipse = { center: { x: 10, z: -5 }, semiAxisX: 80, semiAxisZ: 100, exponent: 2, rotationDeg: 0 };
const square = [
  { x: 0, z: 0 },
  { x: 10, z: 0 },
  { x: 10, z: 10 },
  { x: 0, z: 10 },
];

describe("superellipse", () => {
  it("沿兩個軸的半徑就是兩個半軸", () => {
    expect(superellipseRadius(ellipse, 0)).toBeCloseTo(80);
    expect(superellipseRadius(ellipse, 90)).toBeCloseTo(100);
    expect(superellipseRadius(ellipse, 180)).toBeCloseTo(80);
  });

  it("旋轉後半軸跟著轉", () => {
    expect(superellipseRadius({ ...ellipse, rotationDeg: 90 }, 90)).toBeCloseTo(80);
  });

  it("指數越大越接近矩形：對角方向半徑變大", () => {
    const n2 = superellipseRadius(ellipse, 45);
    const n4 = superellipseRadius({ ...ellipse, exponent: 4 }, 45);
    expect(n4).toBeGreaterThan(n2);
  });

  it("多邊形頂點都在曲線上、圍出的範圍包含中心", () => {
    const polygon = superellipsePolygon(ellipse, 10);
    expect(polygon).toHaveLength(36);
    expect(pointInPolygon(polygon, ellipse.center)).toBe(true);
    for (const p of polygon) {
      const r = Math.hypot(p.x - ellipse.center.x, p.z - ellipse.center.z);
      const deg = (Math.atan2(p.z - ellipse.center.z, p.x - ellipse.center.x) * 180) / Math.PI;
      expect(r).toBeCloseTo(superellipseRadius(ellipse, deg));
    }
  });
});

describe("多邊形", () => {
  it("內外判斷與有號距離", () => {
    expect(pointInPolygon(square, { x: 5, z: 5 })).toBe(true);
    expect(pointInPolygon(square, { x: 15, z: 5 })).toBe(false);
    expect(signedDistance(square, { x: 5, z: 2 })).toBeCloseTo(2);
    expect(signedDistance(square, { x: 13, z: 5 })).toBeCloseTo(-3);
  });

  it("面積形心不受頂點分布影響", () => {
    // 同一個正方形，在一條邊上多塞頂點：頂點平均會偏，面積形心不會
    const dense = [{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 4, z: 0 }, { x: 6, z: 0 }, { x: 8, z: 0 }, ...square.slice(1)];
    expect(areaCentroid(dense)).toEqual({ x: 5, z: 5 });
  });

  it("內縮後每個頂點離原邊界都是 margin", () => {
    const inner = insetConvexPolygon(square, 1);
    expect(inner).toHaveLength(4);
    for (const p of inner) expect(signedDistance(square, p)).toBeCloseTo(1);
  });

  it("徑向查表判斷跟逐邊判斷一致（離邊界 > 1 cm 的點）", () => {
    const polygon = superellipsePolygon({ ...ellipse, exponent: 2.5, rotationDeg: 6 }, 1);
    const inside = radialChecker(polygon, ellipse.center);
    for (let i = 0; i < 2000; i++) {
      const p = { x: ellipse.center.x + ((i * 37) % 220) - 110, z: ellipse.center.z + ((i * 53) % 240) - 120 };
      if (Math.abs(signedDistance(polygon, p)) < 0.01) continue;
      expect(inside(p)).toBe(pointInPolygon(polygon, p));
    }
  });
});

describe("fitInscribedSuperellipse", () => {
  it("資料本身就是超橢圓時，找回接近的參數、差距趨近 0", () => {
    const truth: Superellipse = { center: { x: 0, z: 0 }, semiAxisX: 80, semiAxisZ: 102, exponent: 2.5, rotationDeg: 4 };
    const radii = Array.from({ length: 360 }, (_, deg) => ({ deg, r: superellipseRadius(truth, deg) }));
    const { shape, maxGap } = fitInscribedSuperellipse(radii, truth.center);
    expect(maxGap).toBeLessThan(0.5);
    expect(shape.semiAxisX).toBeCloseTo(80, 0);
    expect(shape.semiAxisZ).toBeCloseTo(102, 0);
  });

  it("結果一定內接：每個方向都不超出真實邊界", () => {
    const radii = Array.from({ length: 360 }, (_, deg) => ({ deg, r: 90 + 8 * Math.cos((deg * 4 * Math.PI) / 180) }));
    const { shape } = fitInscribedSuperellipse(radii, { x: 0, z: 0 });
    for (const { deg, r } of radii) expect(superellipseRadius(shape, deg)).toBeLessThanOrEqual(r + 1e-9);
  });
});
