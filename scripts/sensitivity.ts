/**
 * 臺北大巨蛋 C 級參數的敏感度分析。
 * 在合理範圍內隨機擾動 C 級參數 1,000 次，看 5 個代表座位的 distance、elevationDeg、horizontalDeg 差多少。
 * 用法：npm run sensitivity → 寫出 docs/sensitivity.md（固定隨機種子，每次結果相同）
 *
 * core 的 import 沒寫副檔名，Node 不能直接載入，所以借用專案已有的 Vite（ssrLoadModule），不新增依賴。
 */
import { writeFileSync } from "node:fs";
import { createServer } from "vite";
import type { OfficialParams } from "./official-layout.ts";
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

const base = DEFAULT_PARAMS.official;
/** 擾動看台幾何的一個 C 級參數；官方票區的排數與寬度規則固定不動。 */
const officialParam = (label: string, baseValue: number, range: [number, number], set: (o: OfficialParams, v: number) => OfficialParams): Param => ({
  label,
  base: baseValue,
  range,
  unit: "m",
  apply: (params, value) => ({ ...params, official: set(params.official, value) }),
});

// 擾動範圍本身也是 C 級假設（「估算可能差多少」），不是量測誤差
const PARAMS: Param[] = [
  // 這兩個的上限是外框決定的：再大，本壘後方就放不下官方的 38 排（見 docs/sensitivity.md 的「方法」）
  officialParam("B1 前緣距離", base.foulOffset, [15, 19], (o, v) => ({ ...o, foulOffset: v })),
  officialParam("排距", base.rowDepth, [0.8, 0.87], (o, v) => ({ ...o, rowDepth: v })),
  officialParam("B1 內野 baseHeight", base.b1.baseHeight, [2, 4], (o, v) => ({ ...o, b1: { ...o.b1, baseHeight: v } })),
  officialParam("B1 內野 rowRise", base.b1.rowRise, [0.3, 0.4], (o, v) => ({ ...o, b1: { ...o.b1, rowRise: v } })),
  officialParam("L2 淨空", base.l2.headroom, [2.5, 3.5], (o, v) => ({ ...o, l2: { ...o.l2, headroom: v } })),
  officialParam("L2 rowRise", base.l2.rowRise, [0.45, 0.55], (o, v) => ({ ...o, l2: { ...o.l2, rowRise: v } })),
  officialParam("外野淨空", base.outfieldClearance, [2, 5], (o, v) => ({ ...o, outfieldClearance: v })),
  officialParam("外野 baseHeight", base.outfield.baseHeight, [2, 4], (o, v) => ({ ...o, outfield: { ...o.outfield, baseHeight: v } })),
  officialParam("外野 rowRise", base.outfield.rowRise, [0.3, 0.4], (o, v) => ({ ...o, outfield: { ...o.outfield, rowRise: v } })),
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
  { label: "本壘正後方・B1 第 1 排中央", sectionId: "113", row: 1, t: 0.5 },
  { label: "一壘側・B1 第 15 排中段", sectionId: "105", row: 15, t: 0.5 },
  { label: "本壘斜後方・L2 最後一排中央", sectionId: "212", row: base.l2.defaultRows, t: 0.5 },
  { label: "右外野・B1 中段排的中段", sectionId: "143", row: Math.ceil(base.outfield.rows / 2), t: 0.5 },
  { label: "中外野（打者之眼旁）・B1 第 1 排中央", sectionId: "140", row: 1, t: 0.5 },
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

  /** 用這組參數建模型、驗證，回傳每個代表座位的指標；產生器拒絕（有一排放不下座位、間距不合法）時回傳 null。 */
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
    "- 官方票區的排數（B）與每區寬度的規則保持不動；只擾動看台的距離與高度參數，每區寬度依規則重新推算。",
    "- **B1 前緣距離與排距的上限由外框決定**：外框位置固定（C 級）時，B1 前緣距離超過 19 m 或排距超過 0.87 m，本壘後方就放不下官方的 38 排（B 級）。",
    "  - 所以上限改用外框放得下的值（之前的範圍是 21.5 m、0.9 m）。如果真實值更大，代表外框位置也要跟著修正。",
    "- 每排席數會隨距離重新計算，所以代表座位用「該排的同一比例位置」指定。",
    "- 指標是 baseball layout 下 `getSeatView` 的 `metrics`（focus = 本壘板）。",
    "- 水平偏角以基準值為中心展開，避免 ±180° 附近的跳號讓平均值失真。",
    `- 被產生器拒絕的樣本（外框內放不下官方的排數、或隱含座位間距超出 0.45–0.65 m）：${rejected} 次。`,
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
    lines.push(`### ${seat.label}（${seat.sectionId} 區第 ${seat.row} 排）`, "");
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
  const relative = (i: number) => fmt((halfWidth(i, "distance") / at(baseline, i).distance) * 100, 1);
  /** 「擺動 4 m（15–19 m）」：範圍寬度與兩端都從 PARAMS 取 */
  const spread = (label: string) => {
    const param = PARAMS.find((p) => p.label === label);
    if (!param) throw new Error(`沒有參數 ${label}`);
    const [lo, hi] = param.range;
    return `${Number((hi - lo).toFixed(3))} ${param.unit}（${lo}–${hi} ${param.unit}）`;
  };
  const upperStack = base.l2.startRow + base.l2.defaultRows - 1; // L2 最後一排離 B1 前緣隔了幾個排距
  const lowerBackRows = base.b1.rows - 1;
  const hpStats = stats[hpFront]?.horizontalDeg;
  lines.push(
    "## 為什麼是這個結果",
    "",
    "### 1. 距離主要取決於「看台離本壘、離外野牆多遠」",
    "",
    "看台是跟著球場畫的：本壘後方的弧以本壘為圓心，兩側的直線看台平行界外線，外野的弧跟外野牆同心。",
    "所以座位到本壘的距離，幾乎就是「B1 前緣距離 + 排距 × 排數」（外野則是外野牆 + 外野淨空）。",
    "",
    `- 本壘正後方 B1 第 1 排：B1 前緣距離擺動 ${spread("B1 前緣距離")}，距離擺動 ${fmt(swing("B1 前緣距離", hpFront, "distance"))} m。`,
    `  - 95% 區間半寬 ±${fmt(halfWidth(hpFront, "distance"))} m。基準距離只有 ${baseDistance(hpFront)} m，相對誤差約 ${relative(hpFront)}%。`,
    `- L2 最後一排：它離 B1 前緣隔了 ${upperStack} 個排距，所以排距的誤差被放大 ${upperStack} 倍。`,
    `  - 排距擺動 ${spread("排距")}，距離擺動 ${fmt(swing("排距", hpUpper, "distance"))} m；B1 前緣距離擺動 ${fmt(swing("B1 前緣距離", hpUpper, "distance"))} m。`,
    `- 中外野（打者之眼旁）第 1 排：距離主要受外野淨空影響，擺動 ${spread("外野淨空")}時距離擺動 ${fmt(swing("外野淨空", centerField, "distance"))} m。`,
    `  - 基準距離 ${baseDistance(centerField)} m，相對誤差只有約 ${relative(centerField)}%。`,
    "",
    "### 2. 俯角是「高度誤差 ÷ 距離」",
    "",
    "俯角 = atan(高度差 ÷ 水平距離)，高度誤差 Δh 大約讓俯角變動 Δh ÷ 距離（弧度）。所以同樣的高度誤差，越近的座位影響越大。",
    "",
    `- 本壘正後方 B1 第 1 排（${baseDistance(hpFront)} m）：B1 內野 baseHeight 擺動 ${spread("B1 內野 baseHeight")}，俯角擺動 ${fmt(swing("B1 內野 baseHeight", hpFront, "elevationDeg"))}°。`,
    `  - B1 前緣距離改的是分母，前排距離短、比例變化大，所以也有 ${fmt(swing("B1 前緣距離", hpFront, "elevationDeg"))}°。`,
    `- 中外野第 1 排（${baseDistance(centerField)} m）：外野 baseHeight 同樣擺動 ${spread("外野 baseHeight")}，俯角只擺動 ${fmt(swing("外野 baseHeight", centerField, "elevationDeg"))}°。`,
    `- L2 最後一排（${baseDistance(hpUpper)} m）：L2 baseHeight = B1 內野最後一排高度 + 淨空，所以 B1 的斜度誤差會累積 ${lowerBackRows} 排再傳到 L2。`,
    `  - B1 內野 rowRise 擺動 ${spread("B1 內野 rowRise")}，俯角擺動 ${fmt(swing("B1 內野 rowRise", hpUpper, "elevationDeg"))}°；L2 淨空擺動 ${spread("L2 淨空")}，俯角擺動 ${fmt(swing("L2 淨空", hpUpper, "elevationDeg"))}°。`,
    "",
    "### 3. 水平偏角：只有側邊的座位受影響",
    "",
    "水平偏角的變化 ≈ 側向位移 ÷ 距離（弧度）。本壘後方和外野的座位，參數改變時大多沿「離本壘的方向」移動，側向位移很小；一壘側的直線看台則是沿界外線的法線平移，每區的寬度也依外框重新分配，方位會跟著變。",
    "",
    `- 本壘正後方的座位（113 區）：偏角只跟「中央座位是哪一席」有關。席數變成偶數時，最中間兩席各偏半個座位寬，所以 95% 區間是 ${fmt(hpStats?.lo ?? NaN)}–${fmt(hpStats?.hi ?? NaN)}°。`,
    `- 一壘側（105 區）：B1 前緣距離改變時，座位沿界外線的法線方向平移、區的範圍也跟著重新切分，相對本壘的方位跟著變，擺幅 ${fmt(swing("B1 前緣距離", firstBase, "horizontalDeg"))}°。`,
    `- 右外野（143 區，約 ${baseDistance(rightField)} m）：外野淨空擺動 ${spread("外野淨空")}，偏角只擺動 ${fmt(swing("外野淨空", rightField, "horizontalDeg"))}°。`,
    "",
    "### 結論",
    "",
    `- 對使用者最有感的「距離」，誤差主要來自兩個 C 級估算：B1 前緣距離（本壘後方距離，${base.foulOffset} m）和外野淨空（${base.outfieldClearance} m）。`,
    `- 越靠近本壘的座位，相對誤差越大：本壘正後方前排約 ${relative(hpFront)}%，中外野約 ${relative(centerField)}%。`,
    "- L2 疊在 B1 上方，對排距和 B1 斜度特別敏感。",
    "- 如果之後有可靠的資料，最值得優先校正的是：本壘到後擋網的距離、排距、B1 斜度。",
    "",
  );

  writeFileSync(new URL("../docs/sensitivity.md", import.meta.url), lines.join("\n"));
  console.log(`docs/sensitivity.md：${runs.length} 個有效樣本、${rejected} 個被拒絕`);
} finally {
  await server.close();
}
