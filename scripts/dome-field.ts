/**
 * 臺北大巨蛋的球場幾何：本壘、界外桿、中外野與外野牆圓弧。看台怎麼排在 official-layout.ts。
 * 座標同 src/core/schema.ts。
 */
import type { PlanPoint } from "./outline.ts";

export interface Field {
  plate: PlanPoint;
  rightPole: PlanPoint;
  leftPole: PlanPoint;
  centerField: PlanPoint;
  wallCenter: PlanPoint;
  wallRadius: number;
}

const DEG = Math.PI / 180;
const S45 = Math.SQRT1_2;

export function circleThrough(a: PlanPoint, b: PlanPoint, c: PlanPoint): { center: PlanPoint; radius: number } {
  const d = 2 * (a.x * (b.z - c.z) + b.x * (c.z - a.z) + c.x * (a.z - b.z));
  if (Math.abs(d) < 1e-9) throw new Error("三點共線，畫不出圓弧");
  const a2 = a.x ** 2 + a.z ** 2;
  const b2 = b.x ** 2 + b.z ** 2;
  const c2 = c.x ** 2 + c.z ** 2;
  const center = {
    x: (a2 * (b.z - c.z) + b2 * (c.z - a.z) + c2 * (a.z - b.z)) / d,
    z: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d,
  };
  return { center, radius: Math.hypot(a.x - center.x, a.z - center.z) };
}

/** 本壘在 (0, plateZ)，往 −z 是場內；界外桿在本壘到中外野軸線兩側 ±45°。 */
export function fieldGeometry(plateZ: number, foulPole: number, centerField: number): Field {
  const plate = { x: 0, z: plateZ };
  const rightPole = { x: foulPole * S45, z: plateZ - foulPole * S45 };
  const leftPole = { x: -rightPole.x, z: rightPole.z };
  const center = { x: 0, z: plateZ - centerField };
  const wall = circleThrough(leftPole, center, rightPole);
  return { plate, rightPole, leftPole, centerField: center, wallCenter: wall.center, wallRadius: wall.radius };
}

/**
 * 外野牆圓弧兩端的角度（以外野牆圓心量）：右外野桿約 −21°，往中外野（−90°）遞減到左外野桿 = −180° − 右桿。
 * 之前的分析曾寫成 180° − 右桿，弧會繞到本壘那一側。
 */
export function outfieldArcAngles(field: Field): { right: number; left: number } {
  const right = Math.atan2(field.rightPole.z - field.wallCenter.z, field.rightPole.x - field.wallCenter.x) / DEG;
  return { right, left: -180 - right };
}
