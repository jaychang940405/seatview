import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { pointInPolygon } from "../../scripts/outline.ts";
import { parseVenue } from "../core/schema";
import type { Vec3 } from "../core/schema";
import { sectionSeats } from "../core/seat";
import { roofHeightAt, screenCorners, screenNormal } from "../core/shell";
import demoArenaJson from "../venues/demo-arena.json";
import taipeiDomeJson from "../venues/taipei-dome.json";
import { buildVenueScene } from "./scene";
import { CHAIR } from "./seats";
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
  it("牆、牆面接縫、屋頂、屋頂格柵、屋頂邊緣的燈、大螢幕", () => {
    const group = buildShell(domeShell(), "baseball");
    expect(group.name).toBe("shell");
    expect(group.children.map((c) => c.name).sort()).toEqual(["shell-lattice", "shell-lights", "shell-roof", "shell-screens", "shell-seams", "shell-wall"]);
  });

  it("牆：從地面到牆頂，頂點都在底面輪廓上", () => {
    const shell = domeShell();
    const wall = vertices(buildShell(shell, "baseball").getObjectByName("shell-wall"));
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
    const roof = vertices(buildShell(shell, "baseball").getObjectByName("shell-roof"));
    for (const v of roof) expect(Math.abs(v.y - roofHeightAt(shell, { x: v.x, z: v.z }))).toBeLessThan(0.01);
    expect(Math.max(...roof.map((v) => v.y))).toBeCloseTo(shell.roofHeight, 2);
  });

  it("格柵：每個頂點都在殼面上（容差 1 cm），而且在底面輪廓內", () => {
    const shell = domeShell();
    const lattice = vertices(buildShell(shell, "baseball").getObjectByName("shell-lattice"));
    expect(lattice.length).toBeGreaterThan(100);
    for (const v of lattice) {
      expect(Math.abs(v.y - roofHeightAt(shell, { x: v.x, z: v.z }))).toBeLessThan(0.01);
      expect(pointInPolygon(shell.outline, { x: v.x, z: v.z })).toBe(true);
    }
  });

  it("屋頂邊緣的燈會自己發光（不受場景光線影響）", () => {
    const lights = buildShell(domeShell(), "baseball").getObjectByName("shell-lights");
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

  it("鳥瞰（除錯）時藏起整個外殼（38 m 的牆會擋住裡面）；座位視角再顯示", () => {
    const venueScene = buildVenueScene(dome(), "baseball");
    const shell = venueScene.scene.getObjectByName("shell");
    venueScene.setShellVisible(false);
    expect(shell?.visible).toBe(false);
    venueScene.setShellVisible(true);
    expect(shell?.visible).toBe(true);
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
    // 牆、接縫、屋頂、格柵各 (geometry + material)，燈是 InstancedMesh + geometry + material，
    // 三塊螢幕各有螢幕面與外框 (geometry + material)
    expect(spies).toHaveLength(4 * 2 + 3 + 3 * 2 * 2);
    venueScene.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalled();
  });
});

describe("大螢幕（牆面上三塊，C 級）", () => {
  const PLATE = { x: 0, y: 0, z: 60.95 };
  // 一定要有三塊：沒有資料時迴圈跑零次，測試會「空轉通過」
  const screens = () => {
    const list = domeShell().screens ?? [];
    if (list.length !== 3) throw new Error(`應該有 3 塊螢幕，實際 ${list.length} 塊`);
    return list;
  };
  const sub = (a: Vec3, b: Vec3) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
  const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;

  /** 點到螢幕長方形的 3D 距離（角依序左下、右下、右上、左上）。 */
  function distanceToScreen(p: Vec3, corners: Vec3[]): number {
    const [a, b, , d] = corners;
    if (!a || !b || !d) throw new Error("角不足");
    const [u, v, w] = [sub(b, a), sub(d, a), sub(p, a)];
    const s = THREE.MathUtils.clamp(dot(w, u) / dot(u, u), 0, 1);
    const t = THREE.MathUtils.clamp(dot(w, v) / dot(v, v), 0, 1);
    const closest = { x: a.x + s * u.x + t * v.x, y: a.y + s * u.y + t * v.y, z: a.z + s * u.z + t * v.z };
    return Math.hypot(p.x - closest.x, p.y - closest.y, p.z - closest.z);
  }

  it("中外野 28 × 9 m（底邊約 20 m）、左右外野角落各 9 × 5 m；只在棒球亮", () => {
    const byId = Object.fromEntries(screens().map((s) => [s.id, s]));
    expect(Object.keys(byId).sort()).toEqual(["center-field", "left-corner", "right-corner"]);
    expect(byId["center-field"]).toMatchObject({ width: 28, height: 9, onLayouts: ["baseball"] });
    expect((byId["center-field"]?.center.y ?? 0) - 4.5).toBeCloseTo(20, 1);
    for (const id of ["left-corner", "right-corner"]) expect(byId[id]).toMatchObject({ width: 9, height: 5, onLayouts: ["baseball"] });
  });

  it("螢幕所有頂點都在底面輪廓內，而且低於牆頂", () => {
    const shell = domeShell();
    const group = buildShell(shell, "baseball");
    for (const screen of screens()) {
      for (const v of vertices(group.getObjectByName(`screen:${screen.id}`))) {
        expect(pointInPolygon(shell.outline, { x: v.x, z: v.z }), screen.id).toBe(true);
        expect(v.y, screen.id).toBeLessThan(shell.wallHeight);
      }
    }
  });

  it("螢幕離所有座位至少 1 m（座位地面與椅背頂都算；含二層後排），不會穿過座椅", () => {
    const venue = dome();
    for (const screen of screens()) {
      const corners = screenCorners(screen);
      let nearest = Infinity;
      for (const section of venue.sections) {
        for (const { position } of sectionSeats(venue, section.id)) {
          nearest = Math.min(nearest, distanceToScreen(position, corners), distanceToScreen({ ...position, y: position.y + CHAIR.backTop }, corners));
        }
      }
      expect(nearest, screen.id).toBeGreaterThanOrEqual(1);
    }
  });

  it("螢幕面朝本壘：法向量與（螢幕中心 → 本壘）的夾角 < 60°", () => {
    for (const screen of screens()) {
      const n = screenNormal(screen);
      const toPlate = { x: PLATE.x - screen.center.x, z: PLATE.z - screen.center.z };
      const cos = (n.x * toPlate.x + n.z * toPlate.z) / Math.hypot(toPlate.x, toPlate.z);
      expect(THREE.MathUtils.radToDeg(Math.acos(cos)), screen.id).toBeLessThan(60);
    }
  });

  it("棒球：三塊都亮（自己發光的材質）；演唱會：三塊都是熄滅的深色材質", () => {
    const shell = domeShell();
    for (const [layoutId, lit] of [["baseball", true], ["concert", false]] as const) {
      const group = buildShell(shell, layoutId);
      for (const screen of screens()) {
        const mesh = group.getObjectByName(`screen:${screen.id}`) as THREE.Mesh;
        expect(mesh.material instanceof THREE.MeshBasicMaterial, `${layoutId}/${screen.id}`).toBe(lit);
        expect(group.getObjectByName(`screen-frame:${screen.id}`), `${layoutId}/${screen.id} 外框`).toBeDefined();
      }
    }
  });
});
