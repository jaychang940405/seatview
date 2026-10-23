import type { MinimapModel } from "./minimap";
import type { Change } from "./selection";

// 小地圖的 DOM：把 buildMinimapModel 的結果畫成 SVG；點一區（或聚焦後按 Enter）就跳到那一區的中央座位。

export interface MinimapView {
  update(model: MinimapModel): void;
}

const SVG_NS = "http://www.w3.org/2000/svg";
/** 選中座位的點半徑（m，跟 viewBox 同單位）。 */
const DOT_RADIUS = 4;

function svgElement<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string>): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}

export function createMinimap(container: HTMLElement, onChange: (change: Change) => void): MinimapView {
  const svg = svgElement("svg", { role: "group", "aria-label": "小地圖：點一區跳到該區中央座位" });
  const lines = svgElement("g", { class: "lines" });
  const sections = svgElement("g", { class: "sections" });
  const dot = svgElement("circle", { class: "seat-dot", r: String(DOT_RADIUS) });
  svg.append(lines, sections, dot);
  container.append(svg);

  let shapeKey = "";
  const paths = new Map<string, SVGPathElement>();

  return {
    update(model) {
      // 區的形狀沒變就不重建，避免用鍵盤點選後焦點跑掉
      const key = `${model.viewBox}|${model.sections.map((s) => s.id).join(",")}`;
      if (key !== shapeKey) {
        shapeKey = key;
        svg.setAttribute("viewBox", model.viewBox);
        lines.replaceChildren(...model.lines.map((line) => svgElement("path", { d: line.path, "vector-effect": "non-scaling-stroke" })));
        paths.clear();
        sections.replaceChildren(
          ...model.sections.map((section) => {
            const description = `${section.label}：跳到第 ${section.target.row} 排 ${section.target.seat} 號`;
            const path = svgElement("path", {
              d: section.path,
              class: "section",
              role: "button",
              tabindex: "0",
              "aria-label": description,
              "vector-effect": "non-scaling-stroke",
            });
            const title = svgElement("title", {});
            title.textContent = description;
            path.append(title);
            const pick = () => onChange({ kind: "pick", sectionId: section.id, ...section.target });
            path.addEventListener("click", pick);
            path.addEventListener("keydown", (event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              pick();
            });
            paths.set(section.id, path);
            return path;
          }),
        );
      }
      for (const [id, path] of paths) path.classList.toggle("current", id === model.selected?.sectionId);
      dot.style.display = model.selected ? "" : "none";
      if (model.selected) {
        dot.setAttribute("cx", String(model.selected.point.x));
        dot.setAttribute("cy", String(model.selected.point.z));
      }
    },
  };
}
