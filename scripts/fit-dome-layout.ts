/**
 * 臺北大巨蛋看台擬合工具（方案 B）。
 *   npm run fit:dome                      用 K 的外框摘要重跑外圈留空 0／3／5 m 的擬合，並比對 K 存的結果
 *   npm run fit:dome -- --osm <檔案>      從 Overpass 匯出的 JSON 重算外框摘要（只印出，不寫檔、不把座標放進 repo）
 *   npm run fit:dome -- --svg <檔案>      依 K 的設定輸出平面圖 SVG（外框摘要、看台輪廓、本壘與界外桿）
 * 外框資料 © OpenStreetMap contributors（ODbL）。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { buildStands, fitLayout, sectionSeatCount, type FitOptions, type StandSection } from "./dome-layout.ts";
import {
  areaCentroid,
  fitInscribedSuperellipse,
  insetConvexPolygon,
  pointInPolygon,
  superellipsePolygon,
  type PlanPoint,
} from "./outline.ts";
import { DEFAULT_LAYOUT, FIELD, K, OUTLINE } from "./taipei-dome-model.ts";

const DEG = Math.PI / 180;
const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

function fitOptions(margin: number): FitOptions {
  return {
    margin,
    anchors: { lower: K.seatsLowerDecks.value, upper: K.seatsInfieldUpper.value },
    tolerance: 0.1,
    maxLowerRows: K.maxLowerRows.value,
    minOutfieldRows: 6,
    plateRange: [20, 70],
    lateralRange: [-3, 3],
    insetOptions: [0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48],
    lineCap: 95,
  };
}

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
  writeFileSync(svgPath, planSvg(buildStands(FIELD, DEFAULT_LAYOUT)));
  console.log(`平面圖已寫到 ${svgPath}`);
} else {
  const shape = { ...K.outline.value };
  for (const margin of [0, 3, 5]) {
    const result = fitLayout(FIELD, shape, DEFAULT_LAYOUT, fitOptions(margin));
    if (!result) {
      console.log(`留空 ${margin} m：放不下`);
      continue;
    }
    const { params: p, outlineCenter: c } = result;
    const pct = (n: number, anchor: number) => `${(((n - anchor) / anchor) * 100).toFixed(1)}%`;
    console.log(
      `留空 ${margin} m：一層 ${result.lower}（${pct(result.lower, K.seatsLowerDecks.value)}）、二層 ${result.upper}（${pct(result.upper, K.seatsInfieldUpper.value)}）${result.meetsAnchors ? "，席數在 ±10% 內" : "，席數未達 ±10%"}`,
    );
    console.log(
      `  一層 ${p.lower.rows} 排、直線 ${p.lower.lineLength} m｜二層從一層第 ${p.upper.startRow + 1} 排上方起 ${p.upper.rows} 排、直線 ${p.upper.lineLength} m｜外野內縮 ${p.outfield.insetDeg}°、左右 ${p.outfield.sideRows} 排、中 ${p.outfield.centerRows} 排｜外框中心 (${c.x}, ${c.z.toFixed(2)})`,
    );
    if (margin === K.outlineMargin.value) {
      const stored = K.fittedLayout.value;
      const same =
        stored.lowerRows === p.lower.rows &&
        stored.lowerLineLength === p.lower.lineLength &&
        stored.upperStartRow === p.upper.startRow &&
        stored.upperRows === p.upper.rows &&
        stored.upperLineLength === p.upper.lineLength &&
        stored.outfieldInsetDeg === p.outfield.insetDeg &&
        stored.outfieldSideRows === p.outfield.sideRows &&
        stored.outfieldCenterRows === p.outfield.centerRows &&
        K.outlinePlacement.value.x === c.x &&
        Math.abs(K.outlinePlacement.value.z - c.z) < 1e-6;
      console.log(same ? "  ✓ 跟 K.fittedLayout／K.outlinePlacement 一致" : "  ✗ 跟 K 存的結果不同：請更新 taipei-dome-model.ts 的 K");
    }
  }
}

/** 平面圖：外框摘要（含留空線）、看台輪廓、界外線、外野牆、本壘與界外桿。只畫摘要，不含 OSM 原始座標。 */
function planSvg(stands: StandSection[]): string {
  const scale = 3;
  const x0 = -135;
  const z0 = -125;
  const width = 270;
  const height = 290;
  const xy = (p: PlanPoint) => `${((p.x - x0) * scale).toFixed(1)},${((p.z - z0) * scale).toFixed(1)}`;
  const polygon = (pts: PlanPoint[], attrs: string) => `<polygon points="${pts.map(xy).join(" ")}" ${attrs}/>`;
  const polyline = (pts: PlanPoint[], attrs: string) => `<polyline points="${pts.map(xy).join(" ")}" fill="none" ${attrs}/>`;
  const footprint = (s: StandSection): PlanPoint[] => {
    const depth = s.rowDepth * (s.rows - 1);
    if (s.type === "arc") {
      const pts: PlanPoint[] = [];
      for (let i = 0; i <= 24; i++) {
        const a = (s.fromDeg + ((s.toDeg - s.fromDeg) * i) / 24) * DEG;
        pts.push({ x: s.center.x + s.innerRadius * Math.cos(a), z: s.center.z + s.innerRadius * Math.sin(a) });
      }
      for (let i = 24; i >= 0; i--) {
        const a = (s.fromDeg + ((s.toDeg - s.fromDeg) * i) / 24) * DEG;
        pts.push({ x: s.center.x + (s.innerRadius + depth) * Math.cos(a), z: s.center.z + (s.innerRadius + depth) * Math.sin(a) });
      }
      return pts;
    }
    const len = Math.hypot(s.to.x - s.from.x, s.to.z - s.from.z);
    let n = { x: -(s.to.z - s.from.z) / len, z: (s.to.x - s.from.x) / len };
    if ((s.facing.x - s.from.x) * n.x + (s.facing.z - s.from.z) * n.z > 0) n = { x: -n.x, z: -n.z };
    return [s.from, s.to, { x: s.to.x + n.x * depth, z: s.to.z + n.z * depth }, { x: s.from.x + n.x * depth, z: s.from.z + n.z * depth }];
  };
  const mid = (pts: PlanPoint[]) => ({ x: pts.reduce((s, p) => s + p.x, 0) / pts.length, z: pts.reduce((s, p) => s + p.z, 0) / pts.length });
  const color: Record<string, string> = { I1: "#4477aa", I2: "#ee7733", O1: "#228833" };
  const wall: PlanPoint[] = [];
  const right = (Math.atan2(FIELD.rightPole.z - FIELD.wallCenter.z, FIELD.rightPole.x - FIELD.wallCenter.x) * 180) / Math.PI;
  for (let deg = -180 - right; deg <= right + 1e-9; deg += 2) {
    wall.push({ x: FIELD.wallCenter.x + FIELD.wallRadius * Math.cos(deg * DEG), z: FIELD.wallCenter.z + FIELD.wallRadius * Math.sin(deg * DEG) });
  }
  const outline = superellipsePolygon(OUTLINE, 1);
  const lower = stands.filter((s) => !s.id.startsWith("I2")).reduce((sum, s) => sum + sectionSeatCount(s), 0);
  const upper = stands.filter((s) => s.id.startsWith("I2")).reduce((sum, s) => sum + sectionSeatCount(s), 0);
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width * scale} ${height * scale + 120}" font-family="system-ui, sans-serif">`,
    `<rect width="100%" height="100%" fill="#ffffff"/>`,
    `<text x="12" y="28" font-size="20" font-weight="600">臺北大巨蛋近似模型・方案 B 平面圖</text>`,
    `<text x="12" y="52" font-size="13" fill="#555">俯視，x 向右、z 向下；本壘在下、中外野在上。區、排、號為模型內部編號（模型分區），不對應實際票面。</text>`,
    `<g transform="translate(0,64)">`,
    polygon(outline, `fill="#f4f4f4" stroke="#333" stroke-width="2"`),
    polygon(insetConvexPolygon(outline, K.outlineMargin.value), `fill="none" stroke="#333" stroke-width="1" stroke-dasharray="6 4"`),
  ];
  for (const s of stands) {
    const tier = s.id.slice(0, 2);
    const dashed = tier === "I2" ? `stroke-dasharray="5 3"` : "";
    out.push(polygon(footprint(s), `fill="${color[tier]}" fill-opacity="${tier === "I2" ? 0.25 : 0.45}" stroke="${color[tier]}" stroke-width="${tier === "I2" ? 2 : 1}" ${dashed}`));
  }
  for (const s of stands) {
    const c = mid(footprint(s));
    const dy = s.id.startsWith("I2") ? 14 : 0;
    out.push(
      `<text x="${((c.x - x0) * scale).toFixed(1)}" y="${((c.z - z0) * scale + dy).toFixed(1)}" font-size="12" text-anchor="middle" fill="#111" stroke="#fff" stroke-width="3" paint-order="stroke">${s.id} ${sectionSeatCount(s)}席</text>`,
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
    `藍 = 內野一層、橘（虛線）= 內野二層（懸挑在一層後段上方）、綠 = 外野一層；一層 ${lower} 席（錨點 ${K.seatsLowerDecks.value}）、二層 ${upper} 席（錨點 ${K.seatsInfieldUpper.value}）`,
    `外框：© OpenStreetMap contributors（ODbL），way 1304278778；看台參數為 C 級估算（npm run fit:dome）`,
  ];
  legend.forEach((t, i) => out.push(`<text x="12" y="${height * scale + 72 + i * 18}" font-size="12" fill="#333">${t}</text>`));
  out.push(`</svg>`);
  return out.join("\n");
}
