import { describe, expect, it } from "vitest";
import { circleThrough, fieldGeometry, outfieldArcAngles } from "./dome-field.ts";

// 每個測試各自建立：實作壞掉時各案例各自失敗，不會整個檔案在收集階段就掛掉
const field = () => fieldGeometry(60.95, 102.11, 121.92);

describe("球場幾何", () => {
  it("外野牆圓弧通過兩根界外桿與中外野", () => {
    const f = field();
    for (const p of [f.leftPole, f.centerField, f.rightPole]) {
      expect(Math.hypot(p.x - f.wallCenter.x, p.z - f.wallCenter.z)).toBeCloseTo(f.wallRadius, 9);
    }
  });

  it("三點共線畫不出圓弧 → 丟出錯誤", () => {
    expect(() => circleThrough({ x: 0, z: 0 }, { x: 1, z: 1 }, { x: 2, z: 2 })).toThrow();
  });
});

describe("外野牆圓弧的角度（aL 符號回歸）", () => {
  it("右桿約 −20.9°、左桿 = −180° − 右桿（約 −159.1°），不是 180° − 右桿", () => {
    const { right, left } = outfieldArcAngles(field());
    expect(right).toBeCloseTo(-20.9, 1);
    expect(left).toBeCloseTo(-180 - right, 9);
    expect(left).toBeLessThan(-90); // 寫成 180 − right 會變成約 +200.9°
    expect((right + left) / 2).toBeCloseTo(-90, 9); // 弧的中點就是中外野方向
  });
});
