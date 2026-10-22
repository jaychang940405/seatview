import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { parseVenue } from "../core/schema";
import { seatPosition } from "../core/seat";
import { getSeatView } from "../core/view";
import demoArenaJson from "../venues/demo-arena.json";
import { applyCameraPose, createSeatCamera } from "./camera";

/*
 * 左右鏡像檢查。
 * 場館左右對稱時，人眼很難發現整個畫面左右顛倒，所以用投影來檢查：
 * core 判定在觀眾右手邊（horizontalDeg > 0）的東西，畫面上也必須在右側（NDC x > 0）。
 */

const demo = () => parseVenue(demoArenaJson);

/** 從 A1 第 1 排 16 號（場館正中線上、面向舞台）看出去的相機。 */
function cameraAtA1Center(): THREE.PerspectiveCamera {
  const camera = createSeatCamera(16 / 9);
  applyCameraPose(camera, getSeatView(demo(), "concert", "A1", 1, 16).camera);
  return camera;
}

function projectSeat(camera: THREE.PerspectiveCamera, sectionId: string, row: number, seat: number) {
  const p = seatPosition(demo(), sectionId, row, seat);
  return new THREE.Vector3(p.x, p.y, p.z).project(camera);
}

describe("畫面不鏡像", () => {
  it("F1 的 1 號（觀眾左手邊）在畫面左側，40 號（右手邊）在右側", () => {
    const camera = cameraAtA1Center();
    expect(projectSeat(camera, "F1", 1, 1).x).toBeLessThan(0);
    expect(projectSeat(camera, "F1", 1, 40).x).toBeGreaterThan(0);
  });

  it("core 的 horizontalDeg 正負號 = 畫面上的左右", () => {
    const venue = demo();
    const camera = cameraAtA1Center();
    for (let seat = 1; seat <= 40; seat++) {
      const { horizontalDeg } = getSeatView(venue, "concert", "F1", 1, seat).metrics;
      const ndc = projectSeat(camera, "F1", 1, seat);
      expect(Math.sign(ndc.x)).toBe(Math.sign(horizontalDeg));
    }
  });

  it("比視線低的搖滾區在畫面下半部（上下也沒顛倒）", () => {
    expect(projectSeat(cameraAtA1Center(), "F1", 1, 20).y).toBeLessThan(0);
  });
});
