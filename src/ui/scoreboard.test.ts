import { describe, expect, it } from "vitest";
import { parseVenue } from "../core/schema";
import { getSeatView } from "../core/view";
import taipeiDomeJson from "../venues/taipei-dome.json";
import { scoreboardCells } from "./scoreboard";

const dome = () => parseVenue(taipeiDomeJson);

describe("scoreboardCells：記分板資訊列的三格", () => {
  it("棒球：距離本壘、俯角、水平偏角，取到小數一位、附單位；數字跟 core 的 metrics 一致", () => {
    const view = getSeatView(dome(), "baseball", "113", 38, 7);
    expect(scoreboardCells(view)).toEqual([
      { label: "距離本壘", value: `${view.metrics.distance.toFixed(1)} m` },
      { label: "俯角", value: `${view.metrics.elevationDeg.toFixed(1)}°` },
      { label: "水平偏角", value: `${view.metrics.horizontalDeg.toFixed(1).replace("-", "−")}°` },
    ]);
  });

  it("演唱會：第一格是距離舞台", () => {
    expect(scoreboardCells(getSeatView(dome(), "concert", "201", 15, 15))[0]?.label).toBe("距離舞台");
  });

  it("負數用真正的減號（−），記分板字型裡比連字號好認", () => {
    const view = getSeatView(dome(), "baseball", "113", 38, 7);
    expect(view.metrics.horizontalDeg).toBeLessThan(0);
    expect(scoreboardCells(view)[2]?.value.startsWith("−")).toBe(true);
  });

  it("其他 layout：第一格只寫距離", () => {
    const view = { ...getSeatView(dome(), "baseball", "113", 38, 7), layoutId: "opera" };
    expect(scoreboardCells(view)[0]?.label).toBe("距離");
  });
});
