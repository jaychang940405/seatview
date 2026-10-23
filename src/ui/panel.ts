import { stepValue, type Change, type Option, type PanelOptions, type Selection } from "./selection";

// 選位面板的 DOM：只把選項畫成表單、把使用者操作轉成 Change；規則都在 selection.ts。
// 只有座位視角；鳥瞰是 ?debug=overview 的除錯模式，面板上沒有入口。

export interface Panel {
  update(options: PanelOptions, selection: Selection): void;
}

export interface PanelElements {
  /** 左上角的選位面板（可收合） */
  form: HTMLFormElement;
  /** 右上角的場地切換鈕 */
  layoutSwitch: HTMLElement;
}

/** 窄螢幕預設收合，免得面板蓋住太多畫面。 */
const NARROW_SCREEN = "(max-width: 600px)";

export function createPanel({ form, layoutSwitch }: PanelElements, onChange: (change: Change) => void): Panel {
  form.innerHTML = `
    <div class="panel-head">
      <button type="button" id="panel-toggle" aria-controls="panel-body"></button>
      <span id="panel-summary" class="summary"></span>
    </div>
    <div id="panel-body" class="panel-body">
      <label for="pick-venue">場館</label>
      <select id="pick-venue"></select>
      <label for="pick-section">區</label>
      <select id="pick-section"></select>
      <label for="pick-row">排</label>
      <span class="stepper">
        <button type="button" id="row-down" aria-label="前一排">−</button>
        <input id="pick-row" type="number" min="1" step="1" inputmode="numeric" aria-describedby="pick-row-hint" />
        <button type="button" id="row-up" aria-label="後一排">+</button>
        <span id="pick-row-hint" class="hint"></span>
      </span>
      <label for="pick-seat">號</label>
      <span class="stepper">
        <button type="button" id="seat-down" aria-label="前一號">−</button>
        <input id="pick-seat" type="number" min="1" step="1" inputmode="numeric" aria-describedby="pick-seat-hint" />
        <button type="button" id="seat-up" aria-label="後一號">+</button>
        <span id="pick-seat-hint" class="hint"></span>
      </span>
    </div>
  `;
  layoutSwitch.setAttribute("role", "radiogroup");
  layoutSwitch.setAttribute("aria-label", "場地");

  const toggle = part<HTMLButtonElement>(form, "#panel-toggle");
  const summary = part<HTMLSpanElement>(form, "#panel-summary");
  const body = part<HTMLDivElement>(form, "#panel-body");
  const venue = part<HTMLSelectElement>(form, "#pick-venue");
  const section = part<HTMLSelectElement>(form, "#pick-section");
  const row = part<HTMLInputElement>(form, "#pick-row");
  const rowHint = part<HTMLSpanElement>(form, "#pick-row-hint");
  const seat = part<HTMLInputElement>(form, "#pick-seat");
  const seatHint = part<HTMLSpanElement>(form, "#pick-seat-hint");
  const steppers = {
    rowDown: part<HTMLButtonElement>(form, "#row-down"),
    rowUp: part<HTMLButtonElement>(form, "#row-up"),
    seatDown: part<HTMLButtonElement>(form, "#seat-down"),
    seatUp: part<HTMLButtonElement>(form, "#seat-up"),
  };

  // 最近一次 update 的狀態；− / + 依它計算下一個值
  let current: { options: PanelOptions; selection: Selection } | null = null;

  const setCollapsed = (collapsed: boolean) => {
    body.hidden = collapsed;
    form.classList.toggle("collapsed", collapsed);
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.textContent = collapsed ? "▸ 選位" : "▾ 選位";
  };
  setCollapsed(window.matchMedia(NARROW_SCREEN).matches);
  toggle.addEventListener("click", () => setCollapsed(!body.hidden));

  // 沒有送出按鈕；按 Enter 時瀏覽器仍可能送出表單，擋掉以免重新載入頁面
  form.addEventListener("submit", (event) => event.preventDefault());
  venue.addEventListener("change", () => onChange({ kind: "venue", venueId: venue.value }));
  section.addEventListener("change", () => onChange({ kind: "section", sectionId: section.value }));
  layoutSwitch.addEventListener("change", (event) => onChange({ kind: "layout", layoutId: (event.target as HTMLInputElement).value }));
  // 數字框用 change（Enter 或離開欄位才觸發），不用 input：輸入「58」途中不會先跳到 5 號
  row.addEventListener("change", () => onChange({ kind: "row", row: row.valueAsNumber }));
  seat.addEventListener("change", () => onChange({ kind: "seat", seat: seat.valueAsNumber }));
  const step = (field: "row" | "seat", delta: 1 | -1) => () => {
    if (!current) return;
    const { options, selection } = current;
    if (field === "row") onChange({ kind: "row", row: stepValue(selection.row, delta, options.rows) });
    else onChange({ kind: "seat", seat: stepValue(selection.seat, delta, options.seats) });
  };
  steppers.rowDown.addEventListener("click", step("row", -1));
  steppers.rowUp.addEventListener("click", step("row", 1));
  steppers.seatDown.addEventListener("click", step("seat", -1));
  steppers.seatUp.addEventListener("click", step("seat", 1));

  return {
    update(options, selection) {
      current = { options, selection };
      fillSelect(venue, options.venues, selection.venueId);
      fillRadios(layoutSwitch, "pick-layout", options.layouts, selection.layoutId);
      fillSelect(section, options.sections, selection.sectionId);

      row.max = String(options.rows);
      row.value = numberText(selection.row);
      rowHint.textContent = `1–${options.rows} 排`;
      steppers.rowDown.disabled = selection.row <= 1;
      steppers.rowUp.disabled = selection.row >= options.rows;

      if (options.seats === null) seat.removeAttribute("max");
      else seat.max = String(options.seats);
      seat.value = numberText(selection.seat);
      seatHint.textContent = options.seats === null ? "" : `本排 1–${options.seats} 號`;
      steppers.seatDown.disabled = selection.seat <= 1;
      steppers.seatUp.disabled = options.seats !== null && selection.seat >= options.seats;

      summary.textContent = `${selection.sectionId} 第 ${numberText(selection.row) || "?"} 排 ${numberText(selection.seat) || "?"} 號`;
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

/** 有 group 的選項依序放進同名的 optgroup（例如區依樓層分成 B1、L2）；沒有 group 的直接放。 */
function fillSelect(select: HTMLSelectElement, options: Option[], value: string): void {
  rebuildIfChanged(select, options, () => {
    const children: HTMLElement[] = [];
    let group: HTMLOptGroupElement | null = null;
    for (const option of options) {
      const element = document.createElement("option");
      element.value = option.id;
      element.textContent = option.label;
      if (option.group === undefined) {
        group = null;
        children.push(element);
        continue;
      }
      if (group?.label !== option.group) {
        group = document.createElement("optgroup");
        group.label = option.group;
        children.push(group);
      }
      group.append(element);
    }
    return children;
  });
  select.value = value;
}

/** 分段按鈕樣式的 radio：看得到的是短名稱，完整名稱放在 title。 */
function fillRadios(group: HTMLElement, name: string, options: Option[], value: string): void {
  rebuildIfChanged(group, options, () =>
    options.map((option) => {
      const label = document.createElement("label");
      label.title = option.label;
      const input = document.createElement("input");
      input.type = "radio";
      input.name = name;
      input.value = option.id;
      input.setAttribute("aria-label", option.label);
      const text = document.createElement("span");
      text.textContent = option.short ?? option.label;
      label.append(input, text);
      return label;
    }),
  );
  for (const input of group.querySelectorAll<HTMLInputElement>("input")) input.checked = input.value === value;
}
