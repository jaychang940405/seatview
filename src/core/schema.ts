import { z } from "zod";

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

const LayoutSchema = z.object({
  name: z.string(),
  focus: FocusSchema,
  overlays: z.array(OverlaySchema).optional(),
});

export const VenueSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  name: z.string(),
  sections: z.array(SectionSchema).min(1),
  layouts: z.record(z.string(), LayoutSchema),
});

export type Vec3 = z.infer<typeof Vec3Schema>;
export type PlanPoint = z.infer<typeof PlanPointSchema>;
export type ArcSection = z.infer<typeof ArcSectionSchema>;
export type LinearSection = z.infer<typeof LinearSectionSchema>;
export type Section = z.infer<typeof SectionSchema>;
export type Focus = z.infer<typeof FocusSchema>;
export type Overlay = z.infer<typeof OverlaySchema>;
export type Layout = z.infer<typeof LayoutSchema>;
export type Venue = z.infer<typeof VenueSchema>;

/** 驗證場館 JSON；格式錯誤時丟 ZodError。 */
export function parseVenue(json: unknown): Venue {
  throw new Error("not implemented: parseVenue");
}
