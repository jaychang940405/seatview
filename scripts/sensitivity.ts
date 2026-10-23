/**
 * 臺北大巨蛋 C 級參數的敏感度分析。
 * 在合理範圍內隨機擾動 C 級參數 1,000 次，看 5 個代表座位的 distance、elevationDeg、horizontalDeg 差多少。
 * 用法：npm run sensitivity → 寫出 docs/sensitivity.md（固定隨機種子，每次結果相同）
 *
 * core 的 import 沒寫副檔名，Node 不能直接載入，所以借用專案已有的 Vite（ssrLoadModule），不新增依賴。
 */
import { writeFileSync } from "node:fs";
import { createServer } from "vite";
import type { LayoutParams } from "./dome-layout.ts";
import { buildTaipeiDome, DEFAULT_PARAMS, type ModelParams } from "./taipei-dome-model.ts";

type Core = typeof import("../src/core/index.ts");

const SEED = 20261023;
const RUNS = 1000;

interface Param {
  label: string;
  base: number;
  range: [number, number];
  unit: string;
  apply: (params: ModelParams, value: number) => ModelParams;
}

const base = DEFAULT_PARAMS.layout;
/** 擾動看台幾何的一個 C 級參數；看台的排數、長度（擬合結果）固定不動。 */
const layoutParam = (label: string, baseValue: number, range: [number, number], set: (l: LayoutParams, v: number) => LayoutParams): Param => ({
  label,
  base: baseValue,
  range,
  unit: "m",
  apply: (params, value) => ({ ...params, layout: set(params.layout, value) }),
});

// 擾動範圍本身也是 C 級假設（「估算可能差多少」），不是量測誤差
const PARAMS: Param[] = [
  layoutParam("一層前緣距離", base.foulOffset, [15, 21.5], (l, v) => ({ ...l, foulOffset: v })),
  layoutParam("排距", base.rowDepth, [0.8, 0.9], (l, v) => ({ ...l, rowDepth: v })),
  layoutParam("一層 baseHeight", base.lower.baseHeight, [2, 4], (l, v) => ({ ...l, lower: { ...l.lower, baseHeight: v } })),
  layoutParam("一層 rowRise", base.lower.rowRise, [0.3, 0.4], (l, v) => ({ ...l, lower: { ...l.lower, rowRise: v } })),
  layoutParam("二層淨空", base.upper.headroom, [2.5, 3.5], (l, v) => ({ ...l, upper: { ...l.upper, headroom: v } })),
  layoutParam("二層 rowRise", base.upper.rowRise, [0.45, 0.55], (l, v) => ({ ...l, upper: { ...l.upper, rowRise: v } })),
  layoutParam("外野淨空", base.outfield.clearance, [2, 5], (l, v) => ({ ...l, outfield: { ...l.outfield, clearance: v } })),
  layoutParam("外野 baseHeight", base.outfield.baseHeight, [2, 4], (l, v) => ({ ...l, outfield: { ...l.outfield, baseHeight: v } })),
  layoutParam("外野 rowRise", base.outfield.rowRise, [0.3, 0.4], (l, v) => ({ ...l, outfield: { ...l.outfield, rowRise: v } })),
  {
    label: "棒球 focus 高度",
    base: DEFAULT_PARAMS.strikeZoneY,
    range: [0.6, 1.0],
    unit: "m",
    apply: (params, value) => ({ ...params, strikeZoneY: value }),
  },
];

/** 座位用「該排的比例位置」指定，參數改變、每排席數重新分配後仍是同一個位置。 */
const SEATS = [
  { label: "本壘後方・一層第 1 排中央", sectionId: "I1-HP", row: 1, t: 0.5 },
  { label: "一壘側・一層第 15 排中段", sectionId: "I1-1B", row: 15, t: 0.5 },
  { label: "本壘後方・二層最後一排中央", sectionId: "I2-HP", row: base.upper.rows, t: 0.5 },
  { label: "右外野・一層中段排的中段", sectionId: "O1-RF", row: Math.ceil(base.outfield.sideRows / 2), t: 0.5 },
  { label: "中外野・一層第 1 排中央", sectionId: "O1-CF", row: 1, t: 0.5 },
];

const METRICS = [
  { key: "distance", label: "距離", unit: "m" },
  { key: "elevationDeg", label: "俯角", unit: "°" },
  { key: "horizontalDeg", label: "水平偏角", unit: "°" },
] as const;
type MetricKey = (typeof METRICS)[number]["key"];
type Sample = Record<MetricKey, number>;

/** mulberry32：小而可重現的 PRNG。 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 角度以 reference 為中心展開，避免 ±180° 附近 179.9 跳到 −179.9 讓平均值失真。 */
const unwrap = (deg: number, reference: number) => reference + ((((deg - reference + 180) % 360) + 360) % 360) - 180;

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return (sorted[lo] ?? NaN) + ((sorted[hi] ?? NaN) - (sorted[lo] ?? NaN)) * (pos - lo);
}

const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
try {
  const core = (await server.ssrLoadModule("/src/core/index.ts")) as Core;

  /** 用這組參數建模型、驗證，回傳每個代表座位的指標；產生器拒絕（間距不合法）時回傳 null。 */
  function measure(params: ModelParams): Sample[] | null {
    let venue: ReturnType<Core["parseVenue"]>;
    try {
      venue = core.parseVenue(buildTaipeiDome(params));
    } catch {
      return null;
    }
    return SEATS.map(({ sectionId, row, t }) => {
      const section = venue.sections.find((s) => s.id === sectionId);
      const count = section ? core.seatsInRow(section, row) : NaN;
      const seat = Math.max(1, Math.round(t * count));
      const { distance, elevationDeg, horizontalDeg } = core.getSeatView(venue, "baseball", sectionId, row, seat).metrics;
      return { distance, elevationDeg, horizontalDeg };
    });
  }

  const baseline = measure(DEFAULT_PARAMS);
  if (!baseline) throw new Error("基準模型本身不合法");
  const at = (samples: Sample[], i: number) => samples[i] ?? { distance: NaN, elevationDeg: NaN, horizontalDeg: NaN };
  const normalize = (samples: Sample[]) =>
    samples.map((s, i) => ({ ...s, horizontalDeg: unwrap(s.horizontalDeg, at(baseline, i).horizontalDeg) }));

  // 蒙地卡羅：所有參數同時、獨立、均勻抽樣
  const random = rng(SEED);
  const runs: Sample[][] = [];
  let rejected = 0;
  for (let i = 0; i < RUNS; i++) {
    const params = PARAMS.reduce((p, param) => {
      const [lo, hi] = param.range;
      return param.apply(p, lo + (hi - lo) * random());
    }, DEFAULT_PARAMS);
    const samples = measure(params);
    if (samples) runs.push(normalize(samples));
    else rejected++;
  }

  // 單一參數擺幅：其他參數固定在基準值，這個參數從範圍下限改到上限，指標差多少
  const swings = PARAMS.map((param) => {
    const [lo, hi] = param.range;
    const low = measure(param.apply(DEFAULT_PARAMS, lo));
    const high = measure(param.apply(DEFAULT_PARAMS, hi));
    if (!low || !high) throw new Error(`${param.label} 的範圍端點不合法`);
    const [nLow, nHigh] = [normalize(low), normalize(high)];
    return SEATS.map((_, i) =>
      Object.fromEntries(METRICS.map(({ key }) => [key, at(nHigh, i)[key] - at(nLow, i)[key]])) as Sample,
    );
  });

  const fmt = (v: number, digits = 2) => (Object.is(Math.round(v * 10 ** digits), -0) ? 0 : v).toFixed(digits);
  const stats = SEATS.map((_, i) =>
    Object.fromEntries(
      METRICS.map(({ key }) => {
        const values = runs.map((r) => at(r, i)[key]).sort((a, b) => a - b);
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        return [key, { mean, lo: quantile(values, 0.025), hi: quantile(values, 0.975) }];
      }),
    ) as Record<MetricKey, { mean: number; lo: number; hi: number }>,
  );
  const topSources = (seatIndex: number, key: MetricKey) =>
    PARAMS.map((param, p) => ({ label: param.label, swing: swings[p]?.[seatIndex]?.[key] ?? 0 }))
      .sort((a, b) => Math.abs(b.swing) - Math.abs(a.swing))
      .slice(0, 2)
      .map(({ label, swing }) => `${label}（${swing >= 0 ? "+" : ""}${fmt(swing)}）`)
      .join("、");
  const swing = (label: string, seatIndex: number, key: MetricKey) =>
    Math.abs(swings[PARAMS.findIndex((p) => p.label === label)]?.[seatIndex]?.[key] ?? NaN);
  const halfWidth = (seatIndex: number, key: MetricKey) => {
    const s = stats[seatIndex]?.[key];
    return s ? (s.hi - s.lo) / 2 : NaN;
  };

  const lines: string[] = [
    "# 敏感度分析：臺北大巨蛋 C 級參數",
    "",
    `> 由 \`npm run sensitivity\`（\`scripts/sensitivity.ts\`）產生，**不要手改**。隨機種子 ${SEED}，每次結果相同。`,
    "",
    "## 方法",
    "",
    `- 擾動下表的 C 級參數：同時、獨立、在範圍內均勻抽樣，共 ${RUNS} 次。`,
    "- **範圍本身也是 C 級假設**：它表示「估算可能差多少」，不是量測誤差。",
    "- 每次都用 `buildTaipeiDome` 重建模型，並通過 `parseVenue` 驗證。",
    "- 每排席數會隨半徑重新分配，所以代表座位用「該排的同一比例位置」指定。",
    "- 指標是 baseball layout 下 `getSeatView` 的 `metrics`（focus = 本壘板）。",
    "- 水平偏角以基準值為中心展開，避免 ±180° 附近的跳號讓平均值失真。",
    `- 被產生器拒絕的樣本（隱含座位間距超出 0.45–0.65 m）：${rejected} 次。`,
    "",
    "| 參數 | 基準值 | 擾動範圍 |",
    "|---|---|---|",
    ...PARAMS.map(
      (param) => `| ${param.label} | ${param.base} ${param.unit} | ${param.range[0]} – ${param.range[1]} ${param.unit} |`,
    ),
    "",
    "## 結果",
    "",
    "「主要來源」是單一參數擺幅最大的兩項：其他參數固定在基準值，只把這個參數從範圍下限改到上限，看指標差多少。",
    "",
  ];

  SEATS.forEach((seat, i) => {
    lines.push(`### ${seat.label}（${seat.sectionId} 第 ${seat.row} 排）`, "");
    lines.push("| 指標 | 基準值 | 平均 | 95% 區間 | 區間半寬 | 主要來源（擺幅） |", "|---|---|---|---|---|---|");
    for (const { key, label, unit } of METRICS) {
      const s = stats[i]?.[key];
      if (!s) continue;
      lines.push(
        `| ${label} | ${fmt(at(baseline, i)[key])} ${unit} | ${fmt(s.mean)} ${unit} | ${fmt(s.lo)} – ${fmt(s.hi)} ${unit} | ±${fmt(halfWidth(i, key))} ${unit} | ${topSources(i, key)} |`,
      );
    }
    lines.push("");
  });

  // 解釋裡的數字都直接從上面的結果取，不另外手填
  const [hpFront, firstBase, hpUpper, rightField, centerField] = [0, 1, 2, 3, 4];
  const baseDistance = (i: number) => fmt(at(baseline, i).distance, 1);
  lines.push(
    "## 為什麼是這個結果",
    "",
    "### 1. 距離直接吃半徑與本壘位置的誤差",
    "",
    `本壘後方的座位幾乎就在「本壘 → 看台」的半徑方向上，距離 ≈ 看台半徑 − 本壘 z。`,
    `所以半徑差 1 m、距離就差約 1 m，本壘往後 1 m、距離就少約 1 m。`,
    "",
    `- 一層第 1 排：I1 innerRadius 擺動 10 m，距離擺動 ${fmt(swing("I1 innerRadius", hpFront, "distance"))} m；本壘 z 擺動 6 m，距離擺動 ${fmt(swing("本壘 z 偏移", hpFront, "distance"))} m。`,
    `  - 兩者疊加，95% 區間半寬 ±${fmt(halfWidth(hpFront, "distance"))} m。`,
    `  - 基準距離只有 ${baseDistance(hpFront)} m，所以相對誤差很大。`,
    `- 中外野的座位在本壘的另一側，本壘 z 的影響方向相反：本壘往後（+z）移，中外野的距離反而變長。`,
    `  - 本壘 z 擺幅 ${fmt(swing("本壘 z 偏移", centerField, "distance"))} m，O1 innerRadius 擺幅 ${fmt(swing("O1 innerRadius", centerField, "distance"))} m。`,
    `  - 基準距離 ${baseDistance(centerField)} m，所以相對誤差只有約 ${fmt((halfWidth(centerField, "distance") / at(baseline, centerField).distance) * 100, 1)}%（一層第 1 排約 ${fmt((halfWidth(hpFront, "distance") / at(baseline, hpFront).distance) * 100, 1)}%）。`,
    "",
    "### 2. 俯角是「高度誤差 ÷ 距離」",
    "",
    "俯角 = atan(高度差 ÷ 水平距離)，高度誤差 Δh 大約讓俯角變動 Δh ÷ 距離（弧度）。",
    "所以同樣的高度誤差，越近的座位影響越大。",
    "",
    `- 一層第 1 排（${baseDistance(hpFront)} m）：I1 baseHeight 擺動 2 m，俯角擺動 ${fmt(swing("I1 baseHeight", hpFront, "elevationDeg"))}°。`,
    `- 中外野第 1 排（${baseDistance(centerField)} m）：O1 baseHeight 同樣擺動 2 m，俯角只擺動 ${fmt(swing("O1 baseHeight", centerField, "elevationDeg"))}°。`,
    `- 二層最後一排（${baseDistance(hpUpper)} m）：I2 baseHeight 擺動 4 m，俯角擺動 ${fmt(swing("I2 baseHeight", hpUpper, "elevationDeg"))}°。`,
    `  - rowRise 的誤差會累積 6 排：I2 rowRise 擺動 0.1 m，第 7 排高度差 0.6 m，俯角擺動 ${fmt(swing("I2 rowRise", hpUpper, "elevationDeg"))}°。`,
    "- 半徑誤差也會改變俯角，因為水平距離是分母。影響大小要看距離：",
    `  - 前排距離短，半徑擺動 10 m 時分母的變化比例很大。一層第 1 排的 I1 innerRadius 俯角擺幅 ${fmt(swing("I1 innerRadius", hpFront, "elevationDeg"))}°，跟 baseHeight 的 ${fmt(swing("I1 baseHeight", hpFront, "elevationDeg"))}° 相當。`,
    `  - 中外野的 O1 innerRadius 俯角擺幅只有 ${fmt(swing("O1 innerRadius", centerField, "elevationDeg"))}°。`,
    "",
    "### 3. 水平偏角主要受側向位移影響",
    "",
    "水平偏角的變化 ≈ 側向位移 ÷ 距離（弧度）。",
    "",
    `- 本壘正後方的座位，側向位移主要來自本壘 x 偏移：擺動 2 m 時，一層第 1 排擺動 ${fmt(swing("本壘 x 偏移", hpFront, "horizontalDeg"))}°，二層最後一排只擺動 ${fmt(swing("本壘 x 偏移", hpUpper, "horizontalDeg"))}°。`,
    `- 一壘側和右外野的座位不在軸線上。半徑或本壘 z 改變時，座位相對本壘的方位也會改變：`,
    `  - 一壘側的 I1 innerRadius 擺幅 ${fmt(swing("I1 innerRadius", firstBase, "horizontalDeg"))}°，本壘 z 擺幅 ${fmt(swing("本壘 z 偏移", firstBase, "horizontalDeg"))}°。`,
    `  - 右外野的本壘 z 擺幅 ${fmt(swing("本壘 z 偏移", rightField, "horizontalDeg"))}°，O1 innerRadius 擺幅 ${fmt(swing("O1 innerRadius", rightField, "horizontalDeg"))}°。距離約 ${baseDistance(rightField)} m，所以比一壘側小。`,
    "",
    "### 結論",
    "",
    "- 對使用者最有感的「距離」，誤差主要來自看台半徑和本壘位置這兩個 C 級估算，而且越靠近本壘的座位，相對誤差越大。",
    "- 如果之後有可靠的資料能校正這兩項（例如 OSM 外框檢查顯示看台在短向太寬），最值得優先修正。",
    "- 俯角和水平偏角的誤差，在遠處的座位會被距離稀釋。",
    "",
  );

  writeFileSync(new URL("../docs/sensitivity.md", import.meta.url), lines.join("\n"));
  console.log(`docs/sensitivity.md：${runs.length} 個有效樣本、${rejected} 個被拒絕`);
} finally {
  await server.close();
}
