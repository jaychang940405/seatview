import type { SeatView } from "../core/view";

// 資訊列的記分板：三格指標。數字直接取 core 的 metrics，這裡只負責標籤與格式。

export interface ScoreboardCell {
  label: string;
  value: string;
}

/** 第一格的距離標籤：focus 在棒球是本壘、在演唱會是舞台。 */
const DISTANCE_LABEL: Record<string, string> = { baseball: "距離本壘", concert: "距離舞台" };

/** 小數一位；負數用真正的減號（−），記分板字型裡比連字號好認。 */
const fixed = (value: number) => value.toFixed(1).replace("-", "−");

export function scoreboardCells(view: SeatView): ScoreboardCell[] {
  const { distance, elevationDeg, horizontalDeg } = view.metrics;
  // hasOwn：layoutId 是 "toString" 之類時不要拿到原型上的東西
  const distanceLabel = (Object.hasOwn(DISTANCE_LABEL, view.layoutId) && DISTANCE_LABEL[view.layoutId]) || "距離";
  return [
    { label: distanceLabel, value: `${fixed(distance)} m` },
    { label: "俯角", value: `${fixed(elevationDeg)}°` },
    { label: "水平偏角", value: `${fixed(horizontalDeg)}°` },
  ];
}
