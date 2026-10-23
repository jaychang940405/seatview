import { describe, expect, it } from "vitest";
import { centeredSpan, splitByMinWidth } from "./official-layout.ts";

describe("splitByMinWidth：依最小寬度切分（注水法）", () => {
  it("沒有最小寬度的區平分；有標籤要求的區至少拿到它的最小寬度；總長不變、首尾相接", () => {
    const parts = splitByMinWidth(["a", "b", "c", "d"], 40, { c: 13.25 });
    expect(parts.c?.[1]! - parts.c?.[0]!).toBeCloseTo(13.25, 9);
    for (const id of ["a", "b", "d"]) expect(parts[id]?.[1]! - parts[id]?.[0]!).toBeCloseTo((40 - 13.25) / 3, 9);
    expect(parts.a?.[0]).toBe(0);
    expect(parts.d?.[1]).toBeCloseTo(40, 9);
    expect(parts.b?.[0]).toBeCloseTo(parts.a?.[1]!, 9);
  });

  it("最小寬度比平均分還小時不影響（大家一樣寬）", () => {
    const parts = splitByMinWidth(["a", "b"], 20, { a: 3 });
    expect(parts.a?.[1]).toBeCloseTo(10, 9);
  });

  it("最小寬度加起來放不下 → 丟出錯誤，不偷偷縮小", () => {
    expect(() => splitByMinWidth(["a", "b"], 10, { a: 6, b: 6 })).toThrow();
  });
});

describe("centeredSpan：一排可用的長度裡放幾席、放在哪", () => {
  it("7.75 m 放 15 席（0.5 m 間距），佔 7.5 m、置中（兩邊各留 0.125 m）", () => {
    const { seats, span } = centeredSpan([10, 17.75], 0.5);
    expect(seats).toBe(15);
    expect(span[0]).toBeCloseTo(10.125, 9);
    expect(span[1]).toBeCloseTo(17.625, 9);
  });

  it("不到一席寬 → 0 席", () => {
    expect(centeredSpan([0, 0.49], 0.5).seats).toBe(0);
  });

  it("剛好整數席時不會因為浮點誤差少一席", () => {
    expect(centeredSpan([0, 0.1 + 0.2 + 2.7], 0.5).seats).toBe(6);
  });
});
