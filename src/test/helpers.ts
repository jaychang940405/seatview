import { expect } from "vitest";
import { SeatViewError, type SeatViewErrorCode } from "../core/errors";
import type { Vec3 } from "../core/schema";

/** 斷言 fn 丟出指定 code 的 SeatViewError（其他錯誤都算失敗）。 */
export function expectSeatError(fn: () => unknown, code: SeatViewErrorCode): void {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(SeatViewError);
  expect((caught as SeatViewError).code).toBe(code);
}

export function expectVec3Close(actual: Vec3, expected: Vec3, digits = 6): void {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
  expect(actual.z).toBeCloseTo(expected.z, digits);
}
