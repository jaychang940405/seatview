/**
 * 臺北大巨蛋近似模型（方案 B）：常數表與場館組裝。
 *   寫檔：gen-taipei-dome.ts（npm run gen:dome）
 *   看台參數擬合：fit-dome-layout.ts（npm run fit:dome）
 *   敏感度分析：sensitivity.ts（npm run sensitivity）
 *
 * 所有數字集中在下面的 K，每個都標來源等級：
 *   A = 規則或官方定義、B = 新聞報導（非官方圖面）、C = 本專案估算。
 * C 級數字只是估算起點，不可在文件或 UI 寫成事實。要調整估算值時只改這個檔案，再重新產生。
 *
 * 座標（同 src/core/schema.ts）：m；Y 向上；場地 y = 0；平面 x 向右、z 向下；角度 0° = +x、90° = +z。
 * 原點 = 本壘到中外野牆連線的中點；本壘在 +z 側，中外野在 −z 側。
 */
import { buildStands, circleThrough, fieldGeometry, type LayoutParams, type StandSection } from "./dome-layout.ts";
import { superellipsePolygon, type PlanPoint, type Superellipse } from "./outline.ts";

type Grade = "A" | "B" | "C";
interface Sourced {
  label: string;
  value: number | string | readonly number[] | Record<string, unknown>;
  unit?: string;
  grade: Grade;
  source: string;
}

const NOWNEWS = "https://www.nownews.com/news/6860709";
const TN_UPPER_DECK = "https://www.taiwannews.com.tw/zh/news/5054311";
const TN_FIRST_SALE = "https://www.taiwannews.com.tw/zh/news/5046938";
const TN_TOTAL = "https://www.taiwannews.com.tw/zh/news/5089544";
const TVBS = "https://news.tvbs.com.tw/sports/2429115";
const TVBS_HEIGHT = "https://news.tvbs.com.tw/amp/english/2615405";
const LTN_HEIGHT = "https://ec.ltn.com.tw/article/paper/850989";
const OSM = "© OpenStreetMap contributors（ODbL），圓頂分件 way 1304278778";
const ESTIMATE = "本專案估算（非量測）";
const FIT = "npm run fit:dome 擬合結果（超橢圓外框摘要、外圈留空 3 m）";
const CONCERT = "演唱會暫定假設（每場演出不同，非場館屬性）";
const PHOTO = "依使用者自己拍攝的照片目視估計（照片不在 repo，非量測值）";

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
  seatsLowerDecks: {
    label: "內野一層＋外野一層席數（錨點）",
    value: 17000,
    unit: "席",
    grade: "B",
    source: `推算：${TN_UPPER_DECK} 約 22,000 人 − 內野二層約 4,700 ≈ 17,300；${TN_FIRST_SALE} 首波 1.3 萬＋外野約 4,000 ≈ 17,000`,
  },
  seatsInfieldUpper: { label: "內野二層席數（錨點）", value: 4700, unit: "席", grade: "B", source: TN_UPPER_DECK },
  seatsTotal: { label: "總席位（不建模，只說明範圍）", value: 40000, unit: "席", grade: "B", source: TN_TOTAL },
  tierNames: { label: "層名", value: "內野一層、內野二層、外野一層", grade: "B", source: `${TVBS} 等報導` },
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
  infieldArc: { label: "內野紅土弧半徑（以投手板為圓心）", value: 28.96, unit: "m", grade: "A", source: "棒球規則（95 呎）；畫面外觀用" },
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
  outlinePlacement: { label: "外框中心在模型座標的位置", value: { x: 1, z: 6.95 }, grade: "C", source: FIT },
  outlineMargin: { label: "外圈留空（看台離外框的最小距離）", value: 3, unit: "m", grade: "C", source: ESTIMATE },
  headroom: { label: "上下兩層座位之間的垂直淨空", value: 2.5, unit: "m", grade: "C", source: ESTIMATE },
  maxLowerRows: { label: "一層排數上限", value: 30, unit: "排", grade: "C", source: "經驗上限，不是量測值" },
  foulOffset: {
    label: "一層前緣離本壘與界外線的距離",
    value: 18.3,
    unit: "m",
    grade: "C",
    source: "棒球規則建議本壘到後擋網 60 呎以上；沿用到界外線兩側是本專案假設",
  },
  rowDepth: { label: "看台排距", value: 0.85, unit: "m", grade: "C", source: ESTIMATE },
  seatPitch: { label: "座位寬（每排席數 = 長度 ÷ 座位寬取整）", value: 0.5, unit: "m", grade: "C", source: ESTIMATE },
  lowerDeck: { label: "一層高度", value: { rowRise: 0.35, baseHeight: 3 }, grade: "C", source: ESTIMATE },
  upperDeck: { label: "二層高度（baseHeight = 一層後排 + 淨空）", value: { rowRise: 0.5 }, grade: "C", source: ESTIMATE },
  outfieldClearance: { label: "外野看台離外野牆的淨空", value: 3, unit: "m", grade: "C", source: ESTIMATE },
  fittedLayout: {
    label: "擬合出的看台參數",
    value: {
      lowerRows: 30,
      lowerLineLength: 57.5,
      upperStartRow: 19,
      upperRows: 14,
      upperLineLength: 52.5,
      outfieldInsetDeg: 32,
      outfieldSideRows: 21,
      outfieldCenterRows: 30,
    },
    grade: "C",
    source: FIT,
  },
  wallSampleDeg: { label: "外野牆圓弧取樣間隔", value: 5, unit: "°", grade: "C", source: "建模選擇" },
  warningTrack: { label: "警戒區寬", value: 4.5, unit: "m", grade: "C", source: ESTIMATE },
  shellWallHeight: { label: "穹頂牆頂高度（屋頂起拱處）", value: 38, unit: "m", grade: "C", source: PHOTO },
  shellOutlineStepDeg: { label: "穹頂底面輪廓取樣間隔（沿用外框摘要的超橢圓）", value: 2, unit: "°", grade: "C", source: "建模選擇" },
  infieldGrassInset: { label: "內野草皮離壘線內縮", value: 1.2, unit: "m", grade: "C", source: "畫面外觀用" },
  fieldColors: {
    label: "球場地面與線條顏色",
    value: { grass: "#5f9a3c", dirt: "#b5663b", track: "#9e5934", line: "#f2f2f2" },
    grade: "C",
    source: PHOTO,
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
  "本模型為依公開報導與棒球規則推算的近似模型，非官方圖面；區、排、號為模型內部編號，不對應實際票面，不應作為購票依據。";

/** 每區每排的隱含座位間距必須落在這個範圍（m），否則報錯。 */
export const SEAT_SPACING = { min: 0.45, max: 0.65 };

/** 外框摘要（含擺放位置）；測試與擬合工具共用。 */
export const OUTLINE: Superellipse = { center: K.outlinePlacement.value, ...K.outline.value };

export const FIELD = fieldGeometry(K.plateZ.value, K.foulPole.value, K.centerField.value);

/** 方案 B 的看台參數（由 K 組成）。 */
export const DEFAULT_LAYOUT: LayoutParams = {
  foulOffset: K.foulOffset.value,
  rowDepth: K.rowDepth.value,
  pitch: K.seatPitch.value,
  lower: {
    rows: K.fittedLayout.value.lowerRows,
    lineLength: K.fittedLayout.value.lowerLineLength,
    ...K.lowerDeck.value,
  },
  upper: {
    startRow: K.fittedLayout.value.upperStartRow,
    rows: K.fittedLayout.value.upperRows,
    lineLength: K.fittedLayout.value.upperLineLength,
    rowRise: K.upperDeck.value.rowRise,
    headroom: K.headroom.value,
  },
  outfield: {
    clearance: K.outfieldClearance.value,
    insetDeg: K.fittedLayout.value.outfieldInsetDeg,
    sideRows: K.fittedLayout.value.outfieldSideRows,
    centerRows: K.fittedLayout.value.outfieldCenterRows,
    rowRise: K.lowerDeck.value.rowRise,
    baseHeight: K.lowerDeck.value.baseHeight,
  },
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
 * 球場地面（由下往上）：界外地紅土、界內草皮、警戒區、內野紅土、內野草皮、本壘圓、投手丘。
 * 尺寸：內野弧、本壘圓、投手丘是規則值（A）；警戒區寬、內野草皮內縮、顏色是 C。
 */
function fieldSurfaces(plate: PlanPoint, wallArc: PlanPoint[]) {
  const colors = K.fieldColors.value;
  const step = K.groundLayers.value.step;
  const flat = (id: string, layer: number, color: string, points: PlanPoint[]) => ({ type: "polygon" as const, id, points, y: mm(step * layer), color });

  const pitcher = point(plate.x, plate.z - K.plateToPitcher.value);
  const infieldRight = toCircle(plate, 45, pitcher, K.infieldArc.value);
  const infieldLeft = toCircle(plate, -45, pitcher, K.infieldArc.value);

  const { wallCenter, wallRadius } = FIELD;
  const trackRadius = wallRadius - K.warningTrack.value;
  const trackRight = toCircle(plate, 45, wallCenter, trackRadius);
  const trackLeft = toCircle(plate, -45, wallCenter, trackRadius);

  const diamondCenter = point(plate.x, plate.z - K.plateToSecond.value / 2);
  const grassHalf = K.basePath.value / Math.SQRT2 - K.infieldGrassInset.value * Math.SQRT2;

  return [
    flat("field-dirt", 1, colors.dirt, superellipsePolygon(OUTLINE, 4).map((p) => point(p.x, p.z))),
    flat("fair-grass", 2, colors.grass, [plate, ...wallArc]),
    flat("warning-track", 3, colors.track, [
      ...wallArc,
      ...arc(wallCenter, trackRadius, angleAt(wallCenter, trackRight), angleAt(wallCenter, trackLeft), K.wallSampleDeg.value),
    ]),
    flat("infield-dirt", 4, colors.dirt, [plate, ...arc(pitcher, K.infieldArc.value, angleAt(pitcher, infieldRight), angleAt(pitcher, infieldLeft), 3)]),
    flat("infield-grass", 5, colors.grass, [
      point(diamondCenter.x, diamondCenter.z + grassHalf),
      point(diamondCenter.x + grassHalf, diamondCenter.z),
      point(diamondCenter.x, diamondCenter.z - grassHalf),
      point(diamondCenter.x - grassHalf, diamondCenter.z),
    ]),
    flat("home-circle", 6, colors.dirt, circle(plate, K.homeCircle.value)),
    {
      type: "polygon" as const,
      id: "mound",
      points: circle(pitcher, K.moundDiameter.value / 2),
      y: K.moundHeight.value,
      height: K.moundHeight.value,
      color: colors.dirt,
    },
  ];
}

/** 每排的隱含座位間距（排長 ÷ 席數）必須合理，否則報錯。 */
function checkSpacing(section: StandSection | ReturnType<typeof floorSection>): void {
  const rowLength = (row: number) => {
    if (section.type === "linear") return Math.hypot(section.to.x - section.from.x, section.to.z - section.from.z);
    const arc = section as Extract<StandSection, { type: "arc" }>;
    return (arc.innerRadius + arc.rowDepth * row) * Math.abs(arc.toDeg - arc.fromDeg) * DEG;
  };
  for (let row = 0; row < section.rows; row++) {
    const seats = typeof section.seatsPerRow === "number" ? section.seatsPerRow : (section.seatsPerRow[row] ?? NaN);
    const spacing = rowLength(row) / seats;
    if (!(spacing >= SEAT_SPACING.min && spacing <= SEAT_SPACING.max)) {
      throw new Error(`${section.id} 第 ${row + 1} 排隱含座位間距 ${spacing.toFixed(3)} m 不在 0.45–0.65 m`);
    }
  }
}

function floorSection(id: string, name: string, frontZ: number) {
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
  layout: LayoutParams;
  strikeZoneY: number;
}

export const DEFAULT_PARAMS: ModelParams = { layout: DEFAULT_LAYOUT, strikeZoneY: K.strikeZoneY.value };

export function buildTaipeiDome(params: ModelParams = DEFAULT_PARAMS) {
  const plate = point(0, K.plateZ.value);
  const rightPole = fromPlate(plate, K.foulPole.value, 45);
  const leftPole = fromPlate(plate, K.foulPole.value, -45);
  const centerFieldWall = point(plate.x, plate.z - K.centerField.value);
  const wallArc = arcThrough(leftPole, centerFieldWall, rightPole, K.wallSampleDeg.value);
  const lineY = K.groundLayers.value.lineY;
  const [f1z, f2z, f3z] = K.floorBlocks.value.frontZ;
  const sections = [
    ...buildStands(FIELD, params.layout),
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
      outline: superellipsePolygon(OUTLINE, K.shellOutlineStepDeg.value).map((p) => point(p.x, p.z)),
      wallHeight: K.shellWallHeight.value,
      roofHeight: K.shellRoofHeight.value,
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
