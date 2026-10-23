/**
 * 臺北大巨蛋外框與看台檢查工具（官方票區版）。
 *   npm run fit:dome                      印出每層席數與 K.layerSeats（B−）的偏差：只回報，不拿來縮放
 *   npm run fit:dome -- --osm <檔案>      從 Overpass 匯出的 JSON 重算外框摘要（只印出，不寫檔、不把座標放進 repo）
 *   npm run fit:dome -- --svg <檔案>      輸出平面圖 SVG（外框摘要、看台輪廓、本壘與界外桿）
 * 外框資料 © OpenStreetMap contributors（ODbL）。
 */
import { readFileSync, writeFileSync } from "node:fs";
import type { Section, Venue } from "../src/core/schema.ts";
import { sectionOutline } from "../src/core/stand.ts";
import { outfieldArcAngles } from "./dome-field.ts";
import {
  areaCentroid,
  fitInscribedSuperellipse,
  insetConvexPolygon,
  pointInPolygon,
  superellipsePolygon,
  type PlanPoint,
} from "./outline.ts";
import { buildTaipeiDome, FIELD, K, layerTotals, OUTLINE, type Layer } from "./taipei-dome-model.ts";

const DEG = Math.PI / 180;
const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

/** fit:dome 印出的層名。 */
const LAYER_LABELS: Record<Layer, string> = { b1Infield: "B1 內野", b1Outfield: "B1 外野", l2Infield: "L2 內野" };

const osmPath = option("--osm");
const svgPath = option("--svg");

if (osmPath) {
  // OSM 圓頂分件：經緯度 → 公尺（x 東、z 南，俯視不鏡像）→ 以面積形心為原點 → 長軸轉到 z
  const data = JSON.parse(readFileSync(osmPath, "utf8")) as { elements: { id: number; geometry?: { lat: number; lon: number }[] }[] };
  const way = data.elements.find((e) => e.id === 1304278778);
  if (!way?.geometry) throw new Error("找不到圓頂分件 way 1304278778");
  const lat0 = way.geometry.reduce((s, p) => s + p.lat, 0) / way.geometry.length;
  const lon0 = way.geometry.reduce((s, p) => s + p.lon, 0) / way.geometry.length;
  const mLat = 111132.92 - 559.82 * Math.cos(2 * lat0 * DEG);
  const mLon = 111412.84 * Math.cos(lat0 * DEG);
  let polygon: PlanPoint[] = way.geometry.map((p) => ({ x: (p.lon - lon0) * mLon, z: -(p.lat - lat0) * mLat }));
  const centroid = areaCentroid(polygon);
  polygon = polygon.map((p) => ({ x: p.x - centroid.x, z: p.z - centroid.z }));
  let axis = { width: 0, deg: 0 };
  for (let deg = 0; deg < 180; deg += 0.25) {
    const projected = polygon.map((p) => p.x * Math.cos(deg * DEG) + p.z * Math.sin(deg * DEG));
    const width = Math.max(...projected) - Math.min(...projected);
    if (width > axis.width) axis = { width, deg };
  }
  const rot = (90 - axis.deg) * DEG;
  const a = polygon.map((p) => ({ x: p.x * Math.cos(rot) - p.z * Math.sin(rot), z: p.x * Math.sin(rot) + p.z * Math.cos(rot) }));
  const b = a.map((p) => ({ x: -p.x, z: -p.z })); // 本壘在長軸另一端 = 繞形心轉 180°
  const inside = (p: PlanPoint) => pointInPolygon(a, p) && pointInPolygon(b, p);
  const radii = Array.from({ length: 360 }, (_, deg) => {
    let lo = 0;
    let hi = 300;
    for (let k = 0; k < 50; k++) {
      const mid = (lo + hi) / 2;
      if (inside({ x: mid * Math.cos(deg * DEG), z: mid * Math.sin(deg * DEG) })) lo = mid;
      else hi = mid;
    }
    return { deg, r: lo };
  });
  const { shape, maxGap } = fitInscribedSuperellipse(radii, { x: 0, z: 0 });
  console.log("兩種本壘方位交集的內接超橢圓（© OpenStreetMap contributors，ODbL）：");
  console.log(
    `  semiAxisX ${shape.semiAxisX.toFixed(2)} m、semiAxisZ ${shape.semiAxisZ.toFixed(2)} m、exponent ${shape.exponent.toFixed(2)}、rotationDeg ${shape.rotationDeg.toFixed(2)}；最大內縮差距 ${maxGap.toFixed(2)} m`,
  );
  console.log(`  16 方向淨空極限（參考）：${radii.filter((r) => r.deg % 22.5 < 1).map((r) => `${r.deg}°:${r.r.toFixed(1)}`).join(" ")}`);
} else if (svgPath) {
  writeFileSync(svgPath, planSvg(buildTaipeiDome() as Venue));
  console.log(`平面圖已寫到 ${svgPath}`);
} else {
  // 層總席數是 B−（來源之間有約 500 席的內部不一致），所以只回報偏差，不縮放、不調參數去湊
  const totals = layerTotals(buildTaipeiDome().sections);
  for (const [layer, label] of Object.entries(LAYER_LABELS) as [Layer, string][]) {
    const reference = K.layerSeats.value[layer];
    const pct = (((totals[layer] - reference) / reference) * 100).toFixed(1);
    console.log(`${label}：模型 ${totals[layer]} 席、來源約 ${reference} 席（${Number(pct) >= 0 ? "+" : ""}${pct}%）`);
  }
  console.log(`來源：${K.layerSeats.source}`);
}

/** 平面圖：外框摘要（含留空線）、看台輪廓、界外線、外野牆、本壘與界外桿。只畫摘要，不含 OSM 原始座標。 */
function planSvg(venue: Venue): string {
  const scale = 3;
  const x0 = -135;
  const z0 = -125;
  const width = 270;
  const height = 290;
  const xy = (p: PlanPoint) => `${((p.x - x0) * scale).toFixed(1)},${((p.z - z0) * scale).toFixed(1)}`;
  const polygon = (pts: PlanPoint[], attrs: string) => `<polygon points="${pts.map(xy).join(" ")}" ${attrs}/>`;
  const polyline = (pts: PlanPoint[], attrs: string) => `<polyline points="${pts.map(xy).join(" ")}" fill="none" ${attrs}/>`;
  const mid = (pts: PlanPoint[]) => ({ x: pts.reduce((s, p) => s + p.x, 0) / pts.length, z: pts.reduce((s, p) => s + p.z, 0) / pts.length });
  const layerOf = (s: Section) => (s.id.startsWith("2") ? "l2" : Number(s.id) >= 131 ? "outfield" : "b1");
  const color = { b1: "#4477aa", l2: "#ee7733", outfield: "#228833" };
  const wall: PlanPoint[] = [];
  const { right, left } = outfieldArcAngles(FIELD);
  for (let deg = left; deg <= right + 1e-9; deg += 2) {
    wall.push({ x: FIELD.wallCenter.x + FIELD.wallRadius * Math.cos(deg * DEG), z: FIELD.wallCenter.z + FIELD.wallRadius * Math.sin(deg * DEG) });
  }
  const outline = superellipsePolygon(OUTLINE, 1);
  const stands = venue.sections.filter((s) => !s.id.startsWith("F"));
  const totals = layerTotals(stands);
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width * scale} ${height * scale + 120}" font-family="system-ui, sans-serif">`,
    `<rect width="100%" height="100%" fill="#ffffff"/>`,
    `<text x="12" y="28" font-size="20" font-weight="600">臺北大巨蛋近似模型・官方票區平面圖</text>`,
    `<text x="12" y="52" font-size="13" fill="#555">俯視，x 向右、z 向下；本壘在下、中外野在上。區號採官方票區號，每區形狀、排與號是模型推算。</text>`,
    `<g transform="translate(0,64)">`,
    polygon(outline, `fill="#f4f4f4" stroke="#333" stroke-width="2"`),
    polygon(insetConvexPolygon(outline, K.outlineMargin.value), `fill="none" stroke="#333" stroke-width="1" stroke-dasharray="6 4"`),
  ];
  // 輪廓來自 core 的 sectionOutline（跟小地圖同一份），這裡不自己算看台幾何
  const outlines = new Map(stands.map((s) => [s.id, sectionOutline(venue, s.id)]));
  for (const s of stands) {
    const layer = layerOf(s);
    const dashed = layer === "l2" ? `stroke-dasharray="5 3"` : "";
    out.push(polygon(outlines.get(s.id)!, `fill="${color[layer]}" fill-opacity="${layer === "l2" ? 0.25 : 0.45}" stroke="${color[layer]}" stroke-width="1" ${dashed}`));
  }
  for (const s of stands) {
    const c = mid(outlines.get(s.id)!);
    out.push(
      `<text x="${((c.x - x0) * scale).toFixed(1)}" y="${((c.z - z0) * scale).toFixed(1)}" font-size="9" text-anchor="middle" fill="#111" stroke="#fff" stroke-width="2.5" paint-order="stroke">${s.id}</text>`,
    );
  }
  out.push(polyline([FIELD.leftPole, FIELD.plate, FIELD.rightPole], `stroke="#888" stroke-width="1.5"`));
  out.push(polyline(wall, `stroke="#666" stroke-width="2"`));
  for (const [p, label] of [
    [FIELD.plate, "本壘"],
    [FIELD.rightPole, "右外野界外桿"],
    [FIELD.leftPole, "左外野界外桿"],
    [FIELD.centerField, "中外野"],
  ] as const) {
    const [cx, cy] = [((p.x - x0) * scale).toFixed(1), ((p.z - z0) * scale).toFixed(1)];
    out.push(`<circle cx="${cx}" cy="${cy}" r="5" fill="#cc3311"/>`);
    out.push(`<text x="${Number(cx) + 8}" y="${Number(cy) + 4}" font-size="12" fill="#cc3311" stroke="#fff" stroke-width="3" paint-order="stroke">${label}</text>`);
  }
  out.push(`</g>`);
  const legend = [
    `實線灰底 = 外框摘要（OSM 圓頂分件兩種本壘方位交集的內接超橢圓，C 級）；虛線 = 內縮 ${K.outlineMargin.value} m 的留空線`,
    `藍 = B1 內野 ${totals.b1Infield} 席、綠 = B1 外野 ${totals.b1Outfield} 席、橘（虛線）= L2 內野 ${totals.l2Infield} 席（懸挑在 B1 後段上方）；層總席數只回報偏差（npm run fit:dome）`,
    `外框：© OpenStreetMap contributors（ODbL），way 1304278778；每區寬度與排長為 C 級推算`,
  ];
  legend.forEach((t, i) => out.push(`<text x="12" y="${height * scale + 72 + i * 18}" font-size="12" fill="#333">${t}</text>`));
  out.push(`</svg>`);
  return out.join("\n");
}
