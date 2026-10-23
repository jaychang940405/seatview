import { SeatViewError } from "./core/errors";
import { parseVenue } from "./core/schema";
import { findLayout, getSeatView } from "./core/view";
import { isFacingFocus, LOOK_AHEAD, ZOOM_PRESETS, zoomNote, type Look } from "./render/look";
import { createViewer } from "./render/viewer";
import { buildMinimapModel } from "./ui/minimap";
import { createMinimap } from "./ui/minimapView";
import { createPanel } from "./ui/panel";
import { parseSeatQuery } from "./ui/query";
import { applyChange, normalize, panelOptions, toSearch, type Change, type ChangeResult, type Selection } from "./ui/selection";
import demoArenaJson from "./venues/demo-arena.json";
import taipeiDomeJson from "./venues/taipei-dome.json";

// 入口：面板選位，網址參數同步（例如 ?venue=taipei-dome&layout=baseball&section=I1-HP&row=1&seat=29）。
// 只有座位視角；鳥瞰是隱藏的除錯模式 ?debug=overview。

// 順序就是場館下拉選單的順序
const VENUES = [parseVenue(demoArenaJson), parseVenue(taipeiDomeJson)];

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`index.html 缺少 ${selector}`);
  return element;
}

const app = required<HTMLDivElement>("#app");
const info = required<HTMLDivElement>("#info");
const form = required<HTMLFormElement>("#panel");
const layoutSwitch = required<HTMLDivElement>("#layout-switch");
const viewTools = required<HTMLDivElement>("#view-tools");
const viewHint = required<HTMLSpanElement>("#view-hint");
const resetView = required<HTMLButtonElement>("#reset-view");
const zoomButtons = ZOOM_PRESETS.map((preset) => {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = preset.label;
  button.addEventListener("click", () => viewer.setZoom(preset.zoom));
  return button;
});
required<HTMLDivElement>("#zoom-presets").append(...zoomButtons);

const viewer = createViewer(app);
const onChange = (change: Change) => show(applyChange(VENUES, selection, change));
const panel = createPanel({ form, layoutSwitch }, onChange);
const minimap = createMinimap(required<HTMLDivElement>("#minimap"), onChange);

let selection: Selection;
let sceneKey = "";
/** 目前場景裡最後一個成功顯示的座位；查詢失敗時相機停在這裡 */
let shownSeat: string | null = null;
let look: Look = LOOK_AHEAD;

resetView.addEventListener("click", () => viewer.resetLook());
viewer.onLookChange((next) => {
  look = next;
  updateViewTools();
});

/** 座位視角才顯示：倍數按鈕、目前倍數（以人眼為基準的說明）；轉頭後才出現「回正」。 */
function updateViewTools(): void {
  viewTools.hidden = selection.mode !== "seat" || shownSeat === null;
  resetView.hidden = isFacingFocus(look);
  ZOOM_PRESETS.forEach((preset, i) => zoomButtons[i]?.setAttribute("aria-pressed", String(Math.abs(look.zoom - preset.zoom) < 0.01)));
  viewHint.textContent = `${look.zoom.toFixed(1)}×・${zoomNote(look.zoom)}｜拖曳轉頭、滾輪或兩指縮放`;
}

function show({ selection: next, notices }: ChangeResult): void {
  selection = next;
  const venue = VENUES.find((v) => v.id === next.venueId);
  if (!venue) throw new Error(`沒有 ${next.venueId} 這個場館；selection 應先經過 normalize`);

  const key = `${next.venueId}/${next.layoutId}`;
  if (key !== sceneKey) {
    viewer.showVenue(venue, next.layoutId);
    sceneKey = key;
    shownSeat = null;
  }
  panel.update(panelOptions(VENUES, next), next);
  minimap.update(buildMinimapModel(venue, next.layoutId, next));
  history.replaceState(null, "", toSearch(next));

  const lines: HTMLDivElement[] = notices.map((notice) => line(`提示：${notice}`, "notice"));
  try {
    const view = getSeatView(venue, next.layoutId, next.sectionId, next.row, next.seat);
    viewer.showSeat(view);
    viewer.setMode(next.mode);
    shownSeat = `${view.sectionId} 第 ${view.row} 排 ${view.seat} 號`;
    const sectionName = venue.sections.find((s) => s.id === view.sectionId)?.name;
    const { distance, elevationDeg, horizontalDeg } = view.metrics;
    lines.push(
      line(
        `${venue.name}｜${findLayout(venue, next.layoutId).name}｜` +
          `${view.sectionId}${sectionName ? `（${sectionName}）` : ""} 第 ${view.row} 排 ${view.seat} 號｜` +
          `距離 ${distance.toFixed(1)} m｜俯角 ${elevationDeg.toFixed(1)}°｜水平偏角 ${horizontalDeg.toFixed(1)}°`,
      ),
    );
  } catch (error) {
    if (!(error instanceof SeatViewError)) throw error;
    // 不能讓使用者以為畫面是他指定的座位：說清楚畫面現在是哪一席，或改成鳥瞰
    if (shownSeat) viewer.setMode(next.mode);
    else viewer.setMode("overview");
    lines.push(line(`${error.code}：${error.message}（${shownSeat ? `畫面仍是 ${shownSeat}` : "目前顯示鳥瞰"}）`, "error"));
  }
  // 近似模型一定要讓使用者看到免責聲明，避免把 C 級估算當成事實
  if (venue.meta) lines.push(line(venue.meta.disclaimer, "disclaimer"));
  info.replaceChildren(...lines);
  updateViewTools();
}

function line(text: string, className?: string): HTMLDivElement {
  const element = document.createElement("div");
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

show(normalize(VENUES, parseSeatQuery(location.search)));
