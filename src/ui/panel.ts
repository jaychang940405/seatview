import type { CameraMode } from "../render/viewer";
import type { Change, Option, PanelOptions, Selection } from "./selection";

// 選位面板的 DOM：只把選項畫成表單、把使用者操作轉成 Change；規則都在 selection.ts。

export interface Panel {
  update(options: PanelOptions, selection: Selection): void;
}

const MODES: Option[] = [
  { id: "seat", label: "座位" },
  { id: "overview", label: "鳥瞰" },
];

export function createPanel(form: HTMLFormElement, onChange: (change: Change) => void): Panel {
  form.innerHTML = `
    <label for="pick-venue">場館</label>
    <select id="pick-venue"></select>
    <span id="pick-layout-label">場地</span>
    <div id="pick-layout" class="choices" role="radiogroup" aria-labelledby="pick-layout-label"></div>
    <label for="pick-section">區</label>
    <select id="pick-section"></select>
    <label for="pick-row">排</label>
    <span><input id="pick-row" type="number" min="1" step="1" inputmode="numeric" aria-describedby="pick-row-hint" /><span id="pick-row-hint" class="hint"></span></span>
    <label for="pick-seat">號</label>
    <span><input id="pick-seat" type="number" min="1" step="1" inputmode="numeric" aria-describedby="pick-seat-hint" /><span id="pick-seat-hint" class="hint"></span></span>
    <span id="pick-mode-label">視角</span>
    <div id="pick-mode" class="choices" role="radiogroup" aria-labelledby="pick-mode-label"></div>
  `;
  const venue = part<HTMLSelectElement>(form, "#pick-venue");
  const layout = part<HTMLDivElement>(form, "#pick-layout");
  const section = part<HTMLSelectElement>(form, "#pick-section");
  const row = part<HTMLInputElement>(form, "#pick-row");
  const rowHint = part<HTMLSpanElement>(form, "#pick-row-hint");
  const seat = part<HTMLInputElement>(form, "#pick-seat");
  const seatHint = part<HTMLSpanElement>(form, "#pick-seat-hint");
  const mode = part<HTMLDivElement>(form, "#pick-mode");

  // 沒有送出按鈕；按 Enter 時瀏覽器仍可能送出表單，擋掉以免重新載入頁面
  form.addEventListener("submit", (event) => event.preventDefault());
  venue.addEventListener("change", () => onChange({ kind: "venue", venueId: venue.value }));
  section.addEventListener("change", () => onChange({ kind: "section", sectionId: section.value }));
  layout.addEventListener("change", (event) => onChange({ kind: "layout", layoutId: (event.target as HTMLInputElement).value }));
  mode.addEventListener("change", (event) => onChange({ kind: "mode", mode: (event.target as HTMLInputElement).value as CameraMode }));
  // 數字框用 change（Enter 或離開欄位才觸發），不用 input：輸入「58」途中不會先跳到 5 號
  row.addEventListener("change", () => onChange({ kind: "row", row: row.valueAsNumber }));
  seat.addEventListener("change", () => onChange({ kind: "seat", seat: seat.valueAsNumber }));

  return {
    update(options, selection) {
      fillSelect(venue, options.venues, selection.venueId);
      fillRadios(layout, "pick-layout", options.layouts, selection.layoutId);
      fillSelect(section, options.sections, selection.sectionId);
      fillRadios(mode, "pick-mode", MODES, selection.mode);

      row.max = String(options.rows);
      row.value = numberText(selection.row);
      rowHint.textContent = `1–${options.rows} 排`;

      if (options.seats === null) seat.removeAttribute("max");
      else seat.max = String(options.seats);
      seat.value = numberText(selection.seat);
      seatHint.textContent = options.seats === null ? "" : `本排 1–${options.seats} 號`;
    },
  };
}

function part<T extends Element>(root: Element, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`面板缺少 ${selector}`);
  return element;
}

const numberText = (value: number) => (Number.isFinite(value) ? String(value) : "");

/** 選項沒變就不重建，避免使用者正在操作的元素失去焦點。 */
function rebuildIfChanged(container: HTMLElement, options: Option[], build: () => HTMLElement[]): void {
  const key = JSON.stringify(options);
  if (container.dataset.options === key) return;
  container.dataset.options = key;
  container.replaceChildren(...build());
}

function fillSelect(select: HTMLSelectElement, options: Option[], value: string): void {
  rebuildIfChanged(select, options, () =>
    options.map((option) => {
      const element = document.createElement("option");
      element.value = option.id;
      element.textContent = option.label;
      return element;
    }),
  );
  select.value = value;
}

function fillRadios(group: HTMLElement, name: string, options: Option[], value: string): void {
  rebuildIfChanged(group, options, () =>
    options.map((option) => {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "radio";
      input.name = name;
      input.value = option.id;
      label.append(input, ` ${option.label}`);
      return label;
    }),
  );
  for (const input of group.querySelectorAll<HTMLInputElement>("input")) input.checked = input.value === value;
}
