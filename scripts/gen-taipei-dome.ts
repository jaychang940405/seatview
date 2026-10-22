/**
 * 產生 src/venues/taipei-dome.json：臺北大巨蛋的近似模型。
 * 用法：npm run gen:dome
 *
 * 常數與等級都在 taipei-dome-model.ts 的 K；要調整估算值改那裡，再重新產生。
 */
import { writeFileSync } from "node:fs";
import { buildTaipeiDome } from "./taipei-dome-model.ts";

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

const total = (ids: string[]) =>
  venue.sections
    .filter((s) => ids.includes(s.id))
    .reduce(
      (sum, s) =>
        sum + (typeof s.seatsPerRow === "number" ? s.seatsPerRow * s.rows : s.seatsPerRow.reduce((a, b) => a + b, 0)),
      0,
    );
console.log(
  `taipei-dome.json：${venue.sections.length} 區；I1+O1 ${total(["I1-1B", "I1-HP", "I1-3B", "O1-RF", "O1-CF", "O1-LF"])} 席、` +
    `I2 ${total(["I2-1B", "I2-HP", "I2-3B"])} 席、F ${total(["F1", "F2", "F3"])} 席`,
);
