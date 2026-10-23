import { describe, expect, it } from "vitest";
import { pointInPolygon } from "../../scripts/outline.ts";
import taipeiDomeJson from "../venues/taipei-dome.json";
import type { PlanPoint, Screen, Shell, Vec3 } from "./schema";
import { parseVenue } from "./schema";
import { isScreenOn, roofHeightAt, roofLattice, screenCorners, screenNormal, shellCenter } from "./shell";

/** 半徑 r 的正 n 邊形（近似圓）。 */
const circle = (r: number, n = 360): PlanPoint[] =>
  Array.from({ length: n }, (_, i) => ({ x: r * Math.cos((2 * Math.PI * i) / n), z: r * Math.sin((2 * Math.PI * i) / n) }));

const ROUND: Shell = { outline: circle(100), wallHeight: 38, roofHeight: 72 };
const domeShell = (): Shell => {
  const shell = parseVenue(taipeiDomeJson).shell;
  if (!shell) throw new Error("taipei-dome 沒有 shell");
  return shell;
};

describe("roofHeightAt：屋頂高度（拋物面，C 級外形）", () => {
  it("中心 = 屋頂最高點；輪廓上 = 牆頂", () => {
    expect(roofHeightAt(ROUND, shellCenter(ROUND))).toBeCloseTo(72, 6);
    for (const p of circle(100, 12)) expect(roofHeightAt(ROUND, p)).toBeCloseTo(38, 3);
  });

  it("從中心往外單調下降（拋物面：半徑一半的地方 = 牆頂 + 3/4 × 拱高）", () => {
    const heights = [0, 25, 50, 75, 100].map((r) => roofHeightAt(ROUND, { x: r, z: 0 }));
    for (let i = 1; i < heights.length; i++) expect(heights[i]).toBeLessThan(heights[i - 1] ?? Infinity);
    expect(roofHeightAt(ROUND, { x: 50, z: 0 })).toBeCloseTo(38 + 0.75 * 34, 2);
  });

  it("中心是輪廓的面積形心：偏心的輪廓也一樣", () => {
    const shifted: Shell = { ...ROUND, outline: circle(100).map((p) => ({ x: p.x + 30, z: p.z - 10 })) };
    const center = shellCenter(shifted);
    expect(center.x).toBeCloseTo(30, 6);
    expect(center.z).toBeCloseTo(-10, 6);
    expect(roofHeightAt(shifted, center)).toBeCloseTo(72, 6);
  });

  it("大巨蛋：最高點 72 m（室內淨高，B）、牆頂 38 m（C）", () => {
    const shell = domeShell();
    expect(roofHeightAt(shell, shellCenter(shell))).toBeCloseTo(72, 6);
    for (const p of shell.outline.filter((_, i) => i % 15 === 0)) expect(roofHeightAt(shell, p)).toBeCloseTo(38, 2);
  });
});

describe("roofLattice：屋頂的菱形格柵線", () => {
  it("每個頂點都在殼面上（高度 = roofHeightAt）、在底面輪廓內", () => {
    const shell = domeShell();
    const lines = roofLattice(shell, 6);
    expect(lines.length).toBeGreaterThan(20);
    for (const line of lines) {
      expect(line.length).toBeGreaterThanOrEqual(2);
      for (const p of line) {
        expect(Math.abs(p.y - roofHeightAt(shell, p))).toBeLessThan(1e-9);
        expect(pointInPolygon(shell.outline, p)).toBe(true);
      }
    }
  });

  it("兩組平行線（平面上 ±45°），同一組相鄰兩條相距 = 間距", () => {
    const lines = roofLattice(ROUND, 6);
    // 平面方向：(1, 1) 或 (1, −1)；用 x − z 或 x + z 當作每條線的「位置」
    const offsets = (sign: 1 | -1) =>
      [...new Set(lines.filter((l) => {
        const [a, b] = [l[0], l.at(-1)];
        return a && b && Math.sign((b.x - a.x) * (b.z - a.z)) === sign;
      }).map((l) => Math.round(((l[0]?.x ?? 0) - sign * (l[0]?.z ?? 0)) * 1000) / 1000))].sort((p, q) => p - q);
    for (const sign of [1, -1] as const) {
      const list = offsets(sign);
      expect(list.length, `方向 ${sign}`).toBeGreaterThan(10);
      // 位置先四捨五入到 mm 才去重，所以比到 cm
      for (let i = 1; i < list.length; i++) expect((list[i] ?? 0) - (list[i - 1] ?? 0)).toBeCloseTo(6 * Math.SQRT2, 2);
    }
  });
});

describe("螢幕：screenCorners / screenNormal / isScreenOn", () => {
  const screen: Screen = { id: "s", center: { x: 0, y: 24.5, z: -90 }, width: 28, height: 9, facingYawDeg: 90 };
  const sub = (a: Vec3, b: Vec3) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
  const length = (v: Vec3) => Math.hypot(v.x, v.y, v.z);

  it("四個角依序是左下、右下、右上、左上（從正面看）：寬 28 m、高 9 m、中心不變", () => {
    const [bl, br, tr, tl] = screenCorners(screen);
    if (!bl || !br || !tr || !tl) throw new Error("角不足 4 個");
    expect(length(sub(br, bl))).toBeCloseTo(28, 9);
    expect(length(sub(tl, bl))).toBeCloseTo(9, 9);
    expect(bl.y).toBeCloseTo(20, 9);
    expect(tl.y).toBeCloseTo(29, 9);
    expect((bl.x + tr.x) / 2).toBeCloseTo(0, 9);
    expect((bl.z + tr.z) / 2).toBeCloseTo(-90, 9);
  });

  it("法向量 = facingYawDeg 的方向（90° → +z），而且垂直於螢幕面；從正面看右下角在左下角的右手邊", () => {
    const n = screenNormal(screen);
    expect(n.x).toBeCloseTo(0, 9);
    expect(n.z).toBeCloseTo(1, 9);
    const [bl, br, , tl] = screenCorners(screen);
    if (!bl || !br || !tl) throw new Error("角不足");
    const across = sub(br, bl);
    expect(across.x * n.x + across.z * n.z).toBeCloseTo(0, 9);
    expect(sub(tl, bl).x * n.x + sub(tl, bl).z * n.z).toBeCloseTo(0, 9);
    // 面向 +z 的螢幕，觀眾面向 −z，觀眾的右手邊是 −x：右下角的 x 比較小
    expect(br.x).toBeLessThan(bl.x);
  });

  it("isScreenOn：沒寫 onLayouts 就每個 layout 都亮；有寫只在列出的 layout 亮", () => {
    expect(isScreenOn(screen, "concert")).toBe(true);
    expect(isScreenOn({ ...screen, onLayouts: ["baseball"] }, "baseball")).toBe(true);
    expect(isScreenOn({ ...screen, onLayouts: ["baseball"] }, "concert")).toBe(false);
  });
});
