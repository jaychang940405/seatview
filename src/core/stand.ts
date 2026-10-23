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
    treads.push({
      row,
      top,
      bottom: section.structure === "tier" ? below - TIER_SLAB_THICKNESS : 0,
      front: edge(seatLine - section.rowDepth / 2),
      back: edge(seatLine + section.rowDepth / 2),
    });
  }
  return treads;
}

/** 區的平面輪廓：第 1 排前緣接最後一排後緣（反向），不重複起點。給小地圖用，UI 不自己算幾何。 */
export function sectionOutline(venue: Venue, sectionId: string): PlanPoint[] {
  const treads = sectionTreads(venue, sectionId);
  const first = treads[0];
  const last = treads.at(-1);
  if (!first || !last) throw new Error(`${sectionId} 區沒有任何一排`);
  return [...first.front, ...[...last.back].reverse()];
}

/** 回傳「往後 back 公尺的那條邊」的折線；同一區每一排用同樣的取樣，相鄰排的邊才會完全重合。 */
function edgeAt(section: Section): (back: number) => PlanPoint[] {
  switch (section.type) {
    case "arc": {
      const segments = Math.max(1, Math.ceil(Math.abs(section.toDeg - section.fromDeg) / ARC_STEP_DEG));
      const angles = Array.from({ length: segments + 1 }, (_, k) => (section.fromDeg + (k / segments) * (section.toDeg - section.fromDeg)) / DEG);
      return (back) => {
        const radius = Math.max(0, section.innerRadius + back);
        return angles.map((angle) => ({ x: section.center.x + radius * Math.cos(angle), z: section.center.z + radius * Math.sin(angle) }));
      };
    }
    case "linear": {
      const normal = normalAwayFrom(section.from, section.to, section.facing);
      if (!normal) throw new Error(`${section.id} 區的 from/to/facing 無法決定後方，請先用 parseVenue 驗證`);
      return (back) =>
        [section.from, section.to].map((p) => ({ x: p.x + back * normal.x, z: p.z + back * normal.z }));
    }
  }
}
