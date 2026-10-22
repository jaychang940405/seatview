import { SeatViewError } from "./core/errors";
import { parseVenue } from "./core/schema";
import { findLayout, getSeatView } from "./core/view";
import { createViewer } from "./render/viewer";
import { parseSeatQuery } from "./ui/query";
import demoArenaJson from "./venues/demo-arena.json";
import taipeiDomeJson from "./venues/taipei-dome.json";

// 開發用入口：正式 UI 完成前，用網址參數指定座位，例如
// ?venue=taipei-dome&layout=baseball&section=I1-HP&row=1&seat=91&mode=overview

const VENUES: Record<string, unknown> = {
  "demo-arena": demoArenaJson,
  "taipei-dome": taipeiDomeJson,
};

const app = document.querySelector<HTMLDivElement>("#app");
const info = document.querySelector<HTMLDivElement>("#info");
if (!app || !info) throw new Error("index.html 缺少 #app 或 #info");

const query = parseSeatQuery(location.search);
const venueJson = Object.hasOwn(VENUES, query.venueId) ? VENUES[query.venueId] : undefined;

if (venueJson === undefined) {
  info.textContent = `沒有 ${query.venueId} 這個場館（可用：${Object.keys(VENUES).join("、")}）`;
} else {
  const venue = parseVenue(venueJson);
  const viewer = createViewer(app);
  // 近似模型一定要讓使用者看到免責聲明，避免把 C 級估算當成事實
  const disclaimer = venue.meta ? `\n${venue.meta.disclaimer}` : "";

  try {
    viewer.showVenue(venue, query.layoutId);
    const view = getSeatView(venue, query.layoutId, query.sectionId, query.row, query.seat);
    viewer.showSeat(view);
    viewer.setMode(query.mode);
    const sectionName = venue.sections.find((s) => s.id === view.sectionId)?.name;
    const { distance, elevationDeg, horizontalDeg } = view.metrics;
    info.textContent =
      `${venue.name}｜${findLayout(venue, query.layoutId).name}｜` +
      `${view.sectionId}${sectionName ? `（${sectionName}）` : ""} 第 ${view.row} 排 ${view.seat} 號｜` +
      `距離 ${distance.toFixed(1)} m｜俯角 ${elevationDeg.toFixed(1)}°｜水平偏角 ${horizontalDeg.toFixed(1)}°` +
      disclaimer;
  } catch (error) {
    if (!(error instanceof SeatViewError)) throw error;
    viewer.setMode("overview");
    info.textContent = `${error.code}：${error.message}${disclaimer}`;
  }
}
