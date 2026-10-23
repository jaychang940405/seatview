import { z } from "zod";
import { normalAwayFrom } from "./geometry.ts";

// 座標慣例：公尺；Y 向上、地板 y = 0、原點在場館中心。
// 平面圖 (x, z)：x 向右、z 向下（同 SVG）；平面角度從 +x 轉向 +z 為正（平面圖上順時針）。

const Vec3Schema = z.object({ x: z.number(), y: z.number(), z: z.number() });
const PlanPointSchema = z.object({ x: z.number(), z: z.number() });

const SectionBaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  rows: z.number().int().positive(),
  seatsPerRow: z.union([z.number().int().positive(), z.array(z.number().int().positive())]),
  rowDepth: z.number().positive(),
  rowRise: z.number().nonnegative(),
  baseHeight: z.number(),
  layouts: z.array(z.string()).optional(),
  /** 看台下方：solid（預設）= 實心到地面；tier = 懸挑的階梯樓板，下方是空的（例如二層） */
  structure: z.enum(["solid", "tier"]).optional(),
});

const ArcSectionSchema = SectionBaseSchema.extend({
  type: z.literal("arc"),
  center: PlanPointSchema,
  innerRadius: z.number().positive(),
  fromDeg: z.number(),
  toDeg: z.number(),
});

const LinearSectionSchema = SectionBaseSchema.extend({
  type: z.literal("linear"),
  from: PlanPointSchema,
  to: PlanPointSchema,
  facing: PlanPointSchema,
});

const SectionSchema = z.discriminatedUnion("type", [ArcSectionSchema, LinearSectionSchema]);

const FocusSchema = z.object({ position: Vec3Schema, facingDeg: z.number() });

const OverlaySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("box"),
    id: z.string(),
    center: Vec3Schema,
    size: Vec3Schema,
    yawDeg: z.number().optional(),
    color: z.string().optional(),
  }),
  z.object({
    type: z.literal("polyline"),
    id: z.string(),
    points: z.array(PlanPointSchema).min(2),
    y: z.number().optional(),
    closed: z.boolean().optional(),
    color: z.string().optional(),
  }),
]);

/** 數字的可信度：A = 規則或官方定義、B = 新聞報導、C = 本專案估算。 */
const ProvenanceSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
  grade: z.enum(["A", "B", "C"]),
  source: z.string().min(1),
});

const MetaSchema = z.object({
  disclaimer: z.string().min(1),
  provenance: z.array(ProvenanceSchema),
});

const LayoutSchema = z.object({
  name: z.string(),
  focus: FocusSchema,
  overlays: z.array(OverlaySchema).optional(),
});

export const VenueSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    name: z.string(),
    sections: z.array(SectionSchema).min(1),
    layouts: z.record(z.string(), LayoutSchema),
    meta: MetaSchema.optional(),
  })
  .superRefine((venue, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: "custom", path, message });

    if (Object.keys(venue.layouts).length === 0) issue(["layouts"], "至少要有一個 layout");

    const seenIds = new Set<string>();
    venue.sections.forEach((section, i) => {
      if (seenIds.has(section.id)) issue(["sections", i, "id"], `區 id 重複：${section.id}`);
      seenIds.add(section.id);

      if (Array.isArray(section.seatsPerRow) && section.seatsPerRow.length !== section.rows) {
        issue(
          ["sections", i, "seatsPerRow"],
          `seatsPerRow 有 ${section.seatsPerRow.length} 個，但 rows 是 ${section.rows}`,
        );
      }

      section.layouts?.forEach((layoutId, j) => {
        if (!Object.hasOwn(venue.layouts, layoutId)) {
          issue(["sections", i, "layouts", j], `沒有 ${layoutId} 這個 layout`);
        }
      });

      if (section.type === "arc") {
        const span = Math.abs(section.toDeg - section.fromDeg);
        if (span === 0 || span > 360) {
          issue(["sections", i, "toDeg"], "fromDeg→toDeg 的跨度必須大於 0° 且不超過 360°");
        }
      } else if (section.from.x === section.to.x && section.from.z === section.to.z) {
        issue(["sections", i, "to"], "from 與 to 不能是同一點");
      } else if (!normalAwayFrom(section.from, section.to, section.facing)) {
        issue(["sections", i, "facing"], "facing 不能落在前緣線上，否則分不出哪邊是後方");
      }
    });
  });

export type Vec3 = z.infer<typeof Vec3Schema>;
export type PlanPoint = z.infer<typeof PlanPointSchema>;
export type ArcSection = z.infer<typeof ArcSectionSchema>;
export type LinearSection = z.infer<typeof LinearSectionSchema>;
export type Section = z.infer<typeof SectionSchema>;
export type Focus = z.infer<typeof FocusSchema>;
export type Overlay = z.infer<typeof OverlaySchema>;
export type Layout = z.infer<typeof LayoutSchema>;
export type Provenance = z.infer<typeof ProvenanceSchema>;
export type VenueMeta = z.infer<typeof MetaSchema>;
export type Venue = z.infer<typeof VenueSchema>;

/** 驗證場館 JSON；格式錯誤時丟 ZodError。 */
export function parseVenue(json: unknown): Venue {
  return VenueSchema.parse(json);
}
