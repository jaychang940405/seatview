import { SeatViewError } from "./core/errors";
import { parseVenue } from "./core/schema";
import { getSeatView } from "./core/view";
import { createViewer } from "./render/viewer";
import { parseSeatQuery } from "./ui/query";
import demoArenaJson from "./venues/demo-arena.json";

// 開發用入口：正式 UI 完成前，用網址參數指定座位，例如
// ?layout=concert&section=A1&row=1&seat=16&mode=overview

const app = document.querySelector<HTMLDivElement>("#app");
const info = document.querySelector<HTMLDivElement>("#info");
if (!app || !info) throw new Error("index.html 缺少 #app 或 #info");

const venue = parseVenue(demoArenaJson);
const query = parseSeatQuery(location.search);
const viewer = createViewer(app);

try {
  viewer.showVenue(venue, query.layoutId);
  const view = getSeatView(venue, query.layoutId, query.sectionId, query.row, query.seat);
  viewer.showSeat(view);
  viewer.setMode(query.mode);
  const { distance, elevationDeg, horizontalDeg } = view.metrics;
  info.textContent =
    `${venue.name}｜${query.layoutId}｜${view.sectionId} 區第 ${view.row} 排 ${view.seat} 號｜` +
    `距離 ${distance.toFixed(1)} m｜俯角 ${elevationDeg.toFixed(1)}°｜水平偏角 ${horizontalDeg.toFixed(1)}°`;
} catch (error) {
  if (!(error instanceof SeatViewError)) throw error;
  viewer.setMode("overview");
  info.textContent = `${error.code}：${error.message}`;
}
