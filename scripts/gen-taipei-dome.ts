/**
 * 產生 src/venues/taipei-dome.json：臺北大巨蛋的近似模型。
 * 用法：npm run gen:dome
 *
 * 常數與等級都在 taipei-dome-model.ts 的 K；要調整估算值改那裡，再重新產生。
 */
import { writeFileSync } from "node:fs";
import { buildTaipeiDome, layerTotals, seatCount } from "./taipei-dome-model.ts";

/** 只有子項全是純值的陣列／物件才收成一行，其他照常縮排，讓 JSON 好讀、diff 好看。 */
function format(value: unknown, indent = ""): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  const children = Object.values(value);
  const isLeaf = children.every((v) => v === null || typeof v !== "object");
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (isLeaf) return `[${value.map((v) => JSON.stringify(v)).join(", ")}]`;
    return `[\n${value.map((v) => inner + format(v, inner)).join(",\n")}\n${indent}]`;
  }
  const entries = Object.entries(value);
  if (isLeaf && entries.length <= 4) {
    return `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(", ")} }`;
  }
  return `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${format(v, inner)}`).join(",\n")}\n${indent}}`;
}

const venue = buildTaipeiDome();
writeFileSync(new URL("../src/venues/taipei-dome.json", import.meta.url), `${format(venue)}\n`);

const totals = layerTotals(venue.sections);
const floor = venue.sections.filter((s) => s.id.startsWith("F")).reduce((sum, s) => sum + seatCount(s), 0);
console.log(
  `taipei-dome.json：${venue.sections.length} 區；B1 內野 ${totals.b1Infield} 席、B1 外野 ${totals.b1Outfield} 席、` +
    `L2 內野 ${totals.l2Infield} 席、F ${floor} 席（層席數的偏差：npm run fit:dome）`,
);
