import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { pointInPolygon } from "../../scripts/outline.ts";
import { parseVenue } from "../core/schema";
import { roofHeightAt } from "../core/shell";
import demoArenaJson from "../venues/demo-arena.json";
import taipeiDomeJson from "../venues/taipei-dome.json";
import { buildVenueScene } from "./scene";
import { buildShell } from "./shell";

const dome = () => parseVenue(taipeiDomeJson);
const domeShell = () => {
  const shell = dome().shell;
  if (!shell) throw new Error("taipei-dome 沒有 shell");
  return shell;
};

function vertices(object: THREE.Object3D | undefined): THREE.Vector3[] {
  if (!(object instanceof THREE.Mesh || object instanceof THREE.Line)) throw new Error("不是 Mesh／Line");
  const position = object.geometry.getAttribute("position");
  return Array.from({ length: position.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(position, i));
}

describe("buildShell：穹頂外殼", () => {
  it("牆、牆面接縫、屋頂、屋頂格柵、屋頂邊緣的燈", () => {
    const group = buildShell(domeShell());
    expect(group.name).toBe("shell");
    expect(group.children.map((c) => c.name).sort()).toEqual(["shell-lattice", "shell-lights", "shell-roof", "shell-seams", "shell-wall"]);
  });

  it("牆：從地面到牆頂（38 m），頂點都在底面輪廓上", () => {
    const shell = domeShell();
    const wall = vertices(buildShell(shell).getObjectByName("shell-wall"));
    const ys = wall.map((v) => v.y);
    expect(Math.min(...ys)).toBeCloseTo(0, 4);
    expect(Math.max(...ys)).toBeCloseTo(shell.wallHeight, 4);
    for (const v of wall) {
      const nearest = Math.min(...shell.outline.map((p) => Math.hypot(p.x - v.x, p.z - v.z)));
      expect(nearest).toBeLessThan(1e-3);
    }
  });

  it("屋頂：每個頂點都在殼面上（容差 1 cm），最高點 = 72 m", () => {
    const shell = domeShell();
    const roof = vertices(buildShell(shell).getObjectByName("shell-roof"));
    for (const v of roof) expect(Math.abs(v.y - roofHeightAt(shell, { x: v.x, z: v.z }))).toBeLessThan(0.01);
    expect(Math.max(...roof.map((v) => v.y))).toBeCloseTo(shell.roofHeight, 2);
  });

  it("格柵：每個頂點都在殼面上（容差 1 cm），而且在底面輪廓內", () => {
    const shell = domeShell();
    const lattice = vertices(buildShell(shell).getObjectByName("shell-lattice"));
    expect(lattice.length).toBeGreaterThan(100);
    for (const v of lattice) {
      expect(Math.abs(v.y - roofHeightAt(shell, { x: v.x, z: v.z }))).toBeLessThan(0.01);
      expect(pointInPolygon(shell.outline, { x: v.x, z: v.z })).toBe(true);
    }
  });

  it("屋頂邊緣的燈會自己發光（不受場景光線影響）", () => {
    const lights = buildShell(domeShell()).getObjectByName("shell-lights");
    expect(lights).toBeInstanceOf(THREE.InstancedMesh);
    expect((lights as THREE.InstancedMesh).material).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect((lights as THREE.InstancedMesh).count).toBeGreaterThan(20);
  });

  it("所有座位都在底面輪廓內", () => {
    const venue = dome();
    const shell = domeShell();
    const scene = buildVenueScene(venue, "baseball").scene;
    const outside: string[] = [];
    scene.getObjectByName("sections")?.children.forEach((child) => {
      if (!(child instanceof THREE.InstancedMesh)) return;
      const m = new THREE.Matrix4();
      for (let i = 0; i < child.count; i++) {
        child.getMatrixAt(i, m);
        const p = new THREE.Vector3().setFromMatrixPosition(m);
        if (!pointInPolygon(shell.outline, { x: p.x, z: p.z })) outside.push(`${child.name}#${i}`);
      }
    });
    expect(outside).toEqual([]);
  });
});

describe("buildVenueScene 與 shell", () => {
  it("有 shell 的場館才有外殼：大巨蛋有、示範館沒有", () => {
    expect(buildVenueScene(dome(), "baseball").scene.getObjectByName("shell")).toBeDefined();
    expect(buildVenueScene(parseVenue(demoArenaJson), "concert").scene.getObjectByName("shell")).toBeUndefined();
  });

  it("鳥瞰（除錯）時藏起屋頂與格柵，才看得到裡面；座位視角再顯示", () => {
    const venueScene = buildVenueScene(dome(), "baseball");
    const roof = venueScene.scene.getObjectByName("shell-roof");
    const lattice = venueScene.scene.getObjectByName("shell-lattice");
    venueScene.setRoofVisible(false);
    expect(roof?.visible).toBe(false);
    expect(lattice?.visible).toBe(false);
    venueScene.setRoofVisible(true);
    expect(roof?.visible).toBe(true);
  });

  it("dispose：外殼的 geometry、material、InstancedMesh 全部釋放", () => {
    const venueScene = buildVenueScene(dome(), "baseball");
    const spies: ReturnType<typeof vi.spyOn>[] = [];
    venueScene.scene.getObjectByName("shell")?.traverse((object) => {
      if (object instanceof THREE.InstancedMesh) spies.push(vi.spyOn(object, "dispose"));
      if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
        spies.push(vi.spyOn(object.geometry, "dispose"));
        spies.push(vi.spyOn(object.material as THREE.Material, "dispose"));
      }
    });
    // 牆、接縫、屋頂、格柵各 (geometry + material)，燈是 InstancedMesh + geometry + material
    expect(spies).toHaveLength(4 * 2 + 3);
    venueScene.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalled();
  });
});
