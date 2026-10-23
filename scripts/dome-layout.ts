/**
 * 臺北大巨蛋方案 B 的看台幾何與擬合：
 *   本壘後方 = 以本壘為圓心的弧（45°→135°）；一三壘側 = 平行界外線的直線看台；外野 = 與外野牆同心的弧。
 * 二層可以懸挑在一層後段上方（baseHeight = 一層後排高度 + 淨空）。
 * 座標同 src/core/schema.ts。
 */
import type { PlanPoint, Superellipse } from "./outline.ts";

export interface Field {
  plate: PlanPoint;
  rightPole: PlanPoint;
  leftPole: PlanPoint;
  centerField: PlanPoint;
  wallCenter: PlanPoint;
  wallRadius: number;
}

export function circleThrough(a: PlanPoint, b: PlanPoint, c: PlanPoint): { center: PlanPoint; radius: number } {
  throw new Error("not implemented: circleThrough");
}

/** 本壘在 (0, plateZ)，往 −z 是場內；界外桿在本壘到中外野軸線兩側 ±45°。 */
export function fieldGeometry(plateZ: number, foulPole: number, centerField: number): Field {
  throw new Error("not implemented: fieldGeometry");
}

/**
 * 外野牆圓弧兩端的角度（以外野牆圓心量）：右外野桿約 −21°，往中外野（−90°）遞減到左外野桿 = −180° − 右桿。
 * 之前的分析曾寫成 180° − 右桿，弧會繞到本壘那一側。
 */
export function outfieldArcAngles(field: Field): { right: number; left: number } {
  throw new Error("not implemented: outfieldArcAngles");
}

export interface LayoutParams {
  /** 一層前緣離界外線（與本壘）的距離 */
  foulOffset: number;
  rowDepth: number;
  /** 座位寬（每排席數 = 長度 ÷ pitch 取整） */
  pitch: number;
  lower: { rows: number; lineLength: number; rowRise: number; baseHeight: number };
  /** startRow：二層前緣懸在一層第 startRow + 1 排的正上方 */
  upper: { startRow: number; rows: number; lineLength: number; rowRise: number; headroom: number };
  /** insetDeg：外野左右兩區從界外桿往中外野內縮的角度 */
  outfield: { clearance: number; insetDeg: number; sideRows: number; centerRows: number; rowRise: number; baseHeight: number };
}

type StandBase = { id: string; name: string; rows: number; rowDepth: number; rowRise: number; baseHeight: number; layouts?: string[] };
export type ArcStand = StandBase & { type: "arc"; center: PlanPoint; innerRadius: number; fromDeg: number; toDeg: number; seatsPerRow: number[] };
export type LinearStand = StandBase & { type: "linear"; from: PlanPoint; to: PlanPoint; facing: PlanPoint; seatsPerRow: number };
export type StandSection = ArcStand | LinearStand;

/** 一層最後一排的高度。 */
export function lowerBackHeight(params: LayoutParams): number {
  throw new Error("not implemented: lowerBackHeight");
}

/** 二層 baseHeight = 一層最後一排高度 + 淨空。 */
export function upperBaseHeight(params: LayoutParams): number {
  throw new Error("not implemented: upperBaseHeight");
}

/** 九個看台區（I1-*, I2-*, O1-*），id 與名稱固定。 */
export function buildStands(field: Field, params: LayoutParams): StandSection[] {
  throw new Error("not implemented: buildStands");
}

/** 座位數算法一：每排取整後加總（跟產生的 JSON 一致）。 */
export function sectionSeatCount(section: StandSection): number {
  throw new Error("not implemented: sectionSeatCount");
}

/** 座位數算法二：看台平面面積 ÷（座位寬 × 排距），不取整。 */
export function areaSeatEstimate(section: StandSection, pitch: number): number {
  throw new Error("not implemented: areaSeatEstimate");
}

export type InsideCheck = (p: PlanPoint) => boolean;

/** 一壘側（side = 1）或三壘側（−1）直線看台，最外排離界外線 back 公尺時，最長可以多長（0.5 m 為單位）。 */
export function maxLineLength(field: Field, inside: InsideCheck, back: number, side: 1 | -1, cap: number): number {
  throw new Error("not implemented: maxLineLength");
}

/** 本壘後方弧最外排半徑為 back 時，整段弧是否放得下。 */
export function homeArcFits(field: Field, inside: InsideCheck, back: number): boolean {
  throw new Error("not implemented: homeArcFits");
}

/** 外野三區各自最多放得下幾排（左右分開算，方便檢查對稱）。 */
export function outfieldRowsFit(
  field: Field,
  inside: InsideCheck,
  clearance: number,
  rowDepth: number,
  insetDeg: number,
  maxRows: number,
): { right: number; center: number; left: number } {
  throw new Error("not implemented: outfieldRowsFit");
}

export interface FitOptions {
  margin: number;
  anchors: { lower: number; upper: number };
  tolerance: number;
  maxLowerRows: number;
  minOutfieldRows: number;
  /** 本壘相對外框中心的 z 距離範圍 */
  plateRange: [number, number];
  /** 外框中心的 x 範圍 */
  lateralRange: [number, number];
  insetOptions: number[];
  lineCap: number;
}

export interface FitResult {
  params: LayoutParams;
  outlineCenter: PlanPoint;
  lower: number;
  upper: number;
  meetsAnchors: boolean;
}

/**
 * 在外框（超橢圓，擺放位置也是搜尋變數）裡找方案 B 的參數。
 * 必要條件：所有看台離外框 ≥ margin、一層 ≤ maxLowerRows 排、席數不超過錨點 +tolerance。
 * 偏好：席數落在錨點 ±tolerance → 席數最接近錨點 → 一層排數少 → 外框中心偏離中線少。
 */
export function fitLayout(
  field: Field,
  shape: Omit<Superellipse, "center">,
  template: LayoutParams,
  options: FitOptions,
): FitResult | null {
  throw new Error("not implemented: fitLayout");
}
