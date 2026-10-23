import { SeatViewError } from "./core/errors";
import { parseVenue } from "./core/schema";
import { findLayout, getSeatView } from "./core/view";
import { createViewer } from "./render/viewer";
import { createPanel } from "./ui/panel";
import { parseSeatQuery } from "./ui/query";
import { applyChange, normalize, panelOptions, toSearch, type ChangeResult, type Selection } from "./ui/selection";
import demoArenaJson from "./venues/demo-arena.json";
import taipeiDomeJson from "./venues/taipei-dome.json";

// 入口：面板選位，網址參數同步（例如 ?venue=taipei-dome&layout=baseball&section=I1-HP&row=1&seat=29&mode=overview）

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

const viewer = createViewer(app);
const panel = createPanel(form, (change) => show(applyChange(VENUES, selection, change)));

let selection: Selection;
let sceneKey = "";
/** 目前場景裡最後一個成功顯示的座位；查詢失敗時相機停在這裡 */
let shownSeat: string | null = null;

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
}

function line(text: string, className?: string): HTMLDivElement {
  const element = document.createElement("div");
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

show(normalize(VENUES, parseSeatQuery(location.search)));
