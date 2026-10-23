import type { PlanPoint, Venue } from "./schema.ts";

/** 懸挑樓板（structure = tier）的厚度（m）。C 級：一般預鑄看台板的量級，不是量測值。 */
export const TIER_SLAB_THICKNESS = 0.3;

/** 弧形踏面切成折線時，每一段最多幾度。 */
export const ARC_STEP_DEG = 2;

export interface RowTread {
  row: number;
  /** 踏面高度 = 這一排的座位地面 */
  top: number;
  /** 這一排實體的底：solid 到地面 0；tier 到前一排踏面（第 1 排是自己的踏面）下方 TIER_SLAB_THICKNESS */
  bottom: number;
  /** 踏面前緣與後緣（平面折線）。兩條點數相同，都從第 1 號那一端排到最後一號那一端 */
  front: PlanPoint[];
  back: PlanPoint[];
}

/**
 * 每一排的踏面：以座位線為中心、前後各半個排深；render 依此畫階梯，不自己算弧線。
 * 第 r 排的後緣就是第 r+1 排的前緣。
 */
export function sectionTreads(_venue: Venue, _sectionId: string): RowTread[] {
  throw new Error("not implemented");
}
