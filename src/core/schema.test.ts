import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import demoArenaJson from "../venues/demo-arena.json";
import { parseVenue } from "./schema";

/** 回傳所有驗證錯誤的路徑，例如 "sections.0.seatsPerRow"；不是 ZodError 就原樣丟出。 */
function issuePaths(json: unknown): string[] {
  try {
    parseVenue(json);
  } catch (e) {
    if (e instanceof ZodError) return e.issues.map((issue) => issue.path.join("."));
    throw e;
  }
  return [];
}

/** 可以隨意修改的 demo-arena 副本（sections: 0 = A1 arc、1 = B1 linear、2 = F1 linear）。 */
const demoCopy = (): any => structuredClone(demoArenaJson);

describe("parseVenue", () => {
  it("demo-arena.json 通過驗證", () => {
    const venue = parseVenue(demoArenaJson);
    expect(venue.id).toBe("demo-arena");
    expect(venue.sections.map((s) => s.id)).toEqual(["A1", "B1", "F1"]);
    expect(Object.keys(venue.layouts)).toEqual(["concert", "baseball"]);
  });

  it("seatsPerRow 陣列長度跟 rows 不同", () => {
    const json = demoCopy();
    json.sections[0].seatsPerRow = [31, 31];
    expect(issuePaths(json)).toContain("sections.0.seatsPerRow");
  });

  it("section.layouts 指到不存在的 layout", () => {
    const json = demoCopy();
    json.sections[2].layouts = ["opera"];
    expect(issuePaths(json)).toContain("sections.2.layouts.0");
  });

  it("section id 重複", () => {
    const json = demoCopy();
    json.sections[1].id = "A1";
    expect(issuePaths(json)).toContain("sections.1.id");
  });

  it("linear 的 facing 落在前緣線上（分不出前後）", () => {
    const json = demoCopy();
    json.sections[1].facing = { x: 36, z: 0 };
    expect(issuePaths(json)).toContain("sections.1.facing");
  });

  it("linear 的 from 與 to 相同", () => {
    const json = demoCopy();
    json.sections[1].to = { ...json.sections[1].from };
    expect(issuePaths(json)).toContain("sections.1.to");
  });

  it("arc 的 fromDeg = toDeg", () => {
    const json = demoCopy();
    json.sections[0].toDeg = json.sections[0].fromDeg;
    expect(issuePaths(json)).toContain("sections.0.toDeg");
  });

  it("arc 跨度超過 360°", () => {
    const json = demoCopy();
    json.sections[0].toDeg = json.sections[0].fromDeg + 361;
    expect(issuePaths(json)).toContain("sections.0.toDeg");
  });

  it("沒有任何 layout", () => {
    const json = demoCopy();
    json.layouts = {};
    expect(issuePaths(json)).toContain("layouts");
  });

  it("schemaVersion 不是 1", () => {
    const json = demoCopy();
    json.schemaVersion = 2;
    expect(issuePaths(json)).toContain("schemaVersion");
  });

  it("缺少必要欄位", () => {
    const json = demoCopy();
    delete json.sections[0].rows;
    expect(issuePaths(json)).toContain("sections.0.rows");
  });

  it("未知的區類型", () => {
    const json = demoCopy();
    json.sections[0].type = "circle";
    expect(issuePaths(json).length).toBeGreaterThan(0);
  });
});

describe("parseVenue：選填的 structure（看台下方的結構）", () => {
  it("沒寫就是 undefined（代表預設的 solid）", () => {
    expect(parseVenue(demoArenaJson).sections[0]?.structure).toBeUndefined();
  });

  it.each(["solid", "tier"])("%s 會保留下來", (structure) => {
    const json = demoCopy();
    json.sections[0].structure = structure;
    expect(parseVenue(json).sections[0]?.structure).toBe(structure);
  });

  it("其他值 → 驗證錯誤", () => {
    const json = demoCopy();
    json.sections[0].structure = "floating";
    expect(issuePaths(json)).toEqual(["sections.0.structure"]);
  });
});

describe("parseVenue：選填的 meta", () => {
  const meta = {
    disclaimer: "近似模型，非官方圖面。",
    provenance: [
      { key: "baseDistance", value: "27.43 m", grade: "A", source: "棒球規則（90 呎）" },
      { key: "innerRadius", value: "80 m", grade: "C", source: "本專案估算" },
    ],
  };

  it("沒有 meta 也能 parse", () => {
    expect(parseVenue(demoArenaJson).meta).toBeUndefined();
  });

  it("有 meta 時完整保留 disclaimer 與 provenance", () => {
    const venue = parseVenue({ ...demoCopy(), meta });
    expect(venue.meta?.disclaimer).toBe(meta.disclaimer);
    expect(venue.meta?.provenance).toEqual(meta.provenance);
  });

  it("grade 只能是 A、B、C", () => {
    const json = { ...demoCopy(), meta: structuredClone(meta) };
    json.meta.provenance[1].grade = "D";
    expect(issuePaths(json)).toContain("meta.provenance.1.grade");
  });

  it("disclaimer 不能是空字串", () => {
    expect(issuePaths({ ...demoCopy(), meta: { ...meta, disclaimer: "" } })).toContain("meta.disclaimer");
  });
});
