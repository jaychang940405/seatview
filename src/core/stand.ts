import { DEG, normalAwayFrom } from "./geometry.ts";
import type { PlanPoint, Section, Venue } from "./schema.ts";
import { findSection } from "./seat.ts";

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
export function sectionTreads(venue: Venue, sectionId: string): RowTread[] {
  const section = findSection(venue, sectionId);
  const edge = edgeAt(section);
  const treads: RowTread[] = [];
  for (let row = 1; row <= section.rows; row++) {
    // 座位線在 (row - 1) * rowDepth；踏面前後各半個排深
    const seatLine = (row - 1) * section.rowDepth;
    const top = section.baseHeight + (row - 1) * section.rowRise;
    const below = row === 1 ? top : top - section.rowRise;
    const span = section.rowSpans?.[row - 1] ?? FULL_SPAN;
    treads.push({
      row,
      top,
      bottom: section.structure === "tier" ? below - TIER_SLAB_THICKNESS : 0,
      front: edge(seatLine - section.rowDepth / 2, span),
      back: edge(seatLine + section.rowDepth / 2, span),
    });
  }
  return treads;
}

/** 區的平面輪廓：第 1 排前緣、兩側沿各排端點的階梯、最後一排後緣（反向），不重複起點。給小地圖用，UI 不自己算幾何。 */
export function sectionOutline(venue: Venue, sectionId: string): PlanPoint[] {
  const treads = sectionTreads(venue, sectionId);
  const first = treads[0];
  const last = treads.at(-1);
  if (!first || !last) throw new Error(`${sectionId} 區沒有任何一排`);
  // 每排的範圍可能不同（rowSpans），所以兩側沿著每一排的端點走成階梯
  const right = treads.flatMap((t) => [t.front.at(-1), t.back.at(-1)] as PlanPoint[]);
  const left = treads.flatMap((t) => [t.front[0], t.back[0]] as PlanPoint[]).reverse();
  return [...first.front.slice(0, -1), ...right, ...[...last.back].reverse().slice(1, -1), ...left.slice(0, -1)];
}

const FULL_SPAN: [number, number] = [0, 1];

/**
 * 回傳「往後 back 公尺、只取 span 那一段」的折線。
 * 取樣只由 span 決定，所以兩排的範圍相同時，相鄰排的邊會完全重合。
 */
function edgeAt(section: Section): (back: number, span: [number, number]) => PlanPoint[] {
  switch (section.type) {
    case "arc": {
      const sweep = section.toDeg - section.fromDeg;
      return (back, [start, end]) => {
        const segments = Math.max(1, Math.ceil(Math.abs(sweep * (end - start)) / ARC_STEP_DEG));
        const radius = Math.max(0, section.innerRadius + back);
        return Array.from({ length: segments + 1 }, (_, k) => {
          const angle = (section.fromDeg + (start + (k / segments) * (end - start)) * sweep) / DEG;
          return { x: section.center.x + radius * Math.cos(angle), z: section.center.z + radius * Math.sin(angle) };
        });
      };
    }
    case "linear": {
      const normal = normalAwayFrom(section.from, section.to, section.facing);
      if (!normal) throw new Error(`${section.id} 區的 from/to/facing 無法決定後方，請先用 parseVenue 驗證`);
      const { from, to } = section;
      return (back, span) =>
        span.map((t) => ({ x: from.x + t * (to.x - from.x) + back * normal.x, z: from.z + t * (to.z - from.z) + back * normal.z }));
    }
  }
}
