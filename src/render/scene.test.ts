import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { parseVenue } from "../core/schema";
import demoArenaJson from "../venues/demo-arena.json";
import { expectColorClose, expectSeatError } from "../test/helpers";
import { buildVenueScene, HIGHLIGHT_COLOR } from "./scene";

const demo = () => parseVenue(demoArenaJson);

function sectionMesh(scene: THREE.Scene, sectionId: string): THREE.InstancedMesh {
  const object = scene.getObjectByName(`section:${sectionId}`);
  if (!(object instanceof THREE.InstancedMesh)) throw new Error(`找不到 section:${sectionId}`);
  return object;
}

function colorAt(mesh: THREE.InstancedMesh, index: number): THREE.Color {
  const color = new THREE.Color();
  mesh.getColorAt(index, color);
  return color;
}

describe("buildVenueScene：場景內容", () => {
  it("演唱會：A1、B1、F1 三區、舞台、地板", () => {
    const { scene } = buildVenueScene(demo(), "concert");
    for (const name of ["section:A1", "section:B1", "section:F1", "overlay:stage", "floor"]) {
      expect(scene.getObjectByName(name), name).toBeDefined();
    }
  });

  it("棒球：沒有搖滾區 F1，也沒有演唱會的舞台", () => {
    const { scene } = buildVenueScene(demo(), "baseball");
    expect(scene.getObjectByName("section:A1")).toBeDefined();
    expect(scene.getObjectByName("section:F1")).toBeUndefined();
    expect(scene.getObjectByName("overlay:stage")).toBeUndefined();
  });

  it("focus 來自 layout", () => {
    expect(buildVenueScene(demo(), "baseball").focus).toEqual({ x: 0, y: 1, z: -25 });
  });

  it("不存在的 layout → UNKNOWN_LAYOUT", () => {
    expectSeatError(() => buildVenueScene(demo(), "opera"), "UNKNOWN_LAYOUT");
  });
});

describe("highlightSeat", () => {
  it("只有選中的座位換成 HIGHLIGHT_COLOR", () => {
    const venueScene = buildVenueScene(demo(), "concert");
    const a1 = sectionMesh(venueScene.scene, "A1");
    const base = colorAt(a1, 1);

    venueScene.highlightSeat({ sectionId: "A1", row: 1, seat: 1 });
    expectColorClose(colorAt(a1, 0), HIGHLIGHT_COLOR);
    expectColorClose(colorAt(a1, 1), base);
  });

  it("換選別的座位時，前一個恢復原色", () => {
    const venueScene = buildVenueScene(demo(), "concert");
    const a1 = sectionMesh(venueScene.scene, "A1");
    const b1 = sectionMesh(venueScene.scene, "B1");
    const a1Base = colorAt(a1, 1);

    venueScene.highlightSeat({ sectionId: "A1", row: 1, seat: 1 });
    venueScene.highlightSeat({ sectionId: "B1", row: 1, seat: 1 });
    expectColorClose(colorAt(a1, 0), a1Base);
    expectColorClose(colorAt(b1, 0), HIGHLIGHT_COLOR);
  });

  it("傳 null 清除選取", () => {
    const venueScene = buildVenueScene(demo(), "concert");
    const a1 = sectionMesh(venueScene.scene, "A1");
    const base = colorAt(a1, 1);
    venueScene.highlightSeat({ sectionId: "A1", row: 1, seat: 1 });
    venueScene.highlightSeat(null);
    expectColorClose(colorAt(a1, 0), base);
  });

  it("換顏色後標記需要上傳 GPU（instanceColor.version 增加）", () => {
    const venueScene = buildVenueScene(demo(), "concert");
    const colors = sectionMesh(venueScene.scene, "A1").instanceColor;
    const before = colors?.version ?? 0;
    venueScene.highlightSeat({ sectionId: "A1", row: 1, seat: 1 });
    expect(colors?.version ?? 0).toBeGreaterThan(before);
  });

  it("這個 layout 沒有的座位：不報錯、什麼都不標", () => {
    const venueScene = buildVenueScene(demo(), "baseball");
    expect(() => venueScene.highlightSeat({ sectionId: "F1", row: 1, seat: 1 })).not.toThrow();
  });
});
