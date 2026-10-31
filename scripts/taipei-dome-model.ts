/**
 * 臺北大巨蛋近似模型（官方票區版）：常數表與場館組裝。
 *   寫檔：gen-taipei-dome.ts（npm run gen:dome）
 *   看台排法：official-layout.ts；外框重算與平面圖：fit-dome-layout.ts（npm run fit:dome）
 *   敏感度分析：sensitivity.ts（npm run sensitivity）
 *
 * 所有數字集中在下面的 K，每個都標來源等級：
 *   A = 規則或官方定義、B = 新聞報導（非官方圖面）、C = 本專案估算。
 * C 級數字只是估算起點，不可在文件或 UI 寫成事實。要調整估算值時只改這個檔案，再重新產生。
 *
 * 座標（同 src/core/schema.ts）：m；Y 向上；場地 y = 0；平面 x 向右、z 向下；角度 0° = +x、90° = +z。
 * 原點 = 本壘到中外野牆連線的中點；本壘在 +z 側，中外野在 −z 側。
 */
import { circleThrough, fieldGeometry } from "./dome-field.ts";
import type { Screen, Section } from "../src/core/schema.ts";
import { officialStands, type OfficialParams } from "./official-layout.ts";
import { screenCorners } from "../src/core/shell.ts";
import { pointInPolygon, signedDistance, superellipsePolygon, type PlanPoint, type Superellipse } from "./outline.ts";

type Grade = "A" | "B" | "C";
interface Sourced {
  label: string;
  value: number | string | readonly number[] | readonly string[] | Record<string, unknown>;
  unit?: string;
  grade: Grade;
  source: string;
}

const NOWNEWS = "https://www.nownews.com/news/6860709";
const TN_TOTAL = "https://www.taiwannews.com.tw/zh/news/5089544";
const TVBS = "https://news.tvbs.com.tw/sports/2429115";
const TVBS_HEIGHT = "https://news.tvbs.com.tw/amp/english/2615405";
const LTN_HEIGHT = "https://ec.ltn.com.tw/article/paper/850989";
const OSM = "© OpenStreetMap contributors（ODbL），圓頂分件 way 1304278778";
const ESTIMATE = "本專案估算（非量測）";
const FIT = "npm run fit:dome 擬合結果（超橢圓外框摘要、外圈留空 3 m）";
const CONCERT = "演唱會暫定假設（每場演出不同，非場館屬性）";
const PHOTO = "依使用者自己拍攝的照片目視估計（照片不在 repo，非量測值）";
const INTERIOR_PHOTO = "使用者提供的大巨蛋內部全景照片（只做目視比較，不在 repo、不描摹；非量測值）";
const GDF = "https://gdf999.com/bigdomelazybag-sara240214/";
const WAIHANN = "https://waihann.tw/1136/taipeidome-seatview/";
const SEAT_MAP = "使用者提供的售票座位圖（只讀區號與相對位置，不描摹、不放進 repo）";

/** 票面標籤（區、排、號）：球迷照片上的實際票面；模型裡一定要有這一席。 */
export const TICKET_LABELS = [
  ["113", 38, 7],
  ["102", 23, 32],
  ["103", 38, 9],
  ["115", 38, 9],
  ["133", 14, 6],
  ["142", 9, 34],
  ["201", 15, 15],
  ["203", 18, 26],
  ["205", 19, 10],
] as const;
/**
 * 視野文章照片說明裡的區排號（B）：https://waihann.tw/2291/taipeidome-seatview-ifb1-3/ （102–110）、
 * https://waihann.tw/2282/taipeidome-seatview-ifb1-2/ （111–115）。跟文章標題對不上的兩張不列入。
 */
export const CAPTION_LABELS = [
  ["102", 23, 32], ["102", 23, 1], ["102", 27, 18], ["102", 32, 7], ["102", 36, 13],
  ["103", 12, 22], ["103", 13, 22], ["103", 17, 16], ["103", 25, 21], ["103", 33, 1], ["103", 38, 9],
  ["104", 7, 22], ["104", 13, 10], ["104", 21, 3], ["104", 28, 20], ["104", 36, 11],
  ["105", 2, 17], ["105", 4, 5], ["105", 11, 1], ["105", 20, 8], ["105", 32, 22], ["105", 38, 5],
  ["106", 3, 8], ["106", 15, 20], ["106", 29, 8], ["106", 36, 22],
  ["107", 6, 10], ["107", 35, 10],
  ["108", 12, 6], ["108", 17, 1], ["108", 26, 20], ["108", 34, 10],
  ["109", 11, 11], ["109", 22, 13],
  ["110", 9, 11], ["110", 17, 12],
  ["111", 32, 1], ["111", 38, 17],
  ["112", 21, 5], ["112", 29, 3], ["112", 37, 7],
  ["113", 8, 13], ["113", 16, 13], ["113", 28, 16], ["113", 35, 5],
  ["114", 10, 3], ["114", 25, 10], ["114", 34, 17], ["114", 38, 4],
  ["115", 25, 6], ["115", 29, 19], ["115", 33, 16], ["115", 34, 1], ["115", 38, 8], ["115", 38, 9],
] as const;
/** 最後一排剛好幾席（201 第 15 排有 15 號、沒有 16 號）。 */
const EXACT_LAST_ROW = { "201": 15 } as const;

export const K = {
  // ── B：新聞報導 ──
  centerField: { label: "本壘到中外野牆", value: 121.92, unit: "m", grade: "B", source: `${NOWNEWS}（400 呎）` },
  foulPole: {
    label: "本壘到左右外野牆（界外桿）",
    value: 102.11,
    unit: "m",
    grade: "B",
    source: `${NOWNEWS}（335 呎；報導數字，非官方圖面）`,
  },
  officialSections: {
    label: "官方票區（區號、層別、相鄰關係）",
    value: "B1 內野 102–124；B1 外野 131–137、140–146（138、139 是打者之眼）；L2 內野 201–212、214–225（213 是灰色無編號的一塊）；102、201、146 在一壘側",
    grade: "B",
    source: `${GDF}；${WAIHANN}；${SEAT_MAP}`,
  },
  ticketLabels: {
    label: "票面標籤（區/排/號；201 第 15 排沒有第 16 號）",
    value: TICKET_LABELS.map(([id, row, seat]) => `${id}/${row}/${seat}`).join("、"),
    grade: "B",
    source: `使用者整理的票面標籤，來自公開視野圖文章裡的票面照片（例如 ${WAIHANN}）`,
  },
  layerSeats: {
    label: "層總席數（B−：來源之間約有 500 席的內部不一致；只回報偏差，不拿來縮放）",
    value: { b1Infield: 13423, b1Outfield: 3826, l2Infield: 9209 },
    unit: "席",
    grade: "B",
    source: GDF,
  },
  seatsTotal: { label: "總席位（不建模，只說明範圍）", value: 40000, unit: "席", grade: "B", source: TN_TOTAL },
  tierNames: { label: "層名", value: "B1（內野、外野）、L2（內野、外野）、L3–L5", grade: "B", source: `${WAIHANN}；${TVBS} 等報導` },
  plateZ: {
    label: "本壘板 z 座標",
    value: 60.95,
    unit: "m",
    grade: "B",
    source: "由本壘到中外野距離推算（121.92 ÷ 2，因原點取在連線中點）",
  },
  roofHeight: {
    label: "屋頂高度（球場面到屋頂外側）",
    value: 74.5,
    unit: "m",
    grade: "B",
    source: `${TVBS_HEIGHT}（球場位於地下 10.5 m、整體 74.5 m）；與 OSM 地面以上 64 m ＋ 10.5 m 相符；室內淨高 72 m（${LTN_HEIGHT}）`,
  },

  shellRoofHeight: {
    label: "穹頂室內最高點（室內淨高；畫面的屋頂內側）",
    value: 72,
    unit: "m",
    grade: "B",
    source: `${LTN_HEIGHT}（室內淨高 72 m）；屋頂外側是 roofHeight 74.5 m`,
  },

  // ── A：棒球規則 ──
  basePath: { label: "壘間距離", value: 27.43, unit: "m", grade: "A", source: "棒球規則（90 呎）" },
  plateToPitcher: { label: "本壘到投手板", value: 18.44, unit: "m", grade: "A", source: "棒球規則（60 呎 6 吋）" },
  plateToSecond: { label: "本壘到二壘", value: 38.8, unit: "m", grade: "A", source: "棒球規則" },
  moundDiameter: { label: "投手丘直徑", value: 5.49, unit: "m", grade: "A", source: "棒球規則（18 呎）" },
  moundHeight: { label: "投手丘高度", value: 0.254, unit: "m", grade: "A", source: "棒球規則（10 吋）" },
  infieldArc: { label: "內野弧半徑（以投手板為圓心；大巨蛋是人工草皮，只畫成白線）", value: 28.96, unit: "m", grade: "A", source: "棒球規則（95 呎）；畫面外觀用" },
  homeCircle: { label: "本壘圓半徑", value: 3.96, unit: "m", grade: "A", source: "棒球規則（13 呎）" },

  // ── C：本專案估算 ──
  origin: {
    label: "原點",
    value: "本壘到中外野牆連線的中點",
    grade: "C",
    source: "為了方便而選",
  },
  strikeZoneY: { label: "baseball focus 高度（好球帶中心）", value: 0.8, unit: "m", grade: "C", source: ESTIMATE },
  outline: {
    label: "外框摘要：兩種本壘方位交集的內接超橢圓",
    value: { semiAxisX: 79.84, semiAxisZ: 102.52, exponent: 2.5, rotationDeg: 6.25 },
    grade: "C",
    source: `${OSM}；最大內縮差距 0.95 m；npm run fit:dome -- --osm <Overpass 匯出檔> 可重算`,
  },
  outlinePlacement: {
    label: "外框中心在模型座標的位置（場地往中外野移 5 m）",
    value: { x: 1, z: 11.95 },
    grade: "C",
    source: `原擬合值 (1, 6.95) 只放得下 33 排；官方票區的 B1 內野有 38 排，本壘後方差 3.97 m，所以把場地往中外野移 5 m（${FIT}）`,
  },
  outlineMargin: { label: "外圈留空（看台離外框的最小距離）", value: 3, unit: "m", grade: "C", source: ESTIMATE },
  headroom: { label: "上下兩層座位之間的垂直淨空", value: 2.5, unit: "m", grade: "C", source: ESTIMATE },
  foulOffset: {
    label: "一層前緣離本壘與界外線的距離",
    value: 18.3,
    unit: "m",
    grade: "C",
    source: "棒球規則建議本壘到後擋網 60 呎以上；沿用到界外線兩側是本專案假設",
  },
  rowDepth: { label: "看台排距", value: 0.85, unit: "m", grade: "C", source: ESTIMATE },
  seatPitch: { label: "座位寬（每排席數 = 長度 ÷ 座位寬取整）", value: 0.5, unit: "m", grade: "C", source: ESTIMATE },
  lowerDeck: { label: "B1（內野、外野）高度；外野第 1 排在全壘打牆之上", value: { rowRise: 0.35, baseHeight: 3 }, grade: "C", source: ESTIMATE },
  b1FrontHeight: { label: "B1 內野第 1 排高度：跟場地（球員站的地方）同高", value: 0, unit: "m", grade: "C", source: "使用者說明：B1 第一排跟球場同高度" },
  upperDeck: { label: "L2 內野高度（baseHeight = B1 內野最後一排 + 淨空）", value: { rowRise: 0.5 }, grade: "C", source: ESTIMATE },
  outfieldClearance: { label: "外野看台離外野牆的淨空", value: 3, unit: "m", grade: "C", source: ESTIMATE },
  officialLayout: {
    label: "官方票區的排數與寬度規則",
    value: {
      b1Rows: 38,
      outfieldRows: 14,
      l2Rows: { "201": 15, "202": 16, "203": 18 },
      l2DefaultRows: 19,
      l2StartRow: 19,
      endCap: 1.5,
      farBackWidth: 2,
      sideRadius: 300,
      homeCenterBack: 0,
      homeHalfSpan: 45,
      eyeHalfDeg: 5,
      outfieldWidthRow: 9,
    },
    grade: "C",
    source:
      "本壘後方的弧心仍在本壘（homeCenterBack 0 m）、往兩側展開 45°：2026-11-01 掃過弧心後退 0–40 m、展開 45–70°、留空 0–3 m、場地再移 0–12 m、座椅 0.45–0.5 m，視野文章照片說明的座位在左右對稱下仍放不下，所以照片說明只回報（npm run fit:dome）；排數的下限來自球迷照片的票面標籤；一三壘側是跟本壘後方的弧相切的大弧，第 1 排半徑 300 m（讀座位圖的相對形狀：越往界外桿越靠近界外線；300 m 時看台末端離界外線三壘側約 8.3 m、一壘側約 10.5 m；不描摹）；L2 從 B1 第 20 排正上方開始；靠界外桿的區保留最後一排、寬度最多是鄰區平均的 1.5 倍；有票面標籤的區至少要有標籤需要的寬度，其餘平分；打者之眼 ±5°",
  },
  concertClosed: { label: "演唱會時在舞台正後方、不開放的外野區", value: ["136", "137", "140", "141"], grade: "C", source: CONCERT },
  battersEye: {
    label: "打者之眼（138、139 的位置）：深色座位的示意量體，不能查詢",
    value: { seatColor: "#16181b" },
    grade: "C",
    source: INTERIOR_PHOTO,
  },
  wallSampleDeg: { label: "外野牆圓弧取樣間隔", value: 5, unit: "°", grade: "C", source: "建模選擇" },
  warningTrack: { label: "警戒區寬", value: 4.5, unit: "m", grade: "C", source: ESTIMATE },
  outfieldFence: {
    label: "全壘打牆（沿外野牆外側的護牆）",
    value: { height: 2.5, thickness: 0.3, color: "#1d3447" },
    grade: "C",
    source: INTERIOR_PHOTO,
  },
  foulPoleMarker: { label: "界外桿（黃色）", value: { height: 18, width: 0.4, color: "#f0c419" }, grade: "C", source: INTERIOR_PHOTO },
  shellWallHeight: {
    label: "穹頂牆頂高度（屋頂起拱處）",
    value: 44,
    unit: "m",
    grade: "C",
    source: `${PHOTO}；原本估 38 m，加上 L5 示意量體（最高一排約 39.5 m）後調高，${INTERIOR_PHOTO}`,
  },
  upperMassing: {
    label: "上層看台示意量體（只畫外觀、不能查詢）",
    value: { levels: ["L3", "L4", "L5"], noHomeArc: ["L3"], overL2Row: 14, rows: 6, rowRise: 0.5, floorGap: 4, outfieldOverRow: 8, outfieldRows: 10 },
    grade: "C",
    source:
      "樓層與區號（L2 外野 233–244、L3 301–317、L4 401–417、L5 503–515）見 https://waihann.tw/1136/taipeidome-seatview/ ；L4 只有 6 排見 https://www.nownews.com/news/6534334 ；L3 中央是包廂見 https://uptogo.com.tw/?p=1729172 。外框留空讓本壘後方沒有水平空間，所以 L3–L5 疊在 L2 後段正上方；L3、L5 的排數、層間距、L2 外野的位置與排數都是估算",
  },
  screens: {
    label: "牆上的大螢幕（依拍照目視估計，非量測值）",
    value: {
      centerField: { width: 28, height: 9, bottom: 20 },
      corners: { width: 9, height: 5, bottom: 16, offsetDeg: 40 },
      wallMargin: 0.6,
      litOn: ["baseball"],
    },
    grade: "C",
    source: `${PHOTO}；演唱會時全部熄滅`,
  },
  shellOutlineStepDeg: { label: "穹頂底面輪廓取樣間隔（沿用外框摘要的超橢圓）", value: 2, unit: "°", grade: "C", source: "建模選擇" },
  baseCutout: {
    label: "一壘、三壘紅土方塊邊長（內野其餘是人工草皮；二壘在參考照片裡被打擊練習網擋住，不畫）",
    value: 4.5,
    unit: "m",
    grade: "C",
    source: INTERIOR_PHOTO,
  },
  fieldColors: {
    label: "球場地面與線條顏色",
    value: { grass: "#5a9a3a", dirt: "#c9652b", track: "#c25f2a", line: "#f2f2f2" },
    grade: "C",
    source: `${PHOTO}；橘色依 ${INTERIOR_PHOTO} 調亮`,
  },
  groundLayers: {
    label: "地面圖層高度",
    value: { step: 0.01, lineY: 0.08 },
    unit: "m",
    grade: "C",
    source: "建模選擇：地面圖層每層高 1 cm 避免重疊閃爍，線條畫在所有平面圖層之上",
  },
  floorBlocks: {
    label: "搖滾區 F1–F3",
    value: { fromX: -25, toX: 25, frontZ: [-38, -18, 2], rows: 20, rowDepth: 0.9, seatsPerRow: 100 },
    grade: "C",
    source: CONCERT,
  },
  stage: {
    label: "舞台",
    value: { center: { x: 0, y: 1, z: -50 }, size: { x: 40, y: 2, z: 16 } },
    grade: "C",
    source: CONCERT,
  },
  concertFocus: {
    label: "concert focus",
    value: { x: 0, y: 3.5, z: -50 },
    grade: "C",
    source: `${CONCERT}；舞台高 2 m＋表演者視線約 1.5 m`,
  },
} as const satisfies Record<string, Sourced>;

export const DISCLAIMER =
  "本模型為依公開報導、公開座位圖的票區編號與棒球規則推算的近似模型，非官方圖面；區號採官方票區號，但每區形狀、排與號是模型推算，只保證少數票面標籤存在，不對應實際座位位置，不應作為購票依據。";

/** 每區每排的隱含座位間距必須落在這個範圍（m），否則報錯。 */
export const SEAT_SPACING = { min: 0.45, max: 0.65 };

/** 外框摘要（含擺放位置）；測試與擬合工具共用。 */
export const OUTLINE: Superellipse = { center: K.outlinePlacement.value, ...K.outline.value };

export const FIELD = fieldGeometry(K.plateZ.value, K.foulPole.value, K.centerField.value);

/** 直線區與外野「非最遠端」的區：它們的寬度由切分決定，所以票面標籤要轉成最小寬度；弧區平分、最遠端另有規則。 */
const WIDTH_BY_SPLIT = new Set([
  ...["103", "104", "105", "106", "120", "121", "122", "123"],
  ...["202", "203", "204", "205", "206", "220", "221", "222", "223", "224"],
  ...["132", "133", "134", "135", "136", "137", "140", "141", "142", "143", "144", "145"],
]);

/** 官方票區的看台參數（由 K 組成）。票面標籤要求的席數 × 座位寬 + 半個座位寬 = 最小寬度。 */
export const DEFAULT_OFFICIAL: OfficialParams = {
  foulOffset: K.foulOffset.value,
  rowDepth: K.rowDepth.value,
  pitch: K.seatPitch.value,
  outlineMargin: K.outlineMargin.value,
  outfieldClearance: K.outfieldClearance.value,
  b1: { rows: K.officialLayout.value.b1Rows, rowRise: K.lowerDeck.value.rowRise, baseHeight: K.b1FrontHeight.value },
  outfield: { rows: K.officialLayout.value.outfieldRows, ...K.lowerDeck.value, eyeHalfDeg: K.officialLayout.value.eyeHalfDeg },
  l2: {
    startRow: K.officialLayout.value.l2StartRow,
    rows: K.officialLayout.value.l2Rows,
    defaultRows: K.officialLayout.value.l2DefaultRows,
    rowRise: K.upperDeck.value.rowRise,
    headroom: K.headroom.value,
  },
  endCap: K.officialLayout.value.endCap,
  labels: TICKET_LABELS,
  homeCenterBack: K.officialLayout.value.homeCenterBack,
  homeHalfSpan: K.officialLayout.value.homeHalfSpan,
  sideRadius: K.officialLayout.value.sideRadius,
  farBackWidth: K.officialLayout.value.farBackWidth,
  exactLastRow: EXACT_LAST_ROW,
  minWidth: Object.fromEntries(
    TICKET_LABELS.filter(([id]) => WIDTH_BY_SPLIT.has(id)).map(([id, , seat]) => [id, seat * K.seatPitch.value + K.seatPitch.value / 2]),
  ),
  outfieldWidthRow: K.officialLayout.value.outfieldWidthRow,
  concertClosed: [...K.concertClosed.value],
  eyeSeatColor: K.battersEye.value.seatColor,
  upper: { ...K.upperMassing.value, levels: [...K.upperMassing.value.levels], noHomeArc: [...K.upperMassing.value.noHomeArc] },
};

// ── 幾何 ──

const DEG = Math.PI / 180;
/** 輸出到 mm，JSON 好讀；誤差遠小於不變量的容許值。 */
const mm = (v: number) => Math.round(v * 1000) / 1000;
const point = (x: number, z: number): PlanPoint => ({ x: mm(x), z: mm(z) });

/** 從本壘往場內、偏離本壘–中外野軸線 offsetDeg 度（正 = 一壘側 +x）走 distance 公尺。 */
function fromPlate(plate: PlanPoint, distance: number, offsetDeg: number): PlanPoint {
  return point(plate.x + distance * Math.sin(offsetDeg * DEG), plate.z - distance * Math.cos(offsetDeg * DEG));
}

/** 通過 left → middle → right 的圓弧，從 middle 往兩側每 stepDeg 取一點，兩端點一定包含在內。 */
function arcThrough(left: PlanPoint, middle: PlanPoint, right: PlanPoint, stepDeg: number): PlanPoint[] {
  const { center, radius } = circleThrough(left, middle, right);
  const angleOf = (p: PlanPoint) => Math.atan2(p.z - center.z, p.x - center.x) / DEG;
  const [aLeft, aMiddle, aRight] = [angleOf(left), angleOf(middle), angleOf(right)];
  if (!(aLeft < aMiddle && aMiddle < aRight)) throw new Error("外野牆圓弧方向不如預期，請檢查三點位置");
  const at = (deg: number) => point(center.x + radius * Math.cos(deg * DEG), center.z + radius * Math.sin(deg * DEG));

  const leftSide: PlanPoint[] = [];
  for (let deg = aMiddle - stepDeg; deg > aLeft; deg -= stepDeg) leftSide.unshift(at(deg));
  const rightSide: PlanPoint[] = [];
  for (let deg = aMiddle + stepDeg; deg < aRight; deg += stepDeg) rightSide.push(at(deg));
  return [left, ...leftSide, middle, ...rightSide, right];
}

/** 以 center 為圓心、半徑 r 的圓弧：角度從 fromDeg 線性走到 toDeg（含兩端），每段不超過 stepDeg。 */
function arc(center: PlanPoint, r: number, fromDeg: number, toDeg: number, stepDeg: number): PlanPoint[] {
  const segments = Math.max(1, Math.ceil(Math.abs(toDeg - fromDeg) / stepDeg));
  return Array.from({ length: segments + 1 }, (_, i) => {
    const deg = fromDeg + ((toDeg - fromDeg) * i) / segments;
    return point(center.x + r * Math.cos(deg * DEG), center.z + r * Math.sin(deg * DEG));
  });
}

/** 正多邊形近似的圓（不重複起點）。 */
function circle(center: PlanPoint, r: number, count = 48): PlanPoint[] {
  return Array.from({ length: count }, (_, i) => point(center.x + r * Math.cos((2 * Math.PI * i) / count), center.z + r * Math.sin((2 * Math.PI * i) / count)));
}

const angleAt = (center: PlanPoint, p: PlanPoint) => Math.atan2(p.z - center.z, p.x - center.x) / DEG;

/** 從圓內的 origin 沿 offsetDeg 方向（同 fromPlate 的角度慣例）走到圓周上的那一點。 */
function toCircle(origin: PlanPoint, offsetDeg: number, center: PlanPoint, r: number): PlanPoint {
  const dir = { x: Math.sin(offsetDeg * DEG), z: -Math.cos(offsetDeg * DEG) };
  const [ox, oz] = [origin.x - center.x, origin.z - center.z];
  const b = ox * dir.x + oz * dir.z;
  const t = -b + Math.sqrt(b * b - (ox * ox + oz * oz - r * r));
  return point(origin.x + t * dir.x, origin.z + t * dir.z);
}

/**
 * 球場地面（由下往上）：界外地紅土、界內草皮、警戒區、一壘與三壘紅土方塊、本壘圓、投手丘。
 * 大巨蛋內野是人工草皮：紅土只有本壘、投手丘和壘包周圍；95 呎內野弧畫成白線（infieldArcLine）。
 * 尺寸：本壘圓、投手丘、壘間是規則值（A）；警戒區寬、壘包方塊、顏色是 C。
 */
function fieldSurfaces(plate: PlanPoint, wallArc: PlanPoint[]) {
  const colors = K.fieldColors.value;
  const step = K.groundLayers.value.step;
  const flat = (id: string, layer: number, color: string, points: PlanPoint[], surface: "turf" | "dirt") => ({
    type: "polygon" as const,
    id,
    points,
    y: mm(step * layer),
    color,
    surface,
  });

  const pitcher = point(plate.x, plate.z - K.plateToPitcher.value);

  const { wallCenter, wallRadius } = FIELD;
  const trackRadius = wallRadius - K.warningTrack.value;
  const trackRight = toCircle(plate, 45, wallCenter, trackRadius);
  const trackLeft = toCircle(plate, -45, wallCenter, trackRadius);

  // 壘包方塊：邊與壘線平行（±45°），所以頂點在壘包往上下左右各 邊長 / √2
  const cutout = (base: PlanPoint) => {
    const h = K.baseCutout.value / Math.SQRT2;
    return [point(base.x, base.z + h), point(base.x + h, base.z), point(base.x, base.z - h), point(base.x - h, base.z)];
  };

  return [
    flat("field-dirt", 1, colors.dirt, superellipsePolygon(OUTLINE, 4).map((p) => point(p.x, p.z)), "dirt"),
    flat("fair-grass", 2, colors.grass, [plate, ...wallArc], "turf"),
    flat("warning-track", 3, colors.track, [
      ...wallArc,
      ...arc(wallCenter, trackRadius, angleAt(wallCenter, trackRight), angleAt(wallCenter, trackLeft), K.wallSampleDeg.value),
    ], "dirt"),
    flat("first-base-dirt", 4, colors.dirt, cutout(fromPlate(plate, K.basePath.value, 45)), "dirt"),
    flat("third-base-dirt", 5, colors.dirt, cutout(fromPlate(plate, K.basePath.value, -45)), "dirt"),
    flat("home-circle", 6, colors.dirt, circle(plate, K.homeCircle.value), "dirt"),
    {
      type: "polygon" as const,
      id: "mound",
      points: circle(pitcher, K.moundDiameter.value / 2),
      y: K.moundHeight.value,
      height: K.moundHeight.value,
      color: colors.dirt,
      surface: "dirt" as const,
    },
  ];
}

/**
 * 全壘打牆：外野牆每一段弦一個 box，貼在牆線外側（中心往外推「弦到弧的距離 + 半個牆厚」），
 * 加上兩根黃色界外桿。只在 baseball。
 */
function fenceAndPoles(wallArc: PlanPoint[]) {
  const { height, thickness, color } = K.outfieldFence.value;
  const { wallCenter } = FIELD;
  const fence = wallArc.slice(1).map((b, i) => {
    const a = wallArc[i] as PlanPoint;
    const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    const r = Math.hypot(mid.x - wallCenter.x, mid.z - wallCenter.z);
    const out = { x: (mid.x - wallCenter.x) / r, z: (mid.z - wallCenter.z) / r };
    const sagitta = FIELD.wallRadius - r;
    const push = sagitta + thickness / 2;
    return {
      type: "box" as const,
      id: `outfield-fence-${i + 1}`,
      center: { x: mm(mid.x + out.x * push), y: height / 2, z: mm(mid.z + out.z * push) },
      size: { x: mm(Math.hypot(b.x - a.x, b.z - a.z)), y: height, z: thickness },
      yawDeg: mm(angleAt(a, b)),
      color,
    };
  });
  const pole = K.foulPoleMarker.value;
  const poles = (
    [
      ["foul-pole-left", wallArc[0]],
      ["foul-pole-right", wallArc.at(-1)],
    ] as const
  ).map(([id, p]) => ({
    type: "box" as const,
    id,
    center: { x: p?.x ?? NaN, y: pole.height / 2, z: p?.z ?? NaN },
    size: { x: pole.width, y: pole.height, z: pole.width },
    color: pole.color,
  }));
  return [...fence, ...poles];
}

/** 95 呎內野弧：大巨蛋是人工草皮，這條弧是畫在草皮上的白線，兩端落在界外線上。 */
function infieldArcLine(plate: PlanPoint) {
  const pitcher = point(plate.x, plate.z - K.plateToPitcher.value);
  const right = toCircle(plate, 45, pitcher, K.infieldArc.value);
  const left = toCircle(plate, -45, pitcher, K.infieldArc.value);
  return {
    type: "polyline" as const,
    id: "infield-arc",
    points: arc(pitcher, K.infieldArc.value, angleAt(pitcher, right), angleAt(pitcher, left), 3),
    y: K.groundLayers.value.lineY,
  };
}

/**
 * 牆上的螢幕：從本壘沿 offsetDeg 方向走到穹頂輪廓，面朝本壘；
 * 再往本壘方向退，直到四個角都在輪廓內並留 wallMargin（螢幕是平面、牆是弧面）。
 */
function wallScreen(id: string, plate: PlanPoint, outline: PlanPoint[], offsetDeg: number, size: { width: number; height: number; bottom: number }): Screen {
  const dir = { x: Math.sin(offsetDeg * DEG), z: -Math.cos(offsetDeg * DEG) };
  // 二分法找輪廓上的點（本壘在輪廓內）
  let [inside, outside] = [0, 400];
  for (let i = 0; i < 60; i++) {
    const mid = (inside + outside) / 2;
    if (pointInPolygon(outline, { x: plate.x + dir.x * mid, z: plate.z + dir.z * mid })) inside = mid;
    else outside = mid;
  }
  const { wallMargin, litOn } = K.screens.value;
  for (let back = 0; back < 20; back += 0.25) {
    const center = point(plate.x + dir.x * (inside - back), plate.z + dir.z * (inside - back));
    const facingYawDeg = Math.round((Math.atan2(plate.z - center.z, plate.x - center.x) / DEG) * 100) / 100;
    const screen: Screen = {
      id,
      center: { x: center.x, y: mm(size.bottom + size.height / 2), z: center.z },
      width: size.width,
      height: size.height,
      facingYawDeg,
      onLayouts: [...litOn],
    };
    if (screenCorners(screen).every((c) => signedDistance(outline, c) >= wallMargin)) return screen;
  }
  throw new Error(`${id} 螢幕放不進穹頂輪廓`);
}

/** 每排的隱含座位間距（這一排實際用的長度 ÷ 席數）必須合理，否則報錯。 */
function checkSpacing(section: Section): void {
  const rowLength = (row: number) => {
    const [start, end] = section.rowSpans?.[row] ?? [0, 1];
    if (section.type === "linear") return Math.hypot(section.to.x - section.from.x, section.to.z - section.from.z) * (end - start);
    return (section.innerRadius + section.rowDepth * row) * Math.abs(section.toDeg - section.fromDeg) * DEG * (end - start);
  };
  for (let row = 0; row < section.rows; row++) {
    const seats = typeof section.seatsPerRow === "number" ? section.seatsPerRow : (section.seatsPerRow[row] ?? NaN);
    const spacing = rowLength(row) / seats;
    if (!(spacing >= SEAT_SPACING.min && spacing <= SEAT_SPACING.max)) {
      throw new Error(`${section.id} 第 ${row + 1} 排隱含座位間距 ${spacing.toFixed(3)} m 不在 0.45–0.65 m`);
    }
  }
}

function floorSection(id: string, name: string, frontZ: number): Section {
  const { fromX, toX, rows, rowDepth, seatsPerRow } = K.floorBlocks.value;
  return {
    id,
    name,
    type: "linear" as const,
    from: point(fromX, frontZ),
    to: point(toX, frontZ),
    facing: point(K.concertFocus.value.x, K.concertFocus.value.z),
    rows,
    rowDepth,
    rowRise: 0,
    baseHeight: 0,
    seatsPerRow,
    layouts: ["concert"],
  };
}

// ── 組出場館 ──

/** 可以替換的 C 級參數；敏感度分析用。預設值就是 K 裡的估算。 */
export interface ModelParams {
  official: OfficialParams;
  strikeZoneY: number;
}

export const DEFAULT_PARAMS: ModelParams = { official: DEFAULT_OFFICIAL, strikeZoneY: K.strikeZoneY.value };

/** 這一區的總席數。 */
export const seatCount = (s: Section): number =>
  typeof s.seatsPerRow === "number" ? s.seatsPerRow * s.rows : s.seatsPerRow.reduce((a, b) => a + b, 0);

export type Layer = keyof typeof K.layerSeats.value;

/** 依官方區號分層加總（F 區不算）；拿來跟 K.layerSeats 對照偏差，不拿來縮放。 */
export function layerTotals(sections: Section[]): Record<Layer, number> {
  const totals: Record<Layer, number> = { b1Infield: 0, b1Outfield: 0, l2Infield: 0 };
  for (const s of sections) {
    const n = Number(s.id);
    const layer = n >= 102 && n <= 124 ? "b1Infield" : n >= 131 && n <= 146 ? "b1Outfield" : n >= 201 && n <= 225 ? "l2Infield" : null;
    if (layer) totals[layer] += seatCount(s);
  }
  return totals;
}

export function buildTaipeiDome(params: ModelParams = DEFAULT_PARAMS) {
  const plate = point(0, K.plateZ.value);
  const rightPole = fromPlate(plate, K.foulPole.value, 45);
  const leftPole = fromPlate(plate, K.foulPole.value, -45);
  const centerFieldWall = point(plate.x, plate.z - K.centerField.value);
  const wallArc = arcThrough(leftPole, centerFieldWall, rightPole, K.wallSampleDeg.value);
  const lineY = K.groundLayers.value.lineY;
  const shellOutline = superellipsePolygon(OUTLINE, K.shellOutlineStepDeg.value).map((p) => point(p.x, p.z));
  const [f1z, f2z, f3z] = K.floorBlocks.value.frontZ;
  // 看台截斷用的外框：跟不變量測試用同一個取樣（1°），留空的判斷才一致
  const clipOutline = superellipsePolygon(OUTLINE, 1);
  const sections: Section[] = [
    ...officialStands(FIELD, clipOutline, params.official),
    floorSection("F1", "搖滾區 1（模型分區）", f1z),
    floorSection("F2", "搖滾區 2", f2z),
    floorSection("F3", "搖滾區 3", f3z),
  ];
  sections.forEach(checkSpacing);

  return {
    schemaVersion: 1,
    id: "taipei-dome",
    name: "臺北大巨蛋（近似模型）",
    meta: {
      disclaimer: DISCLAIMER,
      provenance: Object.entries(K).map(([key, c]: [string, Sourced]) => ({
        key,
        value: `${c.label}：${typeof c.value === "object" ? JSON.stringify(c.value) : c.value}${c.unit ? ` ${c.unit}` : ""}`,
        grade: c.grade,
        source: c.source,
      })),
    },
    sections,
    // 穹頂外殼：底面輪廓就是外框摘要的超橢圓（座位離它 ≥ 3 m），不另外取 OSM 座標
    shell: {
      outline: shellOutline,
      wallHeight: K.shellWallHeight.value,
      roofHeight: K.shellRoofHeight.value,
      screens: [
        wallScreen("center-field", plate, shellOutline, 0, K.screens.value.centerField),
        wallScreen("left-corner", plate, shellOutline, -K.screens.value.corners.offsetDeg, K.screens.value.corners),
        wallScreen("right-corner", plate, shellOutline, K.screens.value.corners.offsetDeg, K.screens.value.corners),
      ],
    },
    layouts: {
      baseball: {
        name: "棒球",
        // 本壘板；facingDeg 90 = 朝本壘後方，所以水平偏角 0° = 本壘正後方、一壘側為正
        focus: { position: { x: plate.x, y: params.strikeZoneY, z: plate.z }, facingDeg: 90 },
        overlays: [
          ...fieldSurfaces(plate, wallArc),
          { type: "polyline", id: "foul-line-left", points: [plate, leftPole], y: lineY },
          { type: "polyline", id: "foul-line-right", points: [plate, rightPole], y: lineY },
          { type: "polyline", id: "outfield-wall", points: wallArc, y: lineY },
          infieldArcLine(plate),
          ...fenceAndPoles(wallArc),
          {
            type: "polyline",
            id: "infield",
            closed: true,
            y: lineY,
            points: [
              plate,
              fromPlate(plate, K.basePath.value, 45),
              point(plate.x, plate.z - K.plateToSecond.value),
              fromPlate(plate, K.basePath.value, -45),
            ],
          },
        ],
      },
      concert: {
        name: "演唱會（暫定假設：外野端台）",
        // 舞台面朝 +z（朝內野看台）；位置、尺寸、高度都是假設，之後只改這裡與 F 區
        focus: { position: K.concertFocus.value, facingDeg: 90 },
        overlays: [{ type: "box", id: "stage", ...K.stage.value }],
      },
    },
  };
}
