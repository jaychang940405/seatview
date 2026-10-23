import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { parseVenue } from "../core/schema";
import demoArenaJson from "../venues/demo-arena.json";
import taipeiDomeJson from "../venues/taipei-dome.json";
import { expectColorClose, expectSeatError } from "../test/helpers";
import { createSeatCamera } from "./camera";
import { GROUND_RENDER_ORDER } from "./overlays";
import { buildVenueScene, HIGHLIGHT_COLOR, MARKER_LAYER } from "./scene";
import { CHAIR, SEAT_NEUTRAL, SEAT_PALETTE, seatPaletteIndex } from "./seats";

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

describe("選位標記", () => {
  const markerOf = (scene: THREE.Scene) => scene.getObjectByName("seat-marker");

  it("還沒選座位時隱藏", () => {
    expect(markerOf(buildVenueScene(demo(), "concert").scene)?.visible).toBe(false);
  });

  it("選了座位：出現在那個座位正上方", () => {
    const venueScene = buildVenueScene(demo(), "concert");
    venueScene.highlightSeat({ sectionId: "A1", row: 1, seat: 16 });
    const marker = markerOf(venueScene.scene);
    expect(marker?.visible).toBe(true);
    // A1 第 1 排 16 號的座位地面在 (0, 3, 30)
    expect(marker?.position.x).toBeCloseTo(0);
    expect(marker?.position.z).toBeCloseTo(30);
    expect(marker?.position.y).toBeGreaterThan(3 + CHAIR.backTop);
  });

  it("清除選取，或選到這個 layout 沒有的座位 → 隱藏", () => {
    const venueScene = buildVenueScene(demo(), "concert");
    venueScene.highlightSeat({ sectionId: "A1", row: 1, seat: 16 });
    venueScene.highlightSeat(null);
    expect(markerOf(venueScene.scene)?.visible).toBe(false);

    venueScene.highlightSeat({ sectionId: "A1", row: 1, seat: 16 });
    venueScene.highlightSeat({ sectionId: "A1", row: 99, seat: 1 });
    expect(markerOf(venueScene.scene)?.visible).toBe(false);
  });

  it("只放在 MARKER_LAYER：座位相機看不到，不會擋住座位視角", () => {
    const marker = markerOf(buildVenueScene(demo(), "concert").scene);
    expect(marker?.layers.isEnabled(MARKER_LAYER)).toBe(true);
    expect(marker?.layers.isEnabled(0)).toBe(false);
    expect(marker && createSeatCamera(16 / 9).layers.test(marker.layers)).toBe(false);
  });
});

describe("dispose", () => {
  it("釋放場景裡每個 geometry、material 與 InstancedMesh 的資源", () => {
    const venueScene = buildVenueScene(demo(), "concert");
    const spies: ReturnType<typeof vi.spyOn>[] = [];
    venueScene.scene.traverse((object) => {
      if (object instanceof THREE.InstancedMesh) spies.push(vi.spyOn(object, "dispose"));
      if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
        spies.push(vi.spyOn(object.geometry, "dispose"));
        spies.push(vi.spyOn(object.material as THREE.Material, "dispose"));
      }
    });
    // 3 區 × (InstancedMesh + geometry + material) + 舞台、地板、選位標記各 (geometry + material)
    // + 升高的 A1、B1 各有看台與護欄 (geometry + material)；F1 在地面，沒有
    expect(spies).toHaveLength(3 * 3 + 3 * 2 + 2 * 2 * 2);

    venueScene.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalled();
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
    // 每一席顏色不同（座椅混色），所以比的是這一席自己原本的顏色
    const a1Base = colorAt(a1, 0);

    venueScene.highlightSeat({ sectionId: "A1", row: 1, seat: 1 });
    venueScene.highlightSeat({ sectionId: "B1", row: 1, seat: 1 });
    expectColorClose(colorAt(a1, 0), a1Base);
    expectColorClose(colorAt(b1, 0), HIGHLIGHT_COLOR);
  });

  it("傳 null 清除選取", () => {
    const venueScene = buildVenueScene(demo(), "concert");
    const a1 = sectionMesh(venueScene.scene, "A1");
    const base = colorAt(a1, 0);
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

describe("地面的畫法", () => {
  it("地板最先畫、不寫深度；球場地面圖層接著依序畫在它上面", () => {
    const { scene } = buildVenueScene(parseVenue(taipeiDomeJson), "baseball");
    const floor = scene.getObjectByName("floor") as THREE.Mesh;
    expect(floor.renderOrder).toBe(GROUND_RENDER_ORDER);
    expect((floor.material as THREE.Material).depthWrite).toBe(false);
    const grass = scene.getObjectByName("overlay:fair-grass") as THREE.Mesh;
    const dirt = scene.getObjectByName("overlay:field-dirt") as THREE.Mesh;
    expect(dirt.renderOrder).toBeGreaterThan(floor.renderOrder);
    expect(grass.renderOrder).toBeGreaterThan(dirt.renderOrder);
  });
});

describe("光線與材質", () => {
  it("有半球光（室內漫射）與一盞從上方照下的平行光", () => {
    const { scene } = buildVenueScene(demo(), "concert");
    const lights: THREE.Light[] = [];
    scene.traverse((object) => {
      if (object instanceof THREE.Light) lights.push(object);
    });
    expect(lights.some((light) => light instanceof THREE.HemisphereLight)).toBe(true);
    const sun = lights.find((light): light is THREE.DirectionalLight => light instanceof THREE.DirectionalLight);
    expect(sun?.position.y).toBeGreaterThan(0);
  });

  it("椅子、看台、護欄、地板、舞台都用會反應光線的 MeshStandardMaterial；只有選位標記不受光", () => {
    const { scene } = buildVenueScene(parseVenue(taipeiDomeJson), "concert");
    const unlit: string[] = [];
    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const material = object.material as THREE.Material;
      if (object.name === "seat-marker") return;
      if (!(material instanceof THREE.MeshStandardMaterial)) unlit.push(`${object.name}（${material.type}）`);
    });
    expect(unlit).toEqual([]);
  });
});

describe("setColorMode", () => {
  it("座位視角：每一席都是黑、白、淺灰之一；鳥瞰（除錯）：每一區混入自己的分區色，彼此不同", () => {
    const venueScene = buildVenueScene(demo(), "concert");
    const a1 = sectionMesh(venueScene.scene, "A1");
    const b1 = sectionMesh(venueScene.scene, "B1");
    const inPalette = (c: THREE.Color) => SEAT_PALETTE.some((p) => Math.abs(p.r - c.r) + Math.abs(p.g - c.g) + Math.abs(p.b - c.b) < 1e-5);

    venueScene.setColorMode("seat");
    for (let i = 0; i < 20; i++) expect(inPalette(colorAt(a1, i)), `A1 #${i}`).toBe(true);

    venueScene.setColorMode("overview");
    expect(colorAt(a1, 0).equals(colorAt(b1, 0))).toBe(false);
    expect(colorAt(a1, 0).equals(SEAT_NEUTRAL)).toBe(false);
  });

  it("切換模式後選中的座位仍是 HIGHLIGHT_COLOR；換選時，前一個恢復成目前模式的顏色", () => {
    const venueScene = buildVenueScene(demo(), "concert");
    const a1 = sectionMesh(venueScene.scene, "A1");
    venueScene.highlightSeat({ sectionId: "A1", row: 1, seat: 1 });

    venueScene.setColorMode("overview");
    expectColorClose(colorAt(a1, 0), HIGHLIGHT_COLOR);
    venueScene.setColorMode("seat");
    expectColorClose(colorAt(a1, 0), HIGHLIGHT_COLOR);

    // 換選別的座位：A1 第 1 排 1 號恢復成它自己在座位視角的顏色
    venueScene.highlightSeat({ sectionId: "B1", row: 1, seat: 1 });
    expectColorClose(colorAt(a1, 0), SEAT_PALETTE[seatPaletteIndex("A1", 1, 1)] ?? new THREE.Color());
  });
});
