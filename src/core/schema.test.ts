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

describe("parseVenue：overlay 類型 polygon（球場地面、投手丘）", () => {
  const square = [
    { x: 0, z: 0 },
    { x: 1, z: 0 },
    { x: 1, z: 1 },
  ];

  it("points、y、height、color 都保留下來；y、height、color 可省略", () => {
    const json = demoCopy();
    json.layouts.concert.overlays.push(
      { type: "polygon", id: "grass", points: square, y: 0.02, color: "#5c9a3c" },
      { type: "polygon", id: "mound", points: square, y: 0.254, height: 0.254 },
      { type: "polygon", id: "bare", points: square },
    );
    const overlays = parseVenue(json).layouts.concert?.overlays ?? [];
    expect(overlays.slice(1)).toEqual([
      { type: "polygon", id: "grass", points: square, y: 0.02, color: "#5c9a3c" },
      { type: "polygon", id: "mound", points: square, y: 0.254, height: 0.254 },
      { type: "polygon", id: "bare", points: square },
    ]);
  });

  it("少於 3 個頂點 → 驗證錯誤", () => {
    const json = demoCopy();
    json.layouts.concert.overlays.push({ type: "polygon", id: "line", points: square.slice(0, 2) });
    expect(issuePaths(json)).toEqual(["layouts.concert.overlays.1.points"]);
  });

  it.each([0, -0.1])("height = %s（不是正數）→ 驗證錯誤", (height) => {
    const json = demoCopy();
    json.layouts.concert.overlays.push({ type: "polygon", id: "flat", points: square, height });
    expect(issuePaths(json)).toEqual(["layouts.concert.overlays.1.height"]);
  });
});

describe("parseVenue：選填的 shell（穹頂外殼：牆與屋頂）", () => {
  const shell = {
    outline: [
      { x: -50, z: -50 },
      { x: 50, z: -50 },
      { x: 50, z: 50 },
      { x: -50, z: 50 },
    ],
    wallHeight: 38,
    roofHeight: 72,
  };

  it("沒寫就是 undefined；有寫就完整保留", () => {
    expect(parseVenue(demoArenaJson).shell).toBeUndefined();
    expect(parseVenue({ ...demoCopy(), shell }).shell).toEqual(shell);
  });

  it("屋頂不高於牆頂 → 驗證錯誤", () => {
    expect(issuePaths({ ...demoCopy(), shell: { ...shell, roofHeight: 38 } })).toEqual(["shell.roofHeight"]);
  });

  const screen = { id: "cf", center: { x: 0, y: 24.5, z: -90 }, width: 28, height: 9, facingYawDeg: 90, onLayouts: ["concert"] };

  it("screens：完整保留；onLayouts 可省略", () => {
    const { onLayouts: _omit, ...always } = screen;
    const parsed = parseVenue({ ...demoCopy(), shell: { ...shell, screens: [screen, { ...always, id: "always" }] } }).shell;
    expect(parsed?.screens).toEqual([screen, { ...always, id: "always" }]);
  });

  it.each(["id", "center", "width", "height", "facingYawDeg"])("screens 缺 %s → 驗證錯誤", (field) => {
    const broken: Record<string, unknown> = { ...screen };
    delete broken[field];
    expect(issuePaths({ ...demoCopy(), shell: { ...shell, screens: [broken] } })).toEqual([`shell.screens.0.${field}`]);
  });

  it.each([
    ["width", 0],
    ["width", -1],
    ["height", 0],
    ["height", -2],
  ])("screens 的 %s = %s（不是正數）→ 驗證錯誤", (field, value) => {
    expect(issuePaths({ ...demoCopy(), shell: { ...shell, screens: [{ ...screen, [field]: value }] } })).toEqual([`shell.screens.0.${field}`]);
  });

  it("輪廓少於 3 點、牆高不是正數 → 驗證錯誤", () => {
    expect(issuePaths({ ...demoCopy(), shell: { ...shell, outline: shell.outline.slice(0, 2) } })).toEqual(["shell.outline"]);
    expect(issuePaths({ ...demoCopy(), shell: { ...shell, wallHeight: 0 } })).toEqual(["shell.wallHeight"]);
  });
});

describe("parseVenue：選填的 rowSpans（每排只用從 from 到 to 的一段）", () => {
  const spans = (rows: number) => Array.from({ length: rows }, (_, i) => [0, 1 - i * 0.01]);

  it("沒寫就是 undefined；有寫就保留（A1 有 20 排）", () => {
    expect(parseVenue(demoArenaJson).sections[0]?.rowSpans).toBeUndefined();
    const json = demoCopy();
    json.sections[0].rowSpans = spans(20);
    expect(parseVenue(json).sections[0]?.rowSpans).toEqual(spans(20));
  });

  it("長度跟 rows 不同 → 驗證錯誤", () => {
    const json = demoCopy();
    json.sections[0].rowSpans = spans(19);
    expect(issuePaths(json)).toEqual(["sections.0.rowSpans"]);
  });

  it.each([
    ["起點 = 終點", [0.5, 0.5]],
    ["起點 > 終點", [0.6, 0.4]],
    ["小於 0", [-0.1, 0.5]],
    ["大於 1", [0.5, 1.2]],
  ])("%s → 驗證錯誤（指到那一排）", (_label, bad) => {
    const json = demoCopy();
    json.sections[0].rowSpans = spans(20);
    json.sections[0].rowSpans[3] = bad;
    expect(issuePaths(json)).toEqual(["sections.0.rowSpans.3"]);
  });
});

describe("parseVenue：選填的 level（樓層，例如 B1、L2）", () => {
  it("沒寫就是 undefined；有寫就保留", () => {
    expect(parseVenue(demoArenaJson).sections[0]?.level).toBeUndefined();
    const json = demoCopy();
    json.sections[0].level = "L2";
    expect(parseVenue(json).sections[0]?.level).toBe("L2");
  });

  it("空字串 → 驗證錯誤", () => {
    const json = demoCopy();
    json.sections[0].level = "";
    expect(issuePaths(json)).toEqual(["sections.0.level"]);
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
