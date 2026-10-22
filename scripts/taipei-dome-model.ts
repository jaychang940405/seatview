/**
 * 臺北大巨蛋近似模型：常數表與場館組裝。
 * 寫檔在 gen-taipei-dome.ts（npm run gen:dome）；敏感度分析在 sensitivity.ts 用不同參數呼叫 buildTaipeiDome。
 *
 * 所有數字集中在下面的 K，每個都標來源等級：
 *   A = 規則或官方定義、B = 新聞報導（非官方圖面）、C = 本專案估算。
 * C 級數字只是估算起點，不可在文件或 UI 寫成事實。要調整估算值時只改這個檔案，再重新產生。
 *
 * 座標（同 src/core/schema.ts）：m；Y 向上；場地 y = 0；平面 x 向右、z 向下；角度 0° = +x、90° = +z。
 * 原點 = 本壘到中外野牆連線的中點；本壘在 +z 側，中外野在 −z 側。
 */

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
const ESTIMATE = "本專案估算（非量測）";
const CONCERT = "演唱會暫定假設（每場演出不同，非場館屬性）";

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
    label: "內野一層＋外野一層席數",
    value: 17000,
    unit: "席",
    grade: "B",
    source: `推算：${TN_UPPER_DECK} 約 22,000 人 − 內野二層約 4,700 ≈ 17,300；${TN_FIRST_SALE} 首波 1.3 萬＋外野約 4,000 ≈ 17,000`,
  },
  seatsInfieldUpper: { label: "內野二層席數", value: 4700, unit: "席", grade: "B", source: TN_UPPER_DECK },
  seatsTotal: { label: "總席位（不建模，只說明範圍）", value: 40000, unit: "席", grade: "B", source: TN_TOTAL },
  tierNames: { label: "層名", value: "內野一層、內野二層、外野一層", grade: "B", source: `${TVBS} 等報導` },
  plateZ: {
    label: "本壘板 z 座標",
    value: 60.95,
    unit: "m",
    grade: "B",
    source: "由本壘到中外野距離推算（121.92 ÷ 2，因原點取在連線中點）",
  },

  // ── A：棒球規則 ──
  basePath: { label: "壘間距離", value: 27.43, unit: "m", grade: "A", source: "棒球規則（90 呎）" },
  plateToPitcher: { label: "本壘到投手板", value: 18.44, unit: "m", grade: "A", source: "棒球規則（60 呎 6 吋）" },
  plateToSecond: { label: "本壘到二壘", value: 38.8, unit: "m", grade: "A", source: "棒球規則" },
  moundDiameter: { label: "投手丘直徑", value: 5.49, unit: "m", grade: "A", source: "棒球規則（18 呎）" },
  moundHeight: { label: "投手丘高度", value: 0.254, unit: "m", grade: "A", source: "棒球規則（10 吋）" },

  // ── C：本專案估算 ──
  origin: {
    label: "原點",
    value: "本壘到中外野牆連線的中點",
    grade: "C",
    source: "為了方便而選，視為看台中心的近似",
  },
  strikeZoneY: { label: "baseball focus 高度（好球帶中心）", value: 0.8, unit: "m", grade: "C", source: ESTIMATE },
  rowDepth: { label: "看台排距", value: 0.85, unit: "m", grade: "C", source: ESTIMATE },
  infieldLower: {
    label: "內野一層 I1（每區）",
    value: { innerRadius: 80, rows: 16, rowRise: 0.35, baseHeight: 3, seats: 3150 },
    grade: "C",
    source: `${ESTIMATE}；每區席數由 B 級總數分配`,
  },
  infieldUpper: {
    label: "內野二層 I2（每區）",
    value: { innerRadius: 100, rows: 7, rowRise: 0.5, baseHeight: 14, seats: 1570 },
    grade: "C",
    source: `${ESTIMATE}；每區席數由 B 級總數分配`,
  },
  outfieldLower: {
    label: "外野一層 O1（每區）",
    value: { innerRadius: 78, rows: 16, rowRise: 0.35, baseHeight: 3, seats: 2500 },
    grade: "C",
    source: `${ESTIMATE}；每區席數由 B 級總數分配`,
  },
  infieldSplitDeg: {
    label: "內野分區角度（一壘側→本壘後方→三壘側）",
    value: [-9, 57, 123, 189],
    unit: "°",
    grade: "C",
    source: `${ESTIMATE}；兩端約在界外桿方向，198° 三等分`,
  },
  outfieldSplitDeg: {
    label: "外野分區角度（右→中→左）",
    value: [-9, -63, -117, -171],
    unit: "°",
    grade: "C",
    source: `${ESTIMATE}；162° 三等分`,
  },
  wallSampleDeg: { label: "外野牆圓弧取樣間隔", value: 5, unit: "°", grade: "C", source: "建模選擇" },
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

/** 各區第 1 排到最後一排的隱含座位間距必須落在這個範圍（m），否則報錯，改調 rows。 */
export const SEAT_SPACING = { min: 0.45, max: 0.65 };

// ── 幾何 ──

export type PlanPoint = { x: number; z: number };
const DEG = Math.PI / 180;
/** 輸出到 mm，JSON 好讀；誤差遠小於不變量的容許值。 */
const mm = (v: number) => Math.round(v * 1000) / 1000;
const point = (x: number, z: number): PlanPoint => ({ x: mm(x), z: mm(z) });

/** 從本壘往場內、偏離本壘–中外野軸線 offsetDeg 度（正 = 一壘側 +x）走 distance 公尺。 */
function fromPlate(plate: PlanPoint, distance: number, offsetDeg: number): PlanPoint {
  return point(plate.x + distance * Math.sin(offsetDeg * DEG), plate.z - distance * Math.cos(offsetDeg * DEG));
}

function circleThrough(a: PlanPoint, b: PlanPoint, c: PlanPoint): { center: PlanPoint; radius: number } {
  const d = 2 * (a.x * (b.z - c.z) + b.x * (c.z - a.z) + c.x * (a.z - b.z));
  if (Math.abs(d) < 1e-9) throw new Error("外野牆三點共線，畫不出圓弧");
  const a2 = a.x ** 2 + a.z ** 2;
  const b2 = b.x ** 2 + b.z ** 2;
  const c2 = c.x ** 2 + c.z ** 2;
  const center = {
    x: (a2 * (b.z - c.z) + b2 * (c.z - a.z) + c2 * (a.z - b.z)) / d,
    z: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d,
  };
  return { center, radius: Math.hypot(a.x - center.x, a.z - center.z) };
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

/** 依權重（弧長）分配座位數，最後一排吸收取整誤差。 */
function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const counts = weights.map((w) => Math.round((total * w) / sum));
  const last = counts.length - 1;
  counts[last] = (counts[last] ?? 0) + total - counts.reduce((a, b) => a + b, 0);
  return counts;
}

function checkSpacing(sectionId: string, rowLengths: number[], seatsPerRow: number[]): void {
  rowLengths.forEach((length, i) => {
    const spacing = length / (seatsPerRow[i] ?? NaN);
    if (!(spacing >= SEAT_SPACING.min && spacing <= SEAT_SPACING.max)) {
      throw new Error(`${sectionId} 第 ${i + 1} 排隱含座位間距 ${spacing.toFixed(3)} m 不在 0.45–0.65 m，請調整 rows`);
    }
  });
}

export interface Tier {
  innerRadius: number;
  rows: number;
  rowRise: number;
  baseHeight: number;
  seats: number;
}

function arcSection(id: string, name: string, tier: Tier, fromDeg: number, toDeg: number, layouts?: string[]) {
  const rowDepth = K.rowDepth.value;
  const radii = Array.from({ length: tier.rows }, (_, i) => tier.innerRadius + i * rowDepth);
  const spanRad = Math.abs(toDeg - fromDeg) * DEG;
  // 每排席數 ∝ 該排弧長，外排才不會因為座位數相同而間距被拉寬
  const seatsPerRow = allocate(tier.seats, radii);
  checkSpacing(id, radii.map((r) => r * spanRad), seatsPerRow);
  return {
    id,
    name,
    type: "arc",
    center: { x: 0, z: 0 },
    innerRadius: tier.innerRadius,
    fromDeg,
    toDeg,
    rows: tier.rows,
    rowDepth,
    rowRise: tier.rowRise,
    baseHeight: tier.baseHeight,
    seatsPerRow,
    ...(layouts && { layouts }),
  };
}

function floorSection(id: string, name: string, frontZ: number) {
  const { fromX, toX, rows, rowDepth, seatsPerRow } = K.floorBlocks.value;
  checkSpacing(id, Array(rows).fill(toX - fromX), Array(rows).fill(seatsPerRow));
  return {
    id,
    name,
    type: "linear",
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
  infieldLower: Tier;
  infieldUpper: Tier;
  outfieldLower: Tier;
  /** 本壘板相對 K.plateZ 的位移（看台不動，球場整個跟著本壘移動） */
  plateOffset: PlanPoint;
}

export const DEFAULT_PARAMS: ModelParams = {
  infieldLower: K.infieldLower.value,
  infieldUpper: K.infieldUpper.value,
  outfieldLower: K.outfieldLower.value,
  plateOffset: { x: 0, z: 0 },
};

export function buildTaipeiDome(params: ModelParams = DEFAULT_PARAMS) {
  const plate = point(params.plateOffset.x, K.plateZ.value + params.plateOffset.z);
  const rightPole = fromPlate(plate, K.foulPole.value, 45);
  const leftPole = fromPlate(plate, K.foulPole.value, -45);
  const centerFieldWall = point(plate.x, plate.z - K.centerField.value);
  const [i0, i1, i2, i3] = K.infieldSplitDeg.value;
  const [o0, o1, o2, o3] = K.outfieldSplitDeg.value;
  const [f1z, f2z, f3z] = K.floorBlocks.value.frontZ;
  const { infieldLower, infieldUpper, outfieldLower } = params;

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
    sections: [
      arcSection("I1-1B", "內野一層・一壘側（模型分區）", infieldLower, i0, i1),
      arcSection("I1-HP", "內野一層・本壘後方", infieldLower, i1, i2),
      arcSection("I1-3B", "內野一層・三壘側", infieldLower, i2, i3),
      arcSection("I2-1B", "內野二層・一壘側", infieldUpper, i0, i1),
      arcSection("I2-HP", "內野二層・本壘後方", infieldUpper, i1, i2),
      arcSection("I2-3B", "內野二層・三壘側", infieldUpper, i2, i3),
      arcSection("O1-RF", "外野一層・右外野", outfieldLower, o0, o1),
      arcSection("O1-CF", "外野一層・中外野", outfieldLower, o1, o2, ["baseball"]),
      arcSection("O1-LF", "外野一層・左外野", outfieldLower, o2, o3),
      floorSection("F1", "搖滾區 1（模型分區）", f1z),
      floorSection("F2", "搖滾區 2", f2z),
      floorSection("F3", "搖滾區 3", f3z),
    ],
    layouts: {
      baseball: {
        name: "棒球",
        // 本壘板；facingDeg 90 = 朝本壘後方，所以水平偏角 0° = 本壘正後方、一壘側為正
        focus: { position: { x: plate.x, y: K.strikeZoneY.value, z: plate.z }, facingDeg: 90 },
        overlays: [
          { type: "polyline", id: "foul-line-left", points: [plate, leftPole] },
          { type: "polyline", id: "foul-line-right", points: [plate, rightPole] },
          {
            type: "polyline",
            id: "outfield-wall",
            points: arcThrough(leftPole, centerFieldWall, rightPole, K.wallSampleDeg.value),
          },
          {
            type: "polyline",
            id: "infield",
            closed: true,
            points: [
              plate,
              fromPlate(plate, K.basePath.value, 45),
              point(plate.x, plate.z - K.plateToSecond.value),
              fromPlate(plate, K.basePath.value, -45),
            ],
          },
          {
            type: "box",
            id: "mound",
            center: { x: plate.x, y: mm(K.moundHeight.value / 2), z: mm(plate.z - K.plateToPitcher.value) },
            size: { x: K.moundDiameter.value, y: K.moundHeight.value, z: K.moundDiameter.value },
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
